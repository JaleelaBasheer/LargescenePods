import React, { useState, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { MeshBVH, MeshBVHHelper } from 'three-mesh-bvh';
import LoadingBar from './LoadingBar';


// Octree implementation
class Octree {
    constructor(center, size) {
      this.center = center;
      this.size = size;
      this.children = [];
      this.objects = [];
      this.divided = false;
      this.boundingBox = new THREE.Box3().setFromCenterAndSize(this.center, new THREE.Vector3(this.size, this.size, this.size));
    }
  subdivide() {
    const { x, y, z } = this.center;
    const newSize = this.size / 2;
    const offset = newSize / 2;

    this.children = [
      new Octree(new THREE.Vector3(x - offset, y - offset, z - offset), newSize),
      new Octree(new THREE.Vector3(x + offset, y - offset, z - offset), newSize),
      new Octree(new THREE.Vector3(x - offset, y + offset, z - offset), newSize),
      new Octree(new THREE.Vector3(x + offset, y + offset, z - offset), newSize),
      new Octree(new THREE.Vector3(x - offset, y - offset, z + offset), newSize),
      new Octree(new THREE.Vector3(x + offset, y - offset, z + offset), newSize),
      new Octree(new THREE.Vector3(x - offset, y + offset, z + offset), newSize),
      new Octree(new THREE.Vector3(x + offset, y + offset, z + offset), newSize),
    ];
    this.divided = true;
  }

  insert(object) {
    if (!this.containsPoint(object.position)) return false;

    if (this.objects.length < 8 && !this.divided) {
      this.objects.push(object);
      return true;
    }

    if (!this.divided) this.subdivide();

    for (const child of this.children) {
      if (child.insert(object)) return true;
    }

    return false;
  }

  containsPoint(point) {
    return (
      point.x >= this.center.x - this.size / 2 &&
      point.x < this.center.x + this.size / 2 &&
      point.y >= this.center.y - this.size / 2 &&
      point.y < this.center.y + this.size / 2 &&
      point.z >= this.center.z - this.size / 2 &&
      point.z < this.center.z + this.size / 2
    );
  }
  intersectsFrustum(frustum) {
    return frustum.intersectsBox(this.boundingBox);
  }

  getVisibleOctants(frustum) {
    let count = 0;
    if (this.intersectsFrustum(frustum)) {
      count = 1;
      if (this.divided) {
        for (const child of this.children) {
          count += child.getVisibleOctants(frustum);
        }
      }
    }
    return count;
  }
}

function RandomFBXFiles() {
  const [files, setFiles] = useState([]);
  const [boundingBox, setBoundingBox] = useState(null);
  const [objectCount, setObjectCount] = useState(0);
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const rendererRef = useRef(null);
  const cameraRef = useRef(null);
  const controlsRef = useRef(null);
  const cumulativeBoundingBoxRef = useRef(new THREE.Box3());
  const octreeRef = useRef(null);
  const octreeVisualizerRef = useRef(null);
  const [visibleOctants, setVisibleOctants] = useState(0);
  
  const raycasterRef = useRef(new THREE.Raycaster());
  const [frustumCulledCount, setFrustumCulledCount] = useState(0);
  const [frustumUnculledCount, setFrustumUnculledCount] = useState(0);
  const [occlusionCulledCount, setOcclusionCulledCount] = useState(0);
  const [occlusionUnculledCount, setOcclusionUnculledCount] = useState(0);
  const [totalMeshes, setTotalMeshes] = useState(0);
  const [totalFiles, setTotalFiles] = useState(0);
  const mouse = useRef({ x: 0, y: 0 });
  const isMouseDown = useRef(false);
  const isPanning = useRef(false);
  const isZooming = useRef(false);
  const lastMouseMovement = useRef({ x: 0, y: 0 });
  const [flySpeed, setFlySpeed] = useState(1); 
  const [flyrotationSpeed, setflyrotationSpeed] = useState(1); 
  const [loadingProgress, setLoadingProgress] = useState(0);


  useEffect(() => {
    initScene();
    return () => {
      if (rendererRef.current) {
        rendererRef.current.dispose();
      }
    };
  }, []);

  const initScene = () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    const renderer = new THREE.WebGLRenderer();
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x00ffff);
    mountRef.current.appendChild(renderer.domElement);

    // const controls = new OrbitControls(camera, renderer.domElement);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
    directionalLight.position.set(1, 1, 1);
    scene.add(directionalLight);

    sceneRef.current = scene;
    cameraRef.current = camera;
    rendererRef.current = renderer;
    // controlsRef.current = controls;

    animate();
  };

  const animate = () => {
    requestAnimationFrame(animate);
    if (controlsRef.current) controlsRef.current.update();
    if (rendererRef.current && sceneRef.current && cameraRef.current) {
      rendererRef.current.render(sceneRef.current, cameraRef.current);
      updateCullingStats();
    }
  };
  useEffect(() => {
    enablefycontrols();
    return () => {
        disableflycontrols();
    };
}, [flySpeed, flyrotationSpeed]);

 

  const handleFileChange = async (event) => {
    const selectedFiles = Array.from(event.target.files);
    setFiles(selectedFiles);
    await processFiles(selectedFiles);
  };

  const processFiles = async (selectedFiles) => {
    const fbxLoader = new FBXLoader();
    cumulativeBoundingBoxRef.current.makeEmpty();
    setTotalFiles(selectedFiles.length); // Set total files count
    setLoadingProgress(0); // Reset loading progress

    const loadFile = (file,index) => {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const arrayBuffer = e.target.result;
                const blob = new Blob([arrayBuffer], { type: file.type });
                const objectUrl = URL.createObjectURL(blob);

                fbxLoader.load(
                    objectUrl,
                    (object) => {
                        sceneRef.current.add(object);
                        const objectBoundingBox = new THREE.Box3().setFromObject(object);
                        cumulativeBoundingBoxRef.current.union(objectBoundingBox);

                        let newObjectCount = 0;
                        object.traverse((child) => {
                            if (child.isMesh) {
                                child.geometry.boundsTree = new MeshBVH(child.geometry);
                                const bvhHelper = new MeshBVHHelper(child);
                                sceneRef.current.add(bvhHelper);
                                bvhHelper.visible = false;
                                newObjectCount += 1;
                            }
                        });

                        setObjectCount((prevCount) => prevCount + newObjectCount);
                        setLoadingProgress(((index + 1) / selectedFiles.length) * 100); // Update loading progress
                        URL.revokeObjectURL(objectUrl);
                        resolve();
                    },
                    undefined,
                    (error) => {
                        console.error('Error loading FBX file:', error);
                        resolve();
                    }
                );
            };
            reader.readAsArrayBuffer(file);
        });
    };

    await Promise.all(selectedFiles.map(loadFile));

    setBoundingBox(cumulativeBoundingBoxRef.current);
    createBoxInScene();
    createOctree();
};



  const createBoxInScene = () => {
    if (sceneRef.current) {
      const existingBox = sceneRef.current.getObjectByName('boundingBox');
      if (existingBox) sceneRef.current.remove(existingBox);

      const box = cumulativeBoundingBoxRef.current;
      if (box.isEmpty()) {
        console.log('Bounding box is empty');
        return;
      }

      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      console.log(center)
      const geometry = new THREE.BoxGeometry(size.x, size.y, size.z);
      const material = new THREE.MeshBasicMaterial({ color: 0x00ff00, wireframe: true });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = 'boundingBox';
      mesh.position.copy(center);
      // sceneRef.current.add(mesh);

      const maxDim = Math.max(size.x, size.y, size.z);
      const fov = cameraRef.current.fov * (Math.PI / 180);
      let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));
      cameraZ *= 1.5;

      cameraRef.current.position.set(center.x, center.y, center.z + cameraZ);
      cameraRef.current.lookAt(center);
      // controlsRef.current.target.copy(center);
      // controlsRef.current.update();
    }
  };

  const createOctree = () => {
    if (sceneRef.current && cumulativeBoundingBoxRef.current) {
      const box = cumulativeBoundingBoxRef.current;
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const maxSize = Math.max(size.x, size.y, size.z);
    
      octreeRef.current = new Octree(center, maxSize);

      sceneRef.current.traverse((child) => {
        if (child.isMesh) {
          octreeRef.current.insert(child);
        }
      });

      if (octreeVisualizerRef.current) {
        sceneRef.current.remove(octreeVisualizerRef.current);
      }
      octreeVisualizerRef.current = visualizeOctree(octreeRef.current);
      // sceneRef.current.add(octreeVisualizerRef.current);
    }
  };

  const visualizeOctree = (octree, depth = 0) => {
    const group = new THREE.Group();
    
    // Create a box for this octree node
    const geometry = new THREE.BoxGeometry(octree.size, octree.size, octree.size);
    
    // Change the color based on the depth
    const color = new THREE.Color();
    color.setHSL(depth / 10, 1.0, 0.5); // Gradually change color by depth
    
    const material = new THREE.MeshBasicMaterial({ 
      color: color,
      transparent: true,
      opacity: 0.4, // Make it semi-transparent
      wireframe: true
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(octree.center);
    group.add(mesh);
  
    // Add a small sphere at the center of the node (optional)
    const sphereGeometry = new THREE.SphereGeometry(octree.size * 0.02);
    const sphereMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
    sphere.position.copy(octree.center);
    group.add(sphere);
  
    // Recursively visualize children
    if (octree.divided) {
      octree.children.forEach(child => {
        group.add(visualizeOctree(child, depth + 1));
      });
    }
  
    return group;
  };
  
  const updateCullingStats = () => {
    const camera = cameraRef.current;
    const frustum = new THREE.Frustum();
    const cameraViewProjectionMatrix = new THREE.Matrix4();
    
    // Update camera matrices
    camera.updateMatrixWorld();
    cameraViewProjectionMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(cameraViewProjectionMatrix);
  
    let frustumCulled = 0;
    let frustumUnculled = 0;
    let occlusionCulled = 0;
    let occlusionUnculled = 0;
    const objectsToCheck = [];
    
    // Traverse scene and perform frustum culling
    sceneRef.current.traverse((child) => {
      if (child.isMesh) {
        const boundingBox = new THREE.Box3().setFromObject(child);
        
        // Frustum culling
        if (frustum.intersectsBox(boundingBox)) {
          frustumUnculled++;
          objectsToCheck.push(child); // Save for occlusion check
        } else {
          frustumCulled++;
          child.visible = false; // Hide objects outside the frustum
        }
      }
    });
  
    // Perform raycasting for occlusion culling
    const raycaster = new THREE.Raycaster();
    objectsToCheck.forEach((obj) => {
      // Compute the bounding sphere for more accurate raycasting
      obj.geometry.computeBoundingSphere();
      const boundingSphere = obj.geometry.boundingSphere;
      const direction = boundingSphere.center.clone().sub(camera.position).normalize();
      
      // Set ray from the camera to the object's bounding sphere center
      raycaster.set(camera.position, direction);
      
      // Perform raycasting against all objects within the frustum
      const intersects = raycaster.intersectObjects(objectsToCheck, true);
      
      if (intersects.length > 0) {
        // Check if any object is blocking the current object
        const closestIntersect = intersects[0];
        
        if (closestIntersect.object !== obj && closestIntersect.distance < boundingSphere.center.distanceTo(camera.position)) {
          // An object is blocking this one, mark it occluded
          obj.visible = false;
          occlusionCulled++;
        } else {
          // No object blocking this one, mark it visible
          obj.visible = true;
          occlusionUnculled++;
        }
      } else {
        // No intersections, make the object visible
        obj.visible = true;
        occlusionUnculled++;
      }
    });
  
    // Update stats
    setFrustumCulledCount(frustumCulled);
    setFrustumUnculledCount(frustumUnculled);
    setOcclusionCulledCount(occlusionCulled);
    setOcclusionUnculledCount(occlusionUnculled);
    setTotalMeshes(frustumCulled + frustumUnculled); // Total meshes
  };
  
  

let continueTranslation = false;
let continueRotation = false;
let translationDirection = 0;
let rotationDirection = 0;
let translationSpeed = 5; // Initial translation speed
let rotationSpeed = 0.0001; // Initial rotation speed
// Define sensitivity constants
const horizontalSensitivity = 1.1; // Adjust as needed
const verticalSensitivity = 1.1; // Adjust as needed

// mouse events functions on fly control
const handleMouseUp = () => {
  isMouseDown.current = false;
  isPanning.current = false;
  isZooming.current = false;    
  lastMouseMovement.current = { x: 0, y: 0 };
  continueTranslation = false;
  continueRotation = false;
};
const handleMouseDown = (event) => {
    const mouseEvent = event.touches ? event.touches[0] : event;
    if (mouseEvent.button === 0) { // Left mouse button pressed
      isMouseDown.current = true;
      mouse.current.x = mouseEvent.clientX;
      mouse.current.y = mouseEvent.clientY;
      isZooming.current = true;
      continueTranslation = true; // Enable automatic translation
      continueRotation = true; // Enable automatic rotation
      translationDirection = lastMouseMovement.current.y > 0 ? 1 : -1; // Set translation direction based on last mouse movement
      rotationDirection = lastMouseMovement.current.x > 0 ? 1 : -1; // Set rotation direction based on last mouse movement
    } else if (mouseEvent.button === 1) { // Middle mouse button pressed
      console.log("middlebutton pressed");
      isPanning.current = true;
      continueTranslation = true; // Enable automatic translation
      mouse.current.x = mouseEvent.clientX;
      mouse.current.y = mouseEvent.clientY;
    }
  };
 
  const handleMouseMove = (event) => {
    event.preventDefault();

    const mouseEvent = event.touches ? event.touches[0] : event;
    if (!isMouseDown.current && !isPanning.current && !isZooming.current) return;

    const movementX = mouseEvent.clientX - mouse.current.x;
    const movementY = mouseEvent.clientY - mouse.current.y;

    lastMouseMovement.current = { x: movementX, y: movementY };
    if (isMouseDown.current) { // Left mouse button clicked
      const isHorizontal = Math.abs(movementX) > Math.abs(movementY);
      if (isHorizontal) { // Horizontal movement, rotate around Y axis
        continueCameraMovement(); 
      } else { // Vertical movement, forward/backward
        continueCameraMovement(); // Adjust with factors
      }
    } else if (isPanning.current) { // Middle mouse button clicked
      continueCameraMovement(movementX, movementY); // Adjust with factors
    }

    mouse.current.x = mouseEvent.clientX;
    mouse.current.y = mouseEvent.clientY;
  };

  const continueCameraMovement = () => {
    const adjustedTranslationSpeed = flySpeed * translationSpeed;
    if (isMouseDown.current && (continueTranslation || continueRotation)) {
      requestAnimationFrame(continueCameraMovement);
      const movementX = lastMouseMovement.current.x;
      const movementY = lastMouseMovement.current.y;
      const tileSizeFactor = 10; // Implement this function to calculate the factor based on tile size
      const isHorizontal = Math.abs(movementX) > Math.abs(movementY);
      if (isHorizontal) {
        const rotationAngle = -movementX * rotationSpeed * horizontalSensitivity * flyrotationSpeed * tileSizeFactor;

        // Get the camera's up vector
        let cameraUp = cameraRef.current.up.clone().normalize();
        
        // Create a quaternion representing the rotation around the camera's up vector
        let quaternion = new THREE.Quaternion().setFromAxisAngle(cameraUp, rotationAngle);
        
        cameraRef.current.applyQuaternion(quaternion);
      } else {
        const zoomSpeed = movementY * 0.01; // Adjust zoom speed based on last recorded mouse movement

        const forwardDirection = new THREE.Vector3(0, 0, 1).applyQuaternion(cameraRef.current.quaternion);
        // Move the camera forward/backward along its local forward direction
        cameraRef.current.position.add(forwardDirection.multiplyScalar(zoomSpeed * adjustedTranslationSpeed * tileSizeFactor));
      }			
    } else if (isPanning.current && continueTranslation) {
      requestAnimationFrame(continueCameraMovement);
      const tileSizeFactor = 0.1;
      const movementY = lastMouseMovement.current.y;
      const movementX = lastMouseMovement.current.x;
      const adjustedHorizontalSensitivity = horizontalSensitivity * tileSizeFactor;
      const adjustedVerticalSensitivity = verticalSensitivity * tileSizeFactor;

      // Calculate movement speed based on mouse movement and sensitivity
      const moveSpeedX = movementX * adjustedHorizontalSensitivity;
      const moveSpeedY = movementY * adjustedVerticalSensitivity;
      
      const isHorizontal = Math.abs(movementX) > Math.abs(movementY);
      const isVertical = Math.abs(movementY) > Math.abs(movementX);
    
      if (isHorizontal) {
        // Move the camera along its local x axis
        cameraRef.current.translateX(moveSpeedX);
      } else if (isVertical) {
        // Move the camera along its local y axis
        cameraRef.current.translateY(-moveSpeedY);
      }
    }
  };

    // enablefycontrols
    const enablefycontrols=()=>{
    
        document.addEventListener('mousedown', handleMouseDown);
        document.addEventListener('mouseup', handleMouseUp);
        document.addEventListener('mousemove', handleMouseMove);
        
        // document.addEventListener('wheel', handleWheel);
    }
    // disableflycontrols
    const disableflycontrols=()=>{
        document.removeEventListener('mousedown', handleMouseDown);
        document.removeEventListener('mouseup', handleMouseUp);
        document.removeEventListener('mousemove', handleMouseMove);    
        // document.removeEventListener('wheel', handleWheel);
    }
    const fitView=()=>{
        const box = cumulativeBoundingBoxRef.current;
        if (box.isEmpty()) {
          console.log('Bounding box is empty');
          return;
        }
  
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const fov = cameraRef.current.fov * (Math.PI / 180);
        let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));
        cameraZ *= 1.5;
  
        cameraRef.current.position.set(center.x, center.y, center.z + cameraZ);
        cameraRef.current.lookAt(center);
    }
return (
    <div >     
        <div ref={mountRef}  style={{width:'100%',height:'100px'}}  />
        <input type="file" multiple onChange={handleFileChange} accept=".fbx" />
        {/* <LoadingBar progress={loadingProgress} /> */}
        <button onClick={fitView} className='btn'>fitview</button>
        {boundingBox && (
            <div>
                <h3>Cumulative Bounding Box:</h3>
                <p>Min: {JSON.stringify(boundingBox.min)}</p>
                <p>Max: {JSON.stringify(boundingBox.max)}</p>
            </div>
        )}
        <div>
            <h3>Rendering Scope:</h3>
            <p>Total Files: {totalFiles}</p>
            <p>Total Meshes: {totalMeshes}</p>
            <p>Frustum Culled Count: {frustumCulledCount}</p>
            <p>Frustum Unculled Count: {frustumUnculledCount}</p>
            <p>Occlusion Culled Count: {occlusionCulledCount}</p>
            <p>Occlusion Unculled Count: {occlusionUnculledCount}</p>
        </div>
       
    </div>
);

}

export default RandomFBXFiles;

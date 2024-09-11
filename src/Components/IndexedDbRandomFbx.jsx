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

function IndexedDbRandomFbx() {
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
  const [dbReady, setDbReady] = useState(false);
  const dbRef = useRef(null);
  const [octreeReady, setOctreeReady] = useState(false);

  const meshesLoadedRef = useRef(false);

  useEffect(() => {
    initIndexedDB();
    initScene();
    return () => {
      if (rendererRef.current) {
        rendererRef.current.dispose();
      }
    };
  }, []);

  useEffect(() => {
    if (dbRef.current) {
      loadMeshesFromIndexedDB();
    }
  }, [dbRef.current]);

  const initIndexedDB = () => {
    const request = indexedDB.open('3DSceneDB', 1);

    request.onerror = (event) => {
      console.error('IndexedDB error:', event.target.error);
    };

    request.onsuccess = (event) => {
      dbRef.current = event.target.result;
      setDbReady(true);
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      db.createObjectStore('sceneData', { keyPath: 'id' });
      db.createObjectStore('meshes', { keyPath: 'id' });
    };
  };

  const initScene = () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 100);
    const renderer = new THREE.WebGLRenderer();
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x000fff);
    mountRef.current.appendChild(renderer.domElement);

     const controls = new OrbitControls(camera, renderer.domElement);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
    directionalLight.position.set(1, 1, 1);
    scene.add(directionalLight);

    sceneRef.current = scene;
    cameraRef.current = camera;
    rendererRef.current = renderer;
    controlsRef.current = controls;

    const animate = () => {
        requestAnimationFrame(animate);
        controlsRef.current.update();
        rendererRef.current.render(sceneRef.current, cameraRef.current);
        if (octreeReady) {
          updateCullingStats();
        }
      };
    animate();
  };

  const handleFileChange = async (event) => {
    const selectedFiles = Array.from(event.target.files);
    setFiles(selectedFiles);
    await processFiles(selectedFiles);
  };

  const processFiles = async (selectedFiles) => {
    const fbxLoader = new FBXLoader();
    cumulativeBoundingBoxRef.current.makeEmpty();
    setTotalFiles(selectedFiles.length);
    setLoadingProgress(0);

    const loadFile = (file, index) => {
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
          const arrayBuffer = e.target.result;
          const blob = new Blob([arrayBuffer], { type: file.type });
          const objectUrl = URL.createObjectURL(blob);

          fbxLoader.load(
            objectUrl,
            async (object) => {
              const objectBoundingBox = new THREE.Box3().setFromObject(object);
              cumulativeBoundingBoxRef.current.union(objectBoundingBox);

              let newObjectCount = 0;
              object.traverse((child) => {
                if (child.isMesh) {
                  child.geometry.boundsTree = new MeshBVH(child.geometry);
                  newObjectCount += 1;
                  
                  // Store mesh data in IndexedDB
                  const meshData = {
                    id: child.uuid,
                    geometry: child.geometry.toJSON(),
                    material: child.material.toJSON(),
                    matrix: child.matrix.toArray()
                  };
                  storeInIndexedDB('meshes', meshData);
                }
              });

              setObjectCount((prevCount) => prevCount + newObjectCount);
              setLoadingProgress(((index + 1) / selectedFiles.length) * 100);
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

    // Store scene data in IndexedDB
    const sceneData = {
      id: 'sceneData',
      boundingBox: {
        min: cumulativeBoundingBoxRef.current.min.toArray(),
        max: cumulativeBoundingBoxRef.current.max.toArray()
      },
      cameraPosition: cameraRef.current.position.toArray(),
      cameraTarget: controlsRef.current.target.toArray()
    };
    await storeInIndexedDB('sceneData', sceneData);

    setBoundingBox(cumulativeBoundingBoxRef.current);
    createBoxInScene();
    await createOctree();
    loadMeshesFromIndexedDB();
  };

  const storeInIndexedDB = (storeName, data) => {
    return new Promise((resolve, reject) => {
      const transaction = dbRef.current.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.put(data);

      request.onerror = (event) => reject(event.target.error);
      request.onsuccess = () => resolve();
    });
  };

  const loadMeshesFromIndexedDB = () => {
    const transaction = dbRef.current.transaction(['sceneData'], 'readonly');
    const store = transaction.objectStore('sceneData');
    const request = store.get('sceneData');

    request.onsuccess = (event) => {
      const sceneData = event.target.result;
      if (sceneData) {
        const boundingBox = new THREE.Box3(
          new THREE.Vector3().fromArray(sceneData.boundingBox.min),
          new THREE.Vector3().fromArray(sceneData.boundingBox.max)
        );
        setBoundingBox(boundingBox);
        createBoxInScene(boundingBox);
        createOctree(boundingBox);
        loadMeshesFromIndexedDB();
      }
    };

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
      controlsRef.current.target.copy(center);
      controlsRef.current.update();
    }
  };

  const createOctree = (boundingBox) => {
    const center = boundingBox.getCenter(new THREE.Vector3());
    const size = boundingBox.getSize(new THREE.Vector3());
    const maxSize = Math.max(size.x, size.y, size.z);
  
    octreeRef.current = new Octree(center, maxSize);
    setOctreeReady(true);
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
    if (!octreeReady || !meshesLoadedRef.current) {
      console.log('Octree or meshes not ready yet');
      return;
    }

    const camera = cameraRef.current;
    const frustum = new THREE.Frustum();
    const cameraViewProjectionMatrix = new THREE.Matrix4();
    
    camera.updateMatrixWorld();
    cameraViewProjectionMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(cameraViewProjectionMatrix);
  
    let frustumCulled = 0;
    let frustumUnculled = 0;
    let occlusionCulled = 0;
    let occlusionUnculled = 0;
    const objectsToCheck = [];
    
    // Perform frustum culling using octree
    const visibleOctants = octreeRef.current.getVisibleOctants(frustum);
    
    visibleOctants.forEach(octant => {
      octant.objects.forEach(obj => {
        const boundingBox = new THREE.Box3().setFromObject(obj);
        if (frustum.intersectsBox(boundingBox)) {
          frustumUnculled++;
          objectsToCheck.push(obj);
        } else {
          frustumCulled++;
          obj.visible = false;
        }
      });
    });
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
<div>     
    <div ref={mountRef} style={{ width: '100%', height: '500px' }} />
    <input type="file" multiple onChange={handleFileChange} accept=".fbx" />
    <LoadingBar progress={loadingProgress} />
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


export default IndexedDbRandomFbx

import React, { useEffect, useRef ,useState} from 'react';
import * as THREE from 'three';
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
  
function TestScene() {
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const camera1Ref = useRef(null);
  const camera2Ref = useRef(null);
  const rendererRef = useRef(null);
  const flyControlsRef = useRef(null);
  const mouse = useRef({ x: 0, y: 0 });
  const isMouseDown = useRef(false);
  const isPanning = useRef(false);
  const isZooming = useRef(false);
  const lastMouseMovement = useRef({ x: 0, y: 0 });
  const [flySpeed, setFlySpeed] = useState(.1); 
  const [flyrotationSpeed, setflyrotationSpeed] = useState(.1); 
  const [insideCount, setInsideCount] = useState(0);
  const [outsideCount, setOutsideCount] = useState(0);
  const [flyInsideStaticFrustum, setFlyInsideStaticFrustum] = useState(false);
  const octreeRef = useRef(null);
  const [visibleOctants, setVisibleOctants] = useState(0);
  useEffect(() => {
    enablefycontrols();
    return () => {
        disableflycontrols();
    };
}, [flySpeed, flyrotationSpeed]);

useEffect(() => {
    sceneRef.current = new THREE.Scene();
    sceneRef.current.background = new THREE.Color(0x000000);

    rendererRef.current = new THREE.WebGLRenderer({ antialias: true });
    rendererRef.current.setSize(window.innerWidth, window.innerHeight);
    mountRef.current.appendChild(rendererRef.current.domElement);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0x404040);
    sceneRef.current.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
    directionalLight.position.set(1, 1, 1);
    sceneRef.current.add(directionalLight);

    // Create random boxes
    const boxes = [];
    for (let i = 0; i < 50; i++) {
      const geometry = new THREE.BoxGeometry(1, 1, 1);
      const material = new THREE.MeshPhongMaterial({ color: Math.random() * 0xffffff });
      const box = new THREE.Mesh(geometry, material);
      box.position.set(
        Math.random() * 40 - 20,
        Math.random() * 40 - 20,
        Math.random() * 40 - 20
      );
      sceneRef.current.add(box);
      boxes.push(box);
    }

    // Calculate cumulative bounding box
    const cumulativeBoundingBox = new THREE.Box3();
    boxes.forEach(box => {
      box.geometry.computeBoundingBox();
      cumulativeBoundingBox.expandByObject(box);
    });


  // Create Octree
  const center = new THREE.Vector3();
  cumulativeBoundingBox.getCenter(center);
  const size = new THREE.Vector3();
  cumulativeBoundingBox.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z);

  octreeRef.current = new Octree(center, maxDim);

  // Insert boxes into Octree
  boxes.forEach(box => {
    octreeRef.current.insert(box);
  });

  // Visualize Octree
  // Visualize Octree
  const octreeHelper = new THREE.Group();
  visualizeOctree(octreeRef.current, octreeHelper, 0);
  sceneRef.current.add(octreeHelper);
    // Set up static camera based on bounding box
    
    const fov = 60;
    const cameraDistance = maxDim / (2 * Math.tan(fov * Math.PI / 360));

    camera2Ref.current = new THREE.PerspectiveCamera(fov, window.innerWidth / window.innerHeight, 0.1, cameraDistance * 3);
    camera2Ref.current.position.copy(center).add(new THREE.Vector3(cameraDistance, cameraDistance, cameraDistance));
    camera2Ref.current.lookAt(center);

    // Fly camera (perspective)
    camera1Ref.current = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera1Ref.current.position.set(center.x, center.y, center.z + maxDim / 2);

    // Add a grid helper for reference
    const gridHelper = new THREE.GridHelper(maxDim * 2, 20);
    sceneRef.current.add(gridHelper);

    // Add axes helper
    const axesHelper = new THREE.AxesHelper(maxDim / 2);
    sceneRef.current.add(axesHelper);

    // Frustum for checking visibility
    const flyFrustum = new THREE.Frustum();
    const staticFrustum = new THREE.Frustum();

    // Animate and render the scene
    function animate() {
      requestAnimationFrame(animate);

      // Update frustum for fly camera
      flyFrustum.setFromProjectionMatrix(
        new THREE.Matrix4().multiplyMatrices(
          camera1Ref.current.projectionMatrix,
          camera1Ref.current.matrixWorldInverse
        )
      );
      const visibleCount = octreeRef.current.getVisibleOctants(flyFrustum);
      setVisibleOctants(visibleCount);
      // Count boxes inside and outside fly camera's frustum
      let inside = 0;
      let outside = 0;
      boxes.forEach(box => {
        if (flyFrustum.containsPoint(box.position)) {
          inside++;
          box.material.emissive.setHex(0x00ff00); // Highlight boxes in view
        } else {
          outside++;
          box.material.emissive.setHex(0x000000); // Reset highlight
        }
      });

      setInsideCount(inside);
      setOutsideCount(outside);

      // Check if fly camera is inside the static camera's frustum
      staticFrustum.setFromProjectionMatrix(
        new THREE.Matrix4().multiplyMatrices(
          camera2Ref.current.projectionMatrix,
          camera2Ref.current.matrixWorldInverse
        )
      );
      const flyCameraPosition = camera1Ref.current.position;
      const isFlyInside = staticFrustum.containsPoint(flyCameraPosition);

      setFlyInsideStaticFrustum(isFlyInside);

      // Render the static camera view (main view)
      rendererRef.current.setViewport(0, 0, window.innerWidth, window.innerHeight);
      rendererRef.current.render(sceneRef.current, camera2Ref.current);

      // Render the fly camera view (picture-in-picture)
      const pipWidth = window.innerWidth / 4;
      const pipHeight = window.innerHeight / 4;
      rendererRef.current.setViewport(
        window.innerWidth - pipWidth, 
        window.innerHeight - pipHeight, 
        pipWidth, 
        pipHeight
      );
      rendererRef.current.setScissor(
        window.innerWidth - pipWidth, 
        window.innerHeight - pipHeight, 
        pipWidth, 
        pipHeight
      );
      rendererRef.current.setScissorTest(true);
      rendererRef.current.render(sceneRef.current, camera1Ref.current);
      rendererRef.current.setScissorTest(false);
    }

    animate();
    // Handle window resize
     const handleResize = () => {
      camera1Ref.current.aspect = window.innerWidth / window.innerHeight;
      camera1Ref.current.updateProjectionMatrix();
      camera2Ref.current.left = -10 * (window.innerWidth / window.innerHeight);
      camera2Ref.current.right = 10 * (window.innerWidth / window.innerHeight);
      camera2Ref.current.top = 10;
      camera2Ref.current.bottom = -10;
      camera2Ref.current.updateProjectionMatrix();
      rendererRef.current.setSize(window.innerWidth, window.innerHeight);
    };

    window.addEventListener('resize', handleResize);

    // Cleanup on component unmount
    return () => {
      window.removeEventListener('resize', handleResize);
      mountRef.current.removeChild(rendererRef.current.domElement);
    };
  }, []);
   // Function to visualize Octree
   function visualizeOctree(node, parent, depth) {
    const colors = [
      0xff0000, // Red
      0x00ff00, // Green
      0x0000ff, // Blue
      0xffff00, // Yellow
      0xff00ff, // Magenta
      0x00ffff, // Cyan
      0xffa500, // Orange
      0x800080  // Purple
    ];

    const color = new THREE.Color(colors[depth % colors.length]);
    const helper = new THREE.Box3Helper(node.boundingBox, color);
    helper.material.transparent = true;
    helper.material.opacity = 0.2 + (depth * 0.1); // Increase opacity for deeper levels
    parent.add(helper);

    if (node.divided) {
      node.children.forEach(child => {
        visualizeOctree(child, parent, depth + 1);
      });
    }
  }
  let continueTranslation = false;
let continueRotation = false;
let translationDirection = 0;
let rotationDirection = 0;
let translationSpeed = 1; // Initial translation speed
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
        let cameraUp = camera1Ref.current.up.clone().normalize();
        
        // Create a quaternion representing the rotation around the camera's up vector
        let quaternion = new THREE.Quaternion().setFromAxisAngle(cameraUp, rotationAngle);
        
        camera1Ref.current.applyQuaternion(quaternion);
      } else {
        const zoomSpeed = movementY * 0.01; // Adjust zoom speed based on last recorded mouse movement

        const forwardDirection = new THREE.Vector3(0, 0, 1).applyQuaternion(camera1Ref.current.quaternion);
        // Move the camera forward/backward along its local forward direction
        camera1Ref.current.position.add(forwardDirection.multiplyScalar(zoomSpeed * adjustedTranslationSpeed * tileSizeFactor));
      }			
    } else if (isPanning.current && continueTranslation) {
      requestAnimationFrame(continueCameraMovement);
      const tileSizeFactor = 0.001;
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
        camera1Ref.current.translateX(moveSpeedX);
      } else if (isVertical) {
        // Move the camera along its local y axis
        camera1Ref.current.translateY(-moveSpeedY);
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

  return  (
    <div>
      <div ref={mountRef}></div>
      <div style={{ position: 'absolute', top: 10, left: 10, color: 'white' }}>
        Boxes inside fly camera: {insideCount}<br />
        Boxes outside fly camera: {outsideCount}<br />
        Fly camera inside static camera frustum: {flyInsideStaticFrustum ? "Yes" : "No"} <br />
        Visible Octants: {visibleOctants}
      </div>
    </div>
  );
};

export default TestScene;
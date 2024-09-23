import React, { useEffect, useRef ,useState} from 'react';
import * as THREE from 'three';
import { FlyControls } from 'three/examples/jsm/controls/FlyControls';

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
  const frustumHelperRef = useRef(null);
  useEffect(() => {
    enablefycontrols();
    return () => {
        disableflycontrols();
    };
}, [flySpeed, flyrotationSpeed]);

  useEffect(() => {
    // Scene, Cameras, Renderer
    sceneRef.current = new THREE.Scene();
    camera1Ref.current = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);  // Fly camera
    camera2Ref.current = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);  // Static camera
    rendererRef.current = new THREE.WebGLRenderer();
    rendererRef.current.setSize(window.innerWidth, window.innerHeight);
    mountRef.current.appendChild(rendererRef.current.domElement);

    // Lighting
     // Lighting
     const ambientLight = new THREE.AmbientLight(0x404040);
     sceneRef.current.add(ambientLight);
 
     const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
     directionalLight.position.set(1, 1, 1);
     sceneRef.current.add(directionalLight);
 
     // Create 50 random cubes
     for (let i = 0; i < 50; i++) {
       const size = Math.random() * 2 + 0.5; // Random size between 0.5 and 2.5
       const geometry = new THREE.BoxGeometry(size, size, size);
       const material = new THREE.MeshStandardMaterial({ 
         color: Math.random() * 0xffffff,
         metalness: Math.random(),
         roughness: Math.random()
       });
       const cube = new THREE.Mesh(geometry, material);
       
       // Random position within a 40x40x40 cube centered at the origin
       cube.position.set(
         Math.random() * 40 - 20,
         Math.random() * 40 - 20,
         Math.random() * 40 - 20
       );
       
       // Random rotation
       cube.rotation.set(
         Math.random() * Math.PI * 2,
         Math.random() * Math.PI * 2,
         Math.random() * Math.PI * 2
       );
       
       sceneRef.current.add(cube);
     }
 

    camera1Ref.current.position.set(0, 0, 30);  // Fly camera
    camera2Ref.current.position.set(30, 30, 30);  // Static camera
    camera2Ref.current.lookAt(0, 0, 0);  // Look at the center of the scene

    // Animate and render the scene
  // Create a frustum helper for the fly camera
  frustumHelperRef.current = new THREE.CameraHelper(camera1Ref.current);
  sceneRef.current.add(frustumHelperRef.current);

  // Animate and render the scene
  function animate() {
    requestAnimationFrame(animate);

    // Update the frustum helper to match the fly camera's current state
    frustumHelperRef.current.update();

    // Render the main view (fly camera)
    rendererRef.current.setViewport(0, 0, window.innerWidth, window.innerHeight);
    rendererRef.current.setScissorTest(false);
    rendererRef.current.render(sceneRef.current, camera1Ref.current);

    // Render the static camera view in the right corner
    const staticViewWidth = window.innerWidth / 3;
    const staticViewHeight = window.innerHeight / 3;
    rendererRef.current.setViewport(
      window.innerWidth - staticViewWidth,
      window.innerHeight - staticViewHeight,
      staticViewWidth,
      staticViewHeight
    );
    rendererRef.current.setScissor(
      window.innerWidth - staticViewWidth,
      window.innerHeight - staticViewHeight,
      staticViewWidth,
      staticViewHeight
    );
    rendererRef.current.setScissorTest(true);
    rendererRef.current.render(sceneRef.current, camera2Ref.current);
  }

  animate();
    // Handle window resize
    const handleResize = () => {
        camera1Ref.current.aspect = window.innerWidth / window.innerHeight;
        camera1Ref.current.updateProjectionMatrix();
        camera2Ref.current.aspect = 1; // Keep the static view square
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

  return <div ref={mountRef} style={{ width: '100%', height: '100vh' }}></div>;
}

export default TestScene;
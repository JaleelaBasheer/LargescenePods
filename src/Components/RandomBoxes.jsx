import React, { useRef, useEffect, useState,useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
// Custom Octree implementation
class Octree {
  constructor(center, size) {
    this.center = center;
    this.size = size;
    this.objects = [];
    this.children = null;
  }

  insert(object) {
    if (this.children !== null) {
      const octant = this.getOctant(object.position);
      if (octant !== -1) {
        this.children[octant].insert(object);
        return;
      }
    }

    this.objects.push(object);

    if (this.children === null && this.objects.length > 8 && this.size > 20) {
      this.split();
    }
  }

  split() {
    const halfSize = this.size / 2;
    this.children = [];
    for (let i = 0; i < 8; i++) {
      const newCenter = new THREE.Vector3(
        this.center.x + (i & 1 ? halfSize : -halfSize),
        this.center.y + (i & 2 ? halfSize : -halfSize),
        this.center.z + (i & 4 ? halfSize : -halfSize)
      );
      this.children.push(new Octree(newCenter, halfSize));
    }

    for (const object of this.objects) {
      const octant = this.getOctant(object.position);
      if (octant !== -1) {
        this.children[octant].insert(object);
      }
    }

    this.objects = [];
  }

  getOctant(position) {
    const dx = position.x - this.center.x;
    const dy = position.y - this.center.y;
    const dz = position.z - this.center.z;
    let octant = 0;
    if (dx > 0) octant |= 1;
    if (dy > 0) octant |= 2;
    if (dz > 0) octant |= 4;
    return octant;
  }

  getObjectsInFrustum(frustum) {
    const objects = [];
    this.getObjectsInFrustumRecursive(frustum, objects);
    return objects;
  }

  getObjectsInFrustumRecursive(frustum, objects) {
    if (!frustum.intersectsBox(new THREE.Box3().setFromCenterAndSize(this.center, new THREE.Vector3(this.size, this.size, this.size)))) {
      return;
    }

    objects.push(...this.objects);

    if (this.children !== null) {
      for (const child of this.children) {
        child.getObjectsInFrustumRecursive(frustum, objects);
      }
    }
  }
}

// Web Worker code
const workerCode = `
  let boxes = [];

  self.onmessage = function(e) {
    const { type, data } = e.data;
    switch(type) {
      case 'init':
        initializeBoxes(data.count, data.volume);
        break;
      case 'update':
        updateBoxes(data.cameraPosition, data.viewportSize);
        break;
    }
  };

  function initializeBoxes(count, volume) {
    boxes = [];
    for (let i = 0; i < count; i++) {
      boxes.push({
        position: [
          Math.random() * volume - volume/2,
          Math.random() * volume - volume/2,
          Math.random() * volume - volume/2
        ],
        rotation: [
          Math.random() * Math.PI,
          Math.random() * Math.PI,
          Math.random() * Math.PI
        ],
        loaded: false,
        screenSize: 0
      });
    }
    self.postMessage({ type: 'initialized', count: boxes.length });
  }

  function updateBoxes(cameraPosition, viewportSize) {
    const updatedBoxes = boxes.map((box, index) => ({
      ...box,
      index,
      screenSize: getScreenSize(box.position, cameraPosition, viewportSize)
    }));

    self.postMessage({ 
      type: 'updated', 
      boxes: updatedBoxes,
      totalBoxes: boxes.length
    });
  }

  function getScreenSize(position, cameraPosition, viewportSize) {
    const dx = position[0] - cameraPosition[0];
    const dy = position[1] - cameraPosition[1];
    const dz = position[2] - cameraPosition[2];
    const distance = Math.sqrt(dx*dx + dy*dy + dz*dz);
    return (50 / distance) * Math.min(viewportSize.width, viewportSize.height);
  }
`;  
  const RandomBoxesScene = () => {
    const mountRef = useRef(null);
    const [stats, setStats] = useState({
        loaded: 0,
        unloaded: 0,
        culled: 0,
        unculled: 0,
        lod1: 0,
        lod2: 0,
        smallSizeUnloaded: 0,
        bufferVolumeOutsideFrustum: 0,
        inBufferZone: 0,
        inFrustum: 0,
        loadedToScene: 0,
        visibleBoxes: 0,
        hiddenBoxes: 0,
        total: 0
      });
      const [activeControls, setActiveControls] = useState('orbit');
      const [flySpeed, setFlySpeed] = useState(1);
      const [flyrotationSpeed, setflyrotationSpeed] = useState(1); 
      const cameraRef = useRef(null);
      const mouse = useRef({ x: 0, y: 0 });
      const isMouseDown = useRef(false);
      const isPanning = useRef(false);
      const isZooming = useRef(false);
      const lastMouseMovement = useRef({ x: 0, y: 0 });
      const orbitControlsRef = useRef(null);
      const sceneRef = useRef(null);
      const rendererRef = useRef(null);
    
      const enableFlyControls = useCallback(() => {
        document.addEventListener('mousedown', handleMouseDown);
        document.addEventListener('mouseup', handleMouseUp);
        document.addEventListener('mousemove', handleMouseMove);
      }, []);
    
      const disableFlyControls = useCallback(() => {
        document.removeEventListener('mousedown', handleMouseDown);
        document.removeEventListener('mouseup', handleMouseUp);
        document.removeEventListener('mousemove', handleMouseMove);
      }, []);
    
    useEffect(() => {
      const currentMount = mountRef.current;
  
      const scene = new THREE.Scene();
      sceneRef.current = scene;
      const camera = new THREE.PerspectiveCamera(75, currentMount.clientWidth / currentMount.clientHeight, 0.1, 2000);
      cameraRef.current = camera;
      const renderer = new THREE.WebGLRenderer();
      rendererRef.current = renderer;
      renderer.setSize(currentMount.clientWidth, currentMount.clientHeight);
      currentMount.appendChild(renderer.domElement);

  
      camera.position.z = 100;
  
      // Lights setup (unchanged)
      const ambientLight = new THREE.AmbientLight(0x404040);
      scene.add(ambientLight);
      const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
      directionalLight.position.set(1, 1, 1);
      scene.add(directionalLight);
  
      // Controls setup
  const orbitControls = new OrbitControls(camera, renderer.domElement);
  orbitControlsRef.current = orbitControls;    
  
      const boxGeometry = new THREE.BoxGeometry(10, 10, 10);
      const materials = {
        lod1: new THREE.MeshPhongMaterial({ color: 0x00ff00 }), // Green for LOD1
        lod2: new THREE.MeshPhongMaterial({ color: 0x0000ff })  // Blue for LOD2
      };
  
      const LOD_THRESHOLDS = {
        HIGH: 90,  // Threshold for LOD1
        LOW: 60,   // Threshold for LOD2
        UNLOAD: 25 // Threshold for unloading (based on screen pixel ratio)
      };
  
      const BUFFER_VOLUME_SIZE = 400; // Size of the buffer volume around the camera
  
      const frustum = new THREE.Frustum();
      const projScreenMatrix = new THREE.Matrix4();
  
      const octree = new Octree(new THREE.Vector3(0, 0, 0), 1000);
  
      const boxes = new Map();
  
      // Web Worker setup
      const blob = new Blob([workerCode], { type: 'application/javascript' });
      const worker = new Worker(URL.createObjectURL(blob));
  
      worker.onmessage = function(e) {
        const { type, boxes: updatedBoxes, totalBoxes } = e.data;
        if (type === 'updated') {
          updateScene(updatedBoxes, totalBoxes);
        }
      };
  
      worker.postMessage({ type: 'init', data: { count: 1000, volume: 1000 } });
  
      const raycaster = new THREE.Raycaster();
  
      function isInBufferVolume(position, cameraPosition) {
        return position.distanceTo(cameraPosition) <= BUFFER_VOLUME_SIZE;
      }

  
     function updateScene(updatedBoxes, totalBoxes) {
  let loaded = 0;
  let unloaded = 0;
  let culled = 0;
  let unculled = 0;
  let lod1Count = 0;
  let lod2Count = 0;
  let smallSizeUnloaded = 0;
  let bufferVolumeOutsideFrustum = 0;
  let inBufferZone = 0;
  let inFrustum = 0;
  let loadedToScene = 0;
  let visibleBoxes = 0;
  let hiddenBoxes = 0;
  let occlusionCulled = 0;

  camera.updateMatrixWorld();
  projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(projScreenMatrix);

  updatedBoxes.forEach(boxData => {
    const position = new THREE.Vector3(...boxData.position);
    const inFrustumView = frustum.containsPoint(position);
    const inBufferVolume = isInBufferVolume(position, camera.position);

    if (inFrustumView || inBufferVolume) {
      // Box is either in frustum or buffer zone, load it to the scene
      let box = boxes.get(boxData.index);
      if (!box) {
        box = new THREE.Mesh(boxGeometry, materials.lod1);
        boxes.set(boxData.index, box);
        scene.add(box);
        octree.insert(box);
        loadedToScene++;
      }

      box.position.set(...boxData.position);
      box.rotation.set(...boxData.rotation);

      if (inFrustumView) {
        inFrustum++;
        if (boxData.screenSize >= LOD_THRESHOLDS.UNLOAD) {
          // Determine LOD
          if (boxData.screenSize >= LOD_THRESHOLDS.HIGH) {
            box.material = materials.lod1;
            lod1Count++;
          } else {
            box.material = materials.lod2;
            lod2Count++;
          }

          // Occlusion culling
          raycaster.set(camera.position, position.clone().sub(camera.position).normalize());
          const intersects = raycaster.intersectObjects(scene.children, true);

          if (intersects.length > 0 && intersects[0].object !== box) {
            box.visible = false;
            culled++;
          } else {
            box.visible = true;
            visibleBoxes++;
            unculled++;
          }
        } else {
          // Box is in frustum but too small
          box.visible = false;
          hiddenBoxes++;
          smallSizeUnloaded++;
        }
      } else {
        // Box is in buffer zone but outside frustum
        box.visible = false;
        hiddenBoxes++;
        bufferVolumeOutsideFrustum++;
      }

      loaded++;
      if (inBufferVolume) inBufferZone++;
    } else {
      // Box is outside both frustum and buffer zone, unload it
      unloaded++;
      const box = boxes.get(boxData.index);
      if (box) {
        scene.remove(box);
        boxes.delete(boxData.index);
      }
    }
  });

  setStats({
    loaded,
    unloaded,
    culled,
    unculled,
    lod1: lod1Count,
    lod2: lod2Count,
    smallSizeUnloaded,
    bufferVolumeOutsideFrustum,
    inBufferZone,
    inFrustum,
    loadedToScene,
    visibleBoxes,
    hiddenBoxes,
    occlusionCulled,
    total: totalBoxes
  });
}
  
      function animate() {
        requestAnimationFrame(animate);
        if (activeControls === 'orbit') {
            orbitControls.update();
          }
  
        worker.postMessage({
          type: 'update',
          data: {
            cameraPosition: camera.position.toArray(),
            viewportSize: { width: currentMount.clientWidth, height: currentMount.clientHeight }
          }
        });
  
        renderer.render(scene, camera);
      }
      animate();
  
      // Handle window resize
    const handleResize = () => {
        camera.aspect = currentMount.clientWidth / currentMount.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(currentMount.clientWidth, currentMount.clientHeight);
      };
      window.addEventListener('resize', handleResize);
      // Cleanup
      return () => {
        window.removeEventListener('resize', handleResize);
        currentMount.removeChild(renderer.domElement);
        worker.terminate();
        orbitControls.dispose();

      };
    }, []);
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
    

    useEffect(() => {
        if (activeControls === 'fly') {
          orbitControlsRef.current.enabled = false;
          enableFlyControls();
        } else {
          orbitControlsRef.current.enabled = true;
          disableFlyControls();
        }
      }, [activeControls, enableFlyControls, disableFlyControls]);
    
      const switchToOrbitControls = useCallback(() => {
        if (activeControls !== 'orbit') {
          const camera = cameraRef.current;
          const orbitControls = orbitControlsRef.current;
          
          // Store the current camera position and rotation
          const position = camera.position.clone();
          const quaternion = camera.quaternion.clone();
          
          setActiveControls('orbit');
          
          // After switching, restore the camera position and rotation
          camera.position.copy(position);
          camera.quaternion.copy(quaternion);
          orbitControls.target.set(0, 0, 0); // Reset orbit controls target
          orbitControls.update();
        }
      }, [activeControls]);
    
      const switchToFlyControls = useCallback(() => {
        if (activeControls !== 'fly') {
          const camera = cameraRef.current;
          
          // Store the current camera position and rotation
          const position = camera.position.clone();
          const quaternion = camera.quaternion.clone();
          
          setActiveControls('fly');
          
          // After switching, restore the camera position and rotation
          camera.position.copy(position);
          camera.quaternion.copy(quaternion);
        }
      }, [activeControls]);
  
    return (
        <div>
        <div ref={mountRef} style={{ width: '100%', height: '100vh' }} />
        <div style={{ position: 'absolute', top: 10, left: 10, color: 'white', backgroundColor: 'rgba(0,0,0,0.5)', padding: '10px' }}>
          <div>Total Boxes: {stats.total}</div>
          <div>Loaded boxes: {stats.loaded}</div>
          <div>Unloaded boxes: {stats.unloaded}</div>
          <div>Culled boxes: {stats.culled}</div>
          <div>Unculled boxes: {stats.unculled}</div>
          <div>Visible Boxes: {stats.visibleBoxes}</div>
          <div>Hidden Boxes: {stats.hiddenBoxes}</div>
          <div>In Frustum: {stats.inFrustum}</div>
          <div style={{ color: '#00ff00' }}>LOD1 (Near): {stats.lod1}</div>
          <div style={{ color: '#0000ff' }}>LOD2 (Far): {stats.lod2}</div>
          <div style={{ color: '#ff9900' }}>Small Size (Hidden): {stats.smallSizeUnloaded}</div>
          <div style={{ color: '#ff00ff' }}>Buffer Volume (Outside Frustum): {stats.bufferVolumeOutsideFrustum}</div>
        </div>
         <div style={{ position: 'absolute', bottom: 10, left: 10 }}>
        <button onClick={switchToOrbitControls} disabled={activeControls === 'orbit'}>
          Orbit Controls
        </button>
        <button onClick={switchToFlyControls} disabled={activeControls === 'fly'}>
          Fly Controls
        </button>
        
      </div>
      </div>
    );
  };
  
  export default RandomBoxesScene;
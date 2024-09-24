import React, { useState, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter';

const TestSceneFbx = () => {
  const [files, setFiles] = useState([]);
  const [convertedFiles, setConvertedFiles] = useState([]);
  const [logMessages, setLogMessages] = useState([]);
  const [isSceneReady, setIsSceneReady] = useState(false);
  const canvasRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const controlsRef = useRef(null);

  useEffect(() => {
    if (canvasRef.current) {
      initScene();
    }
    return () => {
      if (rendererRef.current) {
        rendererRef.current.dispose();
      }
    };
  }, []);

  useEffect(() => {
    if (isSceneReady && convertedFiles.length > 0) {
      loadGLBToScene();
    }
  }, [isSceneReady, convertedFiles]);

  const log = (message) => {
    setLogMessages(prev => [...prev, message]);
    console.log(message);
  };

  const initScene = () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    const renderer = new THREE.WebGLRenderer({ canvas: canvasRef.current, antialias: true });

    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x333333); // Set a dark grey background
    camera.position.set(5, 5, 5);
    camera.lookAt(0, 0, 0);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    // Add lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
    directionalLight.position.set(1, 1, 1);
    scene.add(directionalLight);

    // Add a grid helper
    const gridHelper = new THREE.GridHelper(10, 10);
    scene.add(gridHelper);

    // Add axes helper
    const axesHelper = new THREE.AxesHelper(5);
    scene.add(axesHelper);

    sceneRef.current = scene;
    cameraRef.current = camera;
    rendererRef.current = renderer;
    controlsRef.current = controls;

    const animate = () => {
      requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    setIsSceneReady(true);
    log("3D scene initialized successfully");
  };

  const handleFileChange = (event) => {
    setFiles(Array.from(event.target.files));
  };

  const convertToGLB = async () => {
    const convertedFiles = [];
    const fbxLoader = new FBXLoader();
    const gltfExporter = new GLTFExporter();

    for (const file of files) {
      const fbxUrl = URL.createObjectURL(file);
      try {
        log(`Loading FBX file: ${file.name}`);
        const fbxScene = await new Promise((resolve, reject) => {
          fbxLoader.load(fbxUrl, resolve, undefined, reject);
        });

        log(`FBX file loaded successfully: ${file.name}`);

        // Attempt binary export first
        try {
          log(`Attempting binary export for: ${file.name}`);
          const glbData = await new Promise((resolve, reject) => {
            gltfExporter.parse(fbxScene, (result) => {
              if (result instanceof ArrayBuffer) {
                resolve(result);
              } else {
                reject(new Error('Binary export failed'));
              }
            }, { binary: true }, reject);
          });

          const glbBlob = new Blob([glbData], { type: 'application/octet-stream' });
          const glbUrl = URL.createObjectURL(glbBlob);

          convertedFiles.push({
            name: file.name.replace('.fbx', '.glb'),
            url: glbUrl
          });

          log(`Binary export successful for: ${file.name}`);
        } catch (binaryError) {
          // If binary export fails, try non-binary export
          log(`Binary export failed for ${file.name}, attempting non-binary export`);
          const gltfData = await new Promise((resolve, reject) => {
            gltfExporter.parse(fbxScene, resolve, { binary: false }, reject);
          });

          const gltfBlob = new Blob([JSON.stringify(gltfData)], { type: 'application/json' });
          const gltfUrl = URL.createObjectURL(gltfBlob);

          convertedFiles.push({
            name: file.name.replace('.fbx', '.gltf'),
            url: gltfUrl
          });

          log(`Non-binary export successful for: ${file.name}`);
        }
      } catch (error) {
        log(`Error converting file: ${file.name}`);
        log(`Error details: ${error.message}`);
        console.error('Error stack:', error.stack);
      } finally {
        URL.revokeObjectURL(fbxUrl);
      }
    }

    setConvertedFiles(convertedFiles);
  };

  const loadGLBToScene = () => {
    if (!sceneRef.current) {
      log("Scene is not initialized. Cannot load models.");
      return;
    }

    const loader = new GLTFLoader();
    const cumulativeBoundingBox = new THREE.Box3();

    // Create a single material with a specific color
    const singleMaterial = new THREE.MeshPhongMaterial({ color: 0x00ff00 }); // Green color

    convertedFiles.forEach((file, index) => {
      log(`Loading converted file: ${file.name}`);
      loader.load(file.url, (gltf) => {
        const model = gltf.scene;

        // Log information about the loaded model
        log(`Model loaded: ${file.name}`);
        log(`Number of meshes: ${model.children.length}`);

        model.traverse((child) => {
          if (child.isMesh) {
            log(`Mesh found: ${child.name}`);
            log(`Vertices: ${child.geometry.attributes.position.count}`);

            // Remove existing material and apply the single material
            child.material = singleMaterial;

            log(`Applied single material to mesh: ${child.name}`);
          }
        });

        // Calculate bounding box for this model
        const boundingBox = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        boundingBox.getSize(size);
        log(`Model dimensions: ${size.x.toFixed(2)} x ${size.y.toFixed(2)} x ${size.z.toFixed(2)}`);

        // Center the model
        boundingBox.getCenter(model.position);
        model.position.multiplyScalar(-1);

        // Add the model to a group for easier manipulation
        const group = new THREE.Group();
        group.add(model);
        group.position.set(index * 2, 0, 0); // Offset each model
        sceneRef.current.add(group);

        // Expand cumulative bounding box to include this model
        cumulativeBoundingBox.expandByObject(group);

        log(`Successfully loaded and added to scene with single material: ${file.name}`);

        // If this is the last model, adjust camera
        if (index === convertedFiles.length - 1) {
          adjustCameraToFitScene(cumulativeBoundingBox);
        }
      }, undefined, (error) => {
        log(`Error loading file: ${file.name}`);
        log(`Error details: ${error.message}`);
        console.error('Error stack:', error.stack);
      });
    });
  };

  const adjustCameraToFitScene = (boundingBox) => {
    if (!cameraRef.current || !controlsRef.current) {
      log("Camera or controls are not initialized. Cannot adjust view.");
      return;
    }

    const center = new THREE.Vector3();
    boundingBox.getCenter(center);

    const size = new THREE.Vector3();
    boundingBox.getSize(size);

    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = cameraRef.current.fov * (Math.PI / 180);
    let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));

    // Add some padding
    cameraZ *= 1.5;

    cameraRef.current.position.set(center.x, center.y, center.z + cameraZ);
    const far = cameraZ * 3;
    cameraRef.current.far = far;
    cameraRef.current.updateProjectionMatrix();

    controlsRef.current.target.copy(center);
    controlsRef.current.update();

    log("Camera adjusted to fit all models in the scene.");
  };

  return (
    <div>
      <h2>FBX to GLB Converter with Scene View</h2>
      <input type="file" multiple accept=".fbx" onChange={handleFileChange} />
      <button onClick={convertToGLB}>Convert to GLB</button>
      <canvas ref={canvasRef} />

      <div>
        {logMessages.map((message, index) => (
          <p key={index}>{message}</p>
        ))}
      </div>
    </div>
  );
};

export default TestSceneFbx;

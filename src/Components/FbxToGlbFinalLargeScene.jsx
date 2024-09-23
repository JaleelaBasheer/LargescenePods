import React, { useEffect, useRef, useState ,useCallback} from "react";
import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import pako from 'pako';
import { openDB } from "idb";

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
    updateBoundingBoxes() {
      if (this.divided) {
        this.children.forEach(child => child.updateBoundingBoxes());
      } else {
        this.objects.forEach(obj => {
          if (obj.geometry && !obj.geometry.boundingBox) {
            obj.geometry.computeBoundingBox();
          }
        });
      }
      // Update this node's bounding box
      this.boundingBox.makeEmpty();
      this.objects.forEach(obj => {
        const objectBoundingBox = new THREE.Box3().setFromObject(obj);
        this.boundingBox.union(objectBoundingBox);
      });
      if (this.divided) {
        this.children.forEach(child => {
          this.boundingBox.union(child.boundingBox);
        });
      }
    }
  
    reinsertObjects() {
      const allObjects = this.getAllObjects();
      this.clear();
      allObjects.forEach(obj => this.insert(obj));
    }
  
    getAllObjects() {
      let objects = [...this.objects];
      if (this.divided) {
        this.children.forEach(child => {
          objects = objects.concat(child.getAllObjects());
        });
      }
      return objects;
    }
  
    clear() {
      this.objects = [];
      this.children = [];
      this.divided = false;
    }
  }

  function FbxToGlbFinalLargeScene() {
    const mountRef = useRef(null);
    const sceneRef = useRef(new THREE.Scene());
    const cameraRef = useRef(new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000));
    const rendererRef = useRef(new THREE.WebGLRenderer({ antialias: true }));
    const controlsRef = useRef(null);
    const cumulativeBoundingBox = useRef(new THREE.Box3(
      new THREE.Vector3(Infinity, Infinity, Infinity),
      new THREE.Vector3(-Infinity, -Infinity, -Infinity)
    ));
  
    const [isVisible, setIsVisible] = useState(true);
    const [fileSizes, setFileSizes] = useState([]);
    const [saveDirectory, setSaveDirectory] = useState(null);
    const [selectedFiles, setSelectedFiles] = useState([]);
    const [convertedModels, setConvertedModels] = useState([]);
    const [lodModels, setLodModels] = useState([]);
    const [backgroundColor, setBackgroundColor] = useState(0x000000);
    const [simplificationStats, setSimplificationStats] = useState([]);
    const [boundingBoxData, setBoundingBoxData] = useState({ cumulativeBox: null, center: null, size: null });
    const [progress, setProgress] = useState(0);
    const [octree, setOctree] = useState(null);
    const [meshRelations, setMeshRelations] = useState({});
    const [meshesInFrustum, setMeshesInFrustum] = useState(0);
    const [meshesOutsideFrustum, setMeshesOutsideFrustum] = useState(0);
    const [processingProgress, setProcessingProgress] = useState(0);
    const [db, setDb] = useState(null);
    const [loadingProgress, setLoadingProgress] = useState(0);
    const [culledMeshes, setCulledMeshes] = useState(0);
    const [unculledMeshes, setUnculledMeshes] = useState(0);
  
    const workerRef = useRef(null);
  
    useEffect(() => {
      workerRef.current = new Worker(new URL('./meshLoaderWorker.js', import.meta.url));
      workerRef.current.onmessage = handleWorkerMessage;
  
      return () => {
        if (workerRef.current) {
          workerRef.current.terminate();
        }
      };
    }, []);
  
    useEffect(() => {
      rendererRef.current.setSize(window.innerWidth, window.innerHeight);
      mountRef.current.appendChild(rendererRef.current.domElement);
  
      const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
      sceneRef.current.add(ambientLight);
      const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
      directionalLight.position.set(0, 1, 0);
      sceneRef.current.add(directionalLight);
  
      controlsRef.current = new OrbitControls(cameraRef.current, rendererRef.current.domElement);
      controlsRef.current.enableDamping = true;
      controlsRef.current.dampingFactor = 0.1;
  
      const handleResize = () => {
        const width = window.innerWidth;
        const height = window.innerHeight;
        rendererRef.current.setSize(width, height);
        cameraRef.current.aspect = width / height;
        cameraRef.current.updateProjectionMatrix();
      };
  
      window.addEventListener("resize", handleResize);
      return () => {
        mountRef.current.removeChild(rendererRef.current.domElement);
        controlsRef.current.dispose();
        window.removeEventListener("resize", handleResize);
      };
    }, []);
  
    useEffect(() => {
      rendererRef.current.setClearColor(backgroundColor);
    }, [backgroundColor]);
  
    useEffect(() => {
      const initDB = async () => {
        const database = await openDB("3DModelsDB", 1, {
          upgrade(db) {
            db.createObjectStore("models");
          },
        });
        setDb(database);
      };
      initDB();
    }, []);
  
    const handleWorkerMessage = useCallback((event) => {
      const { type, modelName, lodLevel, modelData } = event.data;
      if (type === 'modelLoaded') {
        handleModelLoaded(modelName, lodLevel, modelData);
      } else if (type === 'allModelsLoaded') {
        finalizeSceneSetup();
      }
    }, []);
  
    const handleModelLoaded = useCallback((modelName, lodLevel, modelData) => {
      if (modelData) {
        const gltfLoader = new GLTFLoader();
        gltfLoader.parse(modelData.buffer, "", (gltf) => {
          const gltfObject = gltf.scene;
          gltfObject.name = `${modelName}_${lodLevel}`;
          sceneRef.current.add(gltfObject);
          const boundingBox = new THREE.Box3().setFromObject(gltfObject);
          cumulativeBoundingBox.current.union(boundingBox);
        }, console.error);
      }
    }, []);
  
    const finalizeSceneSetup = useCallback(() => {
      resetCameraView();
      initializeOctree();
      setLoadingProgress(0);
    }, []);
  
    const selectSaveDirectory = async () => {
      try {
        const dirHandle = await window.showDirectoryPicker();
        setSaveDirectory(dirHandle);
      } catch (err) {
        console.error("Error selecting directory:", err);
      }
    };
  
    const onFileChange = async (event) => {
      const loader = new FBXLoader();
      const files = Array.from(event.target.files);
      
      const totalFiles = files.length;
      let cumulativeBox = new THREE.Box3(
        new THREE.Vector3(Infinity, Infinity, Infinity),
        new THREE.Vector3(-Infinity, -Infinity, -Infinity)
      );
  
      for (const [index, file] of files.entries()) {
        try {
          const fbxObject = await new Promise((resolve, reject) => {
            loader.load(
              URL.createObjectURL(file),
              (object) => resolve(object),
              undefined,
              (error) => reject(error)
            );
          });
  
          const boundingBox = new THREE.Box3().setFromObject(fbxObject);
          cumulativeBox.union(boundingBox);
        } catch (error) {
          console.error("Error loading FBX file:", error);
        }
  
        const progressPercentage = Math.round(((index + 1) / totalFiles) * 100);
        setProgress(progressPercentage);
      }
  
      const center = cumulativeBox.getCenter(new THREE.Vector3());
      const size = cumulativeBox.getSize(new THREE.Vector3());
  
      setBoundingBoxData({
        cumulativeBox,
        center,
        size,
      });
      
      const distance = size.length();
      const fov = cameraRef.current.fov * (Math.PI / 180);
      let cameraZ = distance / (2 * Math.tan(fov / 2));
      cameraZ *= 1.5;
  
      cameraRef.current.position.set(center.x, center.y, center.z + cameraZ);
      cameraRef.current.lookAt(center);
      controlsRef.current.target.copy(center);
      controlsRef.current.update();
  
      setSelectedFiles(files);
      setProgress(0);
    };
  
    const storeModelInIndexedDB = async (modelName, lodLevel, glbData) => {
      if (!db) return;
      const tx = db.transaction("models", "readwrite");
      const store = tx.objectStore("models");
      
      const compressedData = pako.gzip(glbData);
      
      await store.put(compressedData, `${modelName}_${lodLevel}`);
    };
  
    const convertToGLB = async (object) => {
      return new Promise((resolve, reject) => {
        const exporter = new GLTFExporter();
        exporter.parse(
          object,
          (result) => {
            const output = result instanceof ArrayBuffer ? result : JSON.stringify(result);
            resolve(output);
          },
          {
            binary: true,
            includeCustomExtensions: false,
            forceIndices: true,
            truncateDrawRange: true,
          },
          (error) => reject(error)
        );
      });
    };
  
    const processModels = async () => {
      const loader = new FBXLoader();
      const newFileSizes = [];
      const newConvertedModels = [];
      const newLodModels = [];
      const newSimplificationStats = [];
  
      cumulativeBoundingBox.current = new THREE.Box3(
        new THREE.Vector3(Infinity, Infinity, Infinity),
        new THREE.Vector3(-Infinity, -Infinity, -Infinity)
      );
  
      const totalSteps = selectedFiles.length * (4 + 1);
      let completedSteps = 0;
  
      for (const file of selectedFiles) {
        try {
          workerRef.current.postMessage({ type: 'loadModel', modelName: file.name, lodLevel: 'LOD0' });
  
          const fbxObject = await new Promise((resolve, reject) => {
            loader.load(
              URL.createObjectURL(file),
              (object) => resolve(object),
              undefined,
              (error) => reject(error)
            );
          });
  
          fbxObject.traverse((child) => {
            if (child.isMesh) {
              child.material = new THREE.MeshBasicMaterial({ color: 0xcccccc });
            }
          });
  
          const lodLevels = [
            { name: 'LOD0', reduction: 0 },
            { name: 'LOD1', reduction: 0.25 },
            { name: 'LOD2', reduction: 0.5 },
            { name: 'LOD3', reduction: 0.75 }
          ];
          const modelFileSizes = {
            name: file.name,
            fbxSize: file.size,
            lodSizes: []
          };
  
          const lodVersions = lodLevels.map(level => {
            const lodObject = fbxObject.clone();
            const meshStats = [];
            lodObject.traverse((child) => {
              if (child.isMesh && child.geometry) {
                const result = simplifyGeometry(child.geometry, level.reduction);
                child.geometry = result.geometry;
                meshStats.push(result);
              }
            });
            newSimplificationStats.push({ fileName: file.name, lodName: level.name, meshStats });
            return { name: level.name, object: lodObject };
          });
  
          for (const lod of lodVersions) {
            const glbData = await convertToGLB(lod.object);
            await storeModelInIndexedDB(file.name, lod.name, glbData);
            
            const compressedData = pako.gzip(glbData);
            modelFileSizes.lodSizes.push({
              name: lod.name,
              size: compressedData.byteLength
            });
  
            completedSteps++;
            setProcessingProgress((completedSteps / totalSteps) * 100);
          }
          newFileSizes.push(modelFileSizes);
  
          completedSteps++;
          setProcessingProgress((completedSteps / totalSteps) * 100);
  
        } catch (error) {
          console.error("Error processing model:", error);
        }
      }
  
      setSimplificationStats(newSimplificationStats);
      setFileSizes(newFileSizes);
      setConvertedModels(newConvertedModels);
      setLodModels(newLodModels);
      initializeOctree();
  
      setProcessingProgress(0);
    };
  
  const simplifyGeometry = (geometry, targetReduction) => {
  const originalVertexCount = geometry.attributes.position.count;
  
  if (originalVertexCount <= 100) {
    return {
      geometry: geometry.clone(),
      simplificationApplied: false,
      originalVertexCount,
      newVertexCount: originalVertexCount
    };
  }

  const targetVertexCount = Math.max(4, Math.floor(originalVertexCount * (1 - targetReduction)));

  // Basic decimation
  const step = Math.ceil(originalVertexCount / targetVertexCount);
  const newPositions = [];
  const newNormals = [];
  const newUvs = [];

  for (let i = 0; i < originalVertexCount; i += step) {
    newPositions.push(
      geometry.attributes.position.getX(i),
      geometry.attributes.position.getY(i),
      geometry.attributes.position.getZ(i)
    );

    if (geometry.attributes.normal) {
      newNormals.push(
        geometry.attributes.normal.getX(i),
        geometry.attributes.normal.getY(i),
        geometry.attributes.normal.getZ(i)
      );
    }

    if (geometry.attributes.uv) {
      newUvs.push(
        geometry.attributes.uv.getX(i),
        geometry.attributes.uv.getY(i)
      );
    }
  }

  const newGeometry = new THREE.BufferGeometry();
  newGeometry.setAttribute('position', new THREE.Float32BufferAttribute(newPositions, 3));
  
  if (newNormals.length > 0) {
    newGeometry.setAttribute('normal', new THREE.Float32BufferAttribute(newNormals, 3));
  }
  
  if (newUvs.length > 0) {
    newGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(newUvs, 2));
  }

  return {
    geometry: newGeometry,
    simplificationApplied: true,
    originalVertexCount,
    newVertexCount: newGeometry.attributes.position.count
  };
};

const updateLODs = useCallback(() => {
  const camera = cameraRef.current;
  let sceneChanged = false;

  sceneRef.current.traverse(async (object) => {
    if (object instanceof THREE.Mesh) {
      const distance = camera.position.distanceTo(object.position);
      let lodLevel;
      if (distance > 100) lodLevel = 'LOD3';
      else if (distance > 50) lodLevel = 'LOD2';
      else if (distance > 25) lodLevel = 'LOD1';
      else lodLevel = 'LOD0';

      const modelName = object.name.split('_')[0];
      const currentLOD = object.name.split('_')[1];

      if (lodLevel !== currentLOD) {
        const newLODData = await storeModelInIndexedDB(modelName, lodLevel);
        if (newLODData) {
          const gltfLoader = new GLTFLoader();
          const newObject = await new Promise((resolve, reject) => {
            gltfLoader.parse(newLODData, "", (gltf) => resolve(gltf.scene), reject);
          });
          newObject.position.copy(object.position);
          newObject.rotation.copy(object.rotation);
          newObject.scale.copy(object.scale);
          newObject.name = `${modelName}_${lodLevel}`;
          sceneRef.current.remove(object);
          sceneRef.current.add(newObject);
          sceneChanged = true;
        }
      }
    }
  });

  if (sceneChanged) {
    updateOctree();
  }
}, []);


    
      const saveConvertedModels = async () => {
        if (!saveDirectory) {
          alert("Please select a save directory first.");
          return;
        }
    
        if (convertedModels.length === 0) {
          alert(
            "No models have been processed yet. Please process models before saving."
          );
          return;
        }
    
        let successCount = 0;
        let failCount = 0;
    
        for (const model of convertedModels) {
          try {
            const newHandle = await saveDirectory.getFileHandle(model.fileName, {
              create: true,
            });
            const writable = await newHandle.createWritable();
            await writable.write(model.data);
            await writable.close();
            successCount++;
          } catch (error) {
            console.error("Error saving file:", model.fileName, error);
            failCount++;
          }
        }
    
        for (const lodModel of lodModels) {
          for (const lod of lodModel.lodData) {
            try {
              const fileName = `${lodModel.fileName}_${lod.name}.gltf`;
              const newHandle = await saveDirectory.getFileHandle(fileName, { create: true });
              const writable = await newHandle.createWritable();
              await writable.write(lod.data);
              await writable.close();
              successCount++;
            } catch (error) {
              console.error("Error saving LOD file:", `${lodModel.fileName}_${lod.name}.gltf`, error);
              failCount++;
            }
          }
        }
    
        alert(
          `Saving complete!\n${successCount} files saved successfully.\n${failCount} files failed to save.`
        );
      };
    
    
      const toggleVisibility = (visible) => {
        setIsVisible(visible);
        sceneRef.current.traverse(function (object) {
          if (object instanceof THREE.Mesh) {
            object.visible = visible;
          }
        });
      };
    
      const resetCameraView = () => {
        const center = new THREE.Vector3();
        cumulativeBoundingBox.current.getCenter(center);
        const size = cumulativeBoundingBox.current.getSize(new THREE.Vector3());
        const distance = size.length();
        const fov = cameraRef.current.fov * (Math.PI / 180);
        let cameraZ = distance / (2 * Math.tan(fov / 2));
        cameraZ *= 2.5;
    
        cameraRef.current.position.set(center.x, center.y, center.z + cameraZ);
        cameraRef.current.lookAt(center);
        controlsRef.current.target.copy(center);
        controlsRef.current.update();
      };
    
      const loadAllModelsToScene = async () => {
        if (!db) {
          alert("Database not initialized. Please wait and try again.");
          return;
        }
    
        // Clear existing scene
        while(sceneRef.current.children.length > 0){ 
          sceneRef.current.remove(sceneRef.current.children[0]); 
        }
    
        const tx = db.transaction("models", "readonly");
        const store = tx.objectStore("models");
        const keys = await store.getAllKeys();
    
        // Reset the cumulative bounding box
        cumulativeBoundingBox.current = new THREE.Box3();
    
        // Use the worker to load all models
        workerRef.current.postMessage({ type: 'loadAllModels', keys });
      };
    
      const initializeOctree = () => {
        const scene = sceneRef.current;
        const boundingBox = new THREE.Box3().setFromObject(scene);
        const center = new THREE.Vector3();
        boundingBox.getCenter(center);
        const size = boundingBox.getSize(new THREE.Vector3()).length();
        const newOctree = new Octree(center, size * 2);  // Use size * 2 to ensure it encompasses the entire scene
      
        scene.traverse((object) => {
          if (object instanceof THREE.Mesh) {
            newOctree.insert(object);
          }
        });
      
        newOctree.updateBoundingBoxes();
        setOctree(newOctree);
      };
    
      const updateOctree = () => {
        if (octree) {
          octree.reinsertObjects();
          octree.updateBoundingBoxes();
        }
      };
    
      const updateVisibleMeshes = useCallback(() => {
        if (!octree || !cameraRef.current) return;
    
        const frustum = new THREE.Frustum();
        const matrix = new THREE.Matrix4().multiplyMatrices(
          cameraRef.current.projectionMatrix,
          cameraRef.current.matrixWorldInverse
        );
        frustum.setFromProjectionMatrix(matrix);
    
        let inFrustum = 0;
        let outsideFrustum = 0;
    
        sceneRef.current.traverse((object) => {
          if (object instanceof THREE.Mesh) {
            const meshBoundingBox = new THREE.Box3().setFromObject(object);
            if (frustum.intersectsBox(meshBoundingBox)) {
              object.visible = true;
              inFrustum++;
            } else {
              object.visible = false;
              outsideFrustum++;
            }
          }
        });
    
        setMeshesInFrustum(inFrustum);
        setMeshesOutsideFrustum(outsideFrustum);
      }, [octree]);

      const performOcclusionCulling = useCallback(() => {
        if (!octree || !cameraRef.current) return;
      
        const frustum = new THREE.Frustum();
        const matrix = new THREE.Matrix4().multiplyMatrices(
          cameraRef.current.projectionMatrix,
          cameraRef.current.matrixWorldInverse
        );
        frustum.setFromProjectionMatrix(matrix);
      
        let meshesInFrustum = 0;
        let meshesOutsideFrustum = 0;
        let culledMeshes = 0;
        let visibleMeshes = 0;
      
        // const raycaster = new THREE.Raycaster();
        const tempVec = new THREE.Vector3();
        const meshesInFrustumArray = [];
      
        // First pass: Determine which meshes are in the frustum
        sceneRef.current.traverse((object) => {
          if (object instanceof THREE.Mesh) {
            const meshBoundingBox = new THREE.Box3().setFromObject(object);
            if (frustum.intersectsBox(meshBoundingBox)) {
              meshesInFrustumArray.push(object);
              meshesInFrustum++;
              object.visible = true; // Temporarily set all frustum meshes to visible
            } else {
              object.visible = false;
              meshesOutsideFrustum++;
            }
          }
        });
      
        // Second pass: Occlusion culling on meshes within frustum
        // for (const mesh of meshesInFrustumArray) {
        //   mesh.getWorldPosition(tempVec);
        //   const direction = tempVec.sub(cameraRef.current.position).normalize();
        //   raycaster.set(cameraRef.current.position, direction);
          
        //   const intersects = raycaster.intersectObjects(meshesInFrustumArray, true);
        //   if (intersects.length > 0 && intersects[0].object !== mesh) {
        //     mesh.visible = false;
        //     culledMeshes++;
        //   } else {
        //     visibleMeshes++;
        //   }
        // }

         // Perform raycasting for occlusion culling
    const raycaster = new THREE.Raycaster();
    meshesInFrustumArray.forEach((obj) => {
      // Compute the bounding sphere for more accurate raycasting
      obj.geometry.computeBoundingSphere();
      const boundingSphere = obj.geometry.boundingSphere;
      const direction = boundingSphere.center.clone().sub(cameraRef.current.position).normalize();
      
      // Set ray from the camera to the object's bounding sphere center
      raycaster.set(cameraRef.current.position, direction);
      
      // Perform raycasting against all objects within the frustum
      const intersects = raycaster.intersectObjects(meshesInFrustumArray, true);
      
      if (intersects.length > 0) {
        // Check if any object is blocking the current object
        const closestIntersect = intersects[0];
        
        if (closestIntersect.object !== obj && closestIntersect.distance < boundingSphere.center.distanceTo(cameraRef.current.position)) {
          // An object is blocking this one, mark it occluded
          obj.visible = false;
          culledMeshes++;
        } else {
          // No object blocking this one, mark it visible
          obj.visible = true;
          visibleMeshes++;
        }
      }
      //  else {
      //   // No intersections, make the object visible
      //   obj.visible = true;
      //   culledMeshes++;
      // }
    });
      
        setMeshesInFrustum(meshesInFrustum);
        setMeshesOutsideFrustum(meshesOutsideFrustum);
        setCulledMeshes(culledMeshes);
        setUnculledMeshes(visibleMeshes);
      }, [octree]);

      const animate = useCallback(() => {
        requestAnimationFrame(animate);
        if (isVisible) {
          controlsRef.current.update();
          cameraRef.current.updateMatrixWorld();
          cameraRef.current.updateProjectionMatrix();
          updateLODs();
          performOcclusionCulling();
          rendererRef.current.render(sceneRef.current, cameraRef.current);
        }
      }, [isVisible, updateLODs, performOcclusionCulling]);

        useEffect(() => {
          animate();
        }, [animate]);
      
      
  return (
    <div className="main">
      <div className="canvas-container">
        <button onClick={selectSaveDirectory}>Select Save Directory</button>
        <input
          className="button"
          type="file"
          multiple
          onChange={onFileChange}
          accept=".fbx"
        />
        {progress > 0 && (
          <div style={{ margin: '10px 0', width: '100%', backgroundColor: '#e0e0e0' }}>
            <div
              style={{
                width: `${progress}%`,
                backgroundColor: '#76c7c0',
                height: '10px',
                transition: 'width 0.2s',
              }}>
            </div>
          </div>
        )}
         {processingProgress > 0 && (
          <div style={{ margin: '10px 0', width: '100%', backgroundColor: '#e0e0e0' }}>
            <div
              style={{
                width: `${processingProgress}%`,
                backgroundColor: '#76c7c0',
                height: '10px',
                transition: 'width 0.2s',
              }}
            />
          </div>
        )}
        {loadingProgress > 0 && (
          <div>
            <p>Loading models: {loadingProgress.toFixed(2)}% complete</p>
            <div style={{ margin: '10px 0', width: '100%', backgroundColor: '#e0e0e0' }}>
              <div
                style={{
                  width: `${loadingProgress}%`,
                  backgroundColor: '#76c7c0',
                  height: '10px',
                  transition: 'width 0.2s',
                }}
              />
            </div>
          </div>
        )}
        <div className="frustum-info">
        <h3>Frustum Information</h3>
        <p>Meshes inside frustum: {meshesInFrustum}</p>
        <p>Meshes outside frustum: {meshesOutsideFrustum}</p>
        <p>Culled meshes: {culledMeshes}</p>
        <p>Unculled (visible) meshes: {unculledMeshes}</p>
      </div>
        <button onClick={processModels}>Process Models</button>
        <button onClick={saveConvertedModels}>Save Converted Models</button>
        <button onClick={loadAllModelsToScene}>Load Stored Models to Scene</button>
        <div ref={mountRef} style={{ width: "99%", height: "100vh" }}></div>
      </div>

      <div className="button-container">
        <button
          className="custom-button hide-show"
          onClick={() => toggleVisibility(true)}
        >view
        </button>
        <button
          className="custom-button"
          onClick={() => toggleVisibility(false)}
        >
         hide
        </button>
        <button className="custom-button fit-view" onClick={resetCameraView}>
          fitView
        </button>
        <input
          type="color"
          value={"#" + backgroundColor.toString(16).padStart(6, "0")}
          onChange={(e) =>
            setBackgroundColor(parseInt(e.target.value.slice(1), 16))
          }
        />
      </div>
      <div className="file-sizes">
        {fileSizes.map((file, index) => (
          <div key={index}>
            <h3>{file.name}</h3>
            <p>FBX size: {(file.fbxSize / 1024 / 1024).toFixed(2)} MB</p>
            {file.lodSizes.map((lod, lodIndex) => (
              <p key={lodIndex}>
                {lod.name} GLB size: {(lod.size / 1024 / 1024).toFixed(2)} MB
              </p>
            ))}
          </div>
        ))}
      </div>
      <div className="simplification-stats">
        <h3>Simplification Statistics</h3>
        {simplificationStats.map((stat, index) => (
          <div key={index}>
            <h4>{stat.fileName} - {stat.lodName}</h4>
            {stat.meshStats.map((meshStat, meshIndex) => (
              <p key={meshIndex}>
                Mesh {meshIndex + 1}: 
                {meshStat.simplificationApplied 
                  ? `Simplified from ${meshStat.originalVertexCount} to ${meshStat.newVertexCount} vertices`
                  : `Not simplified (${meshStat.originalVertexCount} vertices)`}
              </p>
            ))}
          </div>
        ))}
      </div>
      {/* <div className="octree-info">
        <h3>Octree Information</h3>
        {octree && (
          <p>Octree created with {Object.keys(meshRelations).length} meshes</p>
        )}
      </div> */}
    </div>
  )
}

export default FbxToGlbFinalLargeScene

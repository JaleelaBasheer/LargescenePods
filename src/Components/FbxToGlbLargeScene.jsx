import React, { useEffect, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter";
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
  }
  function FbxToGlbLargeScene() {
    const mountRef = useRef(null);
    const sceneRef = useRef(new THREE.Scene());
    const rendererRef = useRef(new THREE.WebGLRenderer({ antialias: true }));
    const cumulativeBoundingBox = useRef(new THREE.Box3(
      new THREE.Vector3(Infinity, Infinity, Infinity),
      new THREE.Vector3(-Infinity, -Infinity, -Infinity)
    ));
  
    const sceneCameraRef = useRef(null);
    const flyCameraRef = useRef(null);
    const [octreeVisualization, setOctreeVisualization] = useState(null);
  
    const [isVisible, setIsVisible] = useState(true);
    const [fileSizes, setFileSizes] = useState([]);
    const [saveDirectory, setSaveDirectory] = useState(null);
    const [selectedFiles, setSelectedFiles] = useState([]);
    const [convertedModels, setConvertedModels] = useState([]);
    const [lodModels, setLodModels] = useState([]);
    const [backgroundColor, setBackgroundColor] = useState(0x000000);
    const [simplificationStats, setSimplificationStats] = useState([]);
    const [db, setDb] = useState(null);
    const [boundingBoxData, setBoundingBoxData] = useState({
      cumulativeBox: null,
      center: null,
      size: null,
    });
    const [progress, setProgress] = useState(0);
    const [octree, setOctree] = useState(null);
    const [meshRelations, setMeshRelations] = useState({});
    const [meshesInFrustum, setMeshesInFrustum] = useState(0);
    const [meshesOutsideFrustum, setMeshesOutsideFrustum] = useState(0);
    const workerRef = useRef(null);
    const loadedMeshesRef = useRef({});
    const [nodeGzipRelations, setNodeGzipRelations] = useState({});
    const [unculledMeshes, setUnculledMeshes] = useState(0);
    const mouse = useRef({ x: 0, y: 0 });
    const isMouseDown = useRef(false);
    const isPanning = useRef(false);
    const isZooming = useRef(false);
    const lastMouseMovement = useRef({ x: 0, y: 0 });
    const [flySpeed, setFlySpeed] = useState(0.1);
    const [flyrotationSpeed, setflyrotationSpeed] = useState(0.1);
    const frustumHelperRef = useRef(null);
    const [cameraPosition, setCameraPosition] = useState({ x: 0, y: 0, z: 0 });
  const [currentLOD, setCurrentLOD] = useState('LOD0');
  const [lodStatus, setLodStatus] = useState('');
   // Frustum for checking visibility
   const flyFrustum = new THREE.Frustum();
   const staticFrustum = new THREE.Frustum();
   const lodColors = {
    'LOD0': 0xcccccc, // Original model
    'LOD1': 0xff0000, // Red
    'LOD2': 0x00ff00, // Green
    'LOD3': 0x0000ff  // Blue
  };

    useEffect(() => {
      rendererRef.current.setSize(window.innerWidth, window.innerHeight);
      rendererRef.current.setClearColor(backgroundColor)
      mountRef.current.appendChild(rendererRef.current.domElement);
  
      const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
      sceneRef.current.add(ambientLight);
      const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
      directionalLight.position.set(0, 1, 0);
      sceneRef.current.add(directionalLight);
  
      // Create scene camera
    sceneCameraRef.current = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

    // Create fly camera
    flyCameraRef.current = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

    sceneCameraRef.current.add(flyCameraRef.current);
    flyCameraRef.current.position.set(0, 0, -1); // Adjust this to position the fly camera relative to the scene camera

     // Create frustum helper
     const frustumHelper = new THREE.CameraHelper(flyCameraRef.current);
     sceneRef.current.add(frustumHelper);
     frustumHelperRef.current = frustumHelper;
    //  const gridHelper = new THREE.GridHelper(maxDim * 2, 20);
    //  sceneRef.current.add(gridHelper);
 
    //  // Add axes helper
    //  const axesHelper = new THREE.AxesHelper(maxDim / 2);
    //  sceneRef.current.add(axesHelper);
 
    
      animate();
  
      const handleResize = () => {
        const width = window.innerWidth;
        const height = window.innerHeight;
        rendererRef.current.setSize(width, height);
        if (sceneCameraRef.current) {
          sceneCameraRef.current.aspect = width / height;
          sceneCameraRef.current.updateProjectionMatrix();
        }
        if (flyCameraRef.current) {
          flyCameraRef.current.aspect = width / height;
          flyCameraRef.current.updateProjectionMatrix();
        }
      };
  
      window.addEventListener("resize", handleResize);
      workerRef.current = new Worker(new URL('./meshWorker.js', import.meta.url));
      workerRef.current.onmessage = handleWorkerMessage;
  
      return () => {
        mountRef.current.removeChild(rendererRef.current.domElement);
        window.removeEventListener("resize", handleResize);
        workerRef.current.terminate();
      };
    }, []);
    const handleWorkerMessage = (e) => {
      if (e.data.type === 'meshLoaded') {
        const { meshId, lodLevel, meshData } = e.data;
        console.log(`Received mesh data for ${meshId} at ${lodLevel}`);
        
        const loader = new THREE.ObjectLoader();
        const mesh = loader.parse(meshData);
        
        if (loadedMeshesRef.current[meshId] && loadedMeshesRef.current[meshId].mesh) {
          sceneRef.current.remove(loadedMeshesRef.current[meshId].mesh);
        }
        
        // Apply LOD-specific material
        mesh.traverse((child) => {
          if (child.isMesh) {
            child.material = new THREE.MeshPhongMaterial({ color: lodColors[lodLevel] });
          }
        });
  
        sceneRef.current.add(mesh);
        loadedMeshesRef.current[meshId] = { mesh, lodLevel };
        
        updateFrustumCounts();
      }
    };
  
    useEffect(() => {
      rendererRef.current.setClearColor(backgroundColor);
    }, [backgroundColor]);
  
    useEffect(() => {
      const initDB = async () => {
        const database = await openDB('ModelsDB', 1, {
          upgrade(db) {
            db.createObjectStore('models');
          },
        });
        setDb(database);

      };
      initDB();
    }, []);
  
    useEffect(() => {
      enablefycontrols();
      return () => {
        disableflycontrols();
      };
    }, [flySpeed, flyrotationSpeed]);
  
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
    const maxDim = Math.max(size.x, size.y, size.z);
    const distance = size.length();
    const fov = sceneCameraRef.current.fov * (Math.PI / 180);
    let cameraZ = distance / (2 * Math.tan(fov / 2));
    cameraZ *= 1.5;

    sceneCameraRef.current.position.set(center.x, center.y, center.z + cameraZ);
    sceneCameraRef.current.lookAt(center);
    // controlsRef.current.target.copy(center);
    // controlsRef.current.update();
     // Add a grid helper for reference
    
 

    setSelectedFiles(files);
    setProgress(0);
  };

  const createOctree = useCallback((objects) => {
    const boundingBox = new THREE.Box3();
    objects.forEach(obj => boundingBox.expandByObject(obj));
    
    const center = boundingBox.getCenter(new THREE.Vector3());
    const size = Math.max(
      boundingBox.max.x - boundingBox.min.x,
      boundingBox.max.y - boundingBox.min.y,
      boundingBox.max.z - boundingBox.min.z
    );

    const newOctree = new Octree(center, size);
    objects.forEach((obj) => {
      obj.traverse((child) => {
        if (child.isMesh) {
          newOctree.insert(child);
        }
      });
    });
    return newOctree;
  }, []);

  const createOctreeVisualization = (octree) => {
    const group = new THREE.Group();
    const colors = [0xff0000, 0x00ff00, 0x0000ff, 0xffff00, 0xff00ff, 0x00ffff, 0xffa500, 0x800080];

    const visualizeNode = (node, depth = 0) => {
      const size = node.size;
      const geometry = new THREE.BoxGeometry(size, size, size);
      const material = new THREE.MeshBasicMaterial({
        color: colors[depth % colors.length],
        wireframe: true,
        transparent: true,
        opacity: 0.5
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(node.center);
      group.add(mesh);

      if (node.children.length > 0) {
        node.children.forEach(child => visualizeNode(child, depth + 1));
      }
    };

    visualizeNode(octree);
    return group;
  };


  const createAndStoreGzipFiles = useCallback(async (octree, meshRelations) => {
    const db = await openDB('OctreeGzipDB', 1, {
      upgrade(db) {
        db.createObjectStore('gzips', { keyPath: 'nodeId' });
      },
    });

    const nodeGzipRelations = {};

    const createGzipForNode = async (node, depth) => {
      const nodeId = `node_${depth}_${node.center.toArray().join('_')}`;
      const nodeData = {};

      node.objects.forEach(obj => {
        const relation = meshRelations[obj.uuid];
        if (relation) {
          const { fileIndex, mesh } = relation;
          const fileName = `${selectedFiles[fileIndex].name}_${mesh.name}.gltf`;
          nodeData[fileName] = convertedModels[fileIndex].data;
        }
      });

      if (Object.keys(nodeData).length > 0) {
        const jsonString = JSON.stringify(nodeData);
        const gzippedData = pako.gzip(jsonString);
        const gzipBlob = new Blob([gzippedData], { type: 'application/gzip' });

        await db.put('gzips', { nodeId, gzipBlob });

        nodeGzipRelations[nodeId] = { node, depth };
      }

      if (node.children.length > 0) {
        await Promise.all(node.children.map(child => createGzipForNode(child, depth + 1)));
      }
    };

    await createGzipForNode(octree, 0);
    setNodeGzipRelations(nodeGzipRelations);
    await db.close();

    // Send the octree structure to the worker
    workerRef.current.postMessage({
      type: 'initOctree',
      octree: JSON.stringify(octree, (key, value) => {
        if (key === 'objects') {
          return value.map(obj => obj.uuid);
        }
        return value;
      })
    });

  }, [selectedFiles, convertedModels]);

  const establishMeshRelations = useCallback((objects) => {
    const relations = {};
    objects.forEach((obj, index) => {
      obj.traverse((child) => {
        if (child.isMesh) {
          const box = new THREE.Box3().setFromObject(child);
          relations[child.uuid] = {
            box,
            fileIndex: index,
            mesh: child,
          };
        }
      });
    });
    return relations;
  }, []);

  const loadMeshFromIndexedDB = useCallback(async (fileName) => {
    const db = await openDB('OctreeGzipDB', 1);
    
    const findMeshInNode = async (nodeId) => {
      const gzipData = await db.get('gzips', nodeId);
      if (!gzipData) return null;

      const decompressedData = pako.inflate(gzipData.gzipBlob, { to: 'string' });
      const nodeData = JSON.parse(decompressedData);

      if (nodeData[fileName]) {
        return nodeData[fileName];
      }

      return null;
    };

    const searchMeshInOctree = async (node, depth) => {
      const nodeId = `node_${depth}_${node.center.toArray().join('_')}`;
      const meshData = await findMeshInNode(nodeId);
      if (meshData) return meshData;

      if (node.divided) {
        for (const child of node.children) {
          const result = await searchMeshInOctree(child, depth + 1);
          if (result) return result;
        }
      }

      return null;
    };

    const meshData = await searchMeshInOctree(octree, 0);
    await db.close();

    if (!meshData) {
      console.error(`Mesh data not found for: ${fileName}`);
      return null;
    }

    const loader = new GLTFLoader();
    return new Promise((resolve, reject) => {
      loader.parse(meshData, '', resolve, reject);
    });
  }, [octree]);

  // const updateFrustumCounts = useCallback(() => {
  //   if (!flyCameraRef.current) return;

  //   const frustum = new THREE.Frustum();
  //   const matrix = new THREE.Matrix4().multiplyMatrices(
  //     flyCameraRef.current.projectionMatrix,
  //     flyCameraRef.current.matrixWorldInverse
  //   );
  //   frustum.setFromProjectionMatrix(matrix);

  //   let inFrustum = 0;
  //   let outsideFrustum = 0;
  //   const meshesToLoad = [];

  //   Object.entries(meshRelations).forEach(([meshId, relation]) => {
  //     if (frustum.intersectsBox(relation.box)) {
  //       inFrustum++;
  //       if (!loadedMeshesRef.current[meshId]) {
  //         const fileName = `${selectedFiles[relation.fileIndex].name}_${relation.mesh.name}.gltf`;
  //         meshesToLoad.push({ meshId, fileName });
  //       } else {
  //         loadedMeshesRef.current[meshId].visible = true;
  //       }
  //     } else {
  //       outsideFrustum++;
  //       if (loadedMeshesRef.current[meshId]) {
  //         loadedMeshesRef.current[meshId].visible = false;
  //       }
  //     }
  //   });

  //   setMeshesInFrustum(inFrustum);
  //   setMeshesOutsideFrustum(outsideFrustum);

  //   if (meshesToLoad.length > 0) {
  //     workerRef.current.postMessage({
  //       type: 'loadMeshes',
  //       meshes: meshesToLoad
  //     });
  //   }
  // }, [meshRelations, selectedFiles]);
  const loadLOD = (lodLevel) => {
    console.log(`Loading ${lodLevel}`);
    setCurrentLOD(lodLevel);
    setLodStatus(`Loading ${lodLevel}...`);

    Object.entries(meshRelations).forEach(([meshId, relation]) => {
      const distance = flyCameraRef.current.position.distanceTo(relation.box.getCenter(new THREE.Vector3()));
      
      // Adjust this threshold as needed
      if (distance < 100) {
        workerRef.current.postMessage({
          type: 'loadMesh',
          meshId,
          fileName: selectedFiles[relation.fileIndex].name,
          lodLevel
        });
      }
    });
  };

  const updateFrustumCounts = useCallback(() => {
    if (!flyCameraRef.current || !meshRelations) return;

    const frustum = new THREE.Frustum();
    const matrix = new THREE.Matrix4().multiplyMatrices(
      flyCameraRef.current.projectionMatrix,
      flyCameraRef.current.matrixWorldInverse
    );
    frustum.setFromProjectionMatrix(matrix);

    let inFrustum = 0;
    let outsideFrustum = 0;
    const meshesToLoad = [];

    Object.entries(meshRelations).forEach(([meshId, relation]) => {
      if (frustum.intersectsBox(relation.box)) {
        inFrustum++;
        
        const distance = flyCameraRef.current.position.distanceTo(relation.box.getCenter(new THREE.Vector3()));
        const requiredLOD = determineLODLevel(distance);
        
        if (!loadedMeshesRef.current[meshId] || loadedMeshesRef.current[meshId].lodLevel !== requiredLOD) {
          meshesToLoad.push({
            meshId,
            fileName: `${selectedFiles[relation.fileIndex].name}_${relation.mesh.name}`,
            lodLevel: requiredLOD
          });
        } else {
          if (loadedMeshesRef.current[meshId].mesh) {
            loadedMeshesRef.current[meshId].mesh.visible = true;
          }
        }
      }  else {
        outsideFrustum++;
        if (loadedMeshesRef.current[meshId] && loadedMeshesRef.current[meshId].mesh) {
          loadedMeshesRef.current[meshId].mesh.visible = false;
        }
      }
    });

    setMeshesInFrustum(inFrustum);
    setMeshesOutsideFrustum(outsideFrustum);

    if (meshesToLoad.length > 0) {
      workerRef.current.postMessage({
        type: 'loadMeshes',
        meshes: meshesToLoad
      });
    }
  }, [meshRelations, selectedFiles, currentLOD]);

  const determineLODLevel = (distance) => {
    if (distance < 10) return 'LOD0';
    if (distance < 50) return 'LOD1';
    if (distance < 100) return 'LOD2';
    return 'LOD3';
  };

  const createLodGzips = async () => {
    const lodGzips = {};
    for (const level of ['LOD1', 'LOD2', 'LOD3']) {
      const data = {};
      lodModels.forEach((model) => {
        const lodData = model.lodData.find(lod => lod.name === level);
        if (lodData) {
          data[`${model.fileName}_${level}.gltf`] = lodData.data;
        }
      });
      const jsonString = JSON.stringify(data);
      const compressed = pako.gzip(jsonString);
      lodGzips[level] = new Blob([compressed]);
    }
    return lodGzips;
  };

  const storeInIndexedDB = async (lodGzips) => {
    const db = await openDB('ModelsDB', 1);
    const tx = db.transaction('models', 'readwrite');
    const store = tx.objectStore('models');
  
    await store.put(lodGzips, 'lodGzips');
  
    await tx.done;
  };
  
  const simplifyGeometry = (geometry, targetReduction) => {
    const position = geometry.attributes.position;
    const normal = geometry.attributes.normal;
    const uv = geometry.attributes.uv;
    const originalVertexCount = position.count;
    
    if (originalVertexCount <= 100) {
      return {
        geometry: geometry.clone(),
        simplificationApplied: false,
        originalVertexCount,
        newVertexCount: originalVertexCount
      };
    }
  
    const targetVertexCount = Math.max(4, Math.floor(originalVertexCount * (1 - targetReduction)));
    
    // Calculate edge collapse cost for each edge
    const edgeCosts = [];
    for (let i = 0; i < position.count; i += 3) {
      for (let j = 0; j < 3; j++) {
        const v1 = i + j;
        const v2 = i + ((j + 1) % 3);
        const cost = calculateEdgeCost(position, normal, v1, v2);
        edgeCosts.push({ v1, v2, cost });
      }
    }
    
    // Sort edges by cost
    edgeCosts.sort((a, b) => a.cost - b.cost);
    
    // Collapse edges until target vertex count is reached
    const newPositions = new Float32Array(position.array);
    const newNormals = normal ? new Float32Array(normal.array) : null;
    const newUvs = uv ? new Float32Array(uv.array) : null;
    let currentVertexCount = originalVertexCount;
    
    for (const edge of edgeCosts) {
      if (currentVertexCount <= targetVertexCount) break;
      
      const { v1, v2 } = edge;
      // Collapse edge by moving v2 to v1
      newPositions[v2 * 3] = newPositions[v1 * 3];
      newPositions[v2 * 3 + 1] = newPositions[v1 * 3 + 1];
      newPositions[v2 * 3 + 2] = newPositions[v1 * 3 + 2];
      
      if (newNormals) {
        newNormals[v2 * 3] = newNormals[v1 * 3];
        newNormals[v2 * 3 + 1] = newNormals[v1 * 3 + 1];
        newNormals[v2 * 3 + 2] = newNormals[v1 * 3 + 2];
      }
      
      if (newUvs) {
        newUvs[v2 * 2] = newUvs[v1 * 2];
        newUvs[v2 * 2 + 1] = newUvs[v1 * 2 + 1];
      }
      
      currentVertexCount--;
    }
    
    const newGeometry = new THREE.BufferGeometry();
    newGeometry.setAttribute('position', new THREE.BufferAttribute(newPositions, 3));
    if (newNormals) newGeometry.setAttribute('normal', new THREE.BufferAttribute(newNormals, 3));
    if (newUvs) newGeometry.setAttribute('uv', new THREE.BufferAttribute(newUvs, 2));
    
    return {
      geometry: newGeometry,
      simplificationApplied: true,
      originalVertexCount,
      newVertexCount: currentVertexCount
    };
  };
  
  const calculateEdgeCost = (position, normal, v1, v2) => {
    const p1 = new THREE.Vector3(position.getX(v1), position.getY(v1), position.getZ(v1));
    const p2 = new THREE.Vector3(position.getX(v2), position.getY(v2), position.getZ(v2));
    
    let cost = p1.distanceTo(p2);
    
    if (normal) {
      const n1 = new THREE.Vector3(normal.getX(v1), normal.getY(v1), normal.getZ(v1));
      const n2 = new THREE.Vector3(normal.getX(v2), normal.getY(v2), normal.getZ(v2));
      cost *= (1 - n1.dot(n2));
    }
    
    return cost;
  };

  const processModels = async () => {
    const loader = new FBXLoader();
    const objects = [];
    const newFileSizes = [];
    const newConvertedModels = [];
    const newLodModels = [];
    const newSimplificationStats = [];
  
    cumulativeBoundingBox.current = new THREE.Box3(
      new THREE.Vector3(Infinity, Infinity, Infinity),
      new THREE.Vector3(-Infinity, -Infinity, -Infinity)
    );
  
    const lodLevels = [
      { name: 'LOD0', reduction: 0 },
      { name: 'LOD1', reduction: 0.25 },
      { name: 'LOD2', reduction: 0.5 },
      { name: 'LOD3', reduction: 0.75 }
    ];
  
    for (const file of selectedFiles) {
      try {
        const fbxObject = await new Promise((resolve, reject) => {
          loader.load(
            URL.createObjectURL(file),
            (object) => resolve(object),
            undefined,
            (error) => reject(error)
          );
        });
  
        const lodVersions = lodLevels.map(level => {
          const lodObject = level.name === 'LOD0' ? fbxObject : fbxObject.clone();
          const meshStats = [];
          lodObject.traverse((child) => {
            if (child.isMesh && child.geometry) {
              if (level.name !== 'LOD0') {
                const result = simplifyGeometry(child.geometry, level.reduction);
                child.geometry = result.geometry;
                meshStats.push(result);
              }
              // Set color for this LOD level
              child.material = new THREE.MeshPhongMaterial({ color: lodColors[level.name] });
            }
          });
          if (level.name !== 'LOD0') {
            newSimplificationStats.push({ fileName: file.name, lodName: level.name, meshStats });
          }
          return { name: level.name, object: lodObject };
        });
  
        for (const lodVersion of lodVersions) {
          const lodData = await convertToGLTF(lodVersion.object);
          const compressedData = pako.deflate(lodData);
          await storeModelInIndexedDB(file.name, lodVersion.name, compressedData);
        }
  
        const gltfData = await convertToGLTF(fbxObject);
        const lodGltfData = await Promise.all(lodVersions.slice(1).map(lod => convertToGLTF(lod.object)));
  
        const gltfLoader = new GLTFLoader();
        const gltfObject = await new Promise((resolve, reject) => {
          gltfLoader.parse(gltfData, "", (gltf) => resolve(gltf.scene), reject);
        });
  
        objects.push(gltfObject);
        sceneRef.current.add(gltfObject);
        const boundingBox = new THREE.Box3().setFromObject(gltfObject);
        cumulativeBoundingBox.current.union(boundingBox);
  
        const gltfBlob = new Blob([gltfData], { type: "application/json" });
        const lodGltfBlobs = lodGltfData.map(data => new Blob([data], { type: "application/json" }));
  
        newFileSizes.push({
          name: file.name,
          fbxSize: file.size,
          gltfSize: gltfBlob.size,
          lodSizes: lodGltfBlobs.map((blob, index) => ({ name: lodLevels[index + 1].name, size: blob.size }))
        });
  
        newConvertedModels.push({
          fileName: file.name.replace(".fbx", ".glb"),
          data: gltfBlob,
        });
  
        newLodModels.push({
          fileName: file.name.replace(".fbx", ""),
          lodData: lodGltfBlobs.map((blob, index) => ({
            name: lodLevels[index + 1].name,
            data: blob
          }))
        });
  
      } catch (error) {
        console.error("Error processing model:", error);
      }
    }
  
    setSimplificationStats(newSimplificationStats);
  
    // Create Octree and establish mesh relations
    const newMeshRelations = establishMeshRelations(objects);
    const newOctree = createOctree(objects);
  
    // Create Octree visualization
    const octreeVis = createOctreeVisualization(newOctree);
    sceneRef.current.add(octreeVis);
    setOctreeVisualization(octreeVis);
  
    const octreeGzip = await createAndStoreGzipFiles(newOctree, newMeshRelations);
    const lodGzips = await createLodGzips();
    await storeInIndexedDB(lodGzips);
  
    setOctree(newOctree);
    setMeshRelations(newMeshRelations);
    setFileSizes(newFileSizes);
    setConvertedModels(newConvertedModels);
    setLodModels(newLodModels);
  
    updateFrustumCounts();
  };
  const convertToGLTF = async (object) => {
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
  const storeModelInIndexedDB = async (modelName, lodLevel, glbData) => {
    if (!db) return;
    const tx = db.transaction("models", "readwrite");
    const store = tx.objectStore("models");
    
    const compressedData = pako.gzip(glbData);
    
    await store.put(compressedData, `${modelName}_${lodLevel}`);
  };



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

  const animate = () => {
    requestAnimationFrame(animate);
    if (isVisible && flyCameraRef.current) {
      updateFrustumCounts();
      frustumHelperRef.current.update();
    }
     // Update frustum for fly camera
     flyFrustum.setFromProjectionMatrix(
      new THREE.Matrix4().multiplyMatrices(
        flyCameraRef.current.projectionMatrix,
        flyCameraRef.current.matrixWorldInverse
      )
    );
    
    

    // Check if fly camera is inside the static camera's frustum
    staticFrustum.setFromProjectionMatrix(
      new THREE.Matrix4().multiplyMatrices(
        sceneCameraRef.current.projectionMatrix,
        sceneCameraRef.current.matrixWorldInverse
      )
    );
    const flyCameraPosition = flyCameraRef.current.position;
    const isFlyInside = staticFrustum.containsPoint(flyCameraPosition);

   

    // Render the static camera view (main view)
    rendererRef.current.setViewport(0, 0, window.innerWidth, window.innerHeight);
    rendererRef.current.render(sceneRef.current, sceneCameraRef.current);

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
    rendererRef.current.render(sceneRef.current, flyCameraRef.current);
    rendererRef.current.setScissorTest(false);
  
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
    if (!sceneCameraRef.current || !flyCameraRef.current) return;

    const center = new THREE.Vector3();
    cumulativeBoundingBox.current.getCenter(center);
    const size = cumulativeBoundingBox.current.getSize(new THREE.Vector3());
    const distance = size.length();
    const fov = sceneCameraRef.current.fov * (Math.PI / 180);
    let cameraZ = distance / (2 * Math.tan(fov / 2));
    cameraZ *= 2.5;

    sceneCameraRef.current.position.set(center.x, center.y, center.z + cameraZ);
    sceneCameraRef.current.lookAt(center);

    // Position fly camera slightly in front of scene camera
    flyCameraRef.position.copy(sceneCameraRef.current.position);
    flyCameraRef.position.z -= 10; // Adjust this value as needed
    flyCameraRef.lookAt(center);

    updateFrustumCounts();
  };
  const toggleOctreeVisualization = () => {
    if (octreeVisualization) {
      octreeVisualization.visible = !octreeVisualization.visible;
    }
  };
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
          let cameraUp = flyCameraRef.current.up.clone().normalize();
          
          // Create a quaternion representing the rotation around the camera's up vector
          let quaternion = new THREE.Quaternion().setFromAxisAngle(cameraUp, rotationAngle);
          
          flyCameraRef.current.applyQuaternion(quaternion);
          updateFrustumCounts();
        } else {
          const zoomSpeed = movementY * 0.01; // Adjust zoom speed based on last recorded mouse movement
  
          const forwardDirection = new THREE.Vector3(0, 0, 1).applyQuaternion(flyCameraRef.current.quaternion);
          // Move the camera forward/backward along its local forward direction
          flyCameraRef.current.position.add(forwardDirection.multiplyScalar(zoomSpeed * adjustedTranslationSpeed * tileSizeFactor));
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
          flyCameraRef.current.translateX(moveSpeedX);
        } else if (isVertical) {
          // Move the camera along its local y axis
          flyCameraRef.current.translateY(-moveSpeedY);
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
        
         <div className="frustum-info">
        <h3>Frustum Information</h3>
        <p>Meshes inside frustum: {meshesInFrustum}</p>
        <p>Meshes outside frustum: {meshesOutsideFrustum}</p>
      </div>
        <button onClick={processModels}>Process Models</button>
        <button onClick={saveConvertedModels}>Save Converted Models</button>
        <div ref={mountRef} style={{ width: "99%", height: "100vh" }}></div>
      </div>

      <div className="button-container">
      <button className="custom-button" onClick={() => loadLOD('LOD1')}>
          Load LOD1
        </button>
        <button className="custom-button" onClick={() => loadLOD('LOD2')}>
          Load LOD2
        </button>
        <button className="custom-button" onClick={() => loadLOD('LOD3')}>
          Load LOD3
        </button>
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
        <button className="custom-button" onClick={toggleOctreeVisualization}>
          Toggle Octree
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
            <p>{file.name}</p>
            <p>FBX size: {(file.fbxSize / 1024 / 1024).toFixed(2)} MB</p>
            <p>glTF size: {(file.gltfSize / 1024 / 1024).toFixed(2)} MB</p>
            {file.lodSizes && file.lodSizes.map((lod, lodIndex) => (
              <p key={lodIndex}>{lod.name} size: {(lod.size / 1024 / 1024).toFixed(2)} MB</p>
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
      <div className="octree-info">
        <h3>Octree Information</h3>
        {octree && (
          <>
            <p>Octree created with {Object.keys(meshRelations).length} meshes</p>
          </>
        )}
      </div>
      
    </div>
  );
}

export default FbxToGlbLargeScene;
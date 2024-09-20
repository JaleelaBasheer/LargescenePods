// // import React, { useState, useEffect, useRef } from 'react';
// // import * as THREE from 'three';
// // import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader';
// // import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
// // import { MeshBVH, MeshBVHHelper } from 'three-mesh-bvh';
// // import LoadingBar from './LoadingBar';
// // import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
// // import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter";
// // import pako from 'pako';

// // // Octree implementation
// // class Octree {
// //     constructor(center, size) {
// //       this.center = center;
// //       this.size = size;
// //       this.children = [];
// //       this.objects = [];
// //       this.divided = false;
// //       this.boundingBox = new THREE.Box3().setFromCenterAndSize(this.center, new THREE.Vector3(this.size, this.size, this.size));
// //     }
// //   subdivide() {
// //     const { x, y, z } = this.center;
// //     const newSize = this.size / 2;
// //     const offset = newSize / 2;

// //     this.children = [
// //       new Octree(new THREE.Vector3(x - offset, y - offset, z - offset), newSize),
// //       new Octree(new THREE.Vector3(x + offset, y - offset, z - offset), newSize),
// //       new Octree(new THREE.Vector3(x - offset, y + offset, z - offset), newSize),
// //       new Octree(new THREE.Vector3(x + offset, y + offset, z - offset), newSize),
// //       new Octree(new THREE.Vector3(x - offset, y - offset, z + offset), newSize),
// //       new Octree(new THREE.Vector3(x + offset, y - offset, z + offset), newSize),
// //       new Octree(new THREE.Vector3(x - offset, y + offset, z + offset), newSize),
// //       new Octree(new THREE.Vector3(x + offset, y + offset, z + offset), newSize),
// //     ];
// //     this.divided = true;
// //   }

// //   insert(object) {
// //     if (!this.containsPoint(object.position)) return false;

// //     if (this.objects.length < 8 && !this.divided) {
// //       this.objects.push(object);
// //       return true;
// //     }

// //     if (!this.divided) this.subdivide();

// //     for (const child of this.children) {
// //       if (child.insert(object)) return true;
// //     }

// //     return false;
// //   }

// //   containsPoint(point) {
// //     return (
// //       point.x >= this.center.x - this.size / 2 &&
// //       point.x < this.center.x + this.size / 2 &&
// //       point.y >= this.center.y - this.size / 2 &&
// //       point.y < this.center.y + this.size / 2 &&
// //       point.z >= this.center.z - this.size / 2 &&
// //       point.z < this.center.z + this.size / 2
// //     );
// //   }
// //   intersectsFrustum(frustum) {
// //     return frustum.intersectsBox(this.boundingBox);
// //   }

// //   getVisibleOctants(frustum) {
// //     let count = 0;
// //     if (this.intersectsFrustum(frustum)) {
// //       count = 1;
// //       if (this.divided) {
// //         for (const child of this.children) {
// //           count += child.getVisibleOctants(frustum);
// //         }
// //       }
// //     }
// //     return count;
// //   }
// // }

// // function FbxtoGlb() {
// //   const [files, setFiles] = useState([]);
// //   const [boundingBox, setBoundingBox] = useState(null);
// //   const [objectCount, setObjectCount] = useState(0);
// //   const mountRef = useRef(null);
// //   const sceneRef = useRef(null);
// //   const rendererRef = useRef(null);
// //   const cameraRef = useRef(null);
// //   const controlsRef = useRef(null);
// //   const cumulativeBoundingBoxRef = useRef(new THREE.Box3());
// //   const octreeRef = useRef(null);
// //   const octreeVisualizerRef = useRef(null);
// //   const [visibleOctants, setVisibleOctants] = useState(0);
  
// //   const raycasterRef = useRef(new THREE.Raycaster());
// //   const [frustumCulledCount, setFrustumCulledCount] = useState(0);
// //   const [frustumUnculledCount, setFrustumUnculledCount] = useState(0);
// //   const [occlusionCulledCount, setOcclusionCulledCount] = useState(0);
// //   const [occlusionUnculledCount, setOcclusionUnculledCount] = useState(0);
// //   const [totalMeshes, setTotalMeshes] = useState(0);
// //   const [totalFiles, setTotalFiles] = useState(0);
// //   const mouse = useRef({ x: 0, y: 0 });
// //   const isMouseDown = useRef(false);
// //   const isPanning = useRef(false);
// //   const isZooming = useRef(false);
// //   const lastMouseMovement = useRef({ x: 0, y: 0 });
// //   const [flySpeed, setFlySpeed] = useState(1); 
// //   const [flyrotationSpeed, setflyrotationSpeed] = useState(1); 
// //   const [loadingProgress, setLoadingProgress] = useState(0);
// //   const [meshOctreeRelations, setMeshOctreeRelations] = useState({});
// //   const [nodeGzipRelations, setNodeGzipRelations] = useState({});
// //   const [fileSizes, setFileSizes] = useState([]);
// //   const [convertedModels, setConvertedModels] = useState([]);
// //   const [totalOctants, setTotalOctants] = useState(0);
// //   const [worker, setWorker] = useState(null);

// //   useEffect(() => {
// //     initScene();
// //     initWorker();
// //     return () => {
// //       if (rendererRef.current) {
// //         rendererRef.current.dispose();
// //       }
// //       if (worker) {
// //         worker.terminate();
// //       }
// //     };
// //   }, []);

// //   const initWorker = () => {
// //     const newWorker = new Worker(new URL('./meshWorker.js', import.meta.url));
// //     newWorker.onmessage = handleWorkerMessage;
// //     setWorker(newWorker);
// //     newWorker.postMessage({ type: 'INIT_DB' });
// //   };

// //   const handleWorkerMessage = (e) => {
// //     const { type, payload } = e.data;
// //     switch (type) {
// //       case 'DB_READY':
// //         console.log('IndexedDB is ready in the worker');
// //         break;
// //       case 'MESHES_PROCESSED':
// //         renderProcessedMeshes(payload);
// //         break;
// //     }
// //   };

// //   const renderProcessedMeshes = (meshes) => {
// //     console.log('Rendering processed meshes:', meshes);
// //     meshes.forEach((meshData, index) => {
// //       try {
// //         console.log(`Processing mesh ${index}:`, JSON.stringify(meshData, null, 2));
// //         const geometry = new THREE.BufferGeometry();
        
// //         if (meshData.geometry.data.attributes.position) {
// //           console.log(`Position array for mesh ${index}:`, meshData.geometry.data.attributes.position.array);
// //           if (meshData.geometry.data.attributes.position.array) {
// //             geometry.setAttribute('position', new THREE.Float32BufferAttribute(
// //               meshData.geometry.data.attributes.position.array, 3
// //             ));
// //           } else {
// //             console.error(`Position array is undefined for mesh ${index}`);
// //           }
// //         } else {
// //           console.warn(`Mesh ${index} is missing position attribute`);
// //         }
        
// //         if (meshData.geometry.data.attributes.normal) {
// //           geometry.setAttribute('normal', new THREE.Float32BufferAttribute(
// //             meshData.geometry.data.attributes.normal.array, 3
// //           ));
// //         }
        
// //         if (meshData.geometry.data.attributes.uv) {
// //           geometry.setAttribute('uv', new THREE.Float32BufferAttribute(
// //             meshData.geometry.data.attributes.uv.array, 2
// //           ));
// //         }
        
// //         if (meshData.geometry.data.index) {
// //           geometry.setIndex(new THREE.Uint16BufferAttribute(
// //             meshData.geometry.data.index.array, 1
// //           ));
// //         }
  
// //         const material = new THREE.MeshBasicMaterial({ color: 0xcccccc, wireframe: true });
// //         const mesh = new THREE.Mesh(geometry, material);
        
// //         console.log(`Adding mesh ${index} to scene. Geometry valid:`, geometry.isBufferGeometry);
// //         sceneRef.current.add(mesh);
// //       } catch (error) {
// //         console.error(`Error processing mesh ${index}:`, error);
// //       }
// //     });
// //   };


// //   const initScene = () => {
// //     const scene = new THREE.Scene();
// //     const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
// //     const renderer = new THREE.WebGLRenderer();
// //     renderer.setSize(window.innerWidth, window.innerHeight);
// //     renderer.setClearColor(0x00ffff);
// //     mountRef.current.appendChild(renderer.domElement);

// //     // const controls = new OrbitControls(camera, renderer.domElement);

// //     const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
// //     scene.add(ambientLight);

// //     const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
// //     directionalLight.position.set(1, 1, 1);
// //     scene.add(directionalLight);

// //     const controls = new OrbitControls(camera, renderer.domElement);
// //     controlsRef.current = controls;


// //     sceneRef.current = scene;
// //     cameraRef.current = camera;
// //     rendererRef.current = renderer;
// //     // controlsRef.current = controls;

// //     animate();
// //   };

// //   const animate = () => {
// //     requestAnimationFrame(animate);
// //     if (controlsRef.current) controlsRef.current.update();
// //     if (rendererRef.current && sceneRef.current && cameraRef.current) {
// //       rendererRef.current.render(sceneRef.current, cameraRef.current);
// //       updateCullingStats();
// //     }
// //   };
// //     const updateCullingStats = () => {
// //         const camera = cameraRef.current;
// //         const frustum = new THREE.Frustum();
// //         const cameraViewProjectionMatrix = new THREE.Matrix4();
        
// //         // Update camera matrices
// //         camera.updateMatrixWorld();
// //         cameraViewProjectionMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
// //         frustum.setFromProjectionMatrix(cameraViewProjectionMatrix);
      
// //         let frustumCulled = 0;
// //         let frustumUnculled = 0;
// //         let occlusionCulled = 0;
// //         let occlusionUnculled = 0;
// //         const objectsToCheck = [];
        
// //         // Traverse scene and perform frustum culling
// //         sceneRef.current.traverse((child) => {
// //           if (child.isMesh) {
// //             const boundingBox = new THREE.Box3().setFromObject(child);
            
// //             // Frustum culling
// //             if (frustum.intersectsBox(boundingBox)) {
// //               frustumUnculled++;
// //               objectsToCheck.push(child); // Save for occlusion check
// //             } else {
// //               frustumCulled++;
// //               child.visible = false; // Hide objects outside the frustum
// //             }
// //           }
// //         });
      
// //         // Perform raycasting for occlusion culling
// //         const raycaster = new THREE.Raycaster();
// //         objectsToCheck.forEach((obj) => {
// //       // Compute the bounding sphere for more accurate raycasting
// //       obj.geometry.computeBoundingSphere();
// //       const boundingSphere = obj.geometry.boundingSphere;
// //       const direction = boundingSphere.center.clone().sub(camera.position).normalize();
      
// //       // Set ray from the camera to the object's bounding sphere center
// //       raycaster.set(camera.position, direction);
      
// //       // Perform raycasting against all objects within the frustum
// //       const intersects = raycaster.intersectObjects(objectsToCheck, true);
      
// //       if (intersects.length > 0) {
// //         // Check if any object is blocking the current object
// //         const closestIntersect = intersects[0];
        
// //         if (closestIntersect.object !== obj && closestIntersect.distance < boundingSphere.center.distanceTo(camera.position)) {
// //           // An object is blocking this one, mark it occluded
// //           obj.visible = false;
// //           occlusionCulled++;
// //         } else {
// //           // No object blocking this one, mark it visible
// //           obj.visible = true;
// //           occlusionUnculled++;
// //         }
// //       } else {
// //         // No intersections, make the object visible
// //         obj.visible = true;
// //         occlusionUnculled++;
// //       }
// //     });
// //     let visibleOctantsCount = 0;
// //     if (octreeRef.current) {
// //       const visibleOctants = getVisibleOctants(octreeRef.current, frustum);
// //       visibleOctantsCount = visibleOctants.length;
// //       setVisibleOctants(visibleOctantsCount);
  
// //       // Process visible meshes in the worker
// //       if (worker) {
// //         const visibleNodeIds = visibleOctants.map(octant => 
// //           `node_${octant.depth}_${octant.center.x}_${octant.center.y}_${octant.center.z}`
// //         );
// //         worker.postMessage({
// //           type: 'PROCESS_CULLED_MESHES',
// //           payload: { visibleNodeIds }
// //         });
// //       }
// //     }
  
  
// //     // Update stats
// //     setFrustumCulledCount(frustumCulled);
// //     setFrustumUnculledCount(frustumUnculled);
// //     setOcclusionCulledCount(occlusionCulled);
// //     setOcclusionUnculledCount(occlusionUnculled);
// //     setTotalMeshes(frustumCulled + frustumUnculled); // Total meshes
// //   };
// //   const getVisibleOctants = (octree, frustum) => {
// //     const visibleOctants = [];
// //     const traverse = (node, depth = 0) => {
// //       if (node && node.intersectsFrustum && node.intersectsFrustum(frustum)) {
// //         visibleOctants.push({...node, depth});
// //         if (node.divided) {
// //           node.children.forEach(child => traverse(child, depth + 1));
// //         }
// //       }
// //     };
// //     traverse(octree);
// //     return visibleOctants;
// //   };
  
  

// //   const handleFileUpload = async (event) => {
// //     const files = event.target.files;
// //     setFiles(files);
// //     if (!files.length) return;

// //     while(sceneRef.current.children.length > 0){ 
// //       sceneRef.current.remove(sceneRef.current.children[0]); 
// //     }

// //     const loader = new FBXLoader();
// //     let cumulativeBox = new THREE.Box3();
// //     let hasItems = false;
// //     const meshBoundingBoxes = [];
// //     const meshFileRelations = {};
// //     const serializedGeometries = {};
// //     const newFileSizes = [];
// //     const newConvertedModels = [];

// //     for (const file of files) {
// //       try {
// //         const fbxObject = await loadFile(file, loader);
// //         const glbData = await convertToGLB(fbxObject);
// //         const glbObject = await loadGLB(glbData);

// //         glbObject.traverse((child) => {
// //           if (child.isMesh) {
// //             const box = new THREE.Box3().setFromObject(child);
// //             meshBoundingBoxes.push(box);
// //             meshFileRelations[box.uuid] = file.name;
// //             serializedGeometries[box.uuid] = serializeGeometry(child.geometry);
            
// //             if (hasItems) {
// //               cumulativeBox.union(box);
// //             } else {
// //               cumulativeBox.copy(box);
// //               hasItems = true;
// //             }
// //           }
// //         });

// //         const glbBlob = new Blob([glbData], { type: "model/gltf-binary" });
// //         newFileSizes.push({ name: file.name, fbxSize: file.size, glbSize: glbBlob.size });
// //         newConvertedModels.push({ fileName: file.name.replace(".fbx", ".glb"), data: glbBlob });
// //       } catch (error) {
// //         console.error('Error processing loaded object:', error);
// //       }
// //     }

// //     if (hasItems) {
// //         updateBoundingBox(cumulativeBox);
// //         const octree = createOctree(cumulativeBox, meshBoundingBoxes);
// //         octreeRef.current = octree;
// //         positionCamera(cumulativeBox);
// //         createBoundingBoxMeshes(meshBoundingBoxes);
// //         createCumulativeBoundingBoxMesh(cumulativeBox);
// //         // visualizeOctree(octree);
// //         const relations = relateMeshesToOctree(octree, meshBoundingBoxes);
// //         setMeshOctreeRelations(relations);
// //         await createAndStoreGzipFiles(octree, meshFileRelations, serializedGeometries);
    
// //         // Ensure the octree is set before updating culling stats
// //         updateCullingStats();
// //     }

// //     setFileSizes(newFileSizes);
// //     setConvertedModels(newConvertedModels);
// //   };

// //   const loadFile = (file, loader) => {
// //     return new Promise((resolve, reject) => {
// //       const reader = new FileReader();
// //       reader.onload = (e) => {
// //         const arrayBuffer = e.target.result;
// //         const blob = new Blob([arrayBuffer], { type: file.type });
// //         const objectUrl = URL.createObjectURL(blob);

// //         loader.load(
// //           objectUrl,
// //           (object) => resolve(object),
// //           (xhr) => console.log((xhr.loaded / xhr.total * 100) + '% loaded'),
// //           (error) => reject(error)
// //         );
// //       };
// //       reader.readAsArrayBuffer(file);
// //     });
// //   };

// //   const convertToGLB = (fbxObject) => {
// //     return new Promise((resolve, reject) => {
// //       fbxObject.traverse((child) => {
// //         if (child.isMesh) {
// //           child.material = new THREE.MeshBasicMaterial({ color: 0xcccccc });
// //           if (child.geometry.attributes.color) {
// //             child.geometry.deleteAttribute("color");
// //           }
// //           if (child.geometry.attributes.uv) {
// //             child.geometry.deleteAttribute("uv");
// //           }
// //           if (child.geometry.attributes.normal) {
// //             child.geometry.deleteAttribute("normal");
// //           }
// //         }
// //       });
  
// //       const exporter = new GLTFExporter();
// //       exporter.parse(
// //         fbxObject,
// //         (result) => resolve(result),
// //         (error) => reject(error),
// //         { binary: true }
// //       );
// //     });
// //   };

// //   const loadGLB = (glbData) => {
// //     return new Promise((resolve, reject) => {
// //       const loader = new GLTFLoader();
// //       loader.parse(glbData, "", (gltf) => resolve(gltf.scene), reject);
// //     });
// //   };

// //   const serializeGeometry = (geometry) => {
// //     return {
// //       vertices: Array.from(geometry.attributes.position.array),
// //       normals: geometry.attributes.normal ? Array.from(geometry.attributes.normal.array) : null,
// //       uvs: geometry.attributes.uv ? Array.from(geometry.attributes.uv.array) : null,
// //       indices: geometry.index ? Array.from(geometry.index.array) : null,
// //     };
// //   };

// //   const createOctree = (box, meshBoundingBoxes) => {
// //     const center = new THREE.Vector3();
// //     box.getCenter(center);
// //     const size = Math.max(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z);
// //     const octree = new Octree(center, size);

// //     meshBoundingBoxes.forEach(meshBox => {
// //       const meshCenter = new THREE.Vector3();
// //       meshBox.getCenter(meshCenter);
// //       octree.insert({ position: meshCenter, boxUuid: meshBox.uuid });
// //     });

// //     console.log(`Added ${meshBoundingBoxes.length} objects to the Octree`);
    
// //     const countOctants = (node) => {
// //       let count = 1;
// //       if (node.divided) {
// //         node.children.forEach(child => {
// //           count += countOctants(child);
// //         });
// //       }
// //       return count;
// //     };
// //     setTotalOctants(countOctants(octree));

// //     return octree;
// //   };
// //   const relateMeshesToOctree = (octree, meshBoundingBoxes) => {
// //     const relations = {};

// //     const traverse = (node, depth = 0) => {
// //       node.objects.forEach(obj => {
// //         if (!relations[obj.boxUuid]) {
// //           relations[obj.boxUuid] = [];
// //         }
// //         relations[obj.boxUuid].push({ node, depth });
// //       });

// //       if (node.divided) {
// //         node.children.forEach(child => traverse(child, depth + 1));
// //       }
// //     };

// //     traverse(octree);
// //     return relations;
// //   };

// //   const createAndStoreGzipFiles = async (octree, meshFileRelations, serializedGeometries) => {
// //     const db = await openIndexedDB();
// //     const nodeGzipRelations = {};

// //     const createGzipForNode = async (node, depth) => {
// //       const nodeId = `node_${depth}_${node.center.toArray().join('_')}`;
// //       const nodeData = {};

// //       node.objects.forEach(obj => {
// //         const fileName = meshFileRelations[obj.boxUuid];
// //         if (fileName) {
// //           const geometryJson = JSON.stringify(serializedGeometries[obj.boxUuid]);
// //           nodeData[fileName] = geometryJson;
// //         }
// //       });

// //       const jsonString = JSON.stringify(nodeData);
// //       const gzippedData = pako.gzip(jsonString);
// //       const gzipBlob = new Blob([gzippedData], { type: 'application/gzip' });

// //       await storeGzipInIndexedDB(db, nodeId, gzipBlob);

// //       nodeGzipRelations[nodeId] = { node, depth };

// //       if (node.divided) {
// //         await Promise.all(node.children.map(child => createGzipForNode(child, depth + 1)));
// //       }
// //     };

// //     await createGzipForNode(octree, 0);
// //     setNodeGzipRelations(nodeGzipRelations);
// //     db.close();
// //   };

// //   const openIndexedDB = () => {
// //     return new Promise((resolve, reject) => {
// //       const request = indexedDB.open('OctreeGzipDB', 1);
// //       request.onerror = () => reject(request.error);
// //       request.onsuccess = () => resolve(request.result);
// //       request.onupgradeneeded = (event) => {
// //         const db = event.target.result;
// //         db.createObjectStore('gzips', { keyPath: 'nodeId' });
// //       };
// //     });
// //   };

// //   const storeGzipInIndexedDB = (db, nodeId, gzipBlob) => {
// //     return new Promise((resolve, reject) => {
// //       const transaction = db.transaction(['gzips'], 'readwrite');
// //       const store = transaction.objectStore('gzips');
// //       const request = store.put({ nodeId, gzipBlob });
// //       request.onerror = () => reject(request.error);
// //       request.onsuccess = () => resolve();
// //     });
// //   };

// //   const updateBoundingBox = (box) => {
// //     const center = new THREE.Vector3();
// //     const size = new THREE.Vector3();
// //     box.getCenter(center);
// //     box.getSize(size);
// //     setBoundingBox({ center, size });
// //   };

// //   const positionCamera = (box) => {
// //     const camera = cameraRef.current;
// //     const controls = controlsRef.current;
// //     const size = new THREE.Vector3();
// //     box.getSize(size);
// //     const maxDim = Math.max(size.x, size.y, size.z);
// //     const fov = camera.fov * (Math.PI / 180);
// //     const cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2)) * 1.5;
// //     const center = new THREE.Vector3();
// //     box.getCenter(center);

// //     camera.position.set(center.x, center.y, center.z + cameraZ);
// //     camera.lookAt(center);
// //     controls.target.copy(center);
// //     controls.update();
// //   };

// //   const createBoundingBoxMeshes = (boxes) => {
// //     boxes.forEach((box) => {
// //       const mesh = createBoundingBoxMesh(box, 0x00ff00, 0.5);
// //       sceneRef.current.add(mesh);
// //     });
// //   };

// //   const createCumulativeBoundingBoxMesh = (box) => {
// //     const mesh = createBoundingBoxMesh(box, 0xffff00, 1);
// //     sceneRef.current.add(mesh);
// //   };

// //   const createBoundingBoxMesh = (box, color, opacity = 1) => {
// //     const size = new THREE.Vector3();
// //     box.getSize(size);

// //     const geometry = new THREE.BoxGeometry(1, 1, 1);
// //     const material = new THREE.MeshBasicMaterial({ 
// //       color: color, 
// //       wireframe: true, 
// //       transparent: true, 
// //       opacity: opacity 
// //     });
// //     const mesh = new THREE.Mesh(geometry, material);

// //     const center = box.getCenter(new THREE.Vector3());
// //     mesh.position.set(center.x, center.y, center.z);
// //     mesh.scale.set(size.x, size.y, size.z);

// //     return mesh;
// //   };

// //   const visualizeOctree = (octree) => {
// //     if (!octree) return;

// //     const maxDepth = getMaxDepth(octree);

// //     const visualizeNode = (node, depth = 0) => {
// //       const color = getColorForDepth(depth, maxDepth);
// //       const mesh = createBoundingBoxMesh(node.boundingBox, color, 0.3);
// //       sceneRef.current.add(mesh);

// //       if (node.divided) {
// //         node.children.forEach(child => {
// //           visualizeNode(child, depth + 1);
// //         });
// //       }
// //     };

// //     visualizeNode(octree);
// //   };

// //   const getMaxDepth = (node) => {
// //     if (!node.divided) return 0;
// //     return 1 + Math.max(...node.children.map(getMaxDepth));
// //   };

// //   const getColorForDepth = (depth, maxDepth) => {
// //     const hue = (depth / maxDepth) * 0.8;
// //     return new THREE.Color().setHSL(hue, 1, 0.5);
// //   };


// //     const fitView=()=>{
// //         const box = cumulativeBoundingBoxRef.current;
// //         if (box.isEmpty()) {
// //           console.log('Bounding box is empty');
// //           return;
// //         }
  
// //         const center = box.getCenter(new THREE.Vector3());
// //         const size = box.getSize(new THREE.Vector3());
// //         const maxDim = Math.max(size.x, size.y, size.z);
// //         const fov = cameraRef.current.fov * (Math.PI / 180);
// //         let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));
// //         cameraZ *= 1.5;
  
// //         cameraRef.current.position.set(center.x, center.y, center.z + cameraZ);
// //         cameraRef.current.lookAt(center);
// //     }
// // return (
   
// //     <div>
// //     <h1>FBX to GLB Converter with Octree Visualization</h1>
// //     <input type="file" accept=".fbx" multiple onChange={handleFileUpload} />
// //     {/* <button onClick={saveConvertedModels}>Save Converted Models</button> */}
    
// //     {boundingBox && (
// //       <div>
// //          <button onClick={fitView} className='btn'>fitview</button>
// //         <p>Cumulative Center: {`x: ${boundingBox.center.x.toFixed(2)}, y: ${boundingBox.center.y.toFixed(2)}, z: ${boundingBox.center.z.toFixed(2)}`}</p>
// //         <p>Cumulative Size: {`x: ${boundingBox.size.x.toFixed(2)}, y: ${boundingBox.size.y.toFixed(2)}, z: ${boundingBox.size.z.toFixed(2)}`}</p>
// //         <p>Visible Octants: {visibleOctants}</p>
// //         <p>Total Octants: {totalOctants}</p>
// //         <p>Octants Outside Frustum: {totalOctants - visibleOctants}</p>
// //         <p>Frustum Culled: {frustumCulledCount}</p>
// //         <p>Frustum Unculled: {frustumUnculledCount}</p>
// //         <p>Occlusion Culled: {occlusionCulledCount}</p>
// //         <p>Occlusion Unculled: {occlusionUnculledCount}</p>
// //         <p>Total Meshes: {totalMeshes}</p>
// //       </div>
// //     )}
// //     <div ref={mountRef} style={{ width: '100vw', height: '100vh' }} />
// //     <div>
// //       {fileSizes.length > 0 && (
// //         <table>
// //           <thead>
// //             <tr>
// //               <th>File Name</th>
// //               <th>FBX Size</th>
// //               <th>GLB Size</th>
// //             </tr>
// //           </thead>
// //           <tbody>
// //             {fileSizes.map(({ name, fbxSize, glbSize }) => (
// //               <tr key={name}>
// //                 <td>{name}</td>
// //                 <td>{(fbxSize / 1024 / 1024).toFixed(2)} MB</td>
// //                 <td>{(glbSize / 1024 / 1024).toFixed(2)} MB</td>
// //               </tr>
// //             ))}
// //           </tbody>
// //         </table>
// //       )}
// //     </div>
// //   </div>
// // );

// // }

// // export default FbxtoGlb;
// import React, { useEffect, useRef, useState } from "react";
// import * as THREE from "three";
// import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader";
// import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
// import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter";
// import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
// import pako from 'pako'; // Import pako for GZIP compression
// // import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
// // import { faEyeSlash, faEye, faSearch } from "@fortawesome/free-solid-svg-icons";

// function FBXViewer() {
//   const mountRef = useRef(null);
//   const sceneRef = useRef(new THREE.Scene());
//   const cameraRef = useRef(
//     new THREE.PerspectiveCamera(
//       75,
//       window.innerWidth / window.innerHeight,
//       0.1,
//       1000
//     )
//   );

//   const rendererRef = useRef(new THREE.WebGLRenderer({ antialias: true }));
//   const controlsRef = useRef(null);
//   const cumulativeBoundingBox = useRef(
//     new THREE.Box3(
//       new THREE.Vector3(Infinity, Infinity, Infinity),
//       new THREE.Vector3(-Infinity, -Infinity, -Infinity)
//     )
//   );

//   const [isVisible, setIsVisible] = useState(true);
//   const [fileSizes, setFileSizes] = useState([]);
//   const [saveDirectory, setSaveDirectory] = useState(null);
//   const [selectedFiles, setSelectedFiles] = useState([]);
//   const [convertedModels, setConvertedModels] = useState([]);
//   const [backgroundColor, setBackgroundColor] = useState(0x000000);

//   useEffect(() => {
//     rendererRef.current.setSize(window.innerWidth, window.innerHeight);
//     rendererRef.current.outputEncoding = THREE.sRGBEncoding;
//     mountRef.current.appendChild(rendererRef.current.domElement);

//     const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
//     sceneRef.current.add(ambientLight);
//     const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
//     directionalLight.position.set(0, 1, 0);
//     sceneRef.current.add(directionalLight);

//     controlsRef.current = new OrbitControls(
//       cameraRef.current,
//       rendererRef.current.domElement
//     );
//     controlsRef.current.enableDamping = true;
//     controlsRef.current.dampingFactor = 0.1;

//     animate();

//     const handleResize = () => {
//       const width = window.innerWidth;
//       const height = window.innerHeight;
//       rendererRef.current.setSize(width, height);
//       cameraRef.current.aspect = width / height;
//       cameraRef.current.updateProjectionMatrix();
//     };

//     window.addEventListener("resize", handleResize);

//     return () => {
//       mountRef.current.removeChild(rendererRef.current.domElement);
//       controlsRef.current.dispose();
//       window.removeEventListener("resize", handleResize);
//     };
//   }, []);

//   useEffect(() => {
//     rendererRef.current.setClearColor(backgroundColor);
//   }, [backgroundColor]);

//   const selectSaveDirectory = async () => {
//     try {
//       const dirHandle = await window.showDirectoryPicker();
//       setSaveDirectory(dirHandle);
//     } catch (err) {
//       console.error("Error selecting directory:", err);
//     }
//   };

//   const onFileChange = (event) => {
//     setSelectedFiles(Array.from(event.target.files));
//   };

//   const processModels = async () => {
//     const loader = new FBXLoader();
//     const objects = [];
//     const newFileSizes = [];
//     const newConvertedModels = [];
  
//     cumulativeBoundingBox.current = new THREE.Box3(
//       new THREE.Vector3(Infinity, Infinity, Infinity),
//       new THREE.Vector3(-Infinity, -Infinity, -Infinity)
//     );
  
//     for (const file of selectedFiles) {
//       try {
//         const fbxObject = await new Promise((resolve, reject) => {
//           loader.load(
//             URL.createObjectURL(file),
//             (object) => resolve(object),
//             undefined,
//             (error) => reject(error)
//           );
//         });
  
//         // Remove colors, textures, and materials
//         fbxObject.traverse((child) => {
//           if (child.isMesh) {
//             child.material = new THREE.MeshBasicMaterial({ color: 0xcccccc });
//             if (child.geometry.attributes.color) {
//               child.geometry.deleteAttribute("color");
//             }
//             if (child.geometry.attributes.uv) {
//               child.geometry.deleteAttribute("uv");
//             }
//             if (child.geometry.attributes.normal) {
//               child.geometry.deleteAttribute("normal");
//             }
//           }
//         });
  
//         // Convert FBX to GLB
//         const glbData = await new Promise((resolve, reject) => {
//           const exporter = new GLTFExporter();
//           exporter.parse(
//             fbxObject,
//             (result) => {
//               if (result instanceof ArrayBuffer) {
//                 resolve(result); // GLB binary data
//               } else {
//                 const blob = new Blob([JSON.stringify(result)], {
//                   type: "application/json",
//                 });
//                 blob.arrayBuffer().then(resolve).catch(reject);
//               }
//             },
//             { binary: true }, // Set binary to true to get GLB format
//             (error) => reject(error)
//           );
//         });
  
//         // GZIP compression
//         const compressedData = pako.gzip(new Uint8Array(glbData));
  
//         // Load converted GLB for rendering
//         const gltfLoader = new GLTFLoader();
//         const gltfObject = await new Promise((resolve, reject) => {
//           gltfLoader.parse(glbData, "", (gltf) => resolve(gltf.scene), reject);
//         });
  
//         objects.push(gltfObject);
//         const boundingBox = new THREE.Box3().setFromObject(gltfObject);
//         cumulativeBoundingBox.current.union(boundingBox);
  
//         newFileSizes.push({
//           name: file.name,
//           fbxSize: file.size,
//           glbSize: glbData.byteLength,
//           compressedSize: compressedData.byteLength,
//         });
  
//         const blob = new Blob([compressedData], { type: "application/octet-stream" });
//         newConvertedModels.push({
//           fileName: file.name.replace(".fbx", ".glb.gz"),
//           data: blob,
//         });
//       } catch (error) {
//         console.error("Error processing model:", error);
//       }
//     }
  
//     objects.forEach((obj) => sceneRef.current.add(obj));
//     adjustCamera();
//     setFileSizes(newFileSizes);
//     setConvertedModels(newConvertedModels);
//   };

//   const saveConvertedModels = async () => {
//     if (!saveDirectory) {
//       alert("Please select a save directory first.");
//       return;
//     }

//     if (convertedModels.length === 0) {
//       alert(
//         "No models have been processed yet. Please process models before saving."
//       );
//       return;
//     }

//     let successCount = 0;
//     let failCount = 0;

//     for (const model of convertedModels) {
//       try {
//         const newHandle = await saveDirectory.getFileHandle(model.fileName, {
//           create: true,
//         });
//         const writable = await newHandle.createWritable();
//         await writable.write(model.data);
//         await writable.close();
//         successCount++;
//       } catch (error) {
//         console.error("Error saving file:", model.fileName, error);
//         failCount++;
//       }
//     }

//     alert(
//       `Saving complete!\n${successCount} files saved successfully.\n${failCount} files failed to save.`
//     );
//   };

//   const adjustCamera = () => {
//     const center = new THREE.Vector3();
//     cumulativeBoundingBox.current.getCenter(center);
//     const size = cumulativeBoundingBox.current.getSize(new THREE.Vector3());
//     const distance = size.length();
//     const fov = cameraRef.current.fov * (Math.PI / 180);
//     let cameraZ = distance / (2 * Math.tan(fov / 2));
//     cameraZ *= 2.5;

//     cameraRef.current.position.set(center.x, center.y, center.z + cameraZ);
//     cameraRef.current.lookAt(center);
//     controlsRef.current.target.copy(center);
//     controlsRef.current.update();
//   };

//   const animate = () => {
//     requestAnimationFrame(animate);
//     if (isVisible) {
//       controlsRef.current.update();
//       rendererRef.current.render(sceneRef.current, cameraRef.current);
//     }
//   };

//   const toggleVisibility = (visible) => {
//     setIsVisible(visible);
//     sceneRef.current.traverse(function (object) {
//       if (object instanceof THREE.Mesh) {
//         object.visible = visible;
//       }
//     });
//   };

//   const resetCameraView = () => {
//     const center = new THREE.Vector3();
//     cumulativeBoundingBox.current.getCenter(center);
//     const size = cumulativeBoundingBox.current.getSize(new THREE.Vector3());
//     const distance = size.length();
//     const fov = cameraRef.current.fov * (Math.PI / 180);
//     let cameraZ = distance / (2 * Math.tan(fov / 2));
//     cameraZ *= 2.5;

//     cameraRef.current.position.set(center.x, center.y, center.z + cameraZ);
//     cameraRef.current.lookAt(center);
//     controlsRef.current.target.copy(center);
//     controlsRef.current.update();
//   };

//   return (
//     <div className="main">
//       <div className="canvas-container">
//         <button onClick={selectSaveDirectory}>Select Save Directory</button>
//         <input
//           className="button"
//           type="file"
//           multiple
//           onChange={onFileChange}
//           accept=".fbx"
//         />
//         <button onClick={processModels}>Process Models</button>
//         <button onClick={saveConvertedModels}>Save Converted Models</button>
//         <div ref={mountRef} style={{ width: "99%", height: "100vh" }}></div>
//       </div>

//       <div className="button-container">
//         {/* <button
//           className="custom-button hide-show"
//           onClick={() => toggleVisibility(true)}
//         >
//           <FontAwesomeIcon icon={faEye} />
//         </button>
//         <button
//           className="custom-button"
//           onClick={() => toggleVisibility(false)}
//         >
//           <FontAwesomeIcon icon={faEyeSlash} />
//         </button>
//         <button className="custom-button fit-view" onClick={resetCameraView}>
//           <FontAwesomeIcon icon={faSearch} />
//         </button> */}
//         <input
//           type="color"
//           value={"#" + backgroundColor.toString(16).padStart(6, "0")}
//           onChange={(e) =>
//             setBackgroundColor(parseInt(e.target.value.slice(1), 16))
//           }
//         />
//       </div>

//       <div className="file-sizes">
//         {fileSizes.map((file, index) => (
//           <div key={index}>
//             <p>{file.name}</p>
//             <p>FBX size: {(file.fbxSize / 1024 / 1024).toFixed(2)} MB</p>
//             <p>GLB size: {(file.glbSize / 1024 / 1024).toFixed(2)} MB</p>
//             <p>Compressed size: {(file.compressedSize / 1024 / 1024).toFixed(2)} MB</p>
//           </div>
//         ))}
//       </div>
//     </div>
//   );
// }

// export default FBXViewer;
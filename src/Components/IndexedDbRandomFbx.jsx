import React, { useRef, useState, useEffect } from 'react';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import JSZip from 'jszip';
// Custom Octree class
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
  const [boundingBox, setBoundingBox] = useState(null);
  const containerRef = useRef(null);
  const sceneRef = useRef(new THREE.Scene());
  const cameraRef = useRef(new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000));
  const rendererRef = useRef(new THREE.WebGLRenderer());
  const octreeRef = useRef(null);
  const controlsRef = useRef(null);
  const [meshOctreeRelations, setMeshOctreeRelations] = useState({});
  const [nodeZipRelations, setNodeZipRelations] = useState({});
  const [visibleOctants, setVisibleOctants] = useState(0);
  const [totalOctants, setTotalOctants] = useState(0);
  useEffect(() => {
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    const scene = sceneRef.current;

    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x00ffff);
    containerRef.current.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controlsRef.current = controls;

    const frustum = new THREE.Frustum();
    const projScreenMatrix = new THREE.Matrix4();

    const animate = () => {
      requestAnimationFrame(animate);
      controls.update();

      // Update the frustum
      camera.updateMatrixWorld();
      projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(projScreenMatrix);

      // Perform frustum culling
      if (octreeRef.current) {
        const visibleCount = octreeRef.current.getVisibleOctants(frustum);
        setVisibleOctants(visibleCount);
      }

      renderer.render(scene, camera);
    };
    animate();


    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      containerRef.current.removeChild(renderer.domElement);
      window.removeEventListener('resize', handleResize);
      controls.dispose();
      rendererRef.current.dispose();
    };
  }, []);

  const handleFileUpload = async (event) => {
    const files = event.target.files;
    if (!files.length) return;
 // Clear existing objects from the scene
 while(sceneRef.current.children.length > 0){ 
  sceneRef.current.remove(sceneRef.current.children[0]); 
}
    const loader = new FBXLoader();
    let cumulativeBox = new THREE.Box3();
    let hasItems = false;
    const meshBoundingBoxes = [];
    const meshFileRelations = {};
    const serializedGeometries = {};

    sceneRef.current.clear();

    for (const file of files) {
      try {
        const { object, serializedGeometry } = await loadFile(file, loader);

        object.traverse((child) => {
          if (child.isMesh) {
            const box = new THREE.Box3().setFromObject(child);
            meshBoundingBoxes.push(box);
            meshFileRelations[box.uuid] = file.name;
            serializedGeometries[box.uuid] = serializedGeometry;
            
            if (hasItems) {
              cumulativeBox.union(box);
            } else {
              cumulativeBox.copy(box);
              hasItems = true;
            }
          }
        });
      } catch (error) {
        console.error('Error processing loaded object:', error);
      }
    }

    if (hasItems) {
      updateBoundingBox(cumulativeBox);
      const octree = createOctree(cumulativeBox, meshBoundingBoxes);
      positionCamera(cumulativeBox);
      createBoundingBoxMeshes(meshBoundingBoxes);
      createCumulativeBoundingBoxMesh(cumulativeBox);
      visualizeOctree(octree);
      const relations = relateMeshesToOctree(octree, meshBoundingBoxes);
      setMeshOctreeRelations(relations);
      await createAndStoreZipFiles(octree, meshFileRelations, serializedGeometries);
    }
  };

  const loadFile = (file, loader) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const arrayBuffer = e.target.result;
        const blob = new Blob([arrayBuffer], { type: file.type });
        const objectUrl = URL.createObjectURL(blob);

        loader.load(
          objectUrl,
          (object) => {
            const serializedGeometry = serializeGeometry(object);
            resolve({ object, serializedGeometry });
          },
          (xhr) => console.log((xhr.loaded / xhr.total * 100) + '% loaded'),
          (error) => reject(error)
        );
      };
      reader.readAsArrayBuffer(file);
    });
  };

  const serializeGeometry = (object) => {
    const geometries = [];
    object.traverse((child) => {
      if (child.isMesh) {
        console.log('Original mesh:', child);
      const geometry = child.geometry;
      const serializedGeometry = {
        vertices: Array.from(geometry.attributes.position.array),
        normals: geometry.attributes.normal ? Array.from(geometry.attributes.normal.array) : null,
        uvs: geometry.attributes.uv ? Array.from(geometry.attributes.uv.array) : null,
        indices: geometry.index ? Array.from(geometry.index.array) : null,
      };
      console.log('Serialized geometry:', serializedGeometry);
      }
    });
    return JSON.stringify(geometries);
  };

  const createOctree = (box, meshBoundingBoxes) => {
    const center = new THREE.Vector3();
    box.getCenter(center);
    const size = Math.max(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z);
    const octree = new Octree(center, size);

    meshBoundingBoxes.forEach(meshBox => {
      const meshCenter = new THREE.Vector3();
      meshBox.getCenter(meshCenter);
      octree.insert({ position: meshCenter, boxUuid: meshBox.uuid });
    });

    octreeRef.current = octree;
    console.log(`Added ${meshBoundingBoxes.length} objects to the Octree`);
    
    // Count total octants
    const countOctants = (node) => {
      let count = 1;
      if (node.divided) {
        node.children.forEach(child => {
          count += countOctants(child);
        });
      }
      return count;
    };
    setTotalOctants(countOctants(octree));

    return octree;
  };


  const relateMeshesToOctree = (octree, meshBoundingBoxes) => {
    const relations = {};

    const traverse = (node, depth = 0) => {
      node.objects.forEach(obj => {
        if (!relations[obj.boxUuid]) {
          relations[obj.boxUuid] = [];
        }
        relations[obj.boxUuid].push({ node, depth });
      });

      if (node.divided) {
        node.children.forEach(child => traverse(child, depth + 1));
      }
    };

    traverse(octree);
    return relations;
  };

  const createAndStoreZipFiles = async (octree, meshFileRelations, serializedGeometries) => {
    const db = await openIndexedDB();
    const nodeZipRelations = {};

    const createZipForNode = async (node, depth) => {
      const zip = new JSZip();
      const nodeId = `node_${depth}_${node.center.toArray().join('_')}`;

      node.objects.forEach(obj => {
        const fileName = meshFileRelations[obj.boxUuid];
        if (fileName) {
          zip.file(fileName, new Blob()); // We're not actually adding file content here
          // Store serialized geometry
          const geometryJson = serializedGeometries[obj.boxUuid];
          if (geometryJson) {
            zip.file(`${fileName}.json`, geometryJson);
          }
        }
      });

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      await storeZipInIndexedDB(db, nodeId, zipBlob);

      nodeZipRelations[nodeId] = { node, depth };

      if (node.divided) {
        await Promise.all(node.children.map(child => createZipForNode(child, depth + 1)));
      }
    };

    await createZipForNode(octree, 0);
    setNodeZipRelations(nodeZipRelations);
    db.close();
  };

  const openIndexedDB = () => {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('OctreeZipDB', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        db.createObjectStore('zips', { keyPath: 'nodeId' });
      };
    });
  };

  const storeZipInIndexedDB = (db, nodeId, zipBlob) => {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['zips'], 'readwrite');
      const store = transaction.objectStore('zips');
      const request = store.put({ nodeId, zipBlob });
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  };

  const updateBoundingBox = (box) => {
    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    box.getCenter(center);
    box.getSize(size);
    setBoundingBox({ center, size });
  };

  const positionCamera = (box) => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    const size = new THREE.Vector3();
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = camera.fov * (Math.PI / 180);
    const cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2)) * 1.5;
    const center = new THREE.Vector3();
    box.getCenter(center);

    camera.position.set(center.x, center.y, center.z + cameraZ);
    camera.lookAt(center);
    controls.target.copy(center);
    controls.update();
  };

  const createBoundingBoxMeshes = (boxes) => {
    boxes.forEach((box) => {
      const mesh = createBoundingBoxMesh(box, 0x00ff00, 0.5);
      sceneRef.current.add(mesh);
    });
  };

  const createCumulativeBoundingBoxMesh = (box) => {
    const mesh = createBoundingBoxMesh(box, 0xffff00, 1);
    sceneRef.current.add(mesh);
  };

  const createBoundingBoxMesh = (box, color, opacity = 1) => {
    const size = new THREE.Vector3();
    box.getSize(size);

    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshBasicMaterial({ 
      color: color, 
      wireframe: true, 
      transparent: true, 
      opacity: opacity 
    });
    const mesh = new THREE.Mesh(geometry, material);

    const center = box.getCenter(new THREE.Vector3());
    mesh.position.set(center.x, center.y, center.z);
    mesh.scale.set(size.x, size.y, size.z);

    return mesh;
  };

  const visualizeOctree = (octree) => {
    if (!octree) return;

    const maxDepth = getMaxDepth(octree);

    const visualizeNode = (node, depth = 0) => {
      const color = getColorForDepth(depth, maxDepth);
      const mesh = createBoundingBoxMesh(node.boundingBox, color, 0.3);
      sceneRef.current.add(mesh);

      if (node.divided) {
        node.children.forEach(child => {
          visualizeNode(child, depth + 1);
        });
      }
    };

    visualizeNode(octree);
  };

  const getMaxDepth = (node) => {
    if (!node.divided) return 0;
    return 1 + Math.max(...node.children.map(getMaxDepth));
  };

  const getColorForDepth = (depth, maxDepth) => {
    const hue = (depth / maxDepth) * 0.8; // Use 80% of the hue spectrum
    return new THREE.Color().setHSL(hue, 1, 0.5);
  };

  // New function to deserialize geometry
  const deserializeGeometry = (jsonString) => {
    const geometryData = JSON.parse(jsonString);
    return geometryData.map(data => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.vertices, 3));
      if (data.normals) {
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(data.normals, 3));
      }
      if (data.uvs) {
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(data.uvs, 2));
      }
      if (data.indices) {
        geometry.setIndex(new THREE.Uint16BufferAttribute(data.indices, 1));
      }
      return geometry;
    });
  };

  // Function to load geometry from IndexedDB (to be called when needed)
  const loadGeometryFromIndexedDB = async (nodeId, fileName) => {
    const db = await openIndexedDB();
    const transaction = db.transaction(['zips'], 'readonly');
    const store = transaction.objectStore('zips');
    const zipBlob = await new Promise((resolve, reject) => {
      const request = store.get(nodeId);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result.zipBlob);
    });

    const zip = await JSZip.loadAsync(zipBlob);
    const geometryJson = await zip.file(`${fileName}.json`).async('string');
    const geometries = deserializeGeometry(geometryJson);

    db.close();
    return geometries;
  };

  return (
    <div>
    <input type="file" accept=".fbx" multiple onChange={handleFileUpload} />
    {boundingBox && (
      <div>
        <p>Cumulative Center: {`x: ${boundingBox.center.x.toFixed(2)}, y: ${boundingBox.center.y.toFixed(2)}, z: ${boundingBox.center.z.toFixed(2)}`}</p>
        <p>Cumulative Size: {`x: ${boundingBox.size.x.toFixed(2)}, y: ${boundingBox.size.y.toFixed(2)}, z: ${boundingBox.size.z.toFixed(2)}`}</p>
        <p>Visible Octants: {visibleOctants}</p>
        <p>Total Octants: {totalOctants}</p>
        <p>Octants Outside Frustum: {totalOctants - visibleOctants}</p>
      </div>
    )}
    <div ref={containerRef} style={{ width: '100vw', height: '100vh' }} />
  </div>
  );
}

export default IndexedDbRandomFbx;
// =====================================================//

// import React, { useRef, useState, useEffect } from 'react';
// import * as THREE from 'three';
// import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';

// function IndexedDbRandomFbx() {
//   const [boundingBox, setBoundingBox] = useState(null);
//   const containerRef = useRef(null);
//   const sceneRef = useRef(new THREE.Scene());
//   const cameraRef = useRef(new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000));
//   const rendererRef = useRef(new THREE.WebGLRenderer());
//   const octreeRef = useRef(null);
//   const controlsRef = useRef(null);
//   const workerRef = useRef(null);
//   const [isOctreeReady, setIsOctreeReady] = useState(false);

//   useEffect(() => {
//     const renderer = rendererRef.current;
//     const camera = cameraRef.current;
//     const scene = sceneRef.current;

//     renderer.setSize(window.innerWidth, window.innerHeight);
//     renderer.setClearColor(0x000000); // Changed to black for better contrast
//     containerRef.current.appendChild(renderer.domElement);

//     const controls = new OrbitControls(camera, renderer.domElement);
//     controlsRef.current = controls;

//     // Initialize Web Worker
//     workerRef.current = new Worker(new URL('./octreeWorker.js', import.meta.url));

//     workerRef.current.onmessage = (event) => {
//       const { type, data } = event.data;
//       switch (type) {
//         case 'octreeCreated':
//           if (data) {
//             octreeRef.current = data;
//             visualizeOctree(data);
//             setIsOctreeReady(true);
//           }
//           break;
//         case 'meshesLoaded':
//           updateScene(data);
//           break;
//         case 'boundingBoxUpdated':
//           setBoundingBox(data);
//           visualizeCumulativeBoundingBox(data);
//           positionCamera(data);
//           break;
//       }
//     };

//     const render = () => {
//       requestAnimationFrame(render);
//       if (controlsRef.current) controlsRef.current.update();
//       renderer.render(scene, camera);
//     };
//     render();

//     const handleResize = () => {
//       camera.aspect = window.innerWidth / window.innerHeight;
//       camera.updateProjectionMatrix();
//       renderer.setSize(window.innerWidth, window.innerHeight);
//     };
//     window.addEventListener('resize', handleResize);

//     return () => {
//       containerRef.current.removeChild(renderer.domElement);
//       window.removeEventListener('resize', handleResize);
//       controls.dispose();
//       workerRef.current.terminate();
//     };
//   }, []);

//   useEffect(() => {
//     if (isOctreeReady) {
//       const animate = () => {
//         requestAnimationFrame(animate);
//         controlsRef.current.update();
//         performFrustumCulling();
//         rendererRef.current.render(sceneRef.current, cameraRef.current);
//       };
//       animate();
//     }
//   }, [isOctreeReady]);

//   const handleFileUpload = async (event) => {
//     const files = event.target.files;
//     if (!files.length) return;

//     sceneRef.current.clear();

//     for (const file of files) {
//       try {
//         const arrayBuffer = await file.arrayBuffer();
//         workerRef.current.postMessage({
//           type: 'loadFile',
//           data: { arrayBuffer, fileName: file.name }
//         }, [arrayBuffer]);
//       } catch (error) {
//         console.error('Error processing loaded object:', error);
//       }
//     }
//   };

//   const performFrustumCulling = () => {
//     if (!octreeRef.current) return;

//     const camera = cameraRef.current;
//     const frustum = new THREE.Frustum();
//     frustum.setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));

//     const serializedPlanes = frustum.planes.map(plane => {
//       return [plane.normal.x, plane.normal.y, plane.normal.z, plane.constant];
//     });

//     workerRef.current.postMessage({
//       type: 'performFrustumCulling',
//       data: { frustum: serializedPlanes }
//     });
//   };

//   const updateScene = (meshes) => {
//     sceneRef.current.clear();
//     meshes.forEach(meshData => {
//       const geometry = new THREE.BufferGeometry();
//       geometry.setAttribute('position', new THREE.Float32BufferAttribute(meshData.vertices, 3));
//       if (meshData.normals) {
//         geometry.setAttribute('normal', new THREE.Float32BufferAttribute(meshData.normals, 3));
//       }
//       if (meshData.uvs) {
//         geometry.setAttribute('uv', new THREE.Float32BufferAttribute(meshData.uvs, 2));
//       }
//       if (meshData.indices) {
//         geometry.setIndex(new THREE.Uint16BufferAttribute(meshData.indices, 1));
//       }
//       const material = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true });
//       const mesh = new THREE.Mesh(geometry, material);
//       sceneRef.current.add(mesh);
//     });
//   };

//   const visualizeOctree = (serializedOctree) => {
//     if (!serializedOctree) return;

//     const visualizeNode = (node) => {
//       const center = new THREE.Vector3().fromArray(node.center);
//       const size = node.size;
//       const boxGeometry = new THREE.BoxGeometry(size, size, size);
//       const material = new THREE.MeshBasicMaterial({ 
//         color: new THREE.Color().setHSL(Math.random(), 1, 0.5), 
//         wireframe: true,
//         transparent: true,
//         opacity: 0.5
//       });
//       const boxMesh = new THREE.Mesh(boxGeometry, material);
//       boxMesh.position.copy(center);
//       sceneRef.current.add(boxMesh);

//       if (node.children) {
//         node.children.forEach(child => visualizeNode(child));
//       }
//     };

//     visualizeNode(serializedOctree);
//   };

//   const visualizeCumulativeBoundingBox = (boundingBox) => {
//     if (!boundingBox) return;

//     const geometry = new THREE.BoxGeometry(boundingBox.size.x, boundingBox.size.y, boundingBox.size.z);
//     const material = new THREE.MeshBasicMaterial({ color: 0xffff00, wireframe: true });
//     const mesh = new THREE.Mesh(geometry, material);
//     mesh.position.copy(boundingBox.center);
//     sceneRef.current.add(mesh);
//   };

//   const positionCamera = (boundingBox) => {
//     const camera = cameraRef.current;
//     const controls = controlsRef.current;
    
//     if (!boundingBox) return;

//     const size = new THREE.Vector3();
//     boundingBox.size.getSize(size);
//     const maxDim = Math.max(size.x, size.y, size.z);
//     const fov = camera.fov * (Math.PI / 180);
//     const cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2)) * 2;

//     camera.position.set(boundingBox.center.x, boundingBox.center.y, boundingBox.center.z + cameraZ);
//     camera.lookAt(boundingBox.center.x, boundingBox.center.y, boundingBox.center.z);
    
//     if (controls) {
//       controls.target.set(boundingBox.center.x, boundingBox.center.y, boundingBox.center.z);
//       controls.update();
//     }
//   };

//   return (
//     <div>
//       <input type="file" accept=".fbx" multiple onChange={handleFileUpload} />
//       {boundingBox && (
//         <div>
//           <p>Cumulative Center: {`x: ${boundingBox.center.x.toFixed(2)}, y: ${boundingBox.center.y.toFixed(2)}, z: ${boundingBox.center.z.toFixed(2)}`}</p>
//           <p>Cumulative Size: {`x: ${boundingBox.size.x.toFixed(2)}, y: ${boundingBox.size.y.toFixed(2)}, z: ${boundingBox.size.z.toFixed(2)}`}</p>
//         </div>
//       )}
//       <div ref={containerRef} style={{ width: '100vw', height: '100vh' }} />
//     </div>
//   );
// }

// export default IndexedDbRandomFbx;
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
  }

function FbxToGlbFinalLargeScene() {
    const mountRef = useRef(null);
    const sceneRef = useRef(new THREE.Scene());
    const cameraRef = useRef(
      new THREE.PerspectiveCamera(
        75,
        window.innerWidth / window.innerHeight,
        0.1,
        1000
      )
    );
  
    const rendererRef = useRef(new THREE.WebGLRenderer({ antialias: true }));
    const controlsRef = useRef(null);
    const cumulativeBoundingBox = useRef(
      new THREE.Box3(
        new THREE.Vector3(Infinity, Infinity, Infinity),
        new THREE.Vector3(-Infinity, -Infinity, -Infinity)
      )
    );
  
    const [isVisible, setIsVisible] = useState(true);
    const [fileSizes, setFileSizes] = useState([]);
    const [saveDirectory, setSaveDirectory] = useState(null);
    const [selectedFiles, setSelectedFiles] = useState([]);
    const [convertedModels, setConvertedModels] = useState([]);
    const [lodModels, setLodModels] = useState([]);
    const [backgroundColor, setBackgroundColor] = useState(0x000000);
    const [simplificationStats, setSimplificationStats] = useState([]);
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
  
    useEffect(() => {
      rendererRef.current.setSize(window.innerWidth, window.innerHeight);
      mountRef.current.appendChild(rendererRef.current.domElement);
  
      const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
      sceneRef.current.add(ambientLight);
      const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
      directionalLight.position.set(0, 1, 0);
      sceneRef.current.add(directionalLight);
  
      controlsRef.current = new OrbitControls(
        cameraRef.current,
        rendererRef.current.domElement
      );
      controlsRef.current.enableDamping = true;
      controlsRef.current.dampingFactor = 0.1;
  
      animate();
  
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
        // workerRef.current.terminate();
      };
    }, []);

    useEffect(() => {
        rendererRef.current.setClearColor(backgroundColor);
      }, [backgroundColor]);
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
    
            fbxObject.traverse((child) => {
              if (child.isMesh) {
                child.material = new THREE.MeshBasicMaterial({ color: 0xcccccc });
              }
            });
    
            const lodLevels = [
              { name: 'LOD1', reduction: 0.25 },
              { name: 'LOD2', reduction: 0.5 },
              { name: 'LOD3', reduction: 0.75 }
            ];
    
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
    
            const convertToGLTF = async (object) => {
              return new Promise((resolve, reject) => {
                const exporter = new GLTFExporter();
                exporter.parse(
                  object,
                  (result) => {
                    const output = JSON.stringify(result);
                    resolve(output);
                  },
                  {
                    binary: false,
                    includeCustomExtensions: false,
                    forceIndices: true,
                    truncateDrawRange: true,
                  },
                  (error) => reject(error)
                );
              });
            };
    
            const gltfData = await convertToGLTF(fbxObject);
            const lodGltfData = await Promise.all(lodVersions.map(lod => convertToGLTF(lod.object)));
    
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
              lodSizes: lodGltfBlobs.map((blob, index) => ({ name: lodLevels[index].name, size: blob.size }))
            });
    
            newConvertedModels.push({
              fileName: file.name.replace(".fbx", ".gltf"),
              data: gltfBlob,
            });
    
           
    
          } catch (error) {
            console.error("Error processing model:", error);
          }
          setSimplificationStats(newSimplificationStats);
        }
    
       // Update state after all processing is done
       
       setFileSizes(newFileSizes);
       setConvertedModels(newConvertedModels);
       setLodModels(newLodModels);
    
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
        const stride = Math.max(1, Math.floor(originalVertexCount / targetVertexCount));
    
        const newPositions = [];
        const newNormals = [];
        const newUvs = [];
        const newIndices = [];
    
        for (let i = 0; i < position.count; i += stride) {
          newPositions.push(position.getX(i), position.getY(i), position.getZ(i));
          if (normal) newNormals.push(normal.getX(i), normal.getY(i), normal.getZ(i));
          if (uv) newUvs.push(uv.getX(i), uv.getY(i));
        }
    
        for (let i = 0; i < newPositions.length / 3 - 1; i++) {
          newIndices.push(i, i + 1);
        }
    
        const newGeometry = new THREE.BufferGeometry();
        newGeometry.setAttribute('position', new THREE.Float32BufferAttribute(newPositions, 3));
        if (normal) newGeometry.setAttribute('normal', new THREE.Float32BufferAttribute(newNormals, 3));
        if (uv) newGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(newUvs, 2));
        newGeometry.setIndex(newIndices);
    
        return {
          geometry: newGeometry,
          simplificationApplied: true,
          originalVertexCount,
          newVertexCount: newPositions.length / 3
        };
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
        if (isVisible) {
          controlsRef.current.update();
          rendererRef.current.render(sceneRef.current, cameraRef.current);
        }
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

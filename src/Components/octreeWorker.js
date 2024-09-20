/* eslint-disable no-restricted-globals */

import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader';
import JSZip from 'jszip';

class Octree {
  constructor(center, size) {
    this.center = center;
    this.size = size;
    this.children = [];
    this.objects = [];
    this.divided = false;
    this.boundingBox = new THREE.Box3().setFromCenterAndSize(this.center, new THREE.Vector3(size, size, size));
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
    if (!this.boundingBox.containsPoint(object.position)) return false;

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

  getVisibleOctants(frustum) {
    const visible = [];
    this._getVisibleOctantsHelper(frustum, visible);
    return visible;
  }

  _getVisibleOctantsHelper(frustum, visible) {
    if (frustum.intersectsBox(this.boundingBox)) {
      if (this.divided) {
        for (const child of this.children) {
          child._getVisibleOctantsHelper(frustum, visible);
        }
      } else {
        visible.push(this);
      }
    }
  }
}

let octree = null;
let meshFileRelations = {};
let serializedGeometries = {};
let cumulativeBoundingBox = new THREE.Box3();

self.onmessage = async (event) => {
  const { type, data } = event.data;

  switch (type) {
    case 'loadFile':
      await loadFile(data.arrayBuffer, data.fileName);
      break;
    case 'performFrustumCulling':
      performFrustumCulling(data.frustum);
      break;
  }
};

const loadFile = async (arrayBuffer, fileName) => {
  const loader = new FBXLoader();
  const blob = new Blob([arrayBuffer], { type: 'application/octet-stream' });
  const objectUrl = URL.createObjectURL(blob);

  try {
    const object = await new Promise((resolve, reject) => {
      loader.load(objectUrl, resolve, undefined, reject);
    });

    const serializedGeometry = serializeGeometry(object);
    const box = new THREE.Box3().setFromObject(object);

    if (!octree) {
      const center = box.getCenter(new THREE.Vector3());
      const size = Math.max(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z);
      octree = new Octree(center, size);
    }

    octree.insert({ position: box.getCenter(new THREE.Vector3()), boxUuid: THREE.MathUtils.generateUUID() });

    meshFileRelations[box.uuid] = fileName;
    serializedGeometries[box.uuid] = serializedGeometry;

    // Update cumulative bounding box
    cumulativeBoundingBox.union(box);

    // Store in IndexedDB
    await storeInIndexedDB(fileName, serializedGeometry);

    // Only send the octree data if it exists
    if (octree) {
      self.postMessage({ 
        type: 'octreeCreated', 
        data: serializeOctree(octree)
      });
    }

    self.postMessage({ 
      type: 'boundingBoxUpdated', 
      data: { 
        center: cumulativeBoundingBox.getCenter(new THREE.Vector3()), 
        size: cumulativeBoundingBox.getSize(new THREE.Vector3()) 
      } 
    });

  } catch (error) {
    console.error('Error loading FBX:', error);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};



const serializeGeometry = (object) => {
  const geometries = [];
  object.traverse((child) => {
    if (child.isMesh) {
      const geometry = child.geometry;
      geometries.push({
        vertices: Array.from(geometry.attributes.position.array),
        normals: geometry.attributes.normal ? Array.from(geometry.attributes.normal.array) : null,
        uvs: geometry.attributes.uv ? Array.from(geometry.attributes.uv.array) : null,
        indices: geometry.index ? Array.from(geometry.index.array) : null,
      });
    }
  });
  return geometries;
};
const performFrustumCulling = (serializedPlanes) => {
  if (!octree) {
    console.warn('Octree is not initialized. No culling performed.');
    self.postMessage({ type: 'meshesLoaded', data: [] });
    return;
  }

  const frustum = new THREE.Frustum();
  const planes = serializedPlanes.map(planeData => {
    return new THREE.Plane(new THREE.Vector3(planeData[0], planeData[1], planeData[2]), planeData[3]);
  });
  frustum.planes = planes;

  const visibleNodes = octree.getVisibleOctants(frustum);
  const meshesToLoad = [];

  visibleNodes.forEach(node => {
    node.objects.forEach(obj => {
      const fileName = meshFileRelations[obj.boxUuid];
      const geometry = serializedGeometries[obj.boxUuid];
      if (fileName && geometry) {
        meshesToLoad.push(...geometry);
      }
    });
  });

  self.postMessage({ type: 'meshesLoaded', data: meshesToLoad });
};

const openIndexedDB = () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('GeometryDB', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      db.createObjectStore('geometries', { keyPath: 'fileName' });
    };
  });
};

const storeInIndexedDB = async (fileName, geometryData) => {
  const db = await openIndexedDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['geometries'], 'readwrite');
    const store = transaction.objectStore('geometries');
    const request = store.put({ fileName, geometryData });
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
};

const loadFromIndexedDB = async (fileName) => {
  const db = await openIndexedDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['geometries'], 'readonly');
    const store = transaction.objectStore('geometries');
    const request = store.get(fileName);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result?.geometryData);
  });
};

// Export any necessary functions or variables
const serializeOctree = (node) => {
  if (!node) return null;
  return {
    center: node.center.toArray(),
    size: node.size,
    children: node.children.map(serializeOctree),
    objects: node.objects.map(obj => ({
      position: obj.position.toArray(),
      boxUuid: obj.boxUuid
    })),
    divided: node.divided,
    boundingBox: {
      min: node.boundingBox.min.toArray(),
      max: node.boundingBox.max.toArray()
    }
  };
};

// Update the octree creation postMessage to use the serialized version
self.postMessage({ 
  type: 'octreeCreated', 
  data: serializeOctree(octree)
});



// Export any necessary functions or variables
export {
  loadFile,
  performFrustumCulling,
  openIndexedDB,
  storeInIndexedDB,
  loadFromIndexedDB
};
/* eslint-disable no-restricted-globals */

// meshLoaderWorker.js
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { openDB } from 'idb';
import pako from 'pako';

let db;

async function initDB() {
  db = await openDB("3DModelsDB", 1, {
    upgrade(db) {
      db.createObjectStore("models");
    },
  });
}

async function loadAllModels() {
  if (!db) await initDB();

  const tx = db.transaction("models", "readonly");
  const store = tx.objectStore("models");
  const gltfLoader = new GLTFLoader();

  let cursor = await store.openCursor();
  let loadedModels = 0;
  const totalModels = await store.count();

  while (cursor) {
    try {
      const compressedData = cursor.value;
      const glbData = pako.ungzip(compressedData);
      const gltfObject = await new Promise((resolve, reject) => {
        gltfLoader.parse(glbData.buffer, "", (gltf) => resolve(gltf.scene), reject);
      });
      
      // Serialize the object for transfer
      const serializedObject = serializeObject(gltfObject);
      
      loadedModels++;
      const progress = (loadedModels / totalModels) * 100;
      
      self.postMessage({ type: 'modelLoaded', object: serializedObject, name: cursor.key, progress });
    } catch (error) {
      console.error("Error loading model from IndexedDB:", error);
    }

    cursor = await cursor.continue();
  }

  await tx.done;
  self.postMessage({ type: 'loadingComplete' });
}


function serializeObject(object) {
  const result = {
    position: object.position.toArray(),
    rotation: object.rotation.toArray(),
    scale: object.scale.toArray(),
    name: object.name,
    children: []
  };

  if (object.isMesh) {
    result.isMesh = true;
    result.geometry = {
      attributes: {},
      index: object.geometry.index ? Array.from(object.geometry.index.array) : null
    };
    for (const key in object.geometry.attributes) {
      result.geometry.attributes[key] = Array.from(object.geometry.attributes[key].array);
    }
    result.material = {
      color: object.material.color ? object.material.color.getHex() : null,
      // Add other material properties as needed
    };
  }

  for (const child of object.children) {
    result.children.push(serializeObject(child));
  }

  return result;
}

self.onmessage = async function(e) {
  if (e.data.type === 'loadAllModels') {
    await loadAllModels();
  }
};
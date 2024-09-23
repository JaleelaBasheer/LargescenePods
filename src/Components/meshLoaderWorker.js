/* eslint-disable no-restricted-globals */

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

async function loadModelFromIndexedDB(modelName, lodLevel) {
  if (!db) await initDB();
  const tx = db.transaction("models", "readonly");
  const store = tx.objectStore("models");
  const compressedData = await store.get(`${modelName}_${lodLevel}`);
  
  if (compressedData) {
    return pako.ungzip(compressedData);
  }
  return null;
}

self.onmessage = async function(e) {
  const { type, modelName, lodLevel, keys } = e.data;

  if (type === 'loadModel') {
    const modelData = await loadModelFromIndexedDB(modelName, lodLevel);
    self.postMessage({ type: 'modelLoaded', modelName, lodLevel, modelData });
  } else if (type === 'loadAllModels') {
    for (const key of keys) {
      const [modelName, lodLevel] = key.split('_');
      const modelData = await loadModelFromIndexedDB(modelName, lodLevel);
      self.postMessage({ type: 'modelLoaded', modelName, lodLevel, modelData });
    }
    self.postMessage({ type: 'allModelsLoaded' });
  }
};
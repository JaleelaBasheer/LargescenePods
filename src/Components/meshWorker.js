/* eslint-disable no-restricted-globals */
import { openDB } from 'idb';
import pako from 'pako';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';

self.onmessage = async (e) => {
  if (e.data.type === 'loadMesh') {
    const { meshId, fileName, lodLevel } = e.data;
    try {
      const meshData = await loadMeshFromIndexedDB(fileName, lodLevel);
      const mesh = await parseMesh(meshData);
      self.postMessage({
        type: 'meshLoaded',
        meshId,
        lodLevel,
        meshData: mesh.toJSON()
      });
    } catch (error) {
      console.error('Error loading mesh:', error);
    }
  }
};

async function loadMeshFromIndexedDB(fileName, lodLevel) {
  const db = await openDB('ModelsDB', 1);
  const compressedData = await db.get('models', [fileName, lodLevel]);
  if (!compressedData) {
    throw new Error(`Mesh data not found for ${fileName} at ${lodLevel}`);
  }
  return pako.inflate(compressedData.data, { to: 'string' });
}

async function parseMesh(meshData) {
  return new Promise((resolve, reject) => {
    const loader = new GLTFLoader();
    loader.parse(meshData, '', (gltf) => {
      resolve(gltf.scene);
    }, reject);
  });
}
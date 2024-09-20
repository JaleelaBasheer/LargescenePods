/* eslint-disable no-restricted-globals */
import { openDB } from 'idb';
import pako from 'pako';

let db;
let octree;

async function initDB() {
  db = await openDB('OctreeGzipDB', 1, {
    upgrade(db) {
      db.createObjectStore('gzips', { keyPath: 'nodeId' });
    },
  });
}

async function loadMeshFromIndexedDB(fileName) {
  if (!db) {
    await initDB();
  }

  const findMeshInNode = async (nodeId) => {
    const gzipData = await db.get('gzips', nodeId);
    if (!gzipData) {
      // console.log(`No gzip data found for node: ${nodeId}`);
      return null;
    }

    const decompressedData = pako.inflate(gzipData.gzipBlob, { to: 'string' });
    const nodeData = JSON.parse(decompressedData);

    if (nodeData[fileName]) {
      // console.log(`Mesh found: ${fileName} in node: ${nodeId}`);
      return nodeData[fileName];
    }

    // console.log(`Mesh not found: ${fileName} in node: ${nodeId}`);
    return null;
  };

  const searchMeshInOctree = async (node, depth) => {
    const nodeId = `node_${depth}_${node.center.x}_${node.center.y}_${node.center.z}`;
    // console.log(`Searching in node: ${nodeId}`);
    const meshData = await findMeshInNode(nodeId);
    if (meshData) return meshData;

    if (node.children && node.children.length > 0) {
      for (const child of node.children) {
        const result = await searchMeshInOctree(child, depth + 1);
        if (result) return result;
      }
    }

    return null;
  };

  if (!octree) {
    // console.error('Octree not initialized');
    return null;
  }

  const meshData = await searchMeshInOctree(octree, 0);

  if (!meshData) {
    // console.error(`Mesh data not found for: ${fileName}`);
    return null;
  }

  return meshData;
}

self.onmessage = async (e) => {
  if (e.data.type === 'initOctree') {
    octree = JSON.parse(e.data.octree);
    // console.log('Octree initialized in worker', JSON.stringify(octree, null, 2));
  } else if (e.data.type === 'loadMeshes') {
    // console.log('Received request to load meshes:', e.data.meshes);
    for (const { meshId, fileName } of e.data.meshes) {
      const meshData = await loadMeshFromIndexedDB(fileName);
      if (meshData) {
        self.postMessage({
          type: 'meshLoaded',
          meshId,
          meshData
        });
      }
    }
  }
};

initDB();

function extractMeshData(object) {
  const meshes = [];

  object.traverse((child) => {
    if (child.isMesh) {
      const geometry = child.geometry;
      const material = child.material;

      const meshData = {
        position: geometry.attributes.position.array,
        normal: geometry.attributes.normal ? geometry.attributes.normal.array : null,
        uv: geometry.attributes.uv ? geometry.attributes.uv.array : null,
        index: geometry.index ? geometry.index.array : null,
        materialType: material.type,
        materialProperties: {
          color: material.color ? material.color.getHex() : null,
          map: material.map ? material.map.image.src : null,
          // Add other material properties as needed
        },
        matrix: child.matrix.elements
      };

      meshes.push(meshData);
    }
  });

  return meshes;
}
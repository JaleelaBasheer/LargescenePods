/* eslint-disable no-restricted-globals */

// frustumCullingWorker.js
import * as THREE from 'three';

self.onmessage = function(e) {
  if (e.data.type === 'checkFrustum') {
    const { meshes, cameraProjectionMatrix, cameraMatrixWorldInverse } = e.data;
    
    const frustum = new THREE.Frustum();
    frustum.setFromProjectionMatrix(
      new THREE.Matrix4().multiplyMatrices(
        new THREE.Matrix4().fromArray(cameraProjectionMatrix),
        new THREE.Matrix4().fromArray(cameraMatrixWorldInverse)
      )
    );

    let inFrustum = 0;
    let outsideFrustum = 0;

    meshes.forEach(mesh => {
      const boundingBox = new THREE.Box3(
        new THREE.Vector3().fromArray(mesh.min),
        new THREE.Vector3().fromArray(mesh.max)
      );
      
      if (frustum.intersectsBox(boundingBox)) {
        inFrustum++;
      } else {
        outsideFrustum++;
      }
    });

    self.postMessage({ type: 'frustumResult', inFrustum, outsideFrustum });
  }
};
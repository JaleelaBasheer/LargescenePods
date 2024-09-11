/* eslint-disable no-restricted-globals */
// Custom Octree implementation
import * as THREE from 'three';


// Custom Octree implementation
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

self.onmessage = function (e) {
  const { type, data } = e.data;

  if (type === 'processMeshes') {
    const meshes = data.meshes;
    const boundingBox = new THREE.Box3();

    meshes.forEach(mesh => {
      const box = new THREE.Box3().setFromObject(mesh);
      boundingBox.union(box);
    });

    self.postMessage({ type: 'boundingBox', data: boundingBox });
  }

  if (type === 'createOctree') {
    const { center, size, objects } = data;
    const octree = new Octree(center, size);

    objects.forEach(object => {
      octree.insert(object);
    });

    self.postMessage({ type: 'octree', data: { octree } });
  }
};
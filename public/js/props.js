import * as THREE from "three";
import { DIORAMA_RADIUS, toScene } from "./geo.js";

const TREE_ATTEMPTS = 20_000;
// [lat, lon, radius in scene units, house count]
const TOWNS = [
  [-19.262, 146.812, 5, 120], // Townsville CBD
  [-19.285, 146.78, 10, 380],
  [-19.31, 146.745, 9, 260],
  [-19.225, 146.775, 5, 90], // Pallarenda / Rowes Bay
  [-19.163, 146.852, 2.5, 40], // Nelly Bay
  [-19.117, 146.853, 2.5, 35], // Horseshoe Bay
  [-19.178, 146.842, 2, 25], // Picnic Bay
  [-19.15, 146.868, 2, 25], // Arcadia
];
const TREE_GREENS = [0x5cb85a, 0x7ccc62, 0x4ea85a, 0x98d870].map((c) => new THREE.Color(c));
const HOUSE_COLORS = [0xfff4e0, 0xffd9c2, 0xd8ecff, 0xfff0a8, 0xe6dcff].map((c) => new THREE.Color(c));

// Lollipop trees on the hills and little houses in town, as instanced meshes.
export function createProps(terrain) {
  const group = new THREE.Group();
  group.add(...createTrees(terrain), ...createHouses(terrain));
  return group;
}

function createTrees(terrain) {
  const spots = [];
  for (let i = 0; i < TREE_ATTEMPTS; i++) {
    const angle = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * (DIORAMA_RADIUS - 6);
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    const elevation = terrain.elevationAtScene(x, z);
    const chance = elevation > 450 ? 0 : elevation > 25 ? 0.35 : elevation > 6 ? 0.02 : 0;
    if (Math.random() < chance) spots.push({ x, z, y: terrain.heightAt(x, z), size: 0.9 + Math.random() * 0.6 });
  }

  const crowns = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1, 1),
    new THREE.MeshStandardMaterial({ roughness: 0.8, flatShading: true }),
    spots.length,
  );
  const trunks = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.12, 0.16, 1, 5).translate(0, 0.5, 0),
    new THREE.MeshStandardMaterial({ color: 0x8a5a3b }),
    spots.length,
  );
  const dummy = new THREE.Object3D();
  spots.forEach(({ x, z, y, size }, i) => {
    dummy.position.set(x, y, z);
    dummy.scale.set(size, size * 1.2, size);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);

    dummy.position.y = y + size * 1.4;
    dummy.scale.setScalar(size);
    dummy.updateMatrix();
    crowns.setMatrixAt(i, dummy.matrix);
    crowns.setColorAt(i, TREE_GREENS[i % TREE_GREENS.length]);
  });
  crowns.castShadow = trunks.castShadow = true;
  return [crowns, trunks];
}

function createHouses(terrain) {
  const spots = [];
  for (const [lat, lon, radius, count] of TOWNS) {
    const centre = toScene(lat, lon);
    for (let placed = 0, tries = 0; placed < count && tries < count * 3; tries++) {
      const angle = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * radius;
      const x = centre.x + Math.cos(angle) * r;
      const z = centre.z + Math.sin(angle) * r;
      const elevation = terrain.elevationAtScene(x, z);
      if (elevation > 1 && elevation < 40) {
        spots.push({ x, z, y: terrain.heightAt(x, z) });
        placed++;
      }
    }
  }

  const walls = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.5, 0.4, 0.5).translate(0, 0.2, 0),
    new THREE.MeshStandardMaterial({ roughness: 0.7 }),
    spots.length,
  );
  const roofs = new THREE.InstancedMesh(
    new THREE.ConeGeometry(0.45, 0.35, 4).rotateY(Math.PI / 4).translate(0, 0.575, 0),
    new THREE.MeshStandardMaterial({ color: 0xe0664f, roughness: 0.7, flatShading: true }),
    spots.length,
  );
  const dummy = new THREE.Object3D();
  spots.forEach(({ x, z, y }, i) => {
    dummy.position.set(x, y, z);
    dummy.rotation.y = Math.random() * Math.PI;
    dummy.updateMatrix();
    walls.setMatrixAt(i, dummy.matrix);
    roofs.setMatrixAt(i, dummy.matrix);
    walls.setColorAt(i, HOUSE_COLORS[i % HOUSE_COLORS.length]);
  });
  walls.castShadow = roofs.castShadow = true;
  walls.receiveShadow = true;
  return [walls, roofs];
}

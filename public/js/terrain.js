import * as THREE from "three";
import { DIORAMA_RADIUS, METERS_PER_UNIT, SCENE_BOUNDS, TILES, toLatLon } from "./geo.js";

const LAND_EXAGGERATION = 5;
const LAND_BASE = 0.12; // keeps the coast clear of the water surface to avoid z-fighting
const SEA_FLOOR = -1.5;
export const BASE_Y = -8;
const SEGMENTS = 480;
const SHORE_BLUR_RADIUS = 7; // vertices

// [elevation in metres, colour]
const COLOR_STOPS = [
  [0, 0xf6e7bd],
  [4, 0xdfe6a0],
  [15, 0xa8d77a],
  [80, 0x86c663],
  [220, 0x69ad52],
  [420, 0xa3a384],
  [600, 0xe2dccd],
];
const EDGE_COLOR = new THREE.Color(0xa47a52);

export function heightFor(elevation) {
  return LAND_BASE + (Math.max(elevation, 0) * LAND_EXAGGERATION) / METERS_PER_UNIT;
}

export async function createTerrain() {
  const elevationAt = await loadElevation();
  const { minX, maxX, minZ, maxZ } = SCENE_BOUNDS;
  const width = maxX - minX;
  const depth = maxZ - minZ;
  const segX = SEGMENTS;
  const segZ = Math.round((SEGMENTS * depth) / width);

  const geometry = new THREE.PlaneGeometry(width, depth, segX, segZ);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate((minX + maxX) / 2, 0, (minZ + maxZ) / 2);

  const position = geometry.attributes.position;
  const elevations = new Float32Array(position.count);
  for (let i = 0; i < position.count; i++) {
    const { lat, lon } = toLatLon(position.getX(i), position.getZ(i));
    elevations[i] = elevationAt(lat, lon);
  }
  const land = seaFill(elevations, segX + 1, segZ + 1);

  const colors = new Float32Array(position.count * 3);
  const color = new THREE.Color();
  const outside = new Uint8Array(position.count);
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const z = position.getZ(i);
    const r = Math.hypot(x, z);
    // Vertices past the rim snap onto it at the base, forming the diorama's side walls.
    if (r > DIORAMA_RADIUS) {
      outside[i] = 1;
      position.setXYZ(i, (x / r) * DIORAMA_RADIUS, BASE_Y, (z / r) * DIORAMA_RADIUS);
      EDGE_COLOR.toArray(colors, i * 3);
      continue;
    }
    position.setY(i, land[i] ? heightFor(elevations[i]) : SEA_FLOOR);
    colorFor(elevations[i], color).toArray(colors, i * 3);
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const index = geometry.index.array.filter((_, i, all) => {
    const t = i - (i % 3);
    return !(outside[all[t]] && outside[all[t + 1]] && outside[all[t + 2]]);
  });
  geometry.setIndex([...index]);
  geometry.computeVertexNormals();

  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }),
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const elevationAtScene = (x, z) => {
    const { lat, lon } = toLatLon(x, z);
    return elevationAt(lat, lon);
  };
  return {
    mesh,
    elevationAt,
    elevationAtScene,
    heightAt: (x, z) => heightFor(elevationAtScene(x, z)),
    shoreMap: shoreMap(land, segX + 1, segZ + 1),
  };
}

// R: distance-to-shore gradient (the elevation data has no bathymetry), G: land mask.
function shoreMap(land, cols, rows) {
  const shore = blur(blur(land, cols, rows), cols, rows);
  const data = new Uint8Array(cols * rows * 4);
  for (let i = 0; i < land.length; i++) {
    data[i * 4] = shore[i] * 255;
    data[i * 4 + 1] = land[i] * 255;
  }
  const texture = new THREE.DataTexture(data, cols, rows);
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

// Low ground counts as sea only when connected to the map edge, so inland flats stay land.
function seaFill(elevations, cols, rows) {
  const land = new Float32Array(elevations.length).fill(1);
  const queue = [];
  const visit = (i) => {
    if (land[i] === 1 && elevations[i] <= 0.5) {
      land[i] = 0;
      queue.push(i);
    }
  };
  for (let c = 0; c < cols; c++) visit(c), visit((rows - 1) * cols + c);
  for (let r = 0; r < rows; r++) visit(r * cols), visit(r * cols + cols - 1);
  while (queue.length) {
    const i = queue.pop();
    const c = i % cols;
    if (c > 0) visit(i - 1);
    if (c < cols - 1) visit(i + 1);
    if (i >= cols) visit(i - cols);
    if (i < (rows - 1) * cols) visit(i + cols);
  }
  return land;
}

// Separable box blur over a cols × rows grid.
function blur(values, cols, rows, radius = SHORE_BLUR_RADIUS) {
  const pass = (src, length, count, index) => {
    const out = new Float32Array(src.length);
    for (let line = 0; line < count; line++) {
      for (let i = 0; i < length; i++) {
        let sum = 0;
        let n = 0;
        for (let k = Math.max(0, i - radius); k <= Math.min(length - 1, i + radius); k++, n++) {
          sum += src[index(line, k)];
        }
        out[index(line, i)] = sum / n;
      }
    }
    return out;
  };
  const horizontal = pass(values, cols, rows, (row, col) => row * cols + col);
  return pass(horizontal, rows, cols, (col, row) => row * cols + col);
}

function colorFor(elevation, target) {
  const upper = COLOR_STOPS.findIndex(([e]) => e >= elevation);
  if (upper <= 0) return target.setHex(COLOR_STOPS[upper === 0 ? 0 : COLOR_STOPS.length - 1][1]);
  const [e0, c0] = COLOR_STOPS[upper - 1];
  const [e1, c1] = COLOR_STOPS[upper];
  return target.setHex(c0).lerp(new THREE.Color(c1), (elevation - e0) / (e1 - e0));
}

// Stitches Terrarium tiles into one image and returns a bilinear elevation sampler.
async function loadElevation() {
  const { z, x0, x1, y0, y1 } = TILES;
  const canvas = document.createElement("canvas");
  canvas.width = (x1 - x0 + 1) * 256;
  canvas.height = (y1 - y0 + 1) * 256;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  const loads = [];
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      loads.push(
        fetch(`terrain/${z}_${x}_${y}.png`)
          .then((res) => res.blob())
          .then((blob) => createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" }))
          .then((img) => ctx.drawImage(img, (x - x0) * 256, (y - y0) * 256)),
      );
    }
  }
  await Promise.all(loads);

  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const worldSize = 256 * 2 ** z;
  const at = (px, py) => {
    const o = (py * width + px) * 4;
    return data[o] * 256 + data[o + 1] + data[o + 2] / 256 - 32768;
  };

  return (lat, lon) => {
    const sin = Math.sin((lat * Math.PI) / 180);
    const mercY = 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI);
    const px = ((lon + 180) / 360) * worldSize - x0 * 256;
    const py = mercY * worldSize - y0 * 256;
    const ix = THREE.MathUtils.clamp(Math.floor(px), 0, width - 2);
    const iy = THREE.MathUtils.clamp(Math.floor(py), 0, height - 2);
    const fx = px - ix;
    const fy = py - iy;
    const top = at(ix, iy) * (1 - fx) + at(ix + 1, iy) * fx;
    const bottom = at(ix, iy + 1) * (1 - fx) + at(ix + 1, iy + 1) * fx;
    return top * (1 - fy) + bottom * fy;
  };
}

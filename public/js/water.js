import * as THREE from "three";
import { DIORAMA_RADIUS, SCENE_BOUNDS } from "./geo.js";
import { BASE_Y } from "./terrain.js";

const DEEP = new THREE.Color(0x2f8fcf);
const SHALLOW = new THREE.Color(0x7fe0d4);
const EARTH = new THREE.Color(0xa47a52);

// An opaque water drum, coloured by distance to shore, with foam lapping the coast.
export function createWater(shoreMap) {
  const { minX, maxX, minZ, maxZ } = SCENE_BOUNDS;
  const width = maxX - minX;
  const depth = maxZ - minZ;
  const normalMap = waveNormalMap();
  normalMap.repeat.set(width / 20, depth / 20);

  const uniforms = {
    uShore: { value: shoreMap },
    uBoundsMin: { value: new THREE.Vector2(minX, minZ) },
    uBoundsSize: { value: new THREE.Vector2(width, depth) },
    uDeep: { value: DEEP },
    uShallow: { value: SHALLOW },
    uEarth: { value: EARTH },
    uBaseY: { value: BASE_Y },
    uTime: { value: 0 },
  };

  const material = new THREE.MeshStandardMaterial({
    roughness: 0.45,
    metalness: 0.05,
    normalMap,
    normalScale: new THREE.Vector2(0.1, 0.1),
  });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWaterPos;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvWaterPos = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
        varying vec3 vWaterPos;
        uniform sampler2D uShore;
        uniform vec2 uBoundsMin, uBoundsSize;
        uniform vec3 uDeep, uShallow, uEarth;
        uniform float uBaseY, uTime;`)
      .replace("#include <color_fragment>", `#include <color_fragment>
        vec4 shore = texture2D(uShore, (vWaterPos.xz - uBoundsMin) / uBoundsSize);
        vec3 water = mix(uDeep, uShallow, smoothstep(0.05, 0.5, shore.r));
        float swash = pow(0.5 + 0.5 * sin(shore.r * 90.0 - uTime * 1.6), 4.0);
        float foam = smoothstep(0.4, 0.49, shore.r) * (0.35 + 0.65 * swash);
        water = mix(water, vec3(1.0), foam * 0.9);
        if (vWaterPos.y < -0.01) {
          // Diorama sides: earth where land meets the edge, darkening water elsewhere.
          float depth = (vWaterPos.y - uBaseY) / -uBaseY;
          water = shore.g > 0.5 ? uEarth : mix(uDeep * 0.55, uDeep, depth);
        }
        diffuseColor.rgb = water;`);
  };

  const geometry = new THREE.CylinderGeometry(DIORAMA_RADIUS, DIORAMA_RADIUS, -BASE_Y, 160);
  geometry.translate(0, BASE_Y / 2, 0);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;

  return {
    mesh,
    update(elapsed) {
      uniforms.uTime.value = elapsed;
      normalMap.offset.set(elapsed * 0.012, elapsed * 0.02);
    },
  };
}

// Tileable ripple normals from wrapped, blurred random noise.
function waveNormalMap(size = 128) {
  let height = Float32Array.from({ length: size * size }, Math.random);
  const at = (h, x, y) => h[((y + size) % size) * size + ((x + size) % size)];
  for (let pass = 0; pass < 3; pass++) {
    const prev = height;
    height = height.map((_, i) => {
      const x = i % size;
      const y = Math.floor(i / size);
      return (at(prev, x - 1, y) + at(prev, x + 1, y) + at(prev, x, y - 1) + at(prev, x, y + 1) + prev[i]) / 5;
    });
  }

  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(size, size);
  const n = new THREE.Vector3();
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const strength = 12;
      n.set((at(height, x - 1, y) - at(height, x + 1, y)) * strength, (at(height, x, y - 1) - at(height, x, y + 1)) * strength, 1).normalize();
      const o = (y * size + x) * 4;
      image.data[o] = (n.x * 0.5 + 0.5) * 255;
      image.data[o + 1] = (n.y * 0.5 + 0.5) * 255;
      image.data[o + 2] = (n.z * 0.5 + 0.5) * 255;
      image.data[o + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}

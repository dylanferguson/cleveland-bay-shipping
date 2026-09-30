import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { HorizontalTiltShiftShader } from "three/addons/shaders/HorizontalTiltShiftShader.js";
import { VerticalTiltShiftShader } from "three/addons/shaders/VerticalTiltShiftShader.js";
import { DIORAMA_RADIUS, toScene } from "./geo.js";
import { createProps } from "./props.js";
import { BASE_Y, createTerrain, heightFor } from "./terrain.js";
import { createWater } from "./water.js";
import { createSky } from "./sky.js";
import { ShipLayer } from "./ships.js";
import { renderShipCard, renderShipList, setStatus } from "./ui.js";

const PLACES = [
  { name: "Townsville", lat: -19.29, lon: 146.79 },
  { name: "Castle Hill", lat: -19.2567, lon: 146.8058 },
  { name: "Port of Townsville", lat: -19.248, lon: 146.845 },
  { name: "Magnetic Island", lat: -19.14, lon: 146.832 },
  { name: "Horseshoe Bay", lat: -19.117, lon: 146.853 },
  { name: "Nelly Bay", lat: -19.163, lon: 146.852 },
  { name: "Mount Stuart", lat: -19.348, lon: 146.78 },
  { name: "Cape Cleveland", lat: -19.183, lon: 147.013 },
  { name: "Cleveland Bay", lat: -19.23, lon: 146.93, water: true },
];

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(innerWidth, innerHeight);
labelRenderer.domElement.className = "labels";
document.body.prepend(labelRenderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 1, 2500);
camera.position.set(170, 330, 470);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(-10, 0, 0);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.45;
controls.minDistance = 4;
controls.maxDistance = 900;
controls.screenSpacePanning = false;
controls.autoRotateSpeed = 0.25;

// A slow turntable spin while nobody is touching it.
let idleTimer = setTimeout(() => (controls.autoRotate = true), 3000);
controls.addEventListener("start", () => {
  controls.autoRotate = false;
  clearTimeout(idleTimer);
});
controls.addEventListener("end", () => {
  idleTimer = setTimeout(() => (controls.autoRotate = true), 20_000);
});

// Tilt-shift blur above and below the middle of the screen, for a miniature look.
const composer = new EffectComposer(renderer);
const tiltH = new ShaderPass(HorizontalTiltShiftShader);
const tiltV = new ShaderPass(VerticalTiltShiftShader);
tiltH.uniforms.r.value = tiltV.uniforms.r.value = 0.5;
composer.addPass(new RenderPass(scene, camera));
composer.addPass(tiltH);
composer.addPass(tiltV);
composer.addPass(new OutputPass());
function sizeTiltShift() {
  tiltH.uniforms.h.value = 3 / innerWidth;
  tiltV.uniforms.v.value = 3 / innerHeight;
}
sizeTiltShift();

const sky = createSky(scene);
const terrain = await createTerrain();
const ships = new ShipLayer(scene, (x, z) => terrain.elevationAtScene(x, z) <= 0.5);
const water = createWater(terrain.shoreMap);
scene.add(terrain.mesh, water.mesh, createProps(terrain), createPlinth());
for (const place of PLACES) {
  const { x, z } = toScene(place.lat, place.lon);
  const label = new CSS2DObject(Object.assign(document.createElement("div"), {
    className: place.water ? "place water" : "place",
    textContent: place.name,
  }));
  label.position.set(x, Math.max(heightFor(terrain.elevationAt(place.lat, place.lon)), 0) + 2, z);
  scene.add(label);
}
document.getElementById("loading").remove();

// A rounded wooden base under the diorama.
function createPlinth() {
  const r = DIORAMA_RADIUS;
  const profile = [
    [0, 0], [r + 2, 0], [r + 4, -0.6], [r + 5, -2], [r + 5, -7], [r + 4.4, -8.4], [r + 3, -9], [0, -9],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const plinth = new THREE.Mesh(
    new THREE.LatheGeometry(profile, 160).translate(0, BASE_Y, 0),
    new THREE.MeshStandardMaterial({ color: 0xc99a6b, roughness: 0.6 }),
  );
  plinth.receiveShadow = true;
  return plinth;
}

// --- Live feed ---

const shipData = new Map();
let selectedMmsi = null;
let flying = false; // easing the camera in towards a newly selected ship
let listDirty = true;

connectFeed();

function connectFeed(retryMs = 1000) {
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/stream`);
  setStatus("connecting");
  ws.addEventListener("open", () => (retryMs = 1000));
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === "snapshot") msg.ships.forEach(upsertShip);
    if (msg.type === "ship") upsertShip(msg.ship);
    if (msg.type === "status") setStatus(msg.status, msg.message);
  });
  ws.addEventListener("close", () => {
    setStatus("offline");
    setTimeout(() => connectFeed(Math.min(retryMs * 2, 30_000)), retryMs);
  });
}

function upsertShip(ship) {
  shipData.set(ship.mmsi, ship);
  ships.upsert(ship);
  listDirty = true;
}

function select(mmsi) {
  selectedMmsi = mmsi;
  ships.setSelected(mmsi);
  flying = mmsi != null;
  listDirty = true;
}

// Refreshes the list and "last report" times once a second.
setInterval(() => {
  for (const mmsi of shipData.keys()) if (!ships.ships.has(mmsi)) shipData.delete(mmsi);
  if (selectedMmsi != null && !shipData.has(selectedMmsi)) select(null);
  if (listDirty) renderShipList(shipData.values(), selectedMmsi, select);
  renderShipCard(shipData.get(selectedMmsi), () => select(null));
  listDirty = false;
}, 1000);

// --- Picking ---

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let pointerDownAt = null;

function pickShip(event) {
  pointer.set((event.clientX / innerWidth) * 2 - 1, -(event.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  return raycaster.intersectObjects(ships.pickables, false)[0]?.object.userData.mmsi ?? null;
}

renderer.domElement.addEventListener("pointermove", (event) => {
  const mmsi = pickShip(event);
  ships.setHovered(mmsi);
  renderer.domElement.style.cursor = mmsi ? "pointer" : "";
});
renderer.domElement.addEventListener("pointerdown", (event) => (pointerDownAt = [event.clientX, event.clientY]));
renderer.domElement.addEventListener("pointerup", (event) => {
  const moved = pointerDownAt && Math.hypot(event.clientX - pointerDownAt[0], event.clientY - pointerDownAt[1]);
  if (moved < 5) select(pickShip(event));
});

// --- Camera follow ---

controls.addEventListener("start", () => (flying = false));

function followSelected(dt) {
  const ship = ships.selected;
  if (ship) {
    const step = ship.root.position.clone().setY(0).sub(controls.target).multiplyScalar(1 - Math.exp(-dt * 3));
    controls.target.add(step);
    camera.position.add(step);
    if (flying) {
      const offset = camera.position.clone().sub(controls.target);
      offset.setLength(THREE.MathUtils.lerp(offset.length(), 32, 1 - Math.exp(-dt * 2)));
      camera.position.copy(controls.target).add(offset);
      if (offset.length() < 33) flying = false;
    }
  }
  const clamped = controls.target.clone().setY(0);
  clamped.setLength(Math.min(clamped.length(), DIORAMA_RADIUS));
  camera.position.add(clamped.clone().sub(controls.target));
  controls.target.copy(clamped);
}

// --- Loop ---

const clock = new THREE.Clock();
let lastSkyUpdate = -Infinity;

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  const elapsed = clock.elapsedTime;
  if (elapsed - lastSkyUpdate > 10) {
    sky.update(new Date());
    lastSkyUpdate = elapsed;
  }
  water.update(elapsed);
  ships.update(dt, elapsed, camera);
  followSelected(dt);
  controls.update();
  composer.render();
  labelRenderer.render(scene, camera);
});

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  labelRenderer.setSize(innerWidth, innerHeight);
  sizeTiltShift();
});

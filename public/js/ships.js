import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { DIORAMA_RADIUS, METERS_PER_UNIT, toScene } from "./geo.js";

const TOY_SCALE = 3;
const KNOTS_TO_MPS = 0.514444;
const MAX_DEAD_RECKONING_MS = 3 * 60_000;
const QUIET_MS = 15 * 60_000;
const STALE_MS = 3 * 60 * 60_000;
const LABEL_DISTANCE = 90;
const AT_ANCHOR = 1;
const MOORED = 5;

export const NAV_STATUS = [
  "Under way", "At anchor", "Not under command", "Restricted manoeuvrability",
  "Constrained by draught", "Moored", "Aground", "Fishing", "Sailing",
];

export function shipCategory(type) {
  if (type >= 70 && type <= 79) return { name: "Cargo", color: 0x3fae62 };
  if (type >= 80 && type <= 89) return { name: "Tanker", color: 0xd4493d };
  if (type >= 60 && type <= 69) return { name: "Passenger", color: 0x4bb8f2 };
  if (type >= 40 && type <= 49) return { name: "High-speed craft", color: 0xf2d24b };
  if (type === 31 || type === 32 || type === 52) return { name: "Tug", color: 0xf07a2e };
  if (type === 50) return { name: "Pilot", color: 0xff9f43 };
  if (type === 30) return { name: "Fishing", color: 0xc79a4a };
  if (type === 35) return { name: "Military", color: 0x8a9a8a };
  if (type === 36 || type === 37) return { name: "Sailing / pleasure", color: 0xf4f4f4 };
  return { name: "Other", color: 0xa7b0b8 };
}

const hullGeometry = (() => {
  // Top-down outline, bow at -y; after rotation the bow faces +z and extrusion goes up.
  const shape = new THREE.Shape()
    .moveTo(-0.5, 0.5).lineTo(0.5, 0.5).lineTo(0.5, -0.25)
    .quadraticCurveTo(0.45, -0.45, 0, -0.5).quadraticCurveTo(-0.45, -0.45, -0.5, -0.25)
    .closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });
  geometry.rotateX(-Math.PI / 2);
  return geometry;
})();
const cabinGeometry = new RoundedBoxGeometry(1, 1, 1, 2, 0.2).translate(0, 0.5, 0);
const cabinMaterial = new THREE.MeshStandardMaterial({ color: 0xfffaf0, roughness: 0.5 });
const funnelGeometry = new THREE.CylinderGeometry(0.5, 0.6, 1, 12).translate(0, 0.5, 0);
const funnelMaterial = new THREE.MeshStandardMaterial({ color: 0xf0553f, roughness: 0.5 });
const markerTexture = (() => {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.strokeStyle = "rgba(0,0,0,0.6)";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(32, 32, 24, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  return new THREE.CanvasTexture(canvas);
})();

export class ShipLayer {
  constructor(scene, isWater) {
    this.isWater = isWater;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.ships = new Map();
    this.hovered = null;
    this.selected = null;
  }

  get pickables() {
    return [...this.ships.values()].filter((ship) => ship.root.visible).flatMap((ship) => [ship.hull, ship.marker]);
  }

  upsert(data) {
    let ship = this.ships.get(data.mmsi);
    if (!ship) {
      ship = { root: new THREE.Group(), heading: headingOf(data) ?? 0, placed: false, phase: Math.random() * 10 };
      ship.root.rotation.order = "YXZ"; // yaw to heading, then pitch and roll about the boat's own axes
      ship.trail = new THREE.Line(
        new THREE.BufferGeometry(),
        new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45 }),
      );
      ship.label = new CSS2DObject(Object.assign(document.createElement("div"), { className: "ship-label" }));
      this.group.add(ship.root, ship.trail);
      this.ships.set(data.mmsi, ship);
    }
    const styleKey = `${data.type}|${data.length}|${data.beam}`;
    ship.data = data;
    if (ship.styleKey !== styleKey) {
      ship.styleKey = styleKey;
      this.buildModel(ship);
    }
    ship.label.element.textContent = data.name || `MMSI ${data.mmsi}`;
    this.updateTrail(ship);
  }

  buildModel(ship) {
    const { data, root } = ship;
    root.clear();
    const category = shipCategory(data.type);
    // Compressed and chubby, so small boats stay visible and big ships don't swamp the bay.
    const lengthM = data.length ?? 30;
    const length = 1.5 + (lengthM * TOY_SCALE) / METERS_PER_UNIT;
    const beam = Math.max(((data.beam ?? 0) * TOY_SCALE) / METERS_PER_UNIT, length / 4);
    const height = THREE.MathUtils.clamp(length * 0.14, 0.35, 1.2);

    const hull = new THREE.Mesh(hullGeometry, new THREE.MeshStandardMaterial({ color: category.color, roughness: 0.5 }));
    hull.scale.set(beam, height, length);
    hull.position.y = -height * 0.35;
    hull.castShadow = true;

    const cabin = new THREE.Mesh(cabinGeometry, cabinMaterial);
    cabin.scale.set(beam * 0.75, height * 0.9, length * 0.28);
    cabin.position.set(0, height * 0.6, -length * 0.18);
    cabin.castShadow = true;

    const funnel = new THREE.Mesh(funnelGeometry, funnelMaterial);
    funnel.scale.set(beam * 0.28, height * 0.8, beam * 0.28);
    funnel.position.set(0, height * 1.45, -length * 0.22);
    funnel.castShadow = true;

    const marker = new THREE.Sprite(new THREE.SpriteMaterial({
      map: markerTexture, color: category.color, sizeAttenuation: false, depthWrite: false,
    }));
    marker.scale.setScalar(0.022);
    marker.position.y = height * 2 + 1.2;

    hull.userData.mmsi = marker.userData.mmsi = data.mmsi;
    ship.label.position.y = marker.position.y + 0.8;
    root.add(hull, cabin, funnel, marker, ship.label);
    Object.assign(ship, { hull, marker });
    this.refreshHighlight(ship);
  }

  updateTrail(ship) {
    const points = ship.data.track.map(([lat, lon]) => {
      const { x, z } = toScene(lat, lon);
      return new THREE.Vector3(x, 0.05, z);
    });
    points.push(ship.root.position.clone().setY(0.05)); // follows the ship each frame
    ship.trail.geometry.dispose();
    ship.trail.geometry = new THREE.BufferGeometry().setFromPoints(points);
  }

  update(dt, elapsed, camera) {
    const now = Date.now();
    const follow = 1 - Math.exp(-dt * 2);
    for (const [mmsi, ship] of this.ships) {
      if (now - ship.data.positionAt > STALE_MS) {
        this.remove(mmsi);
        continue;
      }
      const target = predictedPosition(ship.data, now, this.isWater);
      if (ship.placed) ship.root.position.lerp(target, follow);
      else ship.root.position.copy(target);
      ship.placed = true;
      ship.root.visible = ship.trail.visible = Math.hypot(target.x, target.z) < DIORAMA_RADIUS - 2;
      ship.marker.material.opacity = now - ship.data.positionAt > QUIET_MS ? 0.35 : 1;
      ship.root.position.y = Math.sin(elapsed * 1.4 + ship.phase) * 0.06;
      ship.root.rotation.z = Math.sin(elapsed * 1.1 + ship.phase) * 0.06;
      ship.root.rotation.x = Math.sin(elapsed * 0.9 + ship.phase * 2) * 0.03;

      const heading = headingOf(ship.data) ?? ship.heading;
      ship.heading += shortestAngle(heading - ship.heading) * follow;
      ship.root.rotation.y = Math.PI - THREE.MathUtils.degToRad(ship.heading);

      const trail = ship.trail.geometry.attributes.position;
      trail.setXYZ(trail.count - 1, ship.root.position.x, 0.05, ship.root.position.z);
      trail.needsUpdate = true;

      ship.label.visible = ship === this.hovered || ship === this.selected
        || camera.position.distanceTo(ship.root.position) < LABEL_DISTANCE;
    }
  }

  remove(mmsi) {
    const ship = this.ships.get(mmsi);
    this.group.remove(ship.root, ship.trail);
    this.ships.delete(mmsi);
    if (this.selected === ship) this.selected = null;
    if (this.hovered === ship) this.hovered = null;
  }

  setHovered(mmsi) {
    const previous = this.hovered;
    this.hovered = this.ships.get(mmsi) ?? null;
    if (previous) this.refreshHighlight(previous);
    if (this.hovered) this.refreshHighlight(this.hovered);
  }

  setSelected(mmsi) {
    const previous = this.selected;
    this.selected = this.ships.get(mmsi) ?? null;
    if (previous) this.refreshHighlight(previous);
    if (this.selected) this.refreshHighlight(this.selected);
  }

  refreshHighlight(ship) {
    const active = ship === this.hovered || ship === this.selected;
    ship.hull.material.emissive.set(active ? 0x555555 : 0x000000);
    ship.marker.scale.setScalar(active ? 0.032 : 0.022);
    ship.label.element.classList.toggle("selected", ship === this.selected);
  }
}

function predictedPosition(data, now, isWater) {
  const { x, z } = toScene(data.lat, data.lon);
  const position = new THREE.Vector3(x, 0, z);
  const stationary = data.navStatus === AT_ANCHOR || data.navStatus === MOORED;
  if (stationary || data.sog < 0.5 || data.cog == null) return position;

  const seconds = THREE.MathUtils.clamp(now - data.positionAt, 0, MAX_DEAD_RECKONING_MS) / 1000;
  const distance = (data.sog * KNOTS_TO_MPS * seconds) / METERS_PER_UNIT;
  const course = THREE.MathUtils.degToRad(data.cog);
  const predicted = position.clone().add(new THREE.Vector3(Math.sin(course) * distance, 0, -Math.cos(course) * distance));
  return isWater(predicted.x, predicted.z) ? predicted : position;
}

function headingOf(data) {
  if (data.heading != null) return data.heading;
  if (data.cog != null && data.sog > 0.5) return data.cog;
  return null;
}

function shortestAngle(degrees) {
  return ((((degrees + 180) % 360) + 360) % 360) - 180;
}

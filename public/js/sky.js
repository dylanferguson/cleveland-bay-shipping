import * as THREE from "three";

const TOWNSVILLE = { lat: -19.26, lon: 146.82 };
// [top of sky, horizon]
const NIGHT = [new THREE.Color(0x040a18), new THREE.Color(0x1a2b52)];
const DUSK = [new THREE.Color(0x6f78b8), new THREE.Color(0xffb38a)];
const DAY = [new THREE.Color(0x86c8f2), new THREE.Color(0xfdeedd)];
const MOON_DIRECTION = new THREE.Vector3(-0.4, 0.8, 0.3).normalize();

// Lights the scene from the real sun position over Townsville.
export function createSky(scene) {
  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  Object.assign(sun.shadow.camera, { left: -350, right: 350, top: 350, bottom: -350, near: 1, far: 1500 });
  sun.shadow.bias = -0.0005;
  sun.shadow.radius = 4;
  const hemisphere = new THREE.HemisphereLight(0xe3f2ff, 0x8a7a5a, 1.2);
  scene.add(sun, sun.target, hemisphere);
  const top = new THREE.Color();
  const horizon = new THREE.Color();

  return {
    update(date) {
      const { altitude, azimuth } = sunPosition(date, TOWNSVILLE.lat, TOWNSVILLE.lon);
      const height = Math.sin(altitude);
      const day = THREE.MathUtils.smoothstep(height, -0.12, 0.25);
      const dusk = Math.max(0, 1 - Math.abs(height) / 0.2);

      const night = day < 0.05;
      const sunDirection = new THREE.Vector3(
        Math.cos(altitude) * Math.sin(azimuth), Math.max(height, 0.08), -Math.cos(altitude) * Math.cos(azimuth),
      ).normalize();
      sun.position.copy(night ? MOON_DIRECTION : sunDirection).multiplyScalar(600);
      sun.color.set(night ? 0x9fb6ff : 0xffffff).lerp(DUSK[1], night ? 0 : dusk * 0.6);
      sun.intensity = THREE.MathUtils.lerp(0.6, 2.6, day);
      hemisphere.intensity = THREE.MathUtils.lerp(0.45, 1.2, day);

      top.copy(NIGHT[0]).lerp(DAY[0], day).lerp(DUSK[0], dusk * 0.4);
      horizon.copy(NIGHT[1]).lerp(DAY[1], day).lerp(DUSK[1], dusk * 0.6);
      // The canvas is transparent; the sky is a CSS gradient behind it.
      document.body.style.setProperty("--sky-top", `#${top.getHexString()}`);
      document.body.style.setProperty("--sky-horizon", `#${horizon.getHexString()}`);
    },
  };
}

// Low-precision solar position (good to ~1°). Azimuth is clockwise from north.
function sunPosition(date, lat, lon) {
  const rad = Math.PI / 180;
  const d = date.getTime() / 86_400_000 - 10_957.5; // days since J2000
  const g = (357.529 + 0.98560028 * d) * rad;
  const q = 280.459 + 0.98564736 * d;
  const eclipticLon = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad;
  const obliquity = (23.439 - 0.00000036 * d) * rad;
  const ra = Math.atan2(Math.cos(obliquity) * Math.sin(eclipticLon), Math.cos(eclipticLon));
  const dec = Math.asin(Math.sin(obliquity) * Math.sin(eclipticLon));
  const gmstHours = (18.697374558 + 24.06570982441908 * d) % 24;
  const hourAngle = gmstHours * 15 * rad + lon * rad - ra;
  const phi = lat * rad;
  return {
    altitude: Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(hourAngle)),
    azimuth: Math.atan2(-Math.sin(hourAngle), Math.tan(dec) * Math.cos(phi) - Math.sin(phi) * Math.cos(hourAngle)),
  };
}

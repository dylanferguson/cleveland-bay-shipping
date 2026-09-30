// Local flat projection: 1 scene unit = 100 m, +x east, -z north.
export const METERS_PER_UNIT = 100;
export const BOUNDS = { west: 146.6, east: 147.15, south: -19.4, north: -19.02 };
export const TILES = { z: 12, x0: 3715, x1: 3722, y0: 2267, y1: 2273 }; // see scripts/fetch-terrain.sh

const ORIGIN = { lat: (BOUNDS.north + BOUNDS.south) / 2, lon: (BOUNDS.west + BOUNDS.east) / 2 };
const M_PER_DEG_LAT = 110_574;
const M_PER_DEG_LON = 111_320 * Math.cos((ORIGIN.lat * Math.PI) / 180);

export function toScene(lat, lon) {
  return {
    x: ((lon - ORIGIN.lon) * M_PER_DEG_LON) / METERS_PER_UNIT,
    z: (-(lat - ORIGIN.lat) * M_PER_DEG_LAT) / METERS_PER_UNIT,
  };
}

export function toLatLon(x, z) {
  return {
    lat: ORIGIN.lat - (z * METERS_PER_UNIT) / M_PER_DEG_LAT,
    lon: ORIGIN.lon + (x * METERS_PER_UNIT) / M_PER_DEG_LON,
  };
}

export const SCENE_BOUNDS = (() => {
  const nw = toScene(BOUNDS.north, BOUNDS.west);
  const se = toScene(BOUNDS.south, BOUNDS.east);
  return { minX: nw.x, maxX: se.x, minZ: nw.z, maxZ: se.z };
})();

// The round diorama, centred on the scene origin.
export const DIORAMA_RADIUS = 205;

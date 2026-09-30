// Folds aisstream.io messages into compact ship records.
// Message reference: https://aisstream.io/documentation

export const MESSAGE_TYPES = [
  "PositionReport",
  "StandardClassBPositionReport",
  "ExtendedClassBPositionReport",
  "ShipStaticData",
  "StaticDataReport",
];

const TRACK_POINTS = 40;
const TRACK_MIN_STEP_DEG = 0.0004; // ~40 m

export function applyAisMessage(ships, msg, now) {
  const meta = msg.MetaData;
  const body = msg.Message?.[msg.MessageType];
  if (!meta?.MMSI || !body) return null;

  const ship = ships.get(meta.MMSI) ?? { mmsi: meta.MMSI, name: "", type: 0, track: [] };
  ship.name ||= clean(meta.ShipName);

  switch (msg.MessageType) {
    case "PositionReport":
    case "StandardClassBPositionReport":
    case "ExtendedClassBPositionReport":
      if (!applyPosition(ship, body, now)) return null;
      if (body.NavigationalStatus !== undefined) ship.navStatus = body.NavigationalStatus;
      if (body.Name) ship.name = clean(body.Name) || ship.name;
      if (body.Type) ship.type = body.Type;
      if (body.Dimension) applyDimension(ship, body.Dimension);
      break;
    case "ShipStaticData":
      ship.name = clean(body.Name) || ship.name;
      ship.type = body.Type || ship.type;
      ship.callSign = clean(body.CallSign);
      ship.destination = clean(body.Destination);
      ship.imo = body.ImoNumber || undefined;
      ship.draught = body.MaximumStaticDraught || undefined;
      applyDimension(ship, body.Dimension);
      break;
    case "StaticDataReport":
      if (body.ReportA?.Valid) ship.name = clean(body.ReportA.Name) || ship.name;
      if (body.ReportB?.Valid) {
        ship.type = body.ReportB.ShipType || ship.type;
        ship.callSign = clean(body.ReportB.CallSign);
        applyDimension(ship, body.ReportB.Dimension);
      }
      break;
    default:
      return null;
  }

  ship.seenAt = now;
  ships.set(ship.mmsi, ship);
  return ship;
}

function applyPosition(ship, body, now) {
  const lat = body.Latitude;
  const lon = body.Longitude;
  // 91 / 181 mean "not available".
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return false;

  const last = ship.track.at(-1);
  if (!last || Math.hypot(last[0] - lat, last[1] - lon) > TRACK_MIN_STEP_DEG) {
    ship.track.push([lat, lon]);
    if (ship.track.length > TRACK_POINTS) ship.track.shift();
  }

  ship.lat = lat;
  ship.lon = lon;
  ship.sog = body.Sog < 102.3 ? body.Sog : 0;
  ship.cog = body.Cog < 360 ? body.Cog : null;
  ship.heading = body.TrueHeading < 360 ? body.TrueHeading : null;
  ship.positionAt = now;
  return true;
}

function applyDimension(ship, d) {
  if (!d) return;
  const length = (d.A ?? 0) + (d.B ?? 0);
  const beam = (d.C ?? 0) + (d.D ?? 0);
  if (length > 0) ship.length = length;
  if (beam > 0) ship.beam = beam;
}

// AIS pads text with spaces and '@'.
function clean(text) {
  return (text ?? "").replace(/@+/g, "").trim();
}

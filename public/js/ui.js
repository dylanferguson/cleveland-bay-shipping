import { NAV_STATUS, shipCategory } from "./ships.js";

const statusEl = document.getElementById("status");
const listEl = document.getElementById("ship-list");
const countEl = document.getElementById("ship-count");
const cardEl = document.getElementById("ship-card");

export function setStatus(status, message) {
  statusEl.dataset.status = status;
  statusEl.textContent = message ?? { live: "Live", connecting: "Connecting…", offline: "Offline" }[status] ?? status;
}

export function renderShipList(ships, selectedMmsi, onSelect) {
  const sorted = [...ships].sort((a, b) => (b.sog ?? 0) - (a.sog ?? 0) || displayName(a).localeCompare(displayName(b)));
  countEl.textContent = sorted.length;
  listEl.replaceChildren(...sorted.map((ship) => {
    const item = document.createElement("li");
    item.classList.toggle("selected", ship.mmsi === selectedMmsi);
    item.style.setProperty("--dot", hex(shipCategory(ship.type).color));
    item.innerHTML = `<span class="dot"></span><span class="name"></span><span class="meta"></span>`;
    item.querySelector(".name").textContent = displayName(ship);
    item.querySelector(".meta").textContent = motion(ship);
    item.addEventListener("click", () => onSelect(ship.mmsi));
    return item;
  }));
}

export function renderShipCard(ship, onClose) {
  cardEl.hidden = !ship;
  if (!ship) return;
  const category = shipCategory(ship.type);
  const rows = [
    ["Type", category.name],
    ["Status", motion(ship)],
    ["Course", ship.cog != null ? `${Math.round(ship.cog)}°` : "—"],
    ["Destination", ship.destination || "—"],
    ["Size", ship.length ? `${ship.length} × ${ship.beam ?? "?"} m` : "—"],
    ["Call sign", ship.callSign || "—"],
    ["MMSI", ship.mmsi],
    ["Last report", ago(ship.positionAt)],
  ];
  cardEl.style.setProperty("--dot", hex(category.color));
  cardEl.innerHTML = `
    <button class="close" aria-label="Close">×</button>
    <h2><span class="dot"></span><span class="name"></span></h2>
    <dl>${rows.map(() => "<dt></dt><dd></dd>").join("")}</dl>
    <a target="_blank" rel="noopener" href="https://www.marinetraffic.com/en/ais/details/ships/mmsi:${ship.mmsi}">View on MarineTraffic ↗</a>`;
  cardEl.querySelector(".name").textContent = displayName(ship);
  const cells = cardEl.querySelectorAll("dt, dd");
  rows.flat().forEach((text, i) => (cells[i].textContent = text));
  cardEl.querySelector(".close").addEventListener("click", onClose);
}

function displayName(ship) {
  return ship.name || `MMSI ${ship.mmsi}`;
}

function motion(ship) {
  const status = NAV_STATUS[ship.navStatus];
  if (ship.sog >= 0.5) return `${ship.sog.toFixed(1)} kn`;
  return status && status !== "Under way" ? status : "Stationary";
}

function ago(ms) {
  const minutes = Math.round((Date.now() - ms) / 60_000);
  return minutes < 1 ? "just now" : `${minutes} min ago`;
}

function hex(color) {
  return `#${color.toString(16).padStart(6, "0")}`;
}

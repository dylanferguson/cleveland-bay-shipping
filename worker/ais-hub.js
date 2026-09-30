import { DurableObject } from "cloudflare:workers";
import { applyAisMessage, MESSAGE_TYPES } from "./ais.js";

const STREAM_URL = "https://stream.aisstream.io/v0/stream";
// [[lat, lon], [lat, lon]] corners, a little wider than the rendered area.
const BOUNDING_BOX = [[-19.5, 146.5], [-18.9, 147.3]];
const STALE_MS = 3 * 60 * 60 * 1000;
const SAVE_INTERVAL_MS = 30_000;
const IDLE_DISCONNECT_MS = 60_000;
const MAX_RETRY_MS = 60_000;

// One shared upstream aisstream connection, fanned out to every browser.
// Ship state is persisted so new visitors see recent ships straight away.
export class AisHub extends DurableObject {
  ships = new Map();
  clients = new Set();
  upstream = null;
  connecting = false;
  retryMs = 1000;
  lastSave = 0;
  idleTimer = null;

  constructor(ctx, env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      for (const ship of (await ctx.storage.get("ships")) ?? []) {
        this.ships.set(ship.mmsi, ship);
      }
    });
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return Response.json(this.currentShips());
    }

    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    this.clients.add(server);
    clearTimeout(this.idleTimer);

    server.send(JSON.stringify({ type: "snapshot", ships: this.currentShips() }));
    server.send(JSON.stringify({ type: "status", status: this.upstream ? "live" : "connecting" }));

    const drop = () => {
      this.clients.delete(server);
      if (this.clients.size === 0) {
        this.idleTimer = setTimeout(() => this.disconnectUpstream(), IDLE_DISCONNECT_MS);
      }
    };
    server.addEventListener("close", drop);
    server.addEventListener("error", drop);

    this.connectUpstream();
    return new Response(null, { status: 101, webSocket: client });
  }

  async connectUpstream() {
    if (this.upstream || this.connecting || this.clients.size === 0) return;
    if (!this.env.AISSTREAM_API_KEY) {
      this.broadcast({ type: "status", status: "error", message: "AISSTREAM_API_KEY is not set" });
      return;
    }

    this.connecting = true;
    try {
      const res = await fetch(STREAM_URL, { headers: { Upgrade: "websocket" } });
      const ws = res.webSocket;
      if (!ws) throw new Error(`aisstream upgrade failed: ${res.status}`);
      ws.accept();
      ws.send(JSON.stringify({
        APIKey: this.env.AISSTREAM_API_KEY,
        BoundingBoxes: [BOUNDING_BOX],
        FilterMessageTypes: MESSAGE_TYPES,
      }));
      ws.addEventListener("message", (event) => this.onAisMessage(event.data));
      ws.addEventListener("close", () => this.onUpstreamLost(ws));
      ws.addEventListener("error", () => this.onUpstreamLost(ws));
      this.upstream = ws;
      this.broadcast({ type: "status", status: "live" });
    } catch (err) {
      console.error(err);
      this.scheduleReconnect();
    } finally {
      this.connecting = false;
    }
  }

  onUpstreamLost(ws) {
    if (this.upstream !== ws) return;
    this.upstream = null;
    this.broadcast({ type: "status", status: "connecting" });
    this.scheduleReconnect();
  }

  scheduleReconnect() {
    setTimeout(() => this.connectUpstream(), this.retryMs);
    this.retryMs = Math.min(this.retryMs * 2, MAX_RETRY_MS);
  }

  disconnectUpstream() {
    if (this.clients.size > 0 || !this.upstream) return;
    const ws = this.upstream;
    this.upstream = null;
    ws.close(1000, "idle");
    this.save();
  }

  async onAisMessage(data) {
    const text = typeof data === "string" ? data : await new Response(data).text();
    this.retryMs = 1000;
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (msg.error) {
      console.error("aisstream:", msg.error);
      this.broadcast({ type: "status", status: "error", message: msg.error });
      return;
    }

    const now = Date.now();
    const isNew = !this.ships.has(msg.MetaData?.MMSI);
    const ship = applyAisMessage(this.ships, msg, now);
    if (ship?.lat !== undefined) this.broadcast({ type: "ship", ship });
    if ((ship && isNew) || now - this.lastSave > SAVE_INTERVAL_MS) this.save();
  }

  currentShips() {
    const cutoff = Date.now() - STALE_MS;
    for (const [mmsi, ship] of this.ships) {
      if (ship.seenAt < cutoff) this.ships.delete(mmsi);
    }
    return [...this.ships.values()].filter((ship) => ship.lat !== undefined);
  }

  save() {
    this.lastSave = Date.now();
    this.ctx.storage.put("ships", [...this.ships.values()]);
  }

  broadcast(message) {
    const payload = JSON.stringify(message);
    for (const ws of this.clients) {
      try {
        ws.send(payload);
      } catch {
        this.clients.delete(ws);
      }
    }
  }
}

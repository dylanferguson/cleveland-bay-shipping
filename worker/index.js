export { AisHub } from "./ais-hub.js";

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/stream" || pathname === "/api/ships") {
      return env.AIS_HUB.getByName("cleveland-bay").fetch(request);
    }
    return new Response("Not found", { status: 404 });
  },
};

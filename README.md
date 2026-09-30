# Cleveland Bay Shipping

A three.js diorama of Cleveland Bay, Townsville, and Magnetic Island, with live ship positions from [aisstream.io](https://aisstream.io). Lighting follows the real sun over Townsville.

- `public/` is the static frontend: plain ES modules, with three.js loaded from a CDN through an import map. There's no build step.
- `worker/` is a Cloudflare Worker with one Durable Object (`AisHub`). It holds a single aisstream.io WebSocket, keeps recent ship state, and fans updates out to browsers on `/api/stream`. `/api/ships` returns the current ships as JSON.
- `public/terrain/` holds Terrarium elevation tiles from [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/). Re-fetch them with `scripts/fetch-terrain.sh`.

## Develop

```bash
npm install
echo "AISSTREAM_API_KEY=your-key" > .dev.vars
npm run dev
```

Open http://localhost:8787.

## Deploy

```bash
npx wrangler secret put AISSTREAM_API_KEY
npm run deploy
```

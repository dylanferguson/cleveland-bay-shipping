#!/usr/bin/env bash
# Downloads Terrarium elevation tiles (AWS Terrain Tiles) covering Cleveland Bay.
# Keep the ranges in sync with TILES in public/js/geo.js.
set -euo pipefail
cd "$(dirname "$0")/../public/terrain"
z=12
for x in $(seq 3715 3722); do
  for y in $(seq 2267 2273); do
    curl -sSf -o "${z}_${x}_${y}.png" \
      "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png"
  done
done

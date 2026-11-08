#!/usr/bin/env bash
# Production audit of every mounted /api endpoint of gods-eye-view-fresh.
# Prints: path  status  bytes  seconds
B=https://gods-eye-view-fresh.vercel.app
H1="Origin: $B"
H2='Sec-Fetch-Site: same-origin'
paths=(
  '/api/flights?lat=52.5&lon=13.4'
  '/api/celestrak?group=stations'
  '/api/tomtom/status'
  '/api/firms?maxPoints=200'
  '/api/launches?days=30'
  '/api/terrain/heights?lat=52.5&lon=13.4'
  '/api/adsbdb?icao24=3c6444'
  '/api/overpass?bbox=52.4,13.2,52.6,13.5'
  '/api/route?from=52.5,13.4&to=52.6,13.5'
  '/api/military-installations'
  '/api/regional-brief?lat=52.5&lon=13.4'
  '/api/geocode?q=Berlin'
  '/api/weather-effects?lat=52.5&lon=13.4'
  '/api/cctv?lat=52.5&lon=13.4'
  '/api/radio?lat=52.5&lon=13.4'
  '/api/gbfs?lat=52.5&lon=13.4'
  '/api/local-receivers/aircraft'
  '/api/transit?lat=52.5&lon=13.4'
  '/api/military'
  '/api/vessels?maxRows=100'
  '/api/flights/track?icao24=3c6444'
  '/api/military/track?hex=3c6444'
  '/api/openai/hud-summary/status'
  '/api/realtime/debug-log'
  '/api/realtime/token'
  '/api/realtime/oauth-status'
  '/api/gemini/token'
  '/api/google/nearby-places?lat=52.5&lon=13.4'
  '/api/google/text-search?q=cafe'
  '/api/google/geocode?q=Berlin'
  '/api/google/reverse-geocode?lat=52.5&lon=13.4'
  '/api/google/tiles-token'
  '/api/wind'
  '/api/weather?lat=52.5&lon=13.4'
  '/api/cyclones'
  '/api/mapillary/status'
  '/api/mapillary/tiles?z=14&x=8&y=5'
  '/api/fire-perimeters'
  '/api/gnss-integrity?lat=52.5&lon=13.4'
  '/api/ghostmaps?lat=52.5&lon=13.4'
  '/api/setup/status'
)
for p in "${paths[@]}"; do
  code=$(curl -s -o ./audit-body.json -w '%{http_code} %{size_download} %{time_total}' --max-time 70 "$B$p" -H "$H1" -H "$H2")
  set -- $code
  head=$(head -c 90 ./audit-body.json | tr -cd '[:print:]' | tr '\n' ' ')
  printf '%-46s %s %8sB %6ss  %s\n' "$p" "$1" "$2" "$3" "$head"
done
rm -f ./audit-body.json

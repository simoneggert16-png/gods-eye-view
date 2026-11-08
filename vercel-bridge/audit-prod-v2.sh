#!/usr/bin/env bash
# Production audit v2 — client-exact URL shapes for every mounted /api route.
# Prints: method path status bytes seconds first-160-bytes
B=${GEV_AUDIT_BASE:-https://gods-eye-view-fresh.vercel.app}
H1="Origin: $B"
H2='Sec-Fetch-Site: same-origin'

get() {
  local p=$1
  local out status bytes secs body
  out=$(curl -s -o /tmp/gev_body -w '%{http_code} %{size_download} %{time_total}' \
        --max-time 70 -H "$H1" -H "$H2" "$B$p" 2>/dev/null)
  status=${out%% *}
  rest=${out#* }
  bytes=${rest%% *}
  secs=${rest##* }
  body=$(head -c 160 /tmp/gev_body | tr -d '\n\r' | tr -cd '[:print:]')
  printf '%-6s %-58s %s %8s %7s  %s\n' GET "$p" "$status" "$bytes" "$secs" "$body"
}

post() {
  local p=$1 data=$2
  local out status bytes secs body
  out=$(curl -s -o /tmp/gev_body -w '%{http_code} %{size_download} %{time_total}' \
        --max-time 70 -H "$H1" -H "$H2" -H 'Content-Type: application/json' \
        -X POST --data "$data" "$B$p" 2>/dev/null)
  status=${out%% *}
  rest=${out#* }
  bytes=${rest%% *}
  secs=${rest##* }
  body=$(head -c 160 /tmp/gev_body | tr -d '\n\r' | tr -cd '[:print:]')
  printf '%-6s %-58s %s %8s %7s  %s\n' POST "$p" "$status" "$bytes" "$secs" "$body"
}

for p in \
  '/api/flights?lat=52.5&lon=13.4' \
  '/api/flights/track?icao24=3c6444' \
  '/api/military?north=53&south=52&east=14&west=13' \
  '/api/military/track?hex=3c6444' \
  '/api/adsbdb?icao24=3c6444' \
  '/api/vessels?maxRows=50' \
  '/api/vessels/track?mmsi=211234567' \
  '/api/celestrak/active' \
  '/api/celestrak/status' \
  '/api/launches' \
  '/api/cyclones' \
  '/api/fire-perimeters/inciweb/index' \
  '/api/firms?north=53&south=52&east=14&west=13' \
  '/api/weather?product=temp&bbox=13.2,52.4,13.6,52.6&size=256' \
  '/api/weather/manifest?product=temp' \
  '/api/weather-effects?latitude=52.5&longitude=13.4' \
  '/api/wind/status' \
  '/api/wind/grid/0/0/0?overlay=wind' \
  '/api/regional-brief?latitude=52.5&longitude=13.4' \
  '/api/geocode?q=Berlin' \
  '/api/google/nearby-places?lat=52.5&lon=13.4' \
  '/api/google/text-search?q=cafe&lat=52.5&lon=13.4' \
  '/api/google/geocode?address=Berlin' \
  '/api/google/reverse-geocode?lat=52.5&lon=13.4' \
  '/api/google/tiles-token' \
  '/api/mapillary/status' \
  '/api/tomtom/status' \
  '/api/route?coords=13.4,52.5;13.5,52.6&profile=driving&steps=2' \
  '/api/traffic?bbox=13.2,52.4,13.6,52.6' \
  '/api/terrain/heights?points=13.4,52.5' \
  '/api/military-installations?north=53&south=52&east=14&west=13' \
  '/api/cctv/sources' \
  '/api/cctv/health' \
  '/api/cctv?lat=52.5&lon=13.4' \
  '/api/radio/stations?lat=52.5&lon=13.4' \
  '/api/transit/feeds' \
  '/api/transit?lat=52.5&lon=13.4' \
  '/api/ghostmaps/catalog' \
  '/api/ghostmaps/events' \
  '/api/gnss-integrity?lat=52.5&lon=13.4' \
  '/api/local-receivers/aircraft' \
  '/api/openai/hud-summary/status' \
  '/api/realtime/debug-log' \
  '/api/realtime/token' \
  '/api/realtime/oauth-status' \
  '/api/gemini/token' \
  '/api/setup/status' \
  ; do get "$p"; done

post '/api/overpass' '{"query":"[out:json][timeout:10];node[\"aeroway\"=\"aerodrome\"](52.4,13.2,52.6,13.5);out 3;"}'
post '/api/gbfs/norwich' '{}'
get '/api/gbfs/norwich/gbfs.json'

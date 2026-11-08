#!/usr/bin/env bash
# Production audit v3 — client-exact URL shapes, corrected from the handler
# source (query-param names, path segments, POST body encoding).
# Prints: method path status bytes seconds first-160-bytes
B=${GEV_AUDIT_BASE:-https://gods-eye-view-fresh.vercel.app}
H1="Origin: $B"
H2='Sec-Fetch-Site: same-origin'

emit() {
  local method=$1 p=$2
  local out status rest bytes secs body
  out=$(cat /tmp/gev_meta)
  status=${out%% *}
  rest=${out#* }
  bytes=${rest%% *}
  secs=${rest##* }
  body=$(head -c 160 /tmp/gev_body | tr -d '\n\r' | tr -cd '[:print:]')
  printf '%-4s %-62s %s %9s %8s  %s\n' "$method" "$p" "$status" "$bytes" "$secs" "$body"
}

get() {
  curl -s -o /tmp/gev_body -w '%{http_code} %{size_download} %{time_total}' \
    --max-time 70 -H "$H1" -H "$H2" "$B$1" > /tmp/gev_meta 2>/dev/null
  emit GET "$1"
}

post_form() {
  curl -s -o /tmp/gev_body -w '%{http_code} %{size_download} %{time_total}' \
    --max-time 70 -H "$H1" -H "$H2" \
    -H 'Content-Type: application/x-www-form-urlencoded' \
    -X POST --data-urlencode "data=$2" "$B$1" > /tmp/gev_meta 2>/dev/null
  emit POST "$1"
}

echo '### LIVE TRAFFIC'
get '/api/flights?lat=52.5&lon=13.4'
get '/api/flights/track?icao24=3c6444'
get '/api/military?north=53&south=52&east=14&west=13'
get '/api/military/track?hex=ae11ea'
get '/api/adsbdb/type/3c6444'
get '/api/adsbdb/route/DLH123'
get '/api/gnss-integrity?lat=52.5&lon=13.4'
get '/api/vessels?maxRows=50'
get '/api/vessels/track?mmsi=244660565'

echo '### SPACE'
get '/api/celestrak/active'
get '/api/launches'
get '/api/cyclones'

echo '### FIRE / HAZARD'
get '/api/fire-perimeters/inciweb/index'
get '/api/firms?north=53&south=52&east=14&west=13'

echo '### WEATHER'
get '/api/weather/manifest?product=radar'
get '/api/weather/manifest?product=lightning'
get '/api/weather/manifest?product=clouds'
get '/api/weather-effects?latitude=52.5&longitude=13.4'
get '/api/wind/status'
get '/api/wind?overlay=none'
get '/api/wind?overlay=temperature'
get '/api/wind?overlay=pressure'

echo '### REGION / PLACES'
get '/api/regional-brief?latitude=52.5&longitude=13.4'
get '/api/geocode?q=Berlin'
get '/api/google/nearby-places?lat=52.5163&lon=13.3777&radiusM=500'
get '/api/google/text-search?q=Brandenburger%20Tor&lat=52.5163&lon=13.3777&radiusM=6000'
get '/api/google/geocode?address=Berlin'
get '/api/google/reverse-geocode?lat=52.5163&lon=13.3777'
get '/api/google/tiles-token'
get '/api/mapillary/status'

echo '### ROUTING / TRAFFIC FLOW'
get '/api/tomtom/status'
get '/api/route?coords=13.4,52.5;13.5,52.6&profile=driving&steps=2'
get '/api/terrain/heights?points=13.4,52.5'

echo '### OSM / INSTALLATIONS'
get '/api/military-installations?north=53&south=52&east=14&west=13'
post_form '/api/overpass' '[out:json][timeout:15];node["aeroway"="aerodrome"](52.4,13.2,52.6,13.5);out 3;'

echo '### CCTV / RADIO / TRANSIT / BIKE'
get '/api/cctv/sources'
get '/api/cctv/health'
get '/api/radio/stations?lat=52.5&lon=13.4'
get '/api/transit/feeds'
get '/api/transit/vehicles/mbta'
get '/api/gbfs/https%3A%2F%2Fgbfs.nextbike.net%2Fmaps%2Fgbfs%2Fv2%2Fnextbike_bn%2Fgbfs.json'

echo '### GHOSTMAPS'
get '/api/ghostmaps/catalog'

echo '### AI / VOICE'
get '/api/local-receivers/aircraft'
get '/api/openai/hud-summary/status'
get '/api/realtime/oauth-status'
get '/api/realtime/token'
get '/api/gemini/token'

echo '### EXPECTED NON-200 (design, not failure)'
get '/api/setup/status'
get '/api/realtime/debug-log'

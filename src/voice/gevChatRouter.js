/**
 * Chat router — AI-powered understanding for what the regex parser cannot.
 *
 * When parseFreeVoiceCommand returns unknown (pronouns, coreference like
 * "seine Insel" → the Epstein island from six turns ago, free phrasing), a
 * chat brain translates the utterance — WITH recent conversation history —
 * into one local tool call. Execution stays local through runGevAction, so
 * the model can never do anything the voice tools cannot do.
 *
 * Pure: prompt building + response extraction. Transport lives in the
 * controller (chain ZAI → Ollama), serverside in chatBrainsProxy.
 *
 * @module voice/gevChatRouter
 */

/** Max history turns (you/app pairs) sent for coreference. */
export const ROUTER_MAX_HISTORY = 6;

/** Longest single history text sent. */
export const ROUTER_MAX_HISTORY_CHARS = 150;

/**
 * Compact tool menu for the router prompt. Names MUST match the voice tool
 * registry (server: GEV_REALTIME_TOOLS); args mirror the real schemas in
 * short form. Unknown names are rejected by the runner anyway.
 */
export const ROUTER_TOOLS = Object.freeze([
  'fly_to_location {query | locationId | latitude + longitude as SEPARATE numbers, rangeM?: number, pitch?: number, heading?: number, layerToEnable?: string, viewMode?: close|overview} — fly/zoom to a PLACE or coordinates with custom 3D camera angle (pitch: -90 to 0, heading: 0-360, rangeM: altitude) and optional layer to activate (e.g. flights, military, satellites, cctv, live-osint). Resolves pronouns ("dorthin", "it") from context.',
  'adjust_camera_zoom {direction: in|out, amount: little|medium|lot} — relative zoom, no place',
  'zoom_to_globe {} — full Earth view',
  'set_layer_visibility {layerId, enabled} — layers: flights, military, satellites, earthquakes, traffic, cctv, radio, bikeshare, ais-live-vessels, local-firms, local-datacenters, local-dams, telegeography-submarine-cables, rocket-launches, conflicts, frontlines, missile-strikes, battles, bombardments, missile-tests, military-convoys, campaign-trails, secret-service, drone-attacks, terror-attacks, live-osint',
  'show_data_layers_menu {layerId?} — open the layers menu, optionally highlight one row',
  'set_panel_open {panelId, open} — panels: data-panel, location-bar, control-panel, cctv-panel, radio-panel, scene-panel, pp-toggles, global-context-panel',
  'set_visual_style {style: normal|retro|surveillance|thermal|anime|noir|snow} — night vision=nvg=surveillance, heat=thermal/flir',
  'set_post_processing {bloom?: {enabled, intensityPct}, sharpen?: {enabled, intensityPct}}',
  'control_cockpit {action: enter|exit|next|previous} — ride/ditch the tracked plane',
  'select_nearest_aircraft {layerId: flights|military, locationQuery?, differentFromSelected?} — pick/follow the nearest or generic aircraft. For "over/near/in PLACE", ALWAYS pass locationQuery. For "another/next/different", pass differentFromSelected:true and keep the prior place',
  'track_entity {query} — follow a named/identified plane, ship, satellite, or fire (\"SATGUS\", \"Hubble\"/\"HST\", callsign, ICAO hex, registration, MMSI); \"fire\" = strongest fire; \"nearest satellite\" = nearest live satellite. Never use this for generic or nearest aircraft',
  'stop_tracking {} — stop following',
  'set_context_mode {mode: off|contacts|space-missions} — contacts roster / missions view',
  'set_hud {visible?: on|off, layout?: tactical|operator|minimal}',
  'set_detection {enabled?, mode?: sparse|balanced|dense, densityPct?} ',
  'set_map_stack {stack: photoreal|bing-aerial|bing-labels|esri-imagery|osm}',
  'get_entity_context {scope?: auto|selected|in_view} — read what is selected/visible (for "what is this" questions answer from it, no navigation)',
  'get_current_view_state {} — read camera/layers/state',
  'control_scene {action: list|play|stop|next, sceneId?}',
  'control_radio {action: enable|disable|play|resume|pause|stop|next|previous|volume|select, category?, locationQuery?}',
  'control_cctv {action: select|nearest|enable|disable|next|prev|focus|coverage|viewshed|analyze, cameraQuery?} — SHOW, VIEW, OR ANALYZE CCTV / WEBCAM / CAMERAS in any city, place, landmark, or street (e.g. Diepoldsau, Zürich, London, Austin). Use action: "select" and cameraQuery: "<place or camera name>" for "zeig mir eine kamera in X", or action: "analyze" for "was sieht die kamera in X" / "analysiere kamera in X"',
  'annotate_map {annotations: [{type: area|pin|route, target, latitude?: number, longitude?: number, entityKind?: country|state|city|neighborhood|building|address}], flyTo?: boolean, persist?: boolean} — DRAW, OUTLINE, OR SHOW BOUNDARIES of any country, state, region, city, address, or landmark. When coordinates (latitude, longitude) are known from your AI world knowledge, ALWAYS supply them inside each annotation item to place the mark precisely without relying on text geocoders!',
  'clear_annotations {} — ONLY on explicit clear asks',
  'analyst_query {layers, scope?, filters?, sortBy?, limit?} — COUNT/LIST questions over live data (never navigates)',
  'move_camera {motion: orbit|pan|tilt|rotate|stop, direction?, speed?} — orbit/rotate the view',
  'frame_overhead {target: flights|military|satellites|vessels} — show traffic overhead',
  'fly_route {} — fly the drawn route',
  'next_iss_pass {} — when is the ISS overhead next',
  'web_search {query} — look up a FACT on the web (tallest building, biggest X, population, events) when you do not reliably know it; you get sourced results back, then make the map call',
  'fly_to_nearest_tactical_target {category?} — fly to the nearest tactical target, drone attack, or missile strike with a safe overview altitude (e.g. 6000-12000m)',
  'mark_tactical_impact_zone {latitude?, longitude?, radiusM?, zoomIn?: boolean, label?} — mark the affected area or impact zone of an attack with a circular perimeter and optional close zoom',
  'describe_tactical_event {latitude?, longitude?} — retrieve military sitrep and BDA for the tactical event at the location',
  'query_osint_news {query?, limit?} — retrieve real-time Telegram / OSINT dispatches and breaking military news for a topic, region, or conflict zone (e.g. Charkiw, Drohnen, Raketen, Nahost)',
  'query_financial_market_impact {asset?, query?} — retrieve real-time financial market data (Brent Oil, Gold, S&P 500, VIX, defense stocks, crypto) and geopolitical impact analysis connecting world events to markets',
  'search_and_forecast_asset {query, asset?, symbol?} — deep dive forecast and 1-3 month price target corridor for a specific stock, commodity, or asset (e.g. Rheinmetall, NVDA, Gold, Brent, Tesla)',
]);

/** System prompt for routing turns. */
export const ROUTER_SYSTEM_PROMPT = [
  'You translate user utterances for a live 3D globe app into map-tool calls or direct answers.',
  'Use the conversation history to resolve pronouns and references ("seine Insel", "dorthin", "it", "there") to the real place or thing meant.',
  '1. MAP ACTIONS: Pick the single best tool from the menu. Prefer navigation with a real place name over relative moves when a place is meant.',
  'When the user asks to draw, outline, or show boundaries of any place, country, state, region, island, city, or address (e.g. "zeichne ... ein", "umrande ...", "outline ..."), ALWAYS use annotate_map with type: "area" and flyTo: true. Translate colloquial nicknames or German place names to standard international/English names if helpful (e.g. "Epsteins Insel" -> "Epstein Island" or "Little Saint James", "Osterinsel" -> "Easter Island").',
  '"Zoom into X / zoome in X rein" with a named building, street, or POI means fly_to_location with viewMode close, not a relative nudge. World-famous buildings resolve directly worldwide (not just one island): map German names to canonical English ones (e.g. "Eiffelturm" -> "Eiffel Tower, Paris", "Freiheitsstatue" -> "Statue of Liberty", "Kölner Dom" -> "Cologne Cathedral", "Brandenburger Tor" -> "Brandenburg Gate", "Epsteins bekanntes Gebäude / Tempel" -> "Epstein temple"). When you know exact coordinates of a famous place, prefer latitude + longitude as two separate numbers.',
  'AUTONOMOUS AI GEOSPATIAL INTELLIGENCE & WORLD KNOWLEDGE (NO BRITTLE KEYWORDS): You are an advanced AI possessing deep real-world geographic, architectural, and historical knowledge across all continents. Do NOT depend on brittle keyword matching or geocoder dictionaries to recognize places. For ANY location the user asks for — whether it is a celebrity mansion/villa (e.g. Sean "Diddy" Combs Holmby Hills or Star Island, Drake\'s The Embassy in Toronto, Playboy Mansion, Neverland Ranch, Bill Gates Xanadu, Elon Musk Starbase, Mar-a-Lago), a political or historical site, military facility, secret base, mountain peak, battleground, disaster area, or private estate:\n'
  + '- Always use your internal AI world knowledge to resolve the exact real-world geographic coordinates (latitude and longitude) and real street address!\n'
  + '- For annotate_map: ALWAYS provide latitude and longitude (as numbers) inside the annotation object alongside target, e.g. {"name": "annotate_map", "args": {"annotations": [{"type": "area", "target": "Diddys Villa", "latitude": 34.0788, "longitude": -118.4312, "entityKind": "building"}], "flyTo": true}, "say": "Ich markiere Diddys Villa in Los Angeles."}. Supplying latitude and longitude ensures instant, 100% accurate placement without geocoder failure!\n'
  + '- For fly_to_location: ALWAYS supply latitude and longitude (as numbers), with appropriate rangeM (e.g. 500-1200 for villas/estates/compounds, 2500 for neighborhoods, 15000 for cities), pitch (e.g. -25 to -35 for 3D perspective), and heading! (e.g. {"name": "fly_to_location", "args": {"latitude": 34.0788, "longitude": -118.4312, "rangeM": 600, "pitch": -30}, "say": "Ich fliege zu Diddys Villa in Los Angeles."}).\n'
  + '- Follow-ups and pronouns ("zeige sie mir", "bring mich hin", "fliege dorthin", "markiere es"): Resolve the exact coordinates and place from conversation history immediately and execute the tool call with latitude and longitude!',
  'COUNTRIES / STATES / REGIONS ("zeig mir Iran", "kannst du mir Iran zeigen", "take me to Japan", "fliege nach Deutschland"): ALWAYS call fly_to_location with query: "<country/region>" without viewMode: "close" (or viewMode: "overview"). Never use viewMode: "close" for whole countries or states — they must be framed in whole-country/regional overview so the user can see the country, never zoomed down to a few hundred meters in the ground.',
  'TRACKABLE ENTITIES (satellites, ships, aircraft — never geocode these!): when the utterance names a specific satellite ("ISS", "Mark Robers Satellit", "Hubble", "Webb"), ship ("Ever Given"), or aircraft identity (callsign, hex, registration), ALWAYS use track_entity with that identity — never fly_to_location. Famous mappings: "Mark Robers Satellit / Mark Rober satellite" -> query "SATGUS", "Hubble" -> "HST", "James Webb" -> "JWST". The layer enables itself.',
  'GENERIC / NEAREST AIRCRAFT: "show me a military flight", "zeige mir einen Militärflug", "any plane", "ein Flugzeug", or "nearest aircraft" is NOT a name lookup. Use select_nearest_aircraft with layerId "military" for military wording, otherwise "flights". For several objects or traffic overhead, use frame_overhead. Only use track_entity when a specific identity is named.',
  'SOMETHING COOL / WAS COOLES / SPANNENDES ("zeig mir was cooles", "zeige mir etwas spannendes", "show me something cool", "bring mich irgendwohin", "was cooles", "cool"): You are the autonomous director of God\'s Eye View. Ingest the rich multi-system context (camera location, ground gaze target, active layers, botnet/OSINT breaking dispatches, geopolitical markets, and world wonders). Make an intelligent, creative executive choice:\n'
  + '1. Option 3D Live Jet / Orbit: Lock onto an active military jet in 3D ({"name": "select_nearest_aircraft", "args": {"layerId": "military"}, "say": "Ich schalte auf einen aktiven Militärjet im 3D-Modus und richte die Verfolgungskamera mit Kondensstreifen aus."}) or orbit the ISS ({"name": "track_entity", "args": {"query": "ISS"}, "say": "Ich docke an die Raumstation ISS im 3D-Orbit an."}).\n'
  + '2. Option World Wonder / Landmark: Fly to a breathtaking natural wonder or landmark with cinematic camera angles (pitch: e.g. -25 to -35, heading, rangeM) and auto-enable layers if relevant! Examples: Mount Everest ({"name": "fly_to_location", "args": {"latitude": 27.9881, "longitude": 86.9250, "rangeM": 7000, "pitch": -25, "heading": 180}, "say": "Ich bringe dich zum Mount Everest auf 8.848m Höhe mit atemberaubendem Gebirgshorizont."}), Grand Canyon ({"name": "fly_to_location", "args": {"latitude": 36.0544, "longitude": -112.1401, "rangeM": 4500, "pitch": -35, "heading": 60}, "say": "Ich fliege dich in den Grand Canyon mit dramatischer 3D-Schluchtperspektive."}), Pyramids of Giza ({"name": "fly_to_location", "args": {"latitude": 29.9792, "longitude": 31.1342, "rangeM": 2200, "pitch": -30, "heading": 45}, "say": "Ich zeige dir die Pyramiden von Gizeh aus der Vogelperspektive."}), Matterhorn ({"name": "fly_to_location", "args": {"latitude": 45.9765, "longitude": 7.6585, "rangeM": 4500, "pitch": -25, "heading": 120}, "say": "Ich fliege dich zum Matterhorn im 3D-Alpenpanorama."}), Mariana Trench, or Tromsø Aurora.\n'
  + '3. Option Breaking OSINT Hotspot: If breaking OSINT or botnet dispatches indicate urgent tactical activity, navigate there and activate live-osint or drone-attacks with a clear German explanation.\n'
  + 'Never call frame_overhead for "was cooles" — always provide high-impact 3D navigation and cinematic angles!',
  'SHOW FLIGHT TRAFFIC ("zeig mir den Flugverkehr", "Flugverkehr über Austin", "Flugverkehr", "zeige Flugzeuge", "show flight traffic"): ALWAYS use select_nearest_aircraft with layerId: "flights" (pass locationQuery if a city or country is named, e.g. {"name": "select_nearest_aircraft", "args": {"layerId": "flights", "locationQuery": "Austin"}, "say": "Ich schalte den Flugverkehr ein und verfolge den nächsten Flug über Austin."})! This turns on flights and tracks an aircraft in 3D.',
  'GENERIC / NEAREST SATELLITE: \"show me a satellite\", \"zeige mir einen Satelliten\", including the common misspelling \"Sateliten\", or \"nearest satellite\" means track_entity with query \"nearest satellite\" (the satellites layer enables itself). \"ein anderer Satellit\", \"einen anderen Satelliten\", \"another satellite\", or \"different satellite\" after a previously tracked satellite means track_entity with query \"nearest satellite\" AND differentFromSelected:true — a DIFFERENT satellite must be picked, never the one already followed. For several satellites or traffic overhead, use frame_overhead with target \"satellites\". A concrete identity such as ISS, Hubble, or SATGUS still uses track_entity with that identity.',
  'NEAREST-AIRCRAFT PLACES: "flugzeug über Japan", "plane over Japan", "aircraft near Austin", or any other over/near/in PLACE phrasing MUST pass locationQuery with that place. NEVER omit the place and silently use the current camera. For "ein anderes", "another", "next", or "different" after a previous aircraft, pass differentFromSelected:true and preserve the previous place from history/context.',
  'SELECTED OBJECT QUESTIONS: "was macht dieses Flugzeug" (including the common typo "was nacht"), "what does this aircraft do", "what is this satellite/ship", or any question about the currently selected object MUST call get_entity_context with scope "selected" FIRST, then answer from its returned properties. Never ask the user which object while one is selected.',
  'CAMERAS / CCTV IN A PLACE ("kamera in X", "cameras in X", "cctv in X", "zeig mir eine kamera in X", "show me cameras in X"): The tool name is strictly "control_cctv" (NEVER "cam" or "camera"). ALWAYS call control_cctv with action: "select" and cameraQuery: "<clean place name>" (e.g. {"name": "control_cctv", "args": {"action": "select", "cameraQuery": "Tower Bridge, London"}, "say": "Öffne Kameras an der Tower Bridge in London."}), or set_layer_visibility for cctv and fly_to_location to the place. NEVER apologize, refuse, or say you cannot find or show a camera — ALWAYS emit a control_cctv tool call for ANY camera/cctv/webcam request.',
  'SHOW + DRAW COMBOS ("zeig mir X und zeichne es ein", "show me X and mark it"): use ONE annotate_map call with flyTo: true — it flies there AND draws. Always use the canonical English place name as target (e.g. "Frühwarnsystem mit Kuppeln in Australien" -> target "Joint Defence Facility Pine Gap", never a made-up phrase like "Frühwarnsystem bei Jervis Bay"). If you are unsure which place is meant, ask briefly instead of guessing a target.',
  'TACTICAL & MILITARY LAYERS ("zeig mir Drohnenangriffe", "zeige mir einen Drohnenangriff", "show me drone attacks", "zeig mir Terroranschläge", "zeig mir Raketenangriffe", "zeig mir Bombardements", "zeig mir Frontlinien"): ALWAYS enable the corresponding layer with set_layer_visibility (e.g. drone-attacks, terror-attacks, missile-strikes, bombardments, battles, frontlines, conflicts, missile-tests, military-convoys, campaign-trails, secret-service) and NEVER call fly_to_location with the attack or weapon type name as a query! For "zeig mir einen Drohnenangriff", call set_layer_visibility with layerId: "drone-attacks" and enabled: true (e.g. {"name": "set_layer_visibility", "args": {"layerId": "drone-attacks", "enabled": true}, "say": "Zeige Drohnenangriffe."}).',
  'TACTICAL IMPACT ZONES & ATTACKS ("markiere das betroffene Gebiet", "markiere die Einschlagszone", "zoom rein und markiere das Gebiet", "fliege zu einem hin", "erzähl mir was drüber"): When the user asks to mark the affected area or strike zone of an attack, ALWAYS call mark_tactical_impact_zone (pass zoomIn: true if the user asks to zoom). When the user asks "fliege zu einem hin" or to jump to an attack, call fly_to_nearest_tactical_target. When the user asks "erzähl mir was drüber", "was ist hier passiert", or asks about the attack, use describe_tactical_event or answer using the tacticalIntel provided in the scene context.',
  'LIVE OSINT & BREAKING NEWS ("Gibt es aktuelle News?", "Was gibt es Neues?", "Zeig mir OSINT Meldungen", "Was passiert in Charkiw?", "Gibt es neue Drohnenmeldungen?", "Telegram News"): When the user asks for news or OSINT dispatches, use query_osint_news (e.g. {"name": "query_osint_news", "args": {"query": "Charkiw"}, "say": "Frage aktuelle OSINT-Meldungen ab."}) or set_layer_visibility with layerId: "live-osint" and enabled: true to display the live Telegram OSINT layer on the globe.',
  'FINANCIAL MARKETS & STOCK FORECASTS ("Wie wirken sich die Ereignisse auf die Finanzmärkte aus?", "Was macht der Ölpreis?", "Goldpreis Reaktion", "Finanzmärkte", "Aktienmärkte", "Kausalitätsanalyse", "Marktreaktion", "prognostiziere welche aktien durch die decke gehen", "welche aktien steigen am 10. Oktober", "Aktienprognose", "Top Aktien"): When the user asks for financial impacts, breakout stocks, or which stocks will surge/skyrocket ("durch die decke gehen"), ALWAYS call query_financial_market_impact (e.g. {"name": "query_financial_market_impact", "args": {"query": "ausbruchsaktien 10. Oktober"}, "say": "Erstelle geopolitische Ausbruchsprognose für die stärksten Aktien."}). For a specific individual stock (e.g. "Prognose für Rheinmetall", "wie steht Nvidia", "Aktienkurs Tesla"), call search_and_forecast_asset with query: "<asset name>".',
  'DEICTIC REFERENCES ("diesen Wald", "dieses Gebäude", "dieser Turm", "dorthin", "dahin", "it", "there"): NEVER geocode the demonstrative word itself. Resolve it from the conversation history (the last mentioned place of that kind — "diesen Wald" after "Schwarzwald" means Schwarzwald) and second from the current scene (camera place, selection, nearby landmarks). If neither names a place, answer briefly that you do not know which one is meant.',
  'For map actions, answer with ONLY a JSON object, no other text: {"name": "<tool>", "args": {...}, "say": "<short confirmation in the user language>"}',
  'The JSON envelope MUST use exactly the keys "name", "args", "say" — never "tool", "type", or "params". One tool call per answer; the single best tool wins.',
  'KNOWLEDGE THEN ACT: if a map action needs a FACT you do not reliably know (tallest building somewhere, biggest X, newest event), FIRST call web_search with a short query. You will receive sourced results and then make the map call (fly_to_location with the found coordinates as latitude + longitude, or annotate_map with the canonical name). If you already reliably know the fact AND its coordinates, act directly — never ask the user to wait.',
  '2. QUESTIONS: If the user asks a question (e.g. why something has a strange color, what is visible, why water looks turquoise/cyan vs deep blue, sandbanks, reefs, bathymetry, terrain, mountains, geography, or place facts), answer DIRECTLY IN HELPFUL PLAIN TEXT in the user\'s language (at most 3 short sentences, no JSON).',
  '3. GIBBERISH: Only if an utterance is complete meaningless gibberish with neither an action nor a question, answer exactly: {"unknown": true}',
  'Tools:',
  ...ROUTER_TOOLS.map((line, index) => `${index + 1}. ${line}`),
].join('\n');

/**
 * Addendum for screenshot-attached routing: the model may answer visible
 * questions directly instead of emitting a tool call.
 */
export const ROUTER_VISION_ADDENDUM = 'A screenshot of the current view is attached — you SEE the screen. If the user asks what is visible or asks a question about the view, colors, water depth/bathymetry, landscape, geography, or why something looks a certain way (e.g. "wieso hat das so eine komische farbe", "warum ist das wasser türkis", "what is this place"), answer DIRECTLY IN HELPFUL PLAIN TEXT in the user\'s language (at most three short sentences, no JSON). Tool calls remain for map actions.';

/**
 * Compress conversation entries into router history lines.
 *
 * @param {Array<{who:string,text:string}>} entries - Oldest first.
 * @returns {string} "YOU: …\nAPP: …" lines, newest kept on overflow.
 */
export function buildRouterHistory(entries) {
  if (!Array.isArray(entries)) return '';
  const lines = [];
  for (const entry of entries) {
    const who = entry?.who === 'gemini' || entry?.who === 'zai' || entry?.who === 'ollama' ? 'AI' : (entry?.who === 'app' ? 'APP' : 'YOU');
    const text = String(entry?.text || '').trim().slice(0, ROUTER_MAX_HISTORY_CHARS);
    if (text) lines.push(`${who}: ${text}`);
  }
  return lines.slice(-ROUTER_MAX_HISTORY).join('\n');
}

/**
 * True when the text points at something only conversation/scene context can
 * resolve (pronouns, possessives, deictics). Such utterances must NEVER go
 * through regex name extraction ("seine Insel" geocodes to a random island
 * in the Seine) — they route straight to the brain.
 */
export function hasReferenceWords(text) {
  const t = ` ${String(text || '').toLowerCase()} `;
  return /(\bmein\w*|\bdein\w*|\bsein\w*|\bihr\w*|\bunser\w*|\beuer\w*|\bdorthin|\bdahin|\bhierher|\bhiesig\w*|\bdies\w*|\bjen\w*|\bihn|\bihm|\bes\b|\bder da\b|\bdie da\b|\bdas da\b|\bmy\b|\byour\b|\bhis\b|\bher\b|\bits\b|\bour\b|\btheir\b|\bthere\b|\bhere\b|\bthis\b|\bthat\b|\bthose\b|\bthese\b|\bit\b|\bhim\b|\bthem\b)/.test(t);
}

/**
 * Build the router user message (history + current utterance).
 *
 * @param {string} text - Current utterance.
 * @param {Array} historyEntries - Log entries (oldest first).
 * @param {string} [sceneContext] - Compact live scene snapshot.
 */
export function buildRouterMessage(text, historyEntries, sceneContext = '') {
  const history = buildRouterHistory(historyEntries);
  const clean = String(text || '').trim().slice(0, 500);
  const scene = String(sceneContext || '').trim().slice(0, 3500);
  const parts = [];
  if (history) parts.push(`Conversation so far:\n${history}`);
  if (scene) parts.push(`MULTI-SYSTEM LIVE CONTEXT (Camera, Layers, Botnet/OSINT, Markets, Wonders):\n${scene}`);
  parts.push(history || scene ? `Now the user says: "${clean}"` : `The user says: "${clean}" (no prior conversation)`);
  return parts.join('\n\n');
}

/**
 * Build the place-fix message: the lookup missed, the brain corrects.
 *
 * @param {string} query - The failed place query.
 * @param {Array} historyEntries - Log entries (oldest first).
 * @param {string} [sceneContext] - Compact live scene snapshot (camera place, selection).
 */
export function buildPlaceFixMessage(query, historyEntries, sceneContext = '') {
  const history = buildRouterHistory(historyEntries);
  const clean = String(query || '').trim().slice(0, 160);
  const scene = String(sceneContext || '').trim().slice(0, 800);
  const context = history ? `Conversation so far:\n${history}\n\n` : '';
  const sceneBlock = scene ? `Current scene (camera place, selection, layers):\n${scene}\n\n` : '';
  return `${context}${sceneBlock}Geocoding for "${clean}" returned zero results in standard maps. Use your internal AI world knowledge to resolve this place anywhere on Earth!
Reply with ONLY JSON:
{"latitude": <number>, "longitude": <number>, "query": "<canonical place or street address name>"}
If you know the real-world location (for any mansion, villa, landmark, compound, historical site, or base), ALWAYS provide its exact real-world latitude and longitude numbers! If you know the real street address, provide it in "query". Fix typos (shenzen→Shenzhen) and resolve pronouns from context. If completely unmappable, reply exactly {"unknown": true}.`;
}

/**
 * Extract a corrected place name and/or coordinates from a brain answer.
 *
 * @param {unknown} answer - Raw brain text.
 * @returns {{query?:string,latitude?:number,longitude?:number}|{unknown:true}|null} Fix, coordinates, explicit unknown, or null.
 */
export function extractPlaceFix(answer) {
  if (typeof answer !== 'string') return null;
  const cleaned = answer.replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let parsed = null;
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  if (parsed.unknown === true) return { unknown: true };

  // If this object is actually a tool call (e.g. {"name": "select_nearest_aircraft", ...}), reject it as a place fix!
  const possibleTool = String(parsed.name || parsed.tool || parsed.action || '').trim().toLowerCase();
  if (possibleTool && normalizeRouterToolName(possibleTool)) {
    return null;
  }

  const queryCandidate = parsed.query || parsed.place || parsed.location || parsed.target || parsed.address || (!possibleTool ? parsed.name : '');
  const query = typeof queryCandidate === 'string' ? queryCandidate.trim().slice(0, 160) : '';
  const lat = Number(parsed.latitude ?? parsed.lat);
  const lon = Number(parsed.longitude ?? parsed.lon ?? parsed.lng);
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
  if (!query && !hasCoords) return null;
  return {
    ...(query ? { query } : {}),
    ...(hasCoords ? { latitude: lat, longitude: lon } : {}),
  };
}
/**
 * Extract a routed tool call from brain output. Tolerates prose around the
 * JSON and code fences; strict on shape afterwards. Only the FIRST balanced
 * {...} object is parsed, so multi-call ramblings execute the first call
 * instead of failing the whole parse. Also accepts {"type": "<tool>", ...}
 * (small models write "type" instead of "name" with top-level args).
 *
 * @param {unknown} answer - Raw brain text.
 * @returns {{name:string,args:object,say:string}|{unknown:true}|null}
 *   Routed call, explicit unknown, or null when unparseable.
 */
/**
 * Annotation types that map to the annotate_map tool when emitted by small models as {"type": "..."}.
 */
export const ANNOTATION_TYPES = Object.freeze(['area', 'pin', 'route', 'point']);

/**
 * Tool aliases mapping common alternative or abbreviated tool names emitted by models
 * to the exact canonical tool name.
 */
export const TOOL_NAME_ALIASES = Object.freeze({
  cam: 'control_cctv',
  camera: 'control_cctv',
  cameras: 'control_cctv',
  cctv: 'control_cctv',
  webcam: 'control_cctv',
  webcams: 'control_cctv',
  live_cam: 'control_cctv',
  livecam: 'control_cctv',
  track_named_cameras: 'control_cctv',
  track_camera: 'control_cctv',
  track_cameras: 'control_cctv',
  cctv_camera: 'control_cctv',
  cctv_cameras: 'control_cctv',
  show_camera: 'control_cctv',
  show_cameras: 'control_cctv',
  find_camera: 'control_cctv',
  find_cameras: 'control_cctv',
  get_camera: 'control_cctv',
  cctv_control: 'control_cctv',
  fly_to: 'fly_to_location',
  fly: 'fly_to_location',
  flight: 'fly_to_location',
  goto: 'fly_to_location',
  go_to: 'fly_to_location',
  navigate: 'fly_to_location',
  navigate_to: 'fly_to_location',
  zoom: 'adjust_camera_zoom',
  zoom_in: 'adjust_camera_zoom',
  zoom_out: 'adjust_camera_zoom',
  camera_zoom: 'adjust_camera_zoom',
  track: 'track_entity',
  follow: 'track_entity',
  tracking: 'track_entity',
  annotate: 'annotate_map',
  draw: 'annotate_map',
  outline: 'annotate_map',
  marker: 'annotate_map',
  pin: 'annotate_map',
  layer: 'set_layer_visibility',
  layers: 'set_layer_visibility',
  layer_visibility: 'set_layer_visibility',
  visibility: 'set_layer_visibility',
  radio: 'control_radio',
  cockpit: 'control_cockpit',
  scene: 'control_scene',
  hud: 'set_hud',
  style: 'set_visual_style',
  visual_style: 'set_visual_style',
  panel: 'set_panel_open',
  panels: 'set_panel_open',
});

/**
 * Normalize a raw tool name to a canonical GEV tool name, or return empty string if invalid.
 */
export function normalizeRouterToolName(raw) {
  if (typeof raw !== 'string') return '';
  const cleaned = raw.trim().toLowerCase().replace(/^(?:tools?|call|functions?)\./i, '');
  if (ROUTER_TOOL_NAMES.includes(cleaned)) return cleaned;
  if (TOOL_NAME_ALIASES[cleaned]) return TOOL_NAME_ALIASES[cleaned];
  return '';
}

/**
 * Known tool names, derived from the menu (each line starts with `name {...}`).
 * Used to spot degenerate pseudo-format calls like
 * `fly_to_location { "query": "Jervis Bay" }` that small models emit instead
 * of the {"name","args"} envelope.
 */
export const ROUTER_TOOL_NAMES = Object.freeze(ROUTER_TOOLS.map((line) => String(line).split(' ')[0]));

/**
 * Extract a routed tool call from brain output. Tolerates prose around the
 * JSON and code fences; strict on shape afterwards. Only the FIRST balanced
 * {...} object is parsed, so multi-call ramblings execute the first call
 * instead of failing the whole parse. Also accepts {"type": "<tool>", ...},
 * {"action": "<tool>", ...}, {"to": "tool.<tool>", ...}, or Ollama/Harmony
 * tokens like `<|start|>assistant<|channel|>commentary to=tool.annotate_map <|constrain|>json<|message|>...`.
 * When parsed.type is 'area' | 'pin' | 'route' | 'point', the tool name is 'annotate_map'.
 *
 * @param {unknown} answer - Raw brain text.
 * @returns {{name:string,args:object,say:string}|{unknown:true}|null}
 *   Routed call, explicit unknown, or null when unparseable.
 */
export function extractRouterCall(answer) {
  if (typeof answer !== 'string') return null;

  // Extract tool name from Harmony / Ollama commentary token if present (e.g. to=tool.annotate_map, to=functions.track_entity)
  const harmonyToolMatch = answer.match(/\bto=(?:["']?(?:tool|tools|function|functions)\.)([a-z_]{3,40})["']?/i);
  const harmonyToolName = harmonyToolMatch ? harmonyToolMatch[1].toLowerCase() : '';

  // Strip Ollama / Harmony tokens (<|start|>, <|call|>, <|channel|>...<|constrain|>, etc.) and markdown code fences
  const cleaned = answer
    .replace(/<\|[\s\S]*?\|>/g, ' ')
    .replace(/```(?:json)?/gi, '')
    .trim();

  let slice = null;
  let parsed = null;
  let searchIdx = 0;
  while (searchIdx < cleaned.length) {
    slice = extractFirstJsonValue(cleaned, searchIdx);
    if (!slice) break;
    try {
      parsed = JSON.parse(slice);
      break;
    } catch {
      const nextOpen = cleaned.indexOf(slice[0], searchIdx);
      searchIdx = nextOpen >= 0 ? nextOpen + 1 : searchIdx + 1;
      slice = null;
    }
  }
  if (!parsed || typeof parsed !== 'object') return null;

  let rawName = '';
  if (Array.isArray(parsed)) {
    if (typeof parsed[0] === 'string' && typeof parsed[1] === 'object' && parsed[1] !== null) {
      rawName = parsed[0].trim();
      parsed = parsed[1];
    } else if (typeof parsed[0] === 'object' && parsed[0] !== null) {
      parsed = parsed[0];
    } else {
      return null;
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  if (parsed.unknown === true) return { unknown: true };

  const parsedType = typeof parsed.type === 'string' ? parsed.type.trim() : '';
  const isAnnotateType = Boolean(parsedType && ANNOTATION_TYPES.includes(parsedType.toLowerCase()));

  // Extract raw tool name: name -> action -> tool -> to -> harmonyToolName -> type (with area/pin/route/point mapped to annotate_map)
  if (!rawName) {
    if (typeof parsed.name === 'string' && parsed.name.trim()) {
      rawName = parsed.name.trim();
    } else if (typeof parsed.action === 'string' && parsed.action.trim() && (ROUTER_TOOL_NAMES.includes(parsed.action.trim().toLowerCase()) || TOOL_NAME_ALIASES[parsed.action.trim().toLowerCase()] || !parsed.tool)) {
      rawName = parsed.action.trim();
    } else if (typeof parsed.tool === 'string' && parsed.tool.trim()) {
      rawName = parsed.tool.trim();
    } else if (typeof parsed.to === 'string' && parsed.to.trim()) {
      rawName = parsed.to.replace(/^(?:tools?|call)\./i, '').trim();
    } else if (harmonyToolName) {
      rawName = harmonyToolName;
    } else if (isAnnotateType) {
      rawName = 'annotate_map';
    } else if (parsedType) {
      rawName = parsedType;
    }
  }

  let canonicalName = normalizeRouterToolName(rawName);
  if (!canonicalName) return null;

  const argsContainer = parsed.args && typeof parsed.args === 'object' && !Array.isArray(parsed.args) ? parsed.args
    : parsed.params && typeof parsed.params === 'object' && !Array.isArray(parsed.params) ? parsed.params
      : parsed.parameters && typeof parsed.parameters === 'object' && !Array.isArray(parsed.parameters) ? parsed.parameters
        : parsed.arguments && typeof parsed.arguments === 'object' && !Array.isArray(parsed.arguments) ? parsed.arguments
          : parsed.input && typeof parsed.input === 'object' && !Array.isArray(parsed.input) ? parsed.input
            : null;

  let args = argsContainer ? { ...argsContainer } : null;
  if (!args) {
    // {"type": "track_entity", "query": "X"} → args are the top-level rest.
    const {
      name: _name,
      type: _type,
      tool: _tool,
      action: _action,
      to: _to,
      say: _say,
      unknown: _unknown,
      args: _args,
      params: _params,
      parameters: _parameters,
      arguments: _arguments,
      input: _input,
      ...rest
    } = parsed;
    void _args; void _params; void _parameters; void _arguments; void _input;
    args = rest;
  }

  // Preserve parsed.name in args if it was not used as the tool name itself (e.g. tuple format ["fly_to_location", {"name": "Diepoldsau, Switzerland"}])
  if (typeof parsed.name === 'string' && parsed.name.trim() && parsed.name.trim().toLowerCase() !== rawName.toLowerCase() && !args.name) {
    args.name = parsed.name.trim();
  }

  // Preserve annotation type in args if parsed.type was 'area'|'pin'|'route'|'point'
  if (isAnnotateType && !args.type) {
    args.type = parsedType.toLowerCase();
  }

  // Preserve parsed.action in args if it was not used as the tool name itself (e.g. control_cctv action: 'enable')
  if (typeof parsed.action === 'string' && parsed.action.trim() && parsed.action.trim().toLowerCase() !== rawName.toLowerCase() && !args.action) {
    args.action = parsed.action.trim();
  }

  // Normalize query and coordinate aliases
  if (canonicalName === 'track_entity' && !args.query) {
    args.query = String(args.entity_query || args.target || args.name || '').trim();
  }
  if (canonicalName === 'fly_to_location') {
    if (args.lat !== undefined && args.latitude === undefined) args.latitude = args.lat;
    if (args.lon !== undefined && args.longitude === undefined) args.longitude = args.lon;
    if (args.lng !== undefined && args.longitude === undefined) args.longitude = args.lng;
    if (!args.query || (typeof args.query === 'string' && !args.query.trim())) {
      const fallback = args.location || args.place || args.target || args.name || args.destination || args.city || '';
      if (fallback) {
        args.query = String(fallback).trim();
      }
    } else if (typeof args.query === 'string') {
      args.query = args.query.trim();
    }
  }
  if (canonicalName === 'annotate_map') {
    if (args.lat !== undefined && args.latitude === undefined) args.latitude = args.lat;
    if (args.lon !== undefined && args.longitude === undefined) args.longitude = args.lon;
    if (args.lng !== undefined && args.longitude === undefined) args.longitude = args.lng;
    if (Array.isArray(args.annotations)) {
      args.annotations = args.annotations.map((item) => {
        if (!item || typeof item !== 'object') return item;
        const out = { ...item };
        if (out.lat !== undefined && out.latitude === undefined) out.latitude = out.lat;
        if (out.lon !== undefined && out.longitude === undefined) out.longitude = out.lon;
        if (out.lng !== undefined && out.longitude === undefined) out.longitude = out.lng;
        return out;
      });
    }
  }

  // If model routed a camera query to track_entity (e.g. {"name": "track_entity", "query": "London CCTV"})
  if (canonicalName === 'track_entity' && /\b(?:cctv|camera|kamera|webcam|livecam)\b/i.test(args?.query || '')) {
    canonicalName = 'control_cctv';
    const cleanQuery = String(args.query).replace(/\b(?:cctv|camera|kamera|webcam|livecam)\b/gi, ' ').replace(/\s+/g, ' ').trim();
    args = { action: 'select', cameraQuery: cleanQuery || args.query };
  }

  // Default action for control_cctv when camera query is present without explicit action
  if (canonicalName === 'control_cctv') {
    const q = args.cameraQuery || args.locationQuery || args.query || args.location || args.place || args.target || args.name || args.cam || args.camera;
    if (q && !args.cameraQuery) {
      args.cameraQuery = String(q).trim();
    }
    if (!args.action) {
      args.action = args.cameraQuery ? 'select' : 'enable';
    }
  }

  return { name: canonicalName, args, say: typeof parsed.say === 'string' ? parsed.say.slice(0, 200) : '' };
}

/**
 * Extract the first balanced JSON value (either {...} object or [...] array)
 * starting at or after fromIndex. String-aware, so braces or brackets inside
 * quoted text don't unbalance the scan.
 *
 * @param {string} text
 * @param {number} [fromIndex]
 * @returns {string|null} The JSON slice, or null when unbalanced/absent.
 */
export function extractFirstJsonValue(text, fromIndex = 0) {
  const s = String(text || '');
  const offset = fromIndex < 0 ? 0 : fromIndex;
  const braceIdx = s.indexOf('{', offset);
  const bracketIdx = s.indexOf('[', offset);
  if (braceIdx < 0 && bracketIdx < 0) return null;

  let start = -1;
  if (braceIdx >= 0 && bracketIdx >= 0) {
    start = Math.min(braceIdx, bracketIdx);
  } else if (braceIdx >= 0) {
    start = braceIdx;
  } else {
    start = bracketIdx;
  }

  const stack = [];
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i += 1) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') {
      inStr = true;
    } else if (ch === '{') {
      stack.push('}');
    } else if (ch === '[') {
      stack.push(']');
    } else if (ch === '}' || ch === ']') {
      if (stack.length === 0 || stack[stack.length - 1] !== ch) {
        return null;
      }
      stack.pop();
      if (stack.length === 0) {
        return s.slice(start, i + 1);
      }
    }
  }
  return null;
}

/**
 * Extract the first balanced {...} object starting at or after fromIndex.
 * String-aware, so braces inside quoted text don't unbalance the scan.
 *
 * @param {string} text
 * @param {number} [fromIndex]
 * @returns {string|null} The object slice, or null when unbalanced/absent.
 */
export function extractFirstJsonObject(text, fromIndex = 0) {
  const s = String(text || '');
  const start = s.indexOf('{', fromIndex < 0 ? 0 : fromIndex);
  if (start < 0) return null;
  return extractFirstJsonValue(s, start);
}


/**
 * Fallback for degenerate brain output: a bare tool name followed by a JSON
 * args object (`fly_to_location { "query": "Jervis Bay" }`), which
 * extractRouterCall rejects (no "name" envelope). Returns the call with an
 * empty say — callers synthesize a clean confirmation via synthRouterSay so
 * the raw pseudo-syntax never reaches the chat log.
 *
 * @param {unknown} answer - Raw brain text.
 * @returns {{name:string,args:object,say:string}|null}
 */
export function extractDegenerateRouterCall(answer) {
  if (typeof answer !== 'string') return null;
  const cleaned = answer.replace(/<\|[\s\S]*?\|>/g, ' ').replace(/```(?:json)?/gi, ' ');
  let best = null;
  for (const tool of ROUTER_TOOL_NAMES) {
    const at = cleaned.search(new RegExp(`\\b${tool}\\b`));
    if (at >= 0 && (!best || at < best.index)) best = { tool, index: at };
  }
  if (!best) {
    for (const [alias, canonical] of Object.entries(TOOL_NAME_ALIASES)) {
      const at = cleaned.search(new RegExp(`\\b${alias}\\b`));
      if (at >= 0 && (!best || at < best.index)) best = { tool: canonical, index: at };
    }
  }
  if (!best) return null;
  const slice = extractFirstJsonObject(cleaned, best.index);
  if (!slice) return null;
  try {
    const parsed = JSON.parse(slice);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return { name: best.tool, args: parsed, say: '' };
  } catch {
    return null;
  }
}

/**
 * Completeness check for a routed call: the brain sometimes emits a valid
 * envelope with EMPTY args ({"name":"fly_to_location","args":{}}), which
 * would otherwise execute and throw "needs a locationId...". Incomplete
 * calls are treated as unparseable (next brain / honest fallback).
 *
 * @param {string} name - Tool name.
 * @param {object} [args] - Tool args.
 * @returns {boolean} True when the call carries what the tool needs.
 */
export function isCompleteRouterCall(name, args = {}) {
  const a = args && typeof args === 'object' ? args : {};
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  const num = (v) => Number.isFinite(Number(v)) && String(v).trim() !== '';
  switch (name) {
    case 'fly_to_location':
      return Boolean(str(a.locationId) || str(a.query) || (num(a.latitude) && num(a.longitude)));
    case 'track_entity':
      return Boolean(str(a.query));
    case 'annotate_map': {
      const list = Array.isArray(a.annotations) ? a.annotations : [];
      const hasCoords = (num(a.latitude) && num(a.longitude)) || list.some((it) => it && num(it.latitude) && num(it.longitude));
      // annotateMap itself also accepts a flat args.name as the target, or numeric coordinates.
      return list.length > 0 || hasCoords || Boolean(str(a.target) || str(a.query) || str(a.location) || str(a.place) || str(a.entity) || str(a.name));
    }
    case 'adjust_camera_zoom':
      return Boolean(str(a.direction));
    case 'move_camera':
      return Boolean(str(a.motion));
    case 'set_layer_visibility':
      return Boolean(str(a.layerId));
    case 'set_visual_style':
      return Boolean(str(a.style));
    case 'control_cctv':
      return Boolean(str(a.action) || str(a.cameraQuery) || str(a.locationQuery) || str(a.query) || str(a.location));
    case 'set_panel_open':
      return Boolean(str(a.panelId) || str(a.panel));
    default:
      return ROUTER_TOOL_NAMES.includes(name);
  }
}

/**
 * Clean spoken confirmation for a synthesized (degenerate-format) call, so
 * the raw pseudo-syntax never reaches speech or the chat log.
 *
 * @param {string} name - Tool name.
 * @param {object} [args] - Tool args.
 * @param {string} [lang] - 'de' or 'en'.
 * @returns {string} Short confirmation in the user language.
 */
export function synthRouterSay(name, args = {}, lang = 'en') {
  const de = lang === 'de';
  const a = args && typeof args === 'object' ? args : {};
  const q = (v) => String(v ?? '').trim().slice(0, 80);

  if (name === 'track_entity') {
    const target = q(a.query);
    if (/^(?:nearest|nächste|naechste|ein(?:e|en|em|er)?|einen|a|an|any|some)?\s*(?:ander(?:e|en|er|em|es)?|another|others?|different)?\s*(?:satellit(?:e|en|es)?|satelit(?:e|en|es)?|satellite(?:s)?|raumstation|space\s+station)$/i.test(target)) {
      if (/\b(?:ander|another|others?|different)/i.test(target)) {
        return de ? 'Wähle einen anderen Satelliten.' : 'Choosing a different satellite.';
      }
      return de ? 'Verfolge den nächsten Satelliten.' : 'Tracking the nearest satellite.';
    }
    if (target) return de ? `Verfolge ${target}.` : `Tracking ${target}.`;
    return de ? 'Verfolge Kontakt.' : 'Tracking contact.';
  }

  if (name === 'fly_to_location') {
    const where = q(a.query) || q(a.locationId)
      || (Number.isFinite(Number(a.latitude)) ? `${a.latitude}, ${a.longitude}` : '');
    if (where) return de ? `Fliege nach ${where}.` : `Flying to ${where}.`;
    return de ? 'Fliege zum Ort.' : 'Flying to location.';
  }

  if (name === 'annotate_map') {
    const target = q(a.annotations?.[0]?.target) || q(a.target) || q(a.query) || q(a.name) || q(a.location) || q(a.place);
    if (target) return de ? `Zeichne ${target} ein.` : `Marking ${target}.`;
    return de ? 'Zeichne auf der Karte.' : 'Marking the map.';
  }

  if (name === 'control_cctv') {
    const where = q(a.cameraQuery) || q(a.locationQuery) || q(a.query) || q(a.location);
    if (a.action === 'analyze') {
      return where
        ? (de ? `Analysiere Kamerabild in ${where}.` : `Analyzing camera view in ${where}.`)
        : (de ? 'Analysiere aktuelles Kamerabild.' : 'Analyzing current camera view.');
    }
    if (where) return de ? `Öffne Kameras in ${where}.` : `Opening cameras in ${where}.`;
    if (a.action === 'nearest') return de ? 'Springe zur nächsten Kamera.' : 'Jumping to the nearest camera.';
    if (a.action === 'next') return de ? 'Nächste Kamera.' : 'Next camera.';
    if (a.action === 'prev' || a.action === 'previous') return de ? 'Vorherige Kamera.' : 'Previous camera.';
    if (a.action === 'viewshed') return de ? 'Schalte Kamera-Sichtfelder um.' : 'Toggling camera viewsheds.';
    if (a.action === 'coverage') return de ? 'Kameraabdeckung ein.' : 'Camera coverage on.';
    if (a.action === 'disable') return de ? 'Kameras aus.' : 'Cameras off.';
    return de ? 'Kameras ein.' : 'Cameras on.';
  }

  if (name === 'set_layer_visibility') {
    const layer = q(a.layerId);
    const on = a.enabled !== false;
    if (layer === 'cctv') return on ? (de ? 'Kameras ein.' : 'Cameras on.') : (de ? 'Kameras aus.' : 'Cameras off.');
    if (layer === 'drone-attacks') return on ? (de ? 'Drohnenangriffe ein.' : 'Drone attacks on.') : (de ? 'Drohnenangriffe aus.' : 'Drone attacks off.');
    if (layer === 'terror-attacks') return on ? (de ? 'Terroranschläge ein.' : 'Terror attacks on.') : (de ? 'Terroranschläge aus.' : 'Terror attacks off.');
    if (layer === 'missile-strikes') return on ? (de ? 'Raketenangriffe ein.' : 'Missile strikes on.') : (de ? 'Raketenangriffe aus.' : 'Missile strikes off.');
    if (layer === 'bombardments') return on ? (de ? 'Bombardements ein.' : 'Bombardments on.') : (de ? 'Bombardements aus.' : 'Bombardments off.');
    if (layer === 'military-convoys') return on ? (de ? 'Militärkonvois ein.' : 'Military convoys on.') : (de ? 'Militärkonvois aus.' : 'Military convoys off.');
    if (layer === 'missile-tests') return on ? (de ? 'Raketentests ein.' : 'Missile tests on.') : (de ? 'Raketentests aus.' : 'Missile tests off.');
    if (layer === 'frontlines') return on ? (de ? 'Frontlinien ein.' : 'Frontlines on.') : (de ? 'Frontlines aus.' : 'Frontlines off.');
    if (layer === 'conflicts') return on ? (de ? 'Konfliktzonen ein.' : 'Conflict zones on.') : (de ? 'Conflict zones aus.' : 'Conflict zones off.');
    if (layer === 'battles') return on ? (de ? 'Bodenkämpfe ein.' : 'Ground battles on.') : (de ? 'Ground battles aus.' : 'Ground battles off.');
    if (layer === 'campaign-trails') return on ? (de ? 'Wahlkampfrouten ein.' : 'Campaign trails on.') : (de ? 'Wahlkampfrouten aus.' : 'Campaign trails off.');
    if (layer === 'secret-service') return on ? (de ? 'Secret Service Schutz ein.' : 'Secret Service security on.') : (de ? 'Secret Service Schutz aus.' : 'Secret Service security off.');
    if (layer === 'live-osint') return on ? (de ? 'Live OSINT Feed ein.' : 'Live OSINT feed on.') : (de ? 'Live OSINT Feed aus.' : 'Live OSINT feed off.');
    if (layer) return on ? (de ? `Schalte ${layer} ein.` : `Turning ${layer} on.`) : (de ? `Schalte ${layer} aus.` : `Turning ${layer} off.`);
    return on ? (de ? 'Schalte Ebene ein.' : 'Turning layer on.') : (de ? 'Schalte Ebene aus.' : 'Turning layer off.');
  }

  if (name === 'zoom_to_globe') {
    return de ? 'Zoome raus zur Globusansicht.' : 'Zooming out to a globe view.';
  }

  if (name === 'fly_to_nearest_tactical_target') {
    return de ? 'Fliege zum nächsten Einsatzziel.' : 'Flying to tactical target.';
  }

  if (name === 'mark_tactical_impact_zone') {
    return a.zoomIn !== false
      ? (de ? 'Zoome heran und markiere das betroffene Angriffsgebiet.' : 'Zooming in and marking the affected strike zone.')
      : (de ? 'Markiere das betroffene Angriffsgebiet.' : 'Marking the affected strike zone.');
  }

  if (name === 'describe_tactical_event') {
    return de ? 'Rufe Lagebericht und Aufklärungsdaten ab.' : 'Retrieving tactical situation report.';
  }

  if (name === 'query_osint_news') {
    const topic = q(a.query) || q(a.topic) || q(a.location);
    if (topic) return de ? `Frage aktuelle OSINT-Meldungen zu ${topic} ab.` : `Querying latest OSINT news for ${topic}.`;
    return de ? 'Frage aktuelle Telegram OSINT-Meldungen ab.' : 'Querying latest Telegram OSINT dispatches.';
  }

  if (name === 'query_financial_market_impact') {
    return de
      ? 'Analysiere Finanzmärkte und geopolitische Auswirkungen.'
      : 'Analyzing financial markets and geopolitical impact.';
  }

  if (name === 'search_and_forecast_asset') {
    const asset = q(a.query) || q(a.asset) || q(a.symbol) || 'Asset';
    return de
      ? `Erstelle In-Depth Prognose für ${asset}.`
      : `Creating in-depth prognosis for ${asset}.`;
  }

  if (name === 'adjust_camera_zoom') {
    const dir = a.direction === 'out' ? 'out' : 'in';
    return dir === 'out' ? (de ? 'Zoome raus.' : 'Zooming out.') : (de ? 'Zoome ran.' : 'Zooming in.');
  }

  if (name === 'move_camera') {
    if (a.motion === 'stop') return de ? 'Kamera gestoppt.' : 'Camera stopped.';
    if (a.motion === 'orbit') return de ? 'Kreise langsam.' : 'Orbiting slowly.';
    return de ? 'Bewege die Kamera.' : 'Moving the camera.';
  }

  if (name === 'control_cockpit') {
    if (a.action === 'exit' || a.action === 'leave') return de ? 'Verlasse das Cockpit.' : 'Leaving the cockpit.';
    if (a.action === 'next') return de ? 'Nächster Kontakt.' : 'Next contact.';
    if (a.action === 'previous' || a.action === 'prev') return de ? 'Vorheriger Kontakt.' : 'Previous contact.';
    return de ? 'Steige ins Cockpit ein.' : 'Entering the cockpit.';
  }

  if (name === 'select_nearest_aircraft') {
    const isMilitary = a.layerId === 'military';
    if (a.differentFromSelected === true) {
      return de
        ? (isMilitary ? 'Wähle einen anderen Militärflug.' : 'Wähle ein anderes Flugzeug.')
        : (isMilitary ? 'Selecting another military flight.' : 'Selecting another aircraft.');
    }
    return de
      ? (isMilitary ? 'Wähle den nächsten Militärflug.' : 'Wähle das nächste Flugzeug.')
      : (isMilitary ? 'Selecting the nearest military flight.' : 'Selecting the nearest aircraft.');
  }

  if (name === 'frame_overhead') {
    const target = q(a.target || 'flights');
    if (target === 'military') return de ? 'Zeige Militärflüge im Überblick.' : 'Framing military flights overhead.';
    if (target === 'satellites') return de ? 'Zeige Satelliten im Orbit.' : 'Framing satellites overhead.';
    if (target === 'vessels') return de ? 'Zeige Schiffe im Überblick.' : 'Framing vessels.';
    return de ? 'Zeige Flugverkehr im Überblick.' : 'Framing flight traffic overhead.';
  }

  if (name === 'stop_tracking') {
    return de ? 'Verfolgung gestoppt.' : 'Stopped tracking.';
  }

  if (name === 'clear_annotations') {
    return de ? 'Lösche die Karte.' : 'Clearing the map.';
  }

  if (name === 'control_radio') {
    const where = q(a.locationQuery) || q(a.location) || q(a.query);
    if (where) return de ? `Stelle Sender bei ${where} ein.` : `Tuning in near ${where}.`;
    if (a.action === 'stop' || a.action === 'pause') return de ? 'Stoppe das Radio.' : 'Stopping the radio.';
    if (a.action === 'next') return de ? 'Nächster Sender.' : 'Next station.';
    if (a.category === 'news') return de ? 'Spiele Nachrichtenradio.' : 'Playing news radio.';
    return de ? 'Spiele Radio.' : 'Playing the radio.';
  }

  if (name === 'control_scene') {
    if (a.action === 'stop') return de ? 'Stoppe die Szene.' : 'Stopping the scene.';
    if (a.action === 'list') return de ? 'Liste Szenen auf.' : 'Listing scenes.';
    const scene = q(a.sceneId);
    if (scene) return de ? `Spiele ${scene}.` : `Playing ${scene}.`;
    return de ? 'Spiele Szene.' : 'Playing scene.';
  }

  if (name === 'set_visual_style') {
    const style = q(a.style);
    return style ? (de ? `Wechsle zu ${style}.` : `Switching to ${style}.`) : (de ? 'Wechsle Bildstil.' : 'Switching visual style.');
  }

  if (name === 'web_search') {
    const query = q(a.query);
    return query ? (de ? `Suche nach ${query}.` : `Searching for ${query}.`) : (de ? 'Suche im Web.' : 'Searching the web.');
  }

  if (name === 'analyst_query') {
    return de ? 'Analysiere Daten.' : 'Analyzing data.';
  }

  if (name === 'set_hud') {
    if (a.visible === 'off' || a.visible === false) return de ? 'HUD aus.' : 'HUD off.';
    return de ? 'HUD ein.' : 'HUD on.';
  }

  if (name === 'set_map_stack') {
    const stack = q(a.stack);
    return stack ? (de ? `Wechsle zu ${stack}.` : `Switching to ${stack}.`) : (de ? 'Wechsle Kartenansicht.' : 'Switching map.');
  }

  if (name === 'fly_route') {
    return de ? 'Fliege die Route ab.' : 'Flying the route.';
  }

  if (name === 'frame_overhead') {
    const target = q(a.target);
    if (target === 'vessels') return de ? 'Aktiviere Schiffsverkehr und passe Kamera an.' : 'Activating vessels and adjusting view.';
    if (target === 'satellites') return de ? 'Aktiviere Satelliten und passe Kamera an.' : 'Activating satellites and adjusting view.';
    return de ? 'Aktiviere Flugverkehr und zeige Flugzeuge.' : 'Activating flight traffic and framing aircraft.';
  }

  if (name === 'set_panel_open') {
    const panel = q(a.panelId || a.panel);
    const open = a.open !== false;
    if (open) return de ? `Öffne ${panel || 'Panel'}.` : `Opening ${panel || 'panel'}.`;
    return de ? `Schließe ${panel || 'Panel'}.` : `Closing ${panel || 'panel'}.`;
  }

  if (name === 'set_context_mode') {
    const mode = q(a.mode || a.contextMode);
    if (mode === 'off' || mode === 'none') return de ? 'Verlasse Kontext.' : 'Leaving context.';
    return mode ? (de ? `Zeige Kontext ${mode}.` : `Showing ${mode} context.`) : (de ? 'Wechsle Kontextmodus.' : 'Switching context mode.');
  }

  if (name === 'next_iss_pass') {
    return de ? 'Prüfe den nächsten ISS-Überflug.' : 'Checking the next ISS pass.';
  }

  return de ? 'Verstanden, wird ausgeführt.' : 'On it.';
}

/**
 * Extract a human-readable plain-text answer from a brain response.
 * Filters out JSON tool calls and explicit unknown markers, but extracts
 * direct plain text or text enclosed in JSON answer fields.
 *
 * @param {unknown} answer - Raw brain text.
 * @returns {string} Direct plain text answer or empty string.
 */
export function extractDirectAnswer(answer) {
  if (typeof answer !== 'string') return '';
  const text = answer.trim();
  if (!text) return '';

  // If the answer contains Harmony tool call tokens, it's a tool call, not a direct answer.
  if (/\bto=(?:["']?(?:tool|tools|function|functions)\.)([a-z_]{3,40})["']?/i.test(text)) {
    return '';
  }

  const cleaned = text
    .replace(/<\|[\s\S]*?\|>/g, ' ')
    .replace(/```(?:json)?/gi, '')
    .trim();

  let slice = null;
  let parsed = null;
  let searchIdx = 0;
  while (searchIdx < cleaned.length) {
    slice = extractFirstJsonValue(cleaned, searchIdx);
    if (!slice) break;
    try {
      parsed = JSON.parse(slice);
      break;
    } catch {
      const nextOpen = cleaned.indexOf(slice[0], searchIdx);
      searchIdx = nextOpen >= 0 ? nextOpen + 1 : searchIdx + 1;
      slice = null;
    }
  }

  if (slice && parsed) {
    if (parsed?.unknown === true) return '';

    if (Array.isArray(parsed)) {
      const first = parsed[0];
      const isToolName = typeof first === 'string' && Boolean(normalizeRouterToolName(first) || /^[a-z_]{3,40}$/.test(first.trim()));
      let isToolObj = false;
      if (first && typeof first === 'object' && first !== null) {
        const parsedType = typeof first.type === 'string' ? first.type.trim().toLowerCase() : '';
        const isAnnotateType = Boolean(parsedType && ANNOTATION_TYPES.includes(parsedType));
        const firstObjName = typeof first.name === 'string' ? first.name.trim()
          : (typeof first.action === 'string' ? first.action.trim()
            : (typeof first.tool === 'string' ? first.tool.trim()
              : (typeof first.to === 'string' ? first.to.replace(/^(?:tools?|call)\./i, '').trim()
                : (isAnnotateType ? 'annotate_map' : (typeof first.type === 'string' ? first.type.trim() : '')))));
        if (normalizeRouterToolName(firstObjName) || /^[a-z_]{3,40}$/.test(firstObjName)) {
          isToolObj = true;
        }
      }
      if (isToolName || isToolObj) {
        return '';
      }
    } else if (typeof parsed === 'object') {
      const parsedType = typeof parsed?.type === 'string' ? parsed.type.trim().toLowerCase() : '';
      const isAnnotateType = Boolean(parsedType && ANNOTATION_TYPES.includes(parsedType));

      const rawName = typeof parsed?.name === 'string' ? parsed.name.trim()
        : (typeof parsed?.action === 'string' ? parsed.action.trim()
          : (typeof parsed?.tool === 'string' ? parsed.tool.trim()
            : (typeof parsed?.to === 'string' ? parsed.to.replace(/^(?:tools?|call)\./i, '').trim()
              : (isAnnotateType ? 'annotate_map' : (typeof parsed?.type === 'string' ? parsed.type.trim() : '')))));

      if (normalizeRouterToolName(rawName) || /^[a-z_]{3,40}$/.test(rawName || '')) return '';

      if (typeof parsed?.say === 'string' && parsed.say.trim()) return parsed.say.trim();
      if (typeof parsed?.answer === 'string' && parsed.answer.trim()) return parsed.answer.trim();
      if (typeof parsed?.text === 'string' && parsed.text.trim()) return parsed.text.trim();
      if (typeof parsed?.explanation === 'string' && parsed.explanation.trim()) return parsed.explanation.trim();
    }
  }
  return text;
}

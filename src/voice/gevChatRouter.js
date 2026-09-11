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
  'fly_to_location {query | locationId | latitude + longitude as SEPARATE numbers, viewMode?: close|overview} — fly/zoom to a PLACE (resolves pronouns like "diesen Wald"/"dorthin"/"it" from history + scene!). When you know exact coordinates of a famous place, pass latitude and longitude as two separate numbers, never packed into query',
  'adjust_camera_zoom {direction: in|out, amount: little|medium|lot} — relative zoom, no place',
  'zoom_to_globe {} — full Earth view',
  'set_layer_visibility {layerId, enabled} — layers: flights, military, satellites, earthquakes, traffic, cctv, radio, bikeshare, ais-live-vessels, local-firms, local-datacenters, local-dams, telegeography-submarine-cables, rocket-launches',
  'show_data_layers_menu {layerId?} — open the layers menu, optionally highlight one row',
  'set_panel_open {panelId, open} — panels: data-panel, location-bar, control-panel, cctv-panel, radio-panel, scene-panel, pp-toggles, global-context-panel',
  'set_visual_style {style: normal|retro|surveillance|thermal|anime|noir|snow} — night vision=nvg=surveillance, heat=thermal/flir',
  'set_post_processing {bloom?: {enabled, intensityPct}, sharpen?: {enabled, intensityPct}}',
  'control_cockpit {action: enter|exit|next|previous} — ride/ditch the tracked plane',
  'select_nearest_aircraft {layerId: flights|military} — nearest plane + follow',
  'track_entity {query} — follow a plane/ship/satellite/fire by name or description ("fire" = strongest fire; "Mark Rober satellite" = SATGUS; "Hubble" = HST). Use this for ANY satellite/ship/aircraft mention, never fly_to_location',
  'stop_tracking {} — stop following',
  'set_context_mode {mode: off|contacts|space-missions} — contacts roster / missions view',
  'set_hud {visible?: on|off, layout?: tactical|operator|minimal}',
  'set_detection {enabled?, mode?: sparse|balanced|dense, densityPct?} ',
  'set_map_stack {stack: photoreal|bing-aerial|bing-labels|esri-imagery|osm}',
  'get_entity_context {scope?: auto|selected|in_view} — read what is selected/visible (for "what is this" questions answer from it, no navigation)',
  'get_current_view_state {} — read camera/layers/state',
  'control_scene {action: list|play|stop|next, sceneId?}',
  'control_radio {action: enable|disable|play|resume|pause|stop|next|previous|volume|select, category?, locationQuery?}',
  'control_cctv {action: enable|disable|select|next|prev|nearest|focus|coverage|viewshed, cameraQuery?}',
  'annotate_map {annotations: [{type: area|pin|route, target, entityKind?: country|state|city|neighborhood|building|address}], flyTo?: boolean, persist?: boolean} — DRAW, OUTLINE, OR SHOW BOUNDARIES of any country, state, region, city, address, or landmark. When the user asks to draw or outline (e.g. "zeichne X ein", "umrande X", "outline X", "mark borders of X"), ALWAYS call annotate_map with type: "area", target: "<clean place name>", and flyTo: true.',
  'clear_annotations {} — ONLY on explicit clear asks',
  'analyst_query {layers, scope?, filters?, sortBy?, limit?} — COUNT/LIST questions over live data (never navigates)',
  'move_camera {motion: orbit|pan|tilt|rotate|stop, direction?, speed?} — orbit/rotate the view',
  'frame_overhead {target: flights|military|satellites|vessels} — show traffic overhead',
  'fly_route {} — fly the drawn route',
  'next_iss_pass {} — when is the ISS overhead next',
  'web_search {query} — look up a FACT on the web (tallest building, biggest X, population, events) when you do not reliably know it; you get sourced results back, then make the map call',
]);

/** System prompt for routing turns. */
export const ROUTER_SYSTEM_PROMPT = [
  'You translate user utterances for a live 3D globe app into map-tool calls or direct answers.',
  'Use the conversation history to resolve pronouns and references ("seine Insel", "dorthin", "it", "there") to the real place or thing meant.',
  '1. MAP ACTIONS: Pick the single best tool from the menu. Prefer navigation with a real place name over relative moves when a place is meant.',
  'When the user asks to draw, outline, or show boundaries of any place, country, state, region, island, city, or address (e.g. "zeichne ... ein", "umrande ...", "outline ..."), ALWAYS use annotate_map with type: "area" and flyTo: true. Translate colloquial nicknames or German place names to standard international/English names if helpful (e.g. "Epsteins Insel" -> "Epstein Island" or "Little Saint James", "Osterinsel" -> "Easter Island").',
  '"Zoom into X / zoome in X rein" with a named or previously mentioned place means fly_to_location with viewMode close, not a relative nudge. World-famous buildings resolve directly worldwide (not just one island): map German names to canonical English ones (e.g. "Eiffelturm" -> "Eiffel Tower, Paris", "Freiheitsstatue" -> "Statue of Liberty", "Kölner Dom" -> "Cologne Cathedral", "Brandenburger Tor" -> "Brandenburg Gate", "Epsteins bekanntes Gebäude / Tempel" -> "Epstein temple"). When you know exact coordinates of a famous place, prefer latitude + longitude as two separate numbers.',
  'TRACKABLE ENTITIES (satellites, ships, aircraft — never geocode these!): when the utterance names a satellite ("Satellit", "satellite", "ISS", "Mark Robers Satellit", "Hubble", "Webb"), a ship ("Schiff", "ship", "vessel"), or an aircraft ("Flugzeug", "plane", "Flieger"), ALWAYS use track_entity with the plain name as query — never fly_to_location. Famous mappings: "Mark Robers Satellit / Mark Rober satellite" -> query "SATGUS", "Hubble" -> "HST", "James Webb" -> "JWST". The layer enables itself.',
  'SHOW + DRAW COMBOS ("zeig mir X und zeichne es ein", "show me X and mark it"): use ONE annotate_map call with flyTo: true — it flies there AND draws. Always use the canonical English place name as target (e.g. "Frühwarnsystem mit Kuppeln in Australien" -> target "Joint Defence Facility Pine Gap", never a made-up phrase like "Frühwarnsystem bei Jervis Bay"). If you are unsure which place is meant, ask briefly instead of guessing a target.',
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
  const clean = String(text || '').trim().slice(0, 300);
  const scene = String(sceneContext || '').trim().slice(0, 800);
  const parts = [];
  if (history) parts.push(`Conversation so far:\n${history}`);
  if (scene) parts.push(`Current scene (camera place, selection, layers):\n${scene}`);
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
  return `${context}${sceneBlock}The place lookup for "${clean}" found nothing. Reply with ONLY JSON: {"query": "<corrected searchable place name>"} — fix typos (shenzen→Shenzhen), resolve pronouns/demonstratives ("diesen Wald", "dorthin", "it") from history first and scene second, prefer English OpenStreetMap names. If it is unmappable, reply exactly {"unknown": true}.`;
}

/**
 * Extract a corrected place name from a brain answer.
 *
 * @param {unknown} answer - Raw brain text.
 * @returns {{query:string}|{unknown:true}|null} Fix, explicit unknown, or null.
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
  const query = [parsed.query, parsed.place, parsed.location]
    .map((value) => (typeof value === 'string' ? value.trim().slice(0, 160) : ''))
    .find((value) => value);
  return query ? { query } : null;
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
export function extractRouterCall(answer) {
  if (typeof answer !== 'string') return null;
  const cleaned = answer.replace(/```(?:json)?/gi, '').trim();
  const slice = extractFirstJsonObject(cleaned);
  if (!slice) return null;
  let parsed = null;
  try {
    parsed = JSON.parse(slice);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  if (parsed.unknown === true) return { unknown: true };
  const rawName = typeof parsed.name === 'string' ? parsed.name
    : (typeof parsed.type === 'string' ? parsed.type : '')
      || (typeof parsed.tool === 'string' ? parsed.tool : '');
  if (!/^[a-z_]{3,40}$/.test(rawName)) return null;
  const argsContainer = parsed.args && typeof parsed.args === 'object' && !Array.isArray(parsed.args) ? parsed.args
    : parsed.params && typeof parsed.params === 'object' && !Array.isArray(parsed.params) ? parsed.params
      : parsed.parameters && typeof parsed.parameters === 'object' && !Array.isArray(parsed.parameters) ? parsed.parameters
        : parsed.arguments && typeof parsed.arguments === 'object' && !Array.isArray(parsed.arguments) ? parsed.arguments
          : null;
  let args = argsContainer;
  if (!args) {
    // {"type": "track_entity", "query": "X"} → args are the top-level rest.
    const { name: _name, type: _type, tool: _tool, say: _say, unknown: _unknown, args: _args, params: _params, parameters: _parameters, ...rest } = parsed;
    void _args; void _params; void _parameters;
    args = rest;
  }
  return { name: rawName, args, say: typeof parsed.say === 'string' ? parsed.say.slice(0, 200) : '' };
}

/**
 * Known tool names, derived from the menu (each line starts with `name {...}`).
 * Used to spot degenerate pseudo-format calls like
 * `fly_to_location { "query": "Jervis Bay" }` that small models emit instead
 * of the {"name","args"} envelope.
 */
export const ROUTER_TOOL_NAMES = Object.freeze(ROUTER_TOOLS.map((line) => String(line).split(' ')[0]));

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
  let depth = 0;
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
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
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
  const cleaned = answer.replace(/```(?:json)?/gi, ' ');
  let best = null;
  for (const tool of ROUTER_TOOL_NAMES) {
    const at = cleaned.search(new RegExp(`\\b${tool}\\b`));
    if (at >= 0 && (!best || at < best.index)) best = { tool, index: at };
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
      // annotateMap itself also accepts a flat args.name as the target.
      return list.length > 0 || Boolean(str(a.target) || str(a.query) || str(a.location) || str(a.place) || str(a.entity) || str(a.name));
    }
    case 'adjust_camera_zoom':
      return Boolean(str(a.direction));
    case 'move_camera':
      return Boolean(str(a.motion));
    case 'set_layer_visibility':
      return Boolean(str(a.layerId));
    case 'set_visual_style':
      return Boolean(str(a.style));
    default:
      return true;
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
  if (name === 'track_entity' && q(a.query)) {
    return de ? `Verfolge ${q(a.query)}.` : `Tracking ${q(a.query)}.`;
  }
  if (name === 'fly_to_location') {
    const where = q(a.query) || q(a.locationId)
      || (Number.isFinite(Number(a.latitude)) ? `${a.latitude}, ${a.longitude}` : '');
    if (where) return de ? `Fliege nach ${where}.` : `Flying to ${where}.`;
  }
  if (name === 'annotate_map') {
    // Flat tool/params shapes carry the target in `name`.
    const target = q(a.annotations?.[0]?.target) || q(a.target) || q(a.query) || q(a.name);
    if (target) return de ? `Zeichne ${target} ein.` : `Marking ${target}.`;
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
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();
  const slice = extractFirstJsonObject(cleaned);
  if (slice) {
    try {
      const parsed = JSON.parse(slice);
      if (parsed?.unknown === true) return '';
      const rawName = typeof parsed?.name === 'string' ? parsed.name
        : (typeof parsed?.type === 'string' ? parsed.type : '');
      if (/^[a-z_]{3,40}$/.test(rawName || '')) return '';
      if (typeof parsed?.say === 'string' && parsed.say.trim()) return parsed.say.trim();
      if (typeof parsed?.answer === 'string' && parsed.answer.trim()) return parsed.answer.trim();
      if (typeof parsed?.text === 'string' && parsed.text.trim()) return parsed.text.trim();
      if (typeof parsed?.explanation === 'string' && parsed.explanation.trim()) return parsed.explanation.trim();
    } catch {
      // Not valid JSON, fall through to raw text
    }
  }
  return text;
}

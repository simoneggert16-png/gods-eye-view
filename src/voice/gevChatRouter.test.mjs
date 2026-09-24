import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPlaceFixMessage,
  buildRouterHistory,
  buildRouterMessage,
  extractDegenerateRouterCall,
  extractDirectAnswer,
  extractFirstJsonObject,
  extractFirstJsonValue,
  extractPlaceFix,
  extractRouterCall,
  hasReferenceWords,
  isCompleteRouterCall,
  normalizeRouterToolName,
  ROUTER_SYSTEM_PROMPT,
  ROUTER_TOOL_NAMES,
  ROUTER_TOOLS,
  synthRouterSay,
} from './gevChatRouter.js';

test('extractDirectAnswer extracts plain text, json say/answer, and skips tool calls or unknowns', () => {
  assert.equal(
    extractDirectAnswer('Die Farbe kommt vom flachen Wasser der Bahama-Bänke.'),
    'Die Farbe kommt vom flachen Wasser der Bahama-Bänke.',
  );
  assert.equal(
    extractDirectAnswer('{"say": "Turquoise Wasser zeigt flache Gewässer an."}'),
    'Turquoise Wasser zeigt flache Gewässer an.',
  );
  assert.equal(
    extractDirectAnswer('```json\n{"answer": "Das ist Korallensand."}\n```'),
    'Das ist Korallensand.',
  );
  // Tool calls must NOT be treated as direct text answers:
  assert.equal(
    extractDirectAnswer('{"name": "fly_to_location", "args": {"query": "Miami"}, "say": "Fliege hin"}'),
    '',
  );
  // Explicit unknown must NOT be treated as direct text answers:
  assert.equal(extractDirectAnswer('{"unknown": true}'), '');
  assert.equal(extractDirectAnswer(''), '');
  assert.equal(extractDirectAnswer(null), '');
});

test('router prompt carries the tool menu', () => {
  assert.ok(ROUTER_SYSTEM_PROMPT.includes('fly_to_location'));
  assert.ok(ROUTER_SYSTEM_PROMPT.includes('{"name"'));
  assert.equal(ROUTER_TOOLS.length, 35, 'router menu covers every voice tool — update with the registry');
  assert.ok(ROUTER_TOOLS.some((line) => line.startsWith('query_osint_news')));
  assert.ok(ROUTER_TOOLS.some((line) => line.startsWith('query_financial_market_impact')));
  assert.ok(ROUTER_TOOLS.some((line) => line.startsWith('search_and_forecast_asset')));
  assert.ok(ROUTER_TOOLS.some((line) => line.startsWith('fly_to_location')));
  assert.ok(
    ROUTER_SYSTEM_PROMPT.includes('GENERIC / NEAREST AIRCRAFT'),
    'generic plane requests must be routed to nearest-aircraft selection, not identity search',
  );
  assert.ok(
    ROUTER_TOOLS.some((line) => line.startsWith('select_nearest_aircraft') && line.includes('generic')),
    'the nearest-aircraft tool must explicitly own generic requests',
  );
  assert.ok(
    ROUTER_SYSTEM_PROMPT.includes('GENERIC / NEAREST SATELLITE'),
    'generic satellite requests must route to nearest-satellite tracking',
  );
  assert.ok(ROUTER_SYSTEM_PROMPT.includes('Sateliten'), 'the common one-l misspelling is covered');
  assert.ok(
    ROUTER_SYSTEM_PROMPT.includes('NEAREST-AIRCRAFT PLACES:'),
    'place-qualified aircraft requests must bind locationQuery before execution',
  );
  assert.ok(
    ROUTER_SYSTEM_PROMPT.includes('differentFromSelected:true'),
    'another/next aircraft follow-ups must exclude the current selection',
  );
  assert.ok(
    ROUTER_SYSTEM_PROMPT.includes('SELECTED OBJECT QUESTIONS:'),
    'questions about the selected object must call get_entity_context first',
  );
});

test('router prompt resolves deictics and worldwide landmarks', () => {
  assert.ok(ROUTER_SYSTEM_PROMPT.includes('diesen Wald'), 'deictic example guides Ollama');
  assert.ok(ROUTER_SYSTEM_PROMPT.includes('Eiffelturm'), 'worldwide landmark example guides Ollama');
  assert.ok(ROUTER_SYSTEM_PROMPT.includes('NEVER geocode the demonstrative'), 'no literal geocode of diesen/diese');
  const fix = buildPlaceFixMessage('diesen Wald', [{ who: 'you', text: 'zeig mir den Schwarzwald' }], 'Black Forest view');
  assert.ok(fix.includes('Schwarzwald'), 'history disambiguates');
  assert.ok(fix.includes('Black Forest view'), 'scene grounds the retry');
});

test('history compresses to short YOU/APP/AI lines, newest wins', () => {
  const history = buildRouterHistory([
    { who: 'you', text: 'zeig mir epstein island' },
    { who: 'app', text: 'Fliege nach epstein island.' },
    { who: 'gemini', text: 'Flying there.' },
    { who: 'zai', text: 'Done.' },
    { who: 'hacker', text: 'x' },
  ]);
  assert.ok(history.includes('YOU: zeig mir epstein island'));
  assert.ok(history.includes('APP: Fliege nach epstein island.'));
  assert.ok(history.includes('AI: Flying there.'));
  const msg = buildRouterMessage('zoome in seine insel rein', [
    { who: 'you', text: 'zeig mir epstein island' },
  ]);
  assert.ok(msg.includes('seine insel'));
  assert.ok(msg.includes('epstein island'));
});

test('router extraction tolerates prose and fences, strict on shape', () => {
  const good = extractRouterCall('Klar! {"name": "fly_to_location", "args": {"query": "epstein island", "viewMode": "close"}, "say": "Zoome rein."} Fertig.');
  assert.deepEqual(good, { name: 'fly_to_location', args: { query: 'epstein island', viewMode: 'close' }, say: 'Zoome rein.' });

  const fenced = extractRouterCall('```json\n{"name":"zoom_to_globe","args":{}}\n```');
  assert.equal(fenced.name, 'zoom_to_globe');
  assert.equal(fenced.say, '');

  assert.deepEqual(extractRouterCall('{"unknown": true} dazu noch text'), { unknown: true });
  assert.equal(extractRouterCall('kein json hier'), null);
  assert.equal(extractRouterCall('{"name": "EVIL TOOL!"}'), null);
  assert.equal(extractRouterCall('{"name": 42}'), null);
  assert.equal(extractRouterCall(null), null);
});

test('router passes coordinates straight through for the brain', () => {
  const routed = extractRouterCall('{"name": "fly_to_location", "args": {"latitude": 22.54, "longitude": 114.05}, "say": "Fliege hin."}');
  assert.deepEqual(routed.args, { latitude: 22.54, longitude: 114.05 });
});

test('place fixes extract a corrected name or honest unknown', () => {  assert.deepEqual(
    extractPlaceFix('Meintest du: {"query": "Shenzhen, China"}?'),
    { query: 'Shenzhen, China' },
  );
  assert.deepEqual(extractPlaceFix('{"place": "Diepoldsau"}'), { query: 'Diepoldsau' });
  assert.deepEqual(extractPlaceFix('{"unknown": true}'), { unknown: true });
  assert.equal(extractPlaceFix('no json at all'), null);
  assert.equal(extractPlaceFix('{"query": 42}'), null);
  assert.equal(extractPlaceFix(null), null);
});

test('router prompt routes entities to tracking and show+draw to annotate', () => {
  assert.ok(ROUTER_SYSTEM_PROMPT.includes('SATGUS'), 'Mark Rober satellite mapping guides Ollama');
  assert.ok(ROUTER_SYSTEM_PROMPT.includes('track_entity'), 'entity rule names the tool');
  assert.ok(ROUTER_SYSTEM_PROMPT.includes('never geocode these'), 'satellites/ships/planes stay out of geocode');
  assert.ok(ROUTER_SYSTEM_PROMPT.includes('Joint Defence Facility Pine Gap'), 'Pine Gap example guides Ollama');
  assert.ok(ROUTER_SYSTEM_PROMPT.includes('flyTo: true'), 'show+draw combo uses one annotate call');
  assert.ok(ROUTER_TOOLS.some((line) => line.startsWith('track_entity') && line.includes('SATGUS')));
});

test('router calls survive small-model format drift', () => {
  // {"type": ...} instead of {"name": ..., "args": {...}}
  assert.deepEqual(
    extractRouterCall('```json { "type": "track_entity", "query": "Mark Rober Satellite" } ```'),
    { name: 'track_entity', args: { query: 'Mark Rober Satellite' }, say: '' },
  );
  // Two JSON objects: the FIRST call wins, the parse must not span both.
  const two = extractRouterCall('```json { "type": "track_entity", "query": "Mark Rober Satellite" } ``` ```json { "type": "fly_to_location", "query": "Area 51" } ```');
  assert.equal(two?.name, 'track_entity');
  assert.deepEqual(two?.args, { query: 'Mark Rober Satellite' });
  // Balanced scan ignores braces inside strings.
  assert.equal(extractFirstJsonObject('x {"a": "} {"} y'), '{"a": "} {"}');
  assert.equal(extractFirstJsonObject('no braces'), null);
  assert.equal(extractFirstJsonObject('{"open": true'), null);
  // Degenerate bare-tool format: `fly_to_location { ... }`
  assert.deepEqual(
    extractDegenerateRouterCall('``` \nfly_to_location\n{ "query": "Jervis Bay", "viewMode": "close" }\n```'),
    { name: 'fly_to_location', args: { query: 'Jervis Bay', viewMode: 'close' }, say: '' },
  );
  assert.equal(extractDegenerateRouterCall('just prose, no tool'), null);
  assert.equal(ROUTER_TOOL_NAMES.length, 35);
  assert.ok(ROUTER_TOOL_NAMES.includes('query_osint_news'));
  assert.ok(ROUTER_TOOL_NAMES.includes('query_financial_market_impact'));
  assert.ok(ROUTER_TOOL_NAMES.includes('search_and_forecast_asset'));
  assert.ok(ROUTER_TOOL_NAMES.includes('track_entity'));
  assert.ok(ROUTER_TOOL_NAMES.includes('mark_tactical_impact_zone'));
  assert.ok(ROUTER_TOOL_NAMES.includes('fly_to_nearest_tactical_target'));
  assert.ok(ROUTER_TOOL_NAMES.includes('describe_tactical_event'));
  assert.ok(ROUTER_TOOL_NAMES.includes('web_search'), 'the model can look facts up itself');
});

test('tool/params envelopes parse like name/args envelopes', () => {
  assert.deepEqual(
    extractRouterCall('```json { "tool": "annotate_map", "params": { "type": "area", "name": "Washington Monument", "latitude": 38.8895, "longitude": -77.0353, "flyTo": true } } ```'),
    {
      name: 'annotate_map',
      args: { type: 'area', name: 'Washington Monument', latitude: 38.8895, longitude: -77.0353, flyTo: true },
      say: '',
    },
  );
  assert.equal(isCompleteRouterCall('annotate_map', { name: 'Washington Monument', latitude: 38.8895 }), true);
  assert.equal(
    synthRouterSay('annotate_map', { type: 'area', name: 'Washington Monument' }, 'en'),
    'Marking Washington Monument.',
  );
});

test('incomplete brain calls are rejected before execution', () => {
  assert.equal(isCompleteRouterCall('fly_to_location', {}), false);
  assert.equal(isCompleteRouterCall('fly_to_location', { query: 'Paris' }), true);
  assert.equal(isCompleteRouterCall('fly_to_location', { latitude: 48.8, longitude: 2.3 }), true);
  assert.equal(isCompleteRouterCall('track_entity', {}), false);
  assert.equal(isCompleteRouterCall('track_entity', { query: 'SATGUS' }), true);
  assert.equal(isCompleteRouterCall('annotate_map', {}), false);
  assert.equal(isCompleteRouterCall('annotate_map', { annotations: [{ type: 'area', target: 'Pine Gap' }] }), true);
  assert.equal(synthRouterSay('track_entity', { query: 'SATGUS' }, 'de'), 'Verfolge SATGUS.');
  assert.equal(synthRouterSay('track_entity', { query: 'nearest satellite' }, 'de'), 'Verfolge den nächsten Satelliten.');
  assert.equal(synthRouterSay('track_entity', { query: 'einen Sateliten' }, 'en'), 'Tracking the nearest satellite.');
  assert.equal(
    synthRouterSay('track_entity', { query: 'ein anderer Satellit' }, 'de'),
    'Wähle einen anderen Satelliten.',
  );
  assert.equal(
    synthRouterSay('track_entity', { query: 'another satellite' }, 'en'),
    'Choosing a different satellite.',
  );
  assert.equal(synthRouterSay('fly_to_location', { query: 'Jervis Bay' }, 'de'), 'Fliege nach Jervis Bay.');
  assert.equal(synthRouterSay('fly_to_location', { query: 'Paris' }, 'en'), 'Flying to Paris.');
});

test('reference words catch pronouns, never real names', () => {
  for (const text of ['seine Insel', 'fliege dorthin', 'track that plane', 'markiere es', 'take me there', 'zeig mir diesen Ort', 'zoome in diesen Wald rein', 'dieses Gebäude', 'dieser Turm']) {
    assert.equal(hasReferenceWords(text), true, text);
  }
  for (const text of ['Tokyo', 'Epstein island', 'Shenzhen', 'Texas', 'take me to Paris', 'Stuttgart', 'Eiffelturm', 'Schwarzwald']) {
    assert.equal(hasReferenceWords(text), false, text);
  }
});

test('router message carries scene context', () => {
  const msg = buildRouterMessage('dorthin', [], 'Austin, Texas');
  assert.ok(msg.includes('Austin, Texas'));
  assert.ok(msg.includes('dorthin'));
});

test('extractRouterCall parses action envelopes, parameters container, and to field', () => {
  // Small/Ollama model: {"action": "annotate_map", "parameters": {...}}
  const actionCall = extractRouterCall('```json\n{"action": "annotate_map", "parameters": {"target": "Berlin", "type": "area"}}\n```');
  assert.deepEqual(actionCall, {
    name: 'annotate_map',
    args: { target: 'Berlin', type: 'area' },
    say: '',
  });

  // Action with arguments container
  const argsCall = extractRouterCall('{"action": "fly_to_location", "arguments": {"query": "Munich"}}');
  assert.deepEqual(argsCall, {
    name: 'fly_to_location',
    args: { query: 'Munich' },
    say: '',
  });

  // Action with params container
  const paramsCall = extractRouterCall('{"action": "track_entity", "params": {"query": "ISS"}}');
  assert.deepEqual(paramsCall, {
    name: 'track_entity',
    args: { query: 'ISS' },
    say: '',
  });

  // to field: {"to": "tool.annotate_map", "target": "Rome"}
  const toCall = extractRouterCall('{"to": "tool.annotate_map", "target": "Rome"}');
  assert.deepEqual(toCall, {
    name: 'annotate_map',
    args: { target: 'Rome' },
    say: '',
  });
});

test('extractRouterCall maps type area, pin, route, point to annotate_map tool', () => {
  // type: "area" without name or action becomes annotate_map with type: 'area' preserved
  const areaCall = extractRouterCall('{"type": "area", "target": "Black Forest"}');
  assert.deepEqual(areaCall, {
    name: 'annotate_map',
    args: { type: 'area', target: 'Black Forest' },
    say: '',
  });

  // type: "pin"
  const pinCall = extractRouterCall('{"type": "pin", "target": "Big Ben"}');
  assert.deepEqual(pinCall, {
    name: 'annotate_map',
    args: { type: 'pin', target: 'Big Ben' },
    say: '',
  });

  // type: "route"
  const routeCall = extractRouterCall('{"type": "route", "points": [{"target": "A"}, {"target": "B"}]}');
  assert.deepEqual(routeCall, {
    name: 'annotate_map',
    args: { type: 'route', points: [{ target: 'A' }, { target: 'B' }] },
    say: '',
  });

  // type: "point"
  const pointCall = extractRouterCall('{"type": "point", "target": "Colosseum"}');
  assert.deepEqual(pointCall, {
    name: 'annotate_map',
    args: { type: 'point', target: 'Colosseum' },
    say: '',
  });
});

test('extractRouterCall strips Ollama/Harmony tokens and extracts to=tool.<name>', () => {
  const harmony = '<|start|>assistant<|channel|>commentary to=tool.annotate_map <|constrain|>json<|message|>{"query":"Paris"}';
  const routed = extractRouterCall(harmony);
  assert.deepEqual(routed, {
    name: 'annotate_map',
    args: { query: 'Paris' },
    say: '',
  });

  const harmonyWithCall = '<|start|><|call|>to="tool.fly_to_location"<|message|>{"query":"London"}';
  const routedCall = extractRouterCall(harmonyWithCall);
  assert.deepEqual(routedCall, {
    name: 'fly_to_location',
    args: { query: 'London' },
    say: '',
  });
});

test('extractDirectAnswer never returns tool calls across action, tool, to, type, and harmony tokens', () => {
  assert.equal(extractDirectAnswer('{"action": "annotate_map", "parameters": {"target": "Berlin"}}'), '');
  assert.equal(extractDirectAnswer('{"tool": "fly_to_location", "args": {"query": "London"}}'), '');
  assert.equal(extractDirectAnswer('{"to": "tool.control_cctv", "args": {"action": "enable"}}'), '');
  assert.equal(extractDirectAnswer('{"type": "area", "target": "Black Forest"}'), '');
  assert.equal(extractDirectAnswer('<|start|>assistant<|channel|>commentary to=tool.annotate_map <|constrain|>json<|message|>{"query":"Paris"}'), '');
});

test('router prompt guides camera / CCTV place requests', () => {
  assert.ok(ROUTER_SYSTEM_PROMPT.includes('kamera in X'));
  assert.ok(ROUTER_SYSTEM_PROMPT.includes('control_cctv'));
});

test('synthRouterSay produces rich German and English confirmations for all tools', () => {
  // control_cctv
  assert.equal(synthRouterSay('control_cctv', { cameraQuery: 'London' }, 'de'), 'Öffne Kameras in London.');
  assert.equal(synthRouterSay('control_cctv', { cameraQuery: 'London' }, 'en'), 'Opening cameras in London.');
  assert.equal(synthRouterSay('control_cctv', { action: 'nearest' }, 'de'), 'Springe zur nächsten Kamera.');
  assert.equal(synthRouterSay('control_cctv', { action: 'nearest' }, 'en'), 'Jumping to the nearest camera.');
  assert.equal(synthRouterSay('control_cctv', { action: 'next' }, 'de'), 'Nächste Kamera.');
  assert.equal(synthRouterSay('control_cctv', { action: 'prev' }, 'de'), 'Vorherige Kamera.');
  assert.equal(synthRouterSay('control_cctv', { action: 'viewshed' }, 'de'), 'Schalte Kamera-Sichtfelder um.');
  assert.equal(synthRouterSay('control_cctv', { action: 'enable' }, 'de'), 'Kameras ein.');
  assert.equal(synthRouterSay('control_cctv', { action: 'disable' }, 'de'), 'Kameras aus.');

  // other tools
  assert.equal(synthRouterSay('set_layer_visibility', { layerId: 'cctv', enabled: true }, 'de'), 'Kameras ein.');
  assert.equal(synthRouterSay('set_layer_visibility', { layerId: 'flights', enabled: true }, 'en'), 'Turning flights on.');
  assert.equal(synthRouterSay('zoom_to_globe', {}, 'de'), 'Zoome raus zur Globusansicht.');
  assert.equal(synthRouterSay('zoom_to_globe', {}, 'en'), 'Zooming out to a globe view.');
  assert.equal(synthRouterSay('adjust_camera_zoom', { direction: 'out' }, 'de'), 'Zoome raus.');
  assert.equal(synthRouterSay('adjust_camera_zoom', { direction: 'in' }, 'en'), 'Zooming in.');
  assert.equal(synthRouterSay('move_camera', { motion: 'stop' }, 'de'), 'Kamera gestoppt.');
  assert.equal(synthRouterSay('move_camera', { motion: 'orbit' }, 'en'), 'Orbiting slowly.');
  assert.equal(synthRouterSay('control_cockpit', { action: 'exit' }, 'de'), 'Verlasse das Cockpit.');
  assert.equal(synthRouterSay('control_cockpit', { action: 'next' }, 'en'), 'Next contact.');
  assert.equal(synthRouterSay('select_nearest_aircraft', {}, 'de'), 'Wähle das nächste Flugzeug.');
  assert.equal(synthRouterSay('stop_tracking', {}, 'de'), 'Verfolgung gestoppt.');
  assert.equal(synthRouterSay('clear_annotations', {}, 'de'), 'Lösche die Karte.');
  assert.equal(synthRouterSay('control_radio', { locationQuery: 'Austin' }, 'de'), 'Stelle Sender bei Austin ein.');
  assert.equal(synthRouterSay('control_radio', { locationQuery: 'Austin' }, 'en'), 'Tuning in near Austin.');
  assert.equal(synthRouterSay('control_scene', { sceneId: 'Orbital Watch' }, 'de'), 'Spiele Orbital Watch.');
  assert.equal(synthRouterSay('web_search', { query: 'tallest building' }, 'en'), 'Searching for tallest building.');
  assert.equal(synthRouterSay('analyst_query', {}, 'de'), 'Analysiere Daten.');
});

test('isCompleteRouterCall handles control_cctv requirements and rejects unknown tools', () => {
  assert.equal(isCompleteRouterCall('control_cctv', {}), false);
  assert.equal(isCompleteRouterCall('control_cctv', { action: 'enable' }), true);
  assert.equal(isCompleteRouterCall('control_cctv', { cameraQuery: 'London' }), true);
  assert.equal(isCompleteRouterCall('control_cctv', { locationQuery: 'Berlin' }), true);
  assert.equal(isCompleteRouterCall('cam', {}), false);
  assert.equal(isCompleteRouterCall('unknown_garbage_tool', {}), false);
});

test('normalizeRouterToolName and extractRouterCall map cam and camera aliases to control_cctv', () => {
  assert.equal(normalizeRouterToolName('cam'), 'control_cctv');
  assert.equal(normalizeRouterToolName('camera'), 'control_cctv');
  assert.equal(normalizeRouterToolName('cctv'), 'control_cctv');
  assert.equal(normalizeRouterToolName('fly_to'), 'fly_to_location');
  assert.equal(normalizeRouterToolName('zoom'), 'adjust_camera_zoom');
  assert.equal(normalizeRouterToolName('track'), 'track_entity');
  assert.equal(normalizeRouterToolName('totally_fake'), '');

  // Ollama emitting {"action": "cam", "location": "tower bridge in london"}
  const call1 = extractRouterCall('{"action": "cam", "location": "tower bridge in london"}');
  assert.equal(call1.name, 'control_cctv');
  assert.equal(call1.args.action, 'select');
  assert.equal(call1.args.cameraQuery, 'tower bridge in london');

  // Ollama emitting {"tool": "camera", "args": {"query": "London"}}
  const call2 = extractRouterCall('{"tool": "camera", "args": {"query": "London"}}');
  assert.equal(call2.name, 'control_cctv');
  assert.equal(call2.args.action, 'select');
  assert.equal(call2.args.cameraQuery, 'London');

  // Degenerate format: cam { "location": "London" }
  const call3 = extractDegenerateRouterCall('cam { "location": "London" }');
  assert.equal(call3.name, 'control_cctv');

  // Unknown tool is rejected
  assert.equal(extractRouterCall('{"tool": "completely_unknown_tool_xyz", "args": {}}'), null);
});

test('extractRouterCall parses tuple format tool calls and normalizes destination to query', () => {
  // Primary Diepoldsau case emitted by Ollama
  const diepoldsauCall = extractRouterCall('["fly_to_location", {"name":"Diepoldsau, Switzerland","viewMode":"close","flyTo":true}]');
  assert.deepEqual(diepoldsauCall, {
    name: 'fly_to_location',
    args: {
      name: 'Diepoldsau, Switzerland',
      query: 'Diepoldsau, Switzerland',
      viewMode: 'close',
      flyTo: true,
    },
    say: '',
  });

  // Verification that destination fallback aliases map to query
  assert.equal(
    extractRouterCall('["fly_to_location", {"place": "Zürich"}]')?.args?.query,
    'Zürich',
  );
  assert.equal(
    extractRouterCall('["fly_to_location", {"destination": "Tokyo"}]')?.args?.query,
    'Tokyo',
  );
  assert.equal(
    extractRouterCall('["fly_to_location", {"city": "Berlin"}]')?.args?.query,
    'Berlin',
  );
  assert.equal(
    extractRouterCall('["fly_to_location", {"target": "Matterhorn"}]')?.args?.query,
    'Matterhorn',
  );
  assert.equal(
    extractRouterCall('["fly_to_location", {"location": "Paris"}]')?.args?.query,
    'Paris',
  );

  // Tuple with tool alias (e.g. fly_to)
  const aliasCall = extractRouterCall('["fly_to", {"name": "Sydney", "viewMode": "overview"}]');
  assert.equal(aliasCall?.name, 'fly_to_location');
  assert.equal(aliasCall?.args?.query, 'Sydney');

  // Tuple with markdown code fences
  const fenced = extractRouterCall('```json\n["fly_to_location", {"name": "Geneva"}]\n```');
  assert.equal(fenced?.name, 'fly_to_location');
  assert.equal(fenced?.args?.query, 'Geneva');
});

test('extractRouterCall parses array-of-objects tool call format', () => {
  const arrayCall = extractRouterCall('[{"name": "control_cctv", "args": {"action": "select", "cameraQuery": "London"}}]');
  assert.deepEqual(arrayCall, {
    name: 'control_cctv',
    args: {
      action: 'select',
      cameraQuery: 'London',
    },
    say: '',
  });

  // Array of objects with markdown fence and prose
  const fenced = extractRouterCall('Hier ist das Ergebnis:\n```json\n[{"tool": "fly_to_location", "args": {"location": "Bern"}}]\n```');
  assert.equal(fenced?.name, 'fly_to_location');
  assert.equal(fenced?.args?.query, 'Bern');
});

test('extractDirectAnswer returns empty string for tool arrays and prevents chat leakage', () => {
  // Raw Ollama tuple output must never leak as chat text
  assert.equal(
    extractDirectAnswer('["fly_to_location", {"name":"Diepoldsau, Switzerland","viewMode":"close","flyTo":true}]'),
    '',
  );
  assert.equal(
    extractDirectAnswer('["control_cctv", {"cameraQuery": "London"}]'),
    '',
  );
  assert.equal(
    extractDirectAnswer('[{"name": "control_cctv", "args": {"action": "select", "cameraQuery": "London"}}]'),
    '',
  );
  assert.equal(
    extractDirectAnswer('```json\n["fly_to_location", {"query": "Zurich"}]\n```'),
    '',
  );
  assert.equal(
    extractDirectAnswer('["cam", {"action": "enable"}]'),
    '',
  );
});

test('extractFirstJsonValue extracts both objects and arrays with string and nested brackets', () => {
  // Object with nested array and strings containing braces and brackets
  const obj = 'Leading prose {"key": [1, "two [brackets] and {braces}"], "nested": {"a": "}"}} trailing text';
  assert.equal(
    extractFirstJsonValue(obj),
    '{"key": [1, "two [brackets] and {braces}"], "nested": {"a": "}"}}',
  );

  // Array with nested object and strings containing braces and brackets
  const arr = 'Sure! ["fly_to_location", {"name": "Diepoldsau [CH]", "items": [1, 2, "}"], "flag": true}] done.';
  assert.equal(
    extractFirstJsonValue(arr),
    '["fly_to_location", {"name": "Diepoldsau [CH]", "items": [1, 2, "}"], "flag": true}]',
  );

  // Works with fromIndex
  const multi = 'first [1, 2] second {"hello": "world"}';
  assert.equal(extractFirstJsonValue(multi, 0), '[1, 2]');
  assert.equal(extractFirstJsonValue(multi, 10), '{"hello": "world"}');

  // Handles escaped quotes in strings
  assert.equal(
    extractFirstJsonValue('prefix {"escaped": "foo \\" [bar] {baz} \\" end"} suffix'),
    '{"escaped": "foo \\" [bar] {baz} \\" end"}',
  );

  // Unbalanced or absent returns null
  assert.equal(extractFirstJsonValue('no brackets here'), null);
  assert.equal(extractFirstJsonValue('{"unclosed": [1, 2]'), null);
  assert.equal(extractFirstJsonValue('[1, 2, {"unclosed": true]'), null);
});

test('extractPlaceFix extracts coordinates and place name from AI world knowledge', () => {
  const coordFix = extractPlaceFix('```json\n{"latitude": 34.0788, "longitude": -118.4312, "query": "Sean Combs Mansion"}\n```');
  assert.deepEqual(coordFix, {
    latitude: 34.0788,
    longitude: -118.4312,
    query: 'Sean Combs Mansion',
  });

  const flatFix = extractPlaceFix('{"lat": 25.7781, "lon": -80.1502, "place": "Star Island"}');
  assert.deepEqual(flatFix, {
    latitude: 25.7781,
    longitude: -80.1502,
    query: 'Star Island',
  });

  // Tool calls must NOT be extracted as place fixes
  assert.equal(extractPlaceFix('{"name": "select_nearest_aircraft", "args": {"layerId": "military"}}'), null);
  assert.equal(extractPlaceFix('{"action": "control_cctv", "cameraQuery": "London"}'), null);
});

test('extractRouterCall normalizes coordinates for annotate_map and fly_to_location', () => {
  const routed = extractRouterCall('{"name": "annotate_map", "args": {"annotations": [{"type": "area", "target": "Diddys Villa", "lat": 34.0788, "lon": -118.4312}], "flyTo": true}}');
  assert.equal(routed.name, 'annotate_map');
  assert.equal(routed.args.annotations[0].latitude, 34.0788);
  assert.equal(routed.args.annotations[0].longitude, -118.4312);

  const flyCall = extractRouterCall('{"name": "fly_to_location", "args": {"lat": 34.0788, "lon": -118.4312, "rangeM": 600}}');
  assert.equal(flyCall.name, 'fly_to_location');
  assert.equal(flyCall.args.latitude, 34.0788);
  assert.equal(flyCall.args.longitude, -118.4312);
});




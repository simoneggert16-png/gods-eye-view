import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPlaceFixMessage,
  buildRouterHistory,
  buildRouterMessage,
  extractDegenerateRouterCall,
  extractDirectAnswer,
  extractFirstJsonObject,
  extractPlaceFix,
  extractRouterCall,
  hasReferenceWords,
  isCompleteRouterCall,
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
  assert.equal(ROUTER_TOOLS.length, 29, 'router menu covers every voice tool — update with the registry');
  assert.ok(ROUTER_TOOLS.some((line) => line.startsWith('fly_to_location')));
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
  assert.equal(ROUTER_TOOL_NAMES.length, 29);
  assert.ok(ROUTER_TOOL_NAMES.includes('track_entity'));
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

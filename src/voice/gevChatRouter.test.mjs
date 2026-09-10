import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRouterHistory,
  buildRouterMessage,
  extractPlaceFix,
  extractRouterCall,
  hasReferenceWords,
  ROUTER_SYSTEM_PROMPT,
  ROUTER_TOOLS,
} from './gevChatRouter.js';

test('router prompt carries the tool menu', () => {
  assert.ok(ROUTER_SYSTEM_PROMPT.includes('fly_to_location'));
  assert.ok(ROUTER_SYSTEM_PROMPT.includes('{"name"'));
  assert.equal(ROUTER_TOOLS.length, 28, 'router menu covers every voice tool — update with the registry');
  assert.ok(ROUTER_TOOLS.some((line) => line.startsWith('fly_to_location')));
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

test('reference words catch pronouns, never real names', () => {
  for (const text of ['seine Insel', 'fliege dorthin', 'track that plane', 'markiere es', 'take me there', 'zeig mir diesen Ort']) {
    assert.equal(hasReferenceWords(text), true, text);
  }
  for (const text of ['Tokyo', 'Epstein island', 'Shenzhen', 'Texas', 'take me to Paris', 'Stuttgart']) {
    assert.equal(hasReferenceWords(text), false, text);
  }
});

test('router message carries scene context', () => {
  const msg = buildRouterMessage('dorthin', [], 'Austin, Texas');
  assert.ok(msg.includes('Austin, Texas'));
  assert.ok(msg.includes('dorthin'));
});

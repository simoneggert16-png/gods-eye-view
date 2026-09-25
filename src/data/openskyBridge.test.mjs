import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ADSBLOL_WORLD_HUBS,
  adsbLolPointCacheKey,
  buildOpenSkyBridgeRequest,
  mergeAdsbLolSnapshots,
} from '../../vite.config.js';

test('missing or blank bridge URL disables the bridge path', () => {
  assert.equal(buildOpenSkyBridgeRequest({}), null);
  assert.equal(buildOpenSkyBridgeRequest({ bridgeUrl: '   ' }), null);
  assert.equal(buildOpenSkyBridgeRequest(), null);
});

test('non-HTTPS and unparsable bridge URLs are rejected', () => {
  assert.equal(
    buildOpenSkyBridgeRequest({ bridgeUrl: 'http://bridge.example.com' }),
    null,
    'plain HTTP would leak the bridge token',
  );
  assert.equal(buildOpenSkyBridgeRequest({ bridgeUrl: 'not a url' }), null);
});

test('builds an extended=1 HTTPS request with optional bearer auth', () => {
  const withoutToken = buildOpenSkyBridgeRequest({
    bridgeUrl: 'https://gev-opensky-bridge.you.workers.dev/',
  });
  assert.equal(withoutToken.url, 'https://gev-opensky-bridge.you.workers.dev/?extended=1');
  assert.deepEqual(withoutToken.headers, { Accept: 'application/json' });

  const withToken = buildOpenSkyBridgeRequest({
    bridgeUrl: 'https://gev-opensky-bridge.you.workers.dev',
    bridgeToken: 's3cret',
  });
  assert.equal(withToken.url, 'https://gev-opensky-bridge.you.workers.dev/?extended=1');
  assert.deepEqual(withToken.headers, {
    Accept: 'application/json',
    Authorization: 'Bearer s3cret',
  });
});

test('world hubs cover every inhabited continent with stable cache keys', () => {
  assert.ok(ADSBLOL_WORLD_HUBS.length >= 16, 'land hubs plus oceanic gap-fillers');
  const keys = new Set();
  for (const hub of ADSBLOL_WORLD_HUBS) {
    assert.ok(Number.isFinite(hub.lat) && hub.lat >= -90 && hub.lat <= 90, 'valid latitude');
    assert.ok(Number.isFinite(hub.lon) && hub.lon >= -180 && hub.lon <= 180, 'valid longitude');
    keys.add(adsbLolPointCacheKey(hub.lat, hub.lon));
  }
  assert.equal(keys.size, ADSBLOL_WORLD_HUBS.length, 'no two hubs share a cache disc');
});

test('point cache keys quantize to quarter degrees', () => {
  assert.equal(adsbLolPointCacheKey(48.85, 2.35), '48.75,2.25');
  assert.equal(adsbLolPointCacheKey(48.85, 2.35), adsbLolPointCacheKey(48.8, 2.3));
});

test('snapshot merge de-duplicates by ICAO24 and skips garbage', () => {
  const a = JSON.stringify({ time: 100, states: [['ab12', 'A', null, 1, 1, 0, 0], ['cd34', 'B', null, 1, 1, 1, 1]] });
  const b = JSON.stringify({ time: 120, states: [['AB12', 'A2', null, 2, 2, 0, 0], ['ef56', 'C', null, 2, 2, 2, 2]] });
  const merged = mergeAdsbLolSnapshots([a, b, 'not json', JSON.stringify({ time: 50, states: 'nope' })]);
  assert.equal(merged.time, 120);
  assert.deepEqual(
    merged.states.map((s) => s[0]),
    ['ab12', 'cd34', 'ef56'],
  );
});

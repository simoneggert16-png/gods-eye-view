import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOpenSkyBridgeRequest } from '../../vite.config.js';

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

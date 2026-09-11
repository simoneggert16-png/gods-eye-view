import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { backendSpeedAccelerator } from '../scripts/backendAccelerator.mjs';

function createMockServer() {
  let middleware = null;
  return {
    middlewares: {
      use: (fn) => { middleware = fn; }
    },
    getMiddleware: () => middleware,
  };
}

function createMockReq(url, headers = {}) {
  return {
    url,
    method: 'GET',
    headers,
    socket: { setNoDelay: () => {} },
  };
}

function createMockRes() {
  const headers = {};
  let endData = null;
  let status = 200;
  return {
    statusCode: 200,
    setHeader: (k, v) => { headers[k.toLowerCase()] = String(v); },
    getHeader: (k) => headers[k.toLowerCase()],
    removeHeader: (k) => { delete headers[k.toLowerCase()]; },
    writeHead: function(s, h) {
      status = s;
      if (h) Object.entries(h).forEach(([k, v]) => headers[k.toLowerCase()] = String(v));
      return this;
    },
    write: () => {},
    end: function(data) {
      endData = data;
    },
    getHeaders: () => headers,
    getEndData: () => endData,
    getStatus: () => status,
  };
}

test('backendSpeedAccelerator skips non-api and media streams', () => {
  const plugin = backendSpeedAccelerator();
  const server = createMockServer();
  plugin.configureServer(server);
  const mw = server.getMiddleware();

  let nextCalled = false;
  mw(createMockReq('/assets/index.js'), createMockRes(), () => { nextCalled = true; });
  assert.equal(nextCalled, true);

  nextCalled = false;
  mw(createMockReq('/api/cctv/media/cam1'), createMockRes(), () => { nextCalled = true; });
  assert.equal(nextCalled, true);
});

test('backendSpeedAccelerator gzips large JSON responses when accepted', () => {
  const plugin = backendSpeedAccelerator();
  const server = createMockServer();
  plugin.configureServer(server);
  const mw = server.getMiddleware();

  const req = createMockReq('/api/opensky', { 'accept-encoding': 'gzip, deflate' });
  const res = createMockRes();

  let nextCalled = false;
  mw(req, res, () => {
    nextCalled = true;
    res.setHeader('Content-Type', 'application/json');
    const payload = JSON.stringify({ data: 'A'.repeat(5000) });
    res.end(payload);
  });

  assert.equal(nextCalled, true);
  assert.equal(res.getHeader('content-encoding'), 'gzip');
  assert.ok(Number(res.getHeader('content-length')) < 5000);

  const decompressed = zlib.gunzipSync(res.getEndData()).toString('utf8');
  assert.ok(decompressed.includes('AAAA'));
});

test('backendSpeedAccelerator returns 304 on matching ETag', () => {
  const plugin = backendSpeedAccelerator();
  const server = createMockServer();
  plugin.configureServer(server);
  const mw = server.getMiddleware();

  // First request to get ETag
  const req1 = createMockReq('/api/celestrak/stations');
  const res1 = createMockRes();
  mw(req1, res1, () => {
    res1.setHeader('Content-Type', 'text/plain');
    res1.end('TLE data line 1\nline 2');
  });

  const etag = res1.getHeader('etag');
  assert.ok(etag, 'ETag generated');

  // Second request with If-None-Match
  const req2 = createMockReq('/api/celestrak/stations', { 'if-none-match': etag });
  const res2 = createMockRes();
  mw(req2, res2, () => {
    res2.setHeader('Content-Type', 'text/plain');
    res2.end('TLE data line 1\nline 2');
  });

  assert.equal(res2.getStatus(), 304);
});

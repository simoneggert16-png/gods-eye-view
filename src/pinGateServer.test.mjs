import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pinGateProxy,
  createSignedSessionToken,
  verifySessionToken,
  comparePinSafely,
} from './pinGateServer.js';

test('pinGateProxy is a no-op when GEV_ACCESS_PIN is unset', async () => {
  delete process.env.GEV_ACCESS_PIN;
  const plugin = pinGateProxy();
  const handlers = [];
  const server = { middlewares: { use: (pathOrFn, fn) => handlers.push([pathOrFn, fn]) } };
  plugin.configureServer(server);

  // Status check
  const statusHandler = handlers.find(([p]) => p === '/api/pin/status')[1];
  let written = '';
  const res = {
    writeHead: () => {},
    end: (str) => { written = str; },
  };
  statusHandler({ headers: {} }, res);
  assert.deepEqual(JSON.parse(written), { required: false, authenticated: true });
});

test('pinGateProxy protects endpoints and checks verification when PIN is set', async () => {
  process.env.GEV_ACCESS_PIN = '123456';
  const plugin = pinGateProxy();
  const routes = new Map();
  let interceptor = null;
  const server = {
    middlewares: {
      use: (arg1, arg2) => {
        if (typeof arg1 === 'string') routes.set(arg1, arg2);
        else interceptor = arg1;
      },
    },
  };
  plugin.configureServer(server);

  // 1. Status check
  let statusData = '';
  routes.get('/api/pin/status')({ headers: {} }, { writeHead: () => {}, end: (d) => statusData = d });
  assert.deepEqual(JSON.parse(statusData), { required: true, authenticated: false });

  // 2. Interceptor blocks unauthenticated AI calls
  let intercepted = '';
  let nextCalled = false;
  interceptor(
    { url: '/api/ollama/chat', headers: {} },
    { writeHead: () => {}, end: (d) => intercepted = d },
    () => { nextCalled = true; },
  );
  assert.equal(nextCalled, false);
  assert.match(intercepted, /PIN required/);

  // 3. Interceptor passes with cookie
  let passNext = false;
  interceptor(
    { url: '/api/ollama/chat', headers: { cookie: 'gev_auth=1' } },
    {},
    () => { passNext = true; },
  );
  assert.equal(passNext, true);

  delete process.env.GEV_ACCESS_PIN;
});

test('pinGateServer cryptographic session tokens prevent forgery and console tampering', async () => {
  // 1. Valid token validates
  const token = createSignedSessionToken();
  assert.equal(verifySessionToken(token), true);

  // 2. Tampered signature is rejected
  const [ts, sig] = token.split('.');
  const tamperedSig = sig.slice(0, -2) + (sig.endsWith('a') ? 'b' : 'a');
  assert.equal(verifySessionToken(`${ts}.${tamperedSig}`), false);

  // 3. Forged tokens are rejected
  assert.equal(verifySessionToken('9999999999999.deadbeef12345678'), false);
  assert.equal(verifySessionToken(''), false);
  assert.equal(verifySessionToken(null), false);
  assert.equal(verifySessionToken('gev_auth=true'), false);

  // 4. Constant time PIN comparison
  assert.equal(comparePinSafely('991909', '991909'), true);
  assert.equal(comparePinSafely('991908', '991909'), false);
  assert.equal(comparePinSafely('9919', '991909'), false);
  assert.equal(comparePinSafely('', '991909'), false);
});

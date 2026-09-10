import test from 'node:test';
import assert from 'node:assert/strict';
import { pinGateProxy } from './pinGateServer.js';

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

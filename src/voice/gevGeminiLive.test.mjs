import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGeminiLiveController, createLiveAudioOutput } from './gevGeminiLive.js';

function stubFetchToken({ token = 'ephemeral-test-token', model = 'live-test-model', voice = 'Charon' } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push([url, init?.method]);
    if (String(url).includes('/api/voice/tools')) {
      return { ok: true, status: 200, json: async () => ({ tools: [{ type: 'function', name: 'zoom_to_globe', description: 'Globe view', parameters: { type: 'object', properties: {} } }], count: 1 }) };
    }
    return { ok: true, status: 200, json: async () => ({ token, model, voice, error: null }) };
  };
  return { calls, fetchImpl };
}

function stubSocket() {
  const sent = [];
  const sockets = [];
  function FakeSocket(url) {
    const socket = {
      url,
      readyState: 0,
      sent,
      onopen: null,
      onmessage: null,
      onerror: null,
      onclose: null,
      send: (text) => sent.push(text),
      close: () => { socket.readyState = 3; },
    };
    sockets.push(socket);
    return socket;
  }
  return { sent, sockets, FakeSocket };
}

function stubAudio() {
  const played = [];
  let stops = 0;
  return { played, audioEnv: { playPcm: (base64) => played.push(base64), stop: () => { stops += 1; }, stops: () => stops } };
}

test('live start mints a token, connects and sends setup', async () => {
  const { fetchImpl } = stubFetchToken();
  const { sent, sockets, FakeSocket } = stubSocket();
  const { audioEnv } = stubAudio();
  const controller = createGeminiLiveController({
    runner: async () => ({ ok: true }),
    ui: { detail: { textContent: '' } },
    fetchImpl,
    wsCtor: FakeSocket,
    audioEnv,
    mic: 'off',
    getSceneContext: async () => 'Austin, Texas',
  });
  const started = controller.start();
  assert.equal(controller.isActive(), true);
  await started;
  assert.equal(sockets.length, 1);
  assert.match(sockets[0].url, /access_token=ephemeral-test-token/);
  assert.ok(!sockets[0].url.includes('GEMINI_API_KEY'), 'key never reaches the browser URL');

  sockets[0].readyState = 1;
  sockets[0].onopen();
  // Setup follows on a microtask (scene context resolves async).
  await new Promise((resolve) => setTimeout(resolve, 10));
  const setup = JSON.parse(sent[0]);
  assert.match(setup.setup.model, /live-test/);
  assert.deepEqual(setup.setup.generationConfig.responseModalities, ['AUDIO']);
  assert.ok(setup.setup.systemInstruction.parts[0].text.includes('Austin, Texas'));
  assert.equal(setup.setup.tools[0].functionDeclarations[0].name, 'zoom_to_globe');

  await controller.handleServerFrame(JSON.stringify({ setupComplete: {} }));
  assert.equal(controller.state.sessionReady, true);

  // Typed text goes straight to the model once ready.
  assert.equal(controller.sendText('hello'), true);
  assert.match(sent[1], /hello/);
  controller.stop();
  assert.equal(controller.isActive(), false);
});

test('live transcript runs map commands locally, model voices the result', async () => {
  const { fetchImpl } = stubFetchToken();
  const { sent, sockets, FakeSocket } = stubSocket();
  const seen = [];
  const controller = createGeminiLiveController({
    runner: async (name, args) => { seen.push([name, args]); return { ok: true, action: name }; },
    ui: { detail: { textContent: '' } },
    fetchImpl,
    wsCtor: FakeSocket,
    audioEnv: stubAudio().audioEnv,
    mic: 'off',
    getSceneContext: async () => '',
  });
  await controller.start();
  sockets[0].readyState = 1;
  sockets[0].onopen();
  await new Promise((resolve) => setTimeout(resolve, 10));
  await controller.handleServerFrame(JSON.stringify({ setupComplete: {} }));

  await controller.handleServerFrame(JSON.stringify({
    serverContent: { inputTranscription: { text: 'take me to ' } },
  }));
  await controller.handleServerFrame(JSON.stringify({
    serverContent: { inputTranscription: { text: 'tokyo' }, turnComplete: true },
  }));
  assert.deepEqual(seen, [['fly_to_location', { locationId: 'tokyo' }]]);
  // handleTranscript runs fire-and-forget off the frame handler — poll.
  let narration;
  for (let i = 0; i < 50 && !narration; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    narration = sent.find((text) => text.includes('Executed'));
  }
  assert.ok(narration, 'model gets one text turn to voice the confirmation');
  controller.stop();
});

test('live audio plays, interruption stops it, output text reads out', async () => {
  const { fetchImpl } = stubFetchToken();
  const { sockets, FakeSocket } = stubSocket();
  const stubs = stubAudio();
  const detail = { textContent: '' };
  const controller = createGeminiLiveController({
    runner: async () => ({}),
    ui: { detail },
    fetchImpl,
    wsCtor: FakeSocket,
    audioEnv: stubs.audioEnv,
    mic: 'off',
    getSceneContext: async () => '',
  });
  await controller.start();
  sockets[0].readyState = 1;
  sockets[0].onopen();
  await new Promise((resolve) => setTimeout(resolve, 10));
  await controller.handleServerFrame(JSON.stringify({ setupComplete: {} }));

  await controller.handleServerFrame(JSON.stringify({
    serverContent: { modelTurn: { parts: [{ inlineData: { data: 'AAA=', mimeType: 'audio/pcm;rate=24000' } }] } },
  }));
  assert.deepEqual(stubs.played, ['AAA=']);

  await controller.handleServerFrame(JSON.stringify({ serverContent: { interrupted: true } }));
  assert.equal(stubs.audioEnv.stops(), 1);

  await controller.handleServerFrame(JSON.stringify({ serverContent: { outputTranscription: { text: 'Flying to Tokyo.' } } }));
  assert.match(detail.textContent, /FLYING TO TOKYO/);
  controller.stop();
});

test('unexpected close reconnects with a fresh token, then gives up', async () => {
  const { calls, fetchImpl } = stubFetchToken();
  const { sockets, FakeSocket } = stubSocket();
  const detail = { textContent: '' };
  const controller = createGeminiLiveController({
    runner: async () => ({}),
    ui: { detail },
    fetchImpl,
    wsCtor: FakeSocket,
    audioEnv: stubAudio().audioEnv,
    mic: 'off',
    getSceneContext: async () => '',
  });
  await controller.start();
  const tokenCalls = () => calls.filter(([url]) => String(url).includes('live-token')).length;
  assert.equal(tokenCalls(), 1);
  // Simulate four drops: 3 reconnects, then the tired message.
  for (let i = 0; i < 4; i += 1) {
    const socket = controller.state.socket;
    socket.readyState = 3;
    socket.onclose({ target: socket });
    await new Promise((resolve) => setTimeout(resolve, 2100));
    if (!controller.isActive()) break;
  }
  assert.equal(controller.isActive(), false);
  assert.match(detail.textContent, /RETRY/);
  assert.ok(tokenCalls() >= 2, 'reconnect mints a fresh single-use token');
});

test('live playback schedules pcm chunks gaplessly and stops them', () => {  const startedAt = [];
  let currentTime = 10;
  const sources = [];
  const fakeCtx = {
    get currentTime() { return currentTime; },
    createBuffer: (_ch, len, _rate) => {
      const data = new Float32Array(len);
      return { getChannelData: () => data };
    },
    createBufferSource: () => {
      const source = { connect: () => {}, start: (at) => startedAt.push(at), stop: () => sources.push('stop') };
      sources.push(source);
      return source;
    },
    destination: {},
  };
  const output = createLiveAudioOutput({ createContext: () => fakeCtx });
  // 48000 samples @24kHz = 2 s; second chunk must start at 12 s, not at now.
  const chunk = Buffer.from(new Int16Array(48000).fill(1000).buffer).toString('base64');
  assert.equal(output.playPcm(chunk), true);
  assert.equal(output.playPcm(chunk), true);
  assert.deepEqual(startedAt, [10, 12]);
  output.stop();
  assert.equal(sources.filter((s) => s === 'stop').length, 2);
  assert.equal(output.playPcm(''), false);
  assert.equal(createLiveAudioOutput().playPcm(chunk), false);
});

function liveHarness({ contextSequence = ['ctx-a'], debounce = 5, interval = 30 } = {}) {
  const { fetchImpl } = stubFetchToken();
  const { sent, sockets, FakeSocket } = stubSocket();
  let contextCalls = 0;
  const controller = createGeminiLiveController({
    runner: async (name) => ({ ok: true, action: name }),
    ui: { detail: { textContent: '' } },
    fetchImpl,
    wsCtor: FakeSocket,
    audioEnv: stubAudio().audioEnv,
    mic: 'off',
    getSceneContext: async () => contextSequence[Math.min(contextCalls++, contextSequence.length - 1)],
    updateDebounceMs: debounce,
    updateMinIntervalMs: interval,
  });
  return { controller, sent, sockets };
}

async function openLive(harness) {
  await harness.controller.start();
  harness.sockets[0].readyState = 1;
  harness.sockets[0].onopen();
  await new Promise((resolve) => setTimeout(resolve, 10));
  await harness.controller.handleServerFrame(JSON.stringify({ setupComplete: {} }));
}

test('command narration carries the fresh post-flight view', async () => {
  const harness = liveHarness({ contextSequence: ['setup-view', 'hongkong-view'] });
  await openLive(harness);
  harness.sent.length = 0;
  await harness.controller.handleTranscript('take me to hongkong');
  const narration = harness.sent.find((text) => text.includes('Executed'));
  assert.ok(narration, 'model narrates the executed command');
  assert.ok(narration.includes('hongkong-view'), 'fresh view rides along, not the stale one');
  harness.controller.stop();
});

test('manual camera flights push one throttled scene update', async () => {
  const harness = liveHarness({ contextSequence: ['setup-view', 'moved-view'], debounce: 5, interval: 40 });
  await openLive(harness);
  harness.sent.length = 0;

  const listeners = [];
  assert.equal(harness.controller.watchCamera({ camera: { moveEnd: { addEventListener: (fn) => { listeners.push(fn); return () => {}; } } } }), true);
  // Motion burst collapses into a single update.
  harness.controller.noteViewChanged();
  harness.controller.noteViewChanged();
  harness.controller.noteViewChanged();
  await new Promise((resolve) => setTimeout(resolve, 25));
  const updates = harness.sent.filter((text) => text.includes('Scene update'));
  assert.equal(updates.length, 1);
  assert.ok(updates[0].includes('moved-view'));

  // Identical context afterwards is skipped.
  harness.sent.length = 0;
  await harness.controller.pushSceneUpdate();
  assert.equal(harness.sent.length, 0, 'unchanged view sends nothing');

  // Throttle: a changed view inside the window is held back, then sent after.
  harness.controller.state.lastPushedContext = 'other';
  harness.sent.length = 0;
  assert.equal(await harness.controller.pushSceneUpdate(), false);
  await new Promise((resolve) => setTimeout(resolve, 45));
  listeners[0]();
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.ok(harness.sent.some((text) => text.includes('Scene update')), 'update sent after the window');
  harness.controller.stop();
});

test('watchCamera without a viewer fails softly, stop detaches', () => {
  const harness = liveHarness();
  assert.equal(harness.controller.watchCamera(null), false);
  assert.equal(harness.controller.watchCamera({}), false);
  let removed = 0;
  const viewer = { camera: { moveEnd: { addEventListener: () => () => { removed += 1; } } } };
  assert.equal(harness.controller.watchCamera(viewer), true);
  harness.controller.stop();
  assert.equal(removed, 1);
});

test('tracking changes refresh the selected context', async () => {
  const harness = liveHarness({ contextSequence: ['setup-view', 'tracked-view'], debounce: 5, interval: 10 });
  await openLive(harness);
  harness.sent.length = 0;
  let trackedListener = null;
  const viewer = {
    camera: { moveEnd: { addEventListener: () => () => {} } },
    trackedEntityChanged: { addEventListener: (fn) => { trackedListener = fn; return () => {}; } },
  };
  assert.equal(harness.controller.watchCamera(viewer), true);
  trackedListener();
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.ok(harness.sent.some((text) => text.includes('tracked-view')), 'tracked subject reaches the model');
  harness.controller.stop();
});

function toolHarness() {
  const { fetchImpl } = stubFetchToken();
  const { sent, sockets, FakeSocket } = stubSocket();
  const ran = [];
  const detail = { textContent: '' };
  const logged = [];
  const controller = createGeminiLiveController({
    runner: async (name, args) => { ran.push([name, args]); return { ok: true, action: name }; },
    ui: { detail },
    fetchImpl,
    wsCtor: FakeSocket,
    audioEnv: stubAudio().audioEnv,
    mic: 'off',
    getSceneContext: async () => '',
    log: { push: (who, text, calls) => logged.push([who, String(text).slice(0, 60), calls]) },
  });
  return { controller, sent, sockets, ran, logged };
}

async function openToolHarness(harness) {
  await harness.controller.start();
  harness.sockets[0].readyState = 1;
  harness.sockets[0].onopen();
  await new Promise((resolve) => setTimeout(resolve, 10));
  await harness.controller.handleServerFrame(JSON.stringify({ setupComplete: {} }));
}

test('live tool calls execute and every call gets an answer', async () => {
  const harness = toolHarness();
  await openToolHarness(harness);
  harness.sent.length = 0;
  await harness.controller.handleToolCalls([
    { name: 'set_layer_visibility', args: { layerId: 'satellites', enabled: true }, id: 'call-1' },
    { name: 'zoom_to_globe', args: '{"mangled": oops}', id: 'call-2' },
  ]);
  assert.deepEqual(harness.ran, [
    ['set_layer_visibility', { layerId: 'satellites', enabled: true }],
    ['zoom_to_globe', {}],
  ]);
  const response = harness.sent.map((text) => JSON.parse(text)).find((msg) => msg.toolResponse);
  assert.ok(response, 'toolResponse sent');
  assert.deepEqual(response.toolResponse.functionResponses.map((r) => [r.name, r.id]), [
    ['set_layer_visibility', 'call-1'],
    ['zoom_to_globe', 'call-2'],
  ]);
  assert.ok(response.toolResponse.functionResponses[0].response.output.includes('set_layer_visibility'));
  assert.ok(harness.logged.some(([who]) => who === 'app'), 'execution logged');
  harness.controller.stop();
});

test('transcript twin of a tool call collapses instead of flying twice', async () => {
  const harness = toolHarness();
  await openToolHarness(harness);
  await harness.controller.handleTranscript('turn on the satellites layer');
  assert.equal(harness.ran.length, 1);
  harness.sent.length = 0;
  // The model emits the same action as a tool call moments later.
  await harness.controller.handleToolCalls([
    { name: 'set_layer_visibility', args: { enabled: true, layerId: 'satellites' }, id: 'call-9' },
  ]);
  assert.equal(harness.ran.length, 1, 'no second execution');
  const response = harness.sent.map((text) => JSON.parse(text)).find((msg) => msg.toolResponse);
  assert.ok(response, 'twin still answered so the turn never strands');
  harness.controller.stop();
});

test('live see intent sends the screenshot as an image turn', async () => {
  const { fetchImpl } = stubFetchToken();
  const { sent, sockets, FakeSocket } = stubSocket();
  const controller = createGeminiLiveController({
    runner: async () => ({}),
    ui: { detail: { textContent: '' } },
    fetchImpl,
    wsCtor: FakeSocket,
    audioEnv: stubAudio().audioEnv,
    mic: 'off',
    getSceneContext: async () => 'austin',
    captureViewport: async () => 'data:image/jpeg;base64,AAA=',
  });
  await controller.start();
  sockets[0].readyState = 1;
  sockets[0].onopen();
  await new Promise((resolve) => setTimeout(resolve, 10));
  controller.state.sessionReady = true;
  sent.length = 0;
  await controller.handleTranscript('what do you see?');
  const messages = sent.map((text) => JSON.parse(text));
  const imageTurn = messages.find((msg) => msg.realtimeInput?.video);
  assert.ok(imageTurn, 'screenshot goes as an image turn');
  assert.equal(imageTurn.realtimeInput.video.mimeType, 'image/jpeg');
  assert.equal(imageTurn.realtimeInput.video.data, 'AAA=');
  const textTurn = messages.find((msg) => typeof msg.realtimeInput?.text === 'string' && msg.realtimeInput.text.includes('Describe'));
  assert.ok(textTurn, 'describe prompt follows the image');
  controller.stop();
});

test('live see intent falls back to context when capture fails', async () => {
  const { fetchImpl } = stubFetchToken();
  const { sent, sockets, FakeSocket } = stubSocket();
  const logged = [];
  const controller = createGeminiLiveController({
    runner: async () => ({}),
    ui: { detail: { textContent: '' } },
    fetchImpl,
    wsCtor: FakeSocket,
    audioEnv: stubAudio().audioEnv,
    mic: 'off',
    getSceneContext: async () => 'austin',
    captureViewport: async () => null,
    log: { push: (who, text) => logged.push([who, text]) },
  });
  await controller.start();
  sockets[0].readyState = 1;
  sockets[0].onopen();
  await new Promise((resolve) => setTimeout(resolve, 10));
  controller.state.sessionReady = true;
  sent.length = 0;
  const result = await controller.describeLiveView('was siehst du?', 'de');
  assert.equal(result.ok, true);
  const messages = sent.map((text) => JSON.parse(text));
  assert.ok(!messages.some((msg) => msg.realtimeInput?.video), 'no image without capture');
  assert.ok(messages.some((msg) => (msg.realtimeInput?.text || '').includes('austin')), 'context carries the answer');
  controller.stop();
});

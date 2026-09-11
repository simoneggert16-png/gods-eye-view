import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createFreeVoiceController,
  decodePcm16ToFloat32,
  GOOGLE_TTS_SAMPLE_RATE,
  isFreeSpeechRecognitionAvailable,
  parseFreeVoiceCommand,
  playGoogleTTSAudio,
  resetGoogleTTSCooldown,
  speakFreeVoiceConfirmation,
  speakWithGoogleTTS,
  truncateForSpeech,
  TTS_COOLDOWN_MS,
} from './gevFreeVoice.js';

test('fly_to_location resolves presets and free-form places', () => {
  const tokyo = parseFreeVoiceCommand('Take me to Tokyo.');
  assert.equal(tokyo.calls[0].name, 'fly_to_location');
  assert.equal(tokyo.calls[0].args.locationId, 'tokyo');

  const berlin = parseFreeVoiceCommand('Flieg nach Berlin');
  assert.equal(berlin.calls[0].name, 'fly_to_location');
  assert.equal(berlin.calls[0].args.query, 'berlin');
  assert.equal(berlin.lang, 'de');
});

test('globe reset and relative zoom', () => {
  assert.equal(parseFreeVoiceCommand('Zoom out to a globe view.').calls[0].name, 'zoom_to_globe');
  assert.equal(parseFreeVoiceCommand('Zoome raus zur Globusansicht').calls[0].name, 'zoom_to_globe');
  const zoom = parseFreeVoiceCommand('Zoom in a bit');
  assert.deepEqual(zoom.calls[0], { name: 'adjust_camera_zoom', args: { direction: 'in', amount: 'little' } });
  assert.deepEqual(parseFreeVoiceCommand('Zoom in').calls[0], { name: 'adjust_camera_zoom', args: { direction: 'in', amount: 'medium' } });
  assert.deepEqual(parseFreeVoiceCommand('Zoom out').calls[0], { name: 'adjust_camera_zoom', args: { direction: 'out', amount: 'medium' } });
});

test('zoom into a place flies there with close framing', () => {
  const bridge = parseFreeVoiceCommand('Zoom into Stanford Bridge.');
  assert.equal(bridge.calls[0].name, 'fly_to_location');
  assert.equal(bridge.calls[0].args.query, 'stanford bridge');
  assert.equal(bridge.calls[0].args.viewMode, 'close');

  const london = parseFreeVoiceCommand('Zoom to London.');
  assert.deepEqual(london.calls[0], { name: 'fly_to_location', args: { locationId: 'london', viewMode: 'close' } });

  const berlin = parseFreeVoiceCommand('Zoome nach Berlin');
  assert.equal(berlin.calls[0].name, 'fly_to_location');
  assert.equal(berlin.calls[0].args.viewMode, 'close');

  // Fillers stay relative.
  assert.equal(parseFreeVoiceCommand('Zoom in here').calls[0].name, 'adjust_camera_zoom');
  assert.equal(parseFreeVoiceCommand('Zoom into it').calls[0].name, 'adjust_camera_zoom');
});

test('deictic zoom ("diesen Wald") routes to the brain, never to literal geocode', () => {
  for (const text of [
    'zoome in diesen Wald rein',
    'zoome in dieses Gebäude rein',
    'zoome in diesen Turm',
    'Zoom into this forest',
    'fliege in diesen Wald',
  ]) {
    const parsed = parseFreeVoiceCommand(text);
    assert.ok(parsed.brainRoute, `${text} must brain-route`);
    assert.equal(parsed.brainRoute.fallbackCalls[0].name, 'fly_to_location', text);
    assert.equal(parsed.brainRoute.fallbackCalls[0].args.viewMode, 'close', text);
    assert.equal(parsed.calls.length, 0, `${text} must not fly literally`);
  }
  // Named places still fly directly.
  const tower = parseFreeVoiceCommand('zoome in den Eiffelturm rein');
  assert.equal(tower.calls[0]?.name || tower.brainRoute?.fallbackCalls[0]?.name, 'fly_to_location');
});

test('layers, styles, hud and map stacks map to enums', () => {
  assert.deepEqual(parseFreeVoiceCommand('Turn on the flights layer.').calls[0], {
    name: 'set_layer_visibility', args: { layerId: 'flights', enabled: true },
  });
  assert.deepEqual(parseFreeVoiceCommand('Schalte Flüge ein').calls[0], {
    name: 'set_layer_visibility', args: { layerId: 'flights', enabled: true },
  });
  assert.deepEqual(parseFreeVoiceCommand('Switch to night vision').calls[0], {
    name: 'set_visual_style', args: { style: 'surveillance' },
  });
  assert.deepEqual(parseFreeVoiceCommand('Switch to OSM').calls[0], {
    name: 'set_map_stack', args: { stack: 'osm' },
  });
});

test('cockpit, tracking and orbit verbs', () => {
  assert.equal(parseFreeVoiceCommand('Enter cockpit.').calls[0].name, 'control_cockpit');
  const track = parseFreeVoiceCommand('Track that plane.');
  assert.ok(track.brainRoute, 'that plane is deictic — routes to brain');
  assert.equal(track.brainRoute.fallbackCalls[0].name, 'track_entity');
  assert.deepEqual(parseFreeVoiceCommand('Orbit around this area slowly.').calls[0], {
    name: 'move_camera', args: { motion: 'orbit', speed: 'slow', mode: 'continuous' },
  });
});

test('annotations: outline, distance arrow, route, clear', () => {
  const outline = parseFreeVoiceCommand('Outline the state of Texas.');
  assert.equal(outline.calls[0].name, 'annotate_map');
  assert.equal(outline.calls[0].args.annotations[0].type, 'area');

  const dist = parseFreeVoiceCommand('How far is the Eiffel Tower from the Louvre?');
  assert.equal(dist.calls[0].args.annotations[0].type, 'arrow');
  assert.equal(dist.calls[0].args.annotations[0].target, 'eiffel tower');

  const route = parseFreeVoiceCommand('Draw the walking route from the Capitol to Zilker Park.');
  assert.equal(route.calls[0].args.annotations[0].type, 'route');
  assert.equal(route.calls[0].args.annotations[0].mode, 'walking');

  assert.equal(parseFreeVoiceCommand('Clear the map.').calls[0].name, 'clear_annotations');
});

test('analyst questions become analyst_query; open questions route to Gemini', () => {
  const q = parseFreeVoiceCommand('How many flights are over Texas right now?');
  assert.equal(q.calls[0].name, 'analyst_query');
  assert.deepEqual(q.calls[0].args.layers, ['flights']);

  const alt = parseFreeVoiceCommand('Is anything flying above forty thousand feet?');
  assert.equal(alt.calls[0].name, 'analyst_query');

  const iss = parseFreeVoiceCommand('When does the ISS pass over next?');
  assert.equal(iss.calls[0].name, 'next_iss_pass');

  const city = parseFreeVoiceCommand('What city is this?');
  assert.equal(city.calls.length, 0);
  assert.equal(city.geminiQuestion, 'What city is this?');

  const entity = parseFreeVoiceCommand("What's this?");
  assert.equal(entity.geminiQuestion, "What's this?");

  const wieso = parseFreeVoiceCommand('wieso hat das so eine komische farbe im vergleich zum rest');
  assert.equal(wieso.geminiQuestion, 'wieso hat das so eine komische farbe im vergleich zum rest');

  const noise = parseFreeVoiceCommand('blabla nonsense xyz');
  assert.ok(noise.unknown);
  assert.equal(noise.geminiQuestion, undefined);
});

test('fire intent enables the layer and tracks the strongest fire', () => {  for (const text of ['Show me a fire.', 'Take me to the biggest fire', 'Zeig mir ein Feuer', 'Flieg mich zum Feuer']) {
    const parsed = parseFreeVoiceCommand(text);
    assert.deepEqual(parsed.calls, [
      { name: 'set_layer_visibility', args: { layerId: 'local-firms', enabled: true } },
      { name: 'track_entity', args: { query: 'fire' } },
    ], text);
  }
  // Pure questions stay analytical — no navigation.
  const q = parseFreeVoiceCommand('How many fires are over Texas right now?');
  assert.equal(q.calls[0].name, 'analyst_query');
  const q2 = parseFreeVoiceCommand('What is the biggest fire near Los Angeles?');
  assert.equal(q2.calls[0].name, 'analyst_query');
});

test('see intent looks at the screen instead of counting or flying', () => {
  for (const text of [
    'What do you see?',
    'What am I looking at?',
    'Describe this view.',
    'What building is that?',
    'Was siehst du?',
    'Was sehe ich hier?',
    'Beschreibe diese Ansicht.',
    'Erzähl mir was über das hier.',
  ]) {
    const parsed = parseFreeVoiceCommand(text);
    assert.equal(parsed.calls.length, 0, text);
    assert.ok(parsed.see, text);
  }
  // Counting stays analytical even with "see" in it.
  const count = parseFreeVoiceCommand('How many planes can you see?');
  assert.equal(count.calls[0].name, 'analyst_query');
  assert.equal(count.see, undefined);
  // Open text questions keep their existing route.
  assert.ok(parseFreeVoiceCommand('What city is this?').geminiQuestion);
});

test('radio, cctv, scenes and help', () => {  assert.deepEqual(parseFreeVoiceCommand('Play a news radio station near Austin.').calls[0], {
    name: 'control_radio', args: { action: 'select', locationQuery: 'austin', category: 'news' },
  });
  assert.equal(parseFreeVoiceCommand('Turn on the camera viewsheds.').calls[0].name, 'control_cctv');
  assert.equal(parseFreeVoiceCommand('Play Orbital Watch.').calls[0].name, 'control_scene');
  assert.equal(parseFreeVoiceCommand('help').calls.length, 0);
  assert.ok(parseFreeVoiceCommand('blabla nonsense xyz').unknown);
});

test('free controller runs calls through the runner without a key', async () => {
  const seen = [];
  const controller = createFreeVoiceController({
    announce: false,
    runner: async (name, args) => { seen.push([name, args]); return { ok: true, action: name }; },
  });
  const result = await controller.handleText('Take me to Tokyo.');
  assert.equal(result.ok, true);
  assert.deepEqual(seen, [['fly_to_location', { locationId: 'tokyo' }]]);
  const missed = await controller.handleText('blabla nonsense xyz');
  assert.equal(missed.ok, false);
});

test('open questions reach Gemini last with scene context; 503 points to POWER UP', async () => {
  const posted = [];
  const fetchImpl = async (url, init) => {
    posted.push([url, JSON.parse(init.body)]);
    if (String(url).includes('/api/gemini/ask')) {
      return { ok: true, status: 200, json: async () => ({ answer: 'This is Austin, Texas.', blocked: false, error: null }) };
    }
    return { ok: false, status: 503, json: async () => ({}) };
  };
  const controller = createFreeVoiceController({
    announce: false,
    fetchImpl,
    runner: async (name) => ({ ok: true, action: name, echo: name }),
  });
  const result = await controller.handleText('What city is this?');
  assert.equal(result.ok, true);
  assert.equal(result.answer, 'This is Austin, Texas.');
  const geminiCall = posted.find(([url]) => url === '/api/gemini/ask');
  assert.ok(geminiCall, 'chain falls through to Gemini');
  assert.equal(geminiCall[1].question, 'What city is this?');
  assert.ok(geminiCall[1].context.includes('get_current_view_state'));

  const missing = createFreeVoiceController({
    announce: false,
    fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({ code: 'GEMINI_NOT_CONFIGURED', answer: null }) }),
    runner: async () => ({}),
  });
  const needsKey = await missing.handleText('What city is this?');
  assert.equal(needsKey.ok, false);
  assert.equal(needsKey.needsKey, true);
  assert.match(needsKey.speech, /POWER UP/);

  const limited = createFreeVoiceController({
    announce: false,
    fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({ retryable: true, answer: null }) }),
    runner: async () => ({}),
  });
  const quota = await limited.handleText('What city is this?');
  assert.equal(quota.ok, false);
  assert.equal(quota.retryable, true);
});

test('speech recognition probe is environment-safe', () => {
  assert.equal(isFreeSpeechRecognitionAvailable({}), false);
  assert.equal(isFreeSpeechRecognitionAvailable({ webkitSpeechRecognition: function () {} }), true);
  assert.equal(isFreeSpeechRecognitionAvailable(null), false);
});

test('pcm16 decode maps silence, max and min correctly', () => {
  assert.equal(GOOGLE_TTS_SAMPLE_RATE, 24000);
  const samples = decodePcm16ToFloat32(new Uint8Array([0x00, 0x00, 0xff, 0x7f, 0x00, 0x80, 0xaa]));
  assert.equal(samples.length, 3);
  assert.equal(samples[0], 0);
  assert.ok(Math.abs(samples[1] - 32767 / 32768) < 1e-6);
  assert.equal(samples[2], -1);
  assert.equal(decodePcm16ToFloat32(null).length, 0);
});

function fakeAudioEnv() {
  const played = [];
  function FakeAudioContext() {
    return {
      resume: async () => {},
      createBuffer: (_ch, len, _rate) => {
        const data = new Float32Array(len);
        return { getChannelData: () => data };
      },
      createBufferSource: () => ({
        set buffer(v) { this._buffer = v; },
        get buffer() { return this._buffer; },
        connect: () => {},
        start: () => played.push('start'),
      }),
      destination: {},
    };
  }
  return {
    played,
    env: {
      AudioContext: FakeAudioContext,
      atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    },
  };
}

test('google tts playback decodes pcm and starts a source', async () => {
  // 2 samples: silence + max. base64 of [0,0,255,127].
  const { played, env } = fakeAudioEnv();
  assert.equal(await playGoogleTTSAudio('AAD/fw==', env), true);
  assert.deepEqual(played, ['start']);
  assert.equal(await playGoogleTTSAudio('', env), false);
  assert.equal(await playGoogleTTSAudio('AAA=', {}), false);
});

test('speak prefers google tts, falls back to local voice', async () => {
  resetGoogleTTSCooldown();
  const { played, env } = fakeAudioEnv();
  const googleFetch = async () => ({ ok: true, status: 200, json: async () => ({ audio: 'AAD/fw==', mimeType: 'audio/L16;codec=pcm;rate=24000' }) });
  assert.equal(await speakWithGoogleTTS('Hallo.', { fetchImpl: googleFetch, browserEnv: env }), 'google');
  assert.deepEqual(played, ['start']);

  const deadFetch = async () => ({ ok: false, status: 503, json: async () => ({ code: 'GEMINI_NOT_CONFIGURED' }) });
  assert.equal(await speakWithGoogleTTS('Hallo.', { fetchImpl: deadFetch, browserEnv: {} }), null);

  assert.equal(await speakWithGoogleTTS('   ', { fetchImpl: googleFetch, browserEnv: env }), null);
});

test('tts 429 cools down the cloud path so fallback is instant', async () => {
  resetGoogleTTSCooldown();
  let calls = 0;
  const limitedFetch = async () => {
    calls += 1;
    return { ok: false, status: 429, json: async () => ({ retryable: true }) };
  };
  let now = 1_000_000;
  assert.equal(await speakWithGoogleTTS('Hallo.', { fetchImpl: limitedFetch, browserEnv: {}, now: () => now }), null);
  assert.equal(calls, 1);
  // Inside the cooldown window no second upstream attempt happens.
  assert.equal(await speakWithGoogleTTS('Hallo.', { fetchImpl: limitedFetch, browserEnv: {}, now: () => now + 1000 }), null);
  assert.equal(calls, 1);
  // After the window the cloud path is tried again.
  assert.equal(await speakWithGoogleTTS('Hallo.', { fetchImpl: limitedFetch, browserEnv: {}, now: () => now + TTS_COOLDOWN_MS + 1 }), null);
  assert.equal(calls, 2);
  resetGoogleTTSCooldown();
});

test('truncateForSpeech preserves short text and bounds long speech', () => {
  assert.equal(truncateForSpeech('Kurzer Text.'), 'Kurzer Text.');
  const long = 'Texas ist ein Bundesstaat im Süden der USA. Die Hauptstadt ist Austin. Es hat über 30 Millionen Einwohner und viele Städte wie Houston und Dallas.';
  const res = truncateForSpeech(long, 80);
  assert.ok(res.length <= 80);
  assert.ok(res.endsWith('.'));
});

test('speakWithGoogleTTS times out and immediately falls back to local voice', async () => {
  resetGoogleTTSCooldown();
  const hangingFetch = (_url, opt) => new Promise((resolve, reject) => {
    opt?.signal?.addEventListener('abort', () => reject(new Error('Aborted by timeout')));
  });
  const spoken = [];
  const env = {
    speechSynthesis: {
      cancel: () => {},
      getVoices: () => [{ name: 'Default', lang: 'de' }],
      speak: (u) => spoken.push(u),
    },
    SpeechSynthesisUtterance: function (text) { this.text = text; },
  };
  const result = await speakWithGoogleTTS('Hallo.', { fetchImpl: hangingFetch, browserEnv: env, lang: 'de', timeoutMs: 25 });
  assert.equal(result, 'local');
  assert.equal(spoken.length, 1);
  assert.equal(spoken[0].text, 'Hallo.');
});


test('local fallback prefers a google system voice in the text language', () => {
  const spoken = [];
  function FakeUtterance(text) { this.text = text; }
  const env = {
    speechSynthesis: {
      cancel: () => {},
      getVoices: () => [{ name: 'Microsoft Hedda Desktop', lang: 'de-DE' }, { name: 'Google Deutsch', lang: 'de-DE' }],
      speak: (u) => spoken.push(u),
    },
    SpeechSynthesisUtterance: FakeUtterance,
  };
  assert.equal(speakFreeVoiceConfirmation('Hallo Berlin.', env, 'de'), true);
  assert.equal(spoken[0].voice.name, 'Google Deutsch');
  assert.equal(spoken[0].lang, 'de-DE');
});

test('suspended audio context falls back instead of playing silence', async () => {
  const { env } = fakeAudioEnv();
  env.AudioContext = function () {
    return { resume: async () => {}, state: 'suspended', createBuffer: () => { throw new Error('nope'); }, destination: {} };
  };
  // Fresh constructor → fresh cached context; suspended state refuses playback.
  assert.equal(await playGoogleTTSAudio('AAD/fw==', env), false);
});

function fakeRecognition() {
  const calls = [];
  function FakeRecognition() {
    return {
      calls,
      lang: '',
      interimResults: false,
      maxAlternatives: 1,
      continuous: false,
      onresult: null,
      onend: null,
      onerror: null,
      start: () => calls.push('start'),
      stop: () => calls.push('stop'),
      abort: () => calls.push('abort'),
    };
  }
  return { calls, FakeRecognition };
}

test('stop aborts, graceful stop lets the sentence finish', () => {
  const hard = fakeRecognition();
  const hardController = createFreeVoiceController({ announce: false, runner: async () => ({}) });
  hardController.start({ recognitionCtor: hard.FakeRecognition });
  hardController.stop();
  assert.deepEqual(hard.calls, ['start', 'abort', 'stop']);

  const soft = fakeRecognition();
  const softController = createFreeVoiceController({ announce: false, runner: async () => ({}) });
  softController.start({ recognitionCtor: soft.FakeRecognition });
  softController.stop({ graceful: true });
  assert.deepEqual(soft.calls, ['start', 'stop'], 'graceful release must not abort captured audio');
});

test('readout shows which voice spoke', async () => {
  const { env } = fakeAudioEnv();
  const detail = { textContent: '' };
  const googleFetch = async () => ({ ok: true, status: 200, json: async () => ({ audio: 'AAD/fw==', mimeType: 'audio/L16;codec=pcm;rate=24000' }) });
  const controller = createFreeVoiceController({
    announce: true,
    ui: { detail },
    fetchImpl: googleFetch,
    browserEnv: env,
    runner: async () => ({ ok: true }),
  });
  await controller.handleText('take me to tokyo');
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.match(detail.textContent, /GOOGLE VOICE/);
});

test('describeView captures the screen and speaks what it sees', async () => {
  const posted = [];
  const fetchImpl = async (url, init) => {
    posted.push([url, JSON.parse(init.body)]);
    return { ok: true, status: 200, json: async () => ({ answer: 'Austin with the Capitol.', blocked: false, error: null }) };
  };
  const seen = [];
  const controller = createFreeVoiceController({
    announce: false,
    ui: { detail: { textContent: '' } },
    fetchImpl,
    runner: async () => ({}),
    captureViewport: async () => 'data:image/jpeg;base64,AAA=',
    log: { push: (who, text) => seen.push([who, text]) },
  });
  const result = await controller.handleText('what do you see?');
  assert.equal(result.ok, true);
  assert.equal(result.answer, 'Austin with the Capitol.');
  assert.equal(posted[0][0], '/api/gemini/see');
  assert.equal(posted[0][1].image, 'data:image/jpeg;base64,AAA=');
  assert.deepEqual(seen, [['you', 'what do you see?'], ['gemini', 'Austin with the Capitol.']]);
});

test('describeView stays honest when capture fails', async () => {
  let fetched = 0;
  const controller = createFreeVoiceController({
    announce: false,
    ui: { detail: { textContent: '' } },
    fetchImpl: async () => { fetched += 1; return { ok: true, status: 200, json: async () => ({}) }; },
    runner: async () => ({}),
    captureViewport: async () => null,
  });
  const result = await controller.handleText('Zeig mir, was du siehst');
  assert.equal(result.ok, false);
  assert.equal(fetched, 0, 'no cloud call without an image');
  assert.match(result.speech, /Bildschirm/);
});

function brainFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(url);
    const route = routes[String(url)] || { status: 503, body: {} };
    return { ok: route.status < 300, status: route.status, json: async () => route.body };
  };
  return { calls, fetchImpl };
}

function brainController(fetchImpl) {
  const seen = [];
  return {
    seen,
    controller: createFreeVoiceController({
      announce: false,
      ui: { detail: { textContent: '' } },
      fetchImpl,
      runner: async () => ({}),
      log: { push: (who, text) => seen.push([who, text]) },
    }),
  };
}

test('typed chatter prefers Z.AI, then Ollama, then Gemini', async () => {
  const okAnswer = (text) => ({ status: 200, body: { answer: text, blocked: false, error: null } });

  const zai = brainFetch({ '/api/zai/chat': okAnswer('ZAI sagt hallo.') });
  const zaiCase = brainController(zai.fetchImpl);
  const zaiResult = await zaiCase.controller.handleText('Erzähl mir was über Hongkong');
  assert.equal(zaiResult.ok, true);
  assert.equal(zaiResult.answer, 'ZAI sagt hallo.');
  assert.deepEqual(zai.calls, ['/api/zai/chat']);
  assert.ok(zaiCase.seen.some(([who]) => who === 'zai'));

  const ol = brainFetch({
    '/api/zai/chat': { status: 503, body: { code: 'ZAI_NOT_CONFIGURED' } },
    '/api/ollama/chat': okAnswer('Ollama says hi.'),
  });
  const olCase = brainController(ol.fetchImpl);
  const olResult = await olCase.controller.handleText('Tell me about Hong Kong');
  assert.equal(olResult.ok, true);
  assert.equal(olResult.answer, 'Ollama says hi.');
  assert.deepEqual(ol.calls, ['/api/zai/chat', '/api/ollama/chat']);
  assert.ok(olCase.seen.some(([who]) => who === 'ollama'));

  const gem = brainFetch({
    '/api/zai/chat': { status: 503, body: {} },
    '/api/ollama/chat': { status: 503, body: {} },
    '/api/gemini/ask': okAnswer('Gemini says hi.'),
  });
  const gemCase = brainController(gem.fetchImpl);
  const gemResult = await gemCase.controller.handleText('Tell me about Hong Kong');
  assert.equal(gemResult.ok, true);
  assert.equal(gemResult.answer, 'Gemini says hi.');
  assert.deepEqual(gem.calls, ['/api/zai/chat', '/api/ollama/chat', '/api/gemini/ask']);
});

function routerFetch(answerText) {
  const posted = [];
  const fetchImpl = async (url, init) => {
    posted.push([url, JSON.parse(init.body)]);
    return { ok: true, status: 200, json: async () => ({ answer: answerText, blocked: false, error: null }) };
  };
  return { posted, fetchImpl };
}

function routerController(fetchImpl, history = []) {
  const seen = [];
  const ran = [];
  const controller = createFreeVoiceController({
    announce: false,
    ui: { detail: { textContent: '' } },
    fetchImpl,
    runner: async (name, args) => {
      // Scene snapshots are plumbing, not tool calls under test.
      if (name === 'get_current_view_state' || name === 'get_entity_context') return { ok: true };
      ran.push([name, args]);
      return { ok: true, action: name };
    },
    log: {
      push: (who, text, calls) => seen.push([who, text]),
      list: () => [...history, ...seen.map(([who, text]) => ({ who, text }))],
    },
  });
  return { seen, ran, controller };
}

test('unknown pronouns route through AI with history and execute', async () => {
  const history = [
    { who: 'you', text: 'zeig mir epstein island' },
    { who: 'app', text: 'Fliege nach epstein island.' },
  ];
  const routedAnswer = 'Sicher! {"name": "fly_to_location", "args": {"query": "epstein island", "viewMode": "close"}, "say": "Zoome auf die Insel."}';
  const { posted, fetchImpl } = routerFetch(routedAnswer);
  const { seen, ran, controller } = routerController(fetchImpl, history);
  const result = await controller.handleText('zoome in seine insel rein');
  assert.equal(result.ok, true);
  assert.deepEqual(ran, [['fly_to_location', { query: 'epstein island', viewMode: 'close' }]]);
  assert.equal(result.speech, 'Zoome auf die Insel.');
  assert.equal(posted[0][0], '/api/zai/chat');
  assert.ok(posted[0][1].message.includes('epstein island'), 'history disambiguates the pronoun');
  assert.ok(posted[0][1].system.includes('fly_to_location'));
  assert.ok(seen.some(([who]) => who === 'app'));
});

test('router garbage and chit-chat fall back honestly', async () => {
  const { fetchImpl } = routerFetch('Das ist nur Gerede ohne JSON.');
  const { controller } = routerController(fetchImpl, []);
  const missed = await controller.handleText('flargle the wumpus');
  assert.equal(missed.ok, false);
  assert.match(missed.speech, /nicht verstanden|did not understand/);

  const { fetchImpl: fetchImpl2 } = routerFetch('Warum sind Piloten so ruhig? Weil sie alles im Griff haben.');
  const second = routerController(fetchImpl2, []);
  const chitchat = await second.controller.handleText('erzähl mir einen Witz über Piloten');
  assert.equal(chitchat.ok, true);
  assert.match(chitchat.speech, /ruhig/);
});

test('failed place flight gets one AI-corrected retry', async () => {
  const posted = [];
  const fetchImpl = async (url, init) => {
    posted.push(url);
    return { ok: true, status: 200, json: async () => ({ answer: '{"query": "Shenzhen, China"}', blocked: false, error: null }) };
  };
  const ran = [];
  const seen = [];
  const controller = createFreeVoiceController({
    announce: false,
    ui: { detail: { textContent: '' } },
    fetchImpl,
    runner: async (name, args) => {
      if (name === 'get_current_view_state' || name === 'get_entity_context') return { ok: true };
      ran.push([name, args.query]);
      if (args.query === 'shenzen') return { ok: false, action: name, error: 'Place "shenzen" not found' };
      return { ok: true, action: name };
    },
    log: { push: (who, text, calls) => seen.push([who, text]), list: () => [] },
  });
  const result = await controller.handleText('show me shenzen');
  assert.equal(result.ok, true);
  assert.deepEqual(ran, [['fly_to_location', 'shenzen'], ['fly_to_location', 'Shenzhen, China']]);
  assert.match(result.speech, /Shenzhen/);
  assert.equal(result.retriedFrom, 'shenzen');
  assert.ok(posted.includes('/api/zai/chat'));
  assert.ok(seen.some(([who, text]) => who === 'app' && text.includes('Shenzhen')));
});

test('retry stands down when the brain cannot fix it', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ answer: '{"unknown": true}', blocked: false, error: null }) });
  const ran = [];
  const controller = createFreeVoiceController({
    announce: false,
    ui: { detail: { textContent: '' } },
    fetchImpl,
    runner: async (name, args) => {
      if (name === 'get_current_view_state' || name === 'get_entity_context') return { ok: true };
      ran.push(args.query);
      return { ok: false, action: name, error: `Place "${args.query}" not found` };
    },
    log: { push: () => {}, list: () => [] },
  });
  const result = await controller.handleText('show me xyznonexistentplace');
  assert.equal(result.ok, false);
  assert.deepEqual(ran, ['xyznonexistentplace']);
  assert.match(result.speech, /xyznonexistentplace/);
});

test('indefinite show-me stages the layer instead of geocoding', () => {
  const mil = parseFreeVoiceCommand('zeige mir irgendein militärflugzeug');
  assert.deepEqual(mil.calls, [
    { name: 'set_layer_visibility', args: { layerId: 'military', enabled: true } },
    { name: 'select_nearest_aircraft', args: { layerId: 'military' } },
  ]);
  const plane = parseFreeVoiceCommand('show me a plane');
  assert.deepEqual(plane.calls[1], { name: 'select_nearest_aircraft', args: { layerId: 'flights' } });
  const ship = parseFreeVoiceCommand('show me some ship');
  assert.deepEqual(ship.calls, [
    { name: 'set_layer_visibility', args: { layerId: 'ais-live-vessels', enabled: true } },
    { name: 'frame_overhead', args: { target: 'vessels' } },
  ]);
  // Unknown nouns still fall through to geocode (AI retry gets its chance).
  const weird = parseFreeVoiceCommand('zeige mir epstein island');
  assert.equal(weird.calls[0].name, 'fly_to_location');
});

test('search verbs route entities to tracking, places to flying', () => {
  const sat = parseFreeVoiceCommand('Ich suche den Satelliten von Mark Rober');
  assert.equal(sat.calls[0].name, 'track_entity');
  assert.match(sat.calls[0].args.query, /mark rober/i);

  const ship = parseFreeVoiceCommand('suche das Schiff Ever Given');
  assert.equal(ship.calls[0].name, 'track_entity');

  const plane = parseFreeVoiceCommand('find that plane');
  assert.ok(plane.brainRoute, 'pronoun entity still brain-routes');
  assert.equal(plane.brainRoute.fallbackCalls[0].name, 'track_entity');

  const berlin = parseFreeVoiceCommand('suche Berlin');
  assert.equal(berlin.calls[0].name, 'fly_to_location');
  assert.equal(berlin.calls[0].args.query, 'berlin');

  const tokyo = parseFreeVoiceCommand('find Tokyo');
  assert.equal(tokyo.calls[0].name, 'fly_to_location');
  assert.equal(tokyo.calls[0].args.locationId || tokyo.calls[0].args.query, 'tokyo');
});

test('failed annotation gets one AI-corrected retry', async () => {
  const fetchImpl = async () => ({
    ok: true, status: 200,
    json: async () => ({ answer: '{"query": "Joint Defence Facility Pine Gap"}', blocked: false, error: null }),
  });
  const ran = [];
  const controller = createFreeVoiceController({
    announce: false,
    ui: { detail: { textContent: '' } },
    fetchImpl,
    runner: async (name, args) => {
      if (name === 'get_current_view_state' || name === 'get_entity_context') return { ok: true };
      ran.push(args.annotations?.[0]?.target);
      if (args.annotations?.[0]?.target !== 'Joint Defence Facility Pine Gap') {
        return { ok: false, action: name, error: 'Could not place one or more annotations' };
      }
      return { ok: true, action: name };
    },
    log: { push: () => {}, list: () => [] },
  });
  const result = await controller.handleText('zeichne das Frühwarnsystem bei Jervis Bay ein');
  assert.equal(result.ok, true);
  assert.deepEqual(ran, ['frühwarnsystem bei jervis bay', 'Joint Defence Facility Pine Gap']);
  assert.match(result.speech, /Pine Gap/);
});

test('degenerate brain pseudo-format executes with a clean confirmation', async () => {
  const fetchImpl = async () => ({
    ok: true, status: 200,
    json: async () => ({ answer: '``` \nfly_to_location\n{ "query": "Jervis Bay", "viewMode": "close" }\n```', blocked: false, error: null }),
  });
  const ran = [];
  const seen = [];
  const controller = createFreeVoiceController({
    announce: false,
    ui: { detail: { textContent: '' } },
    fetchImpl,
    runner: async (name, args) => {
      if (name === 'get_current_view_state' || name === 'get_entity_context') return { ok: true };
      ran.push([name, args]);
      return { ok: true, action: name };
    },
    log: { push: (who, text) => seen.push([who, text]), list: () => [] },
  });
  const result = await controller.handleChatText('zoome in den grossen see rein');
  assert.equal(result.ok, true);
  assert.deepEqual(ran, [['fly_to_location', { query: 'Jervis Bay', viewMode: 'close' }]]);
  assert.ok(seen.every(([, text]) => !text.includes('```')), 'no raw syntax leaks into the log');
  assert.ok(seen.some(([, text]) => /Jervis Bay/.test(text)), 'clean confirmation names the place');
});

test('type-shaped brain answer tracks the satellite, first call wins', async () => {
  const fetchImpl = async () => ({
    ok: true, status: 200,
    json: async () => ({ answer: '```json { "type": "track_entity", "query": "Mark Rober Satellite" } ``` ```json { "type": "fly_to_location", "query": "Area 51" } ```', blocked: false, error: null }),
  });
  const ran = [];
  const controller = createFreeVoiceController({
    announce: false,
    ui: { detail: { textContent: '' } },
    fetchImpl,
    runner: async (name, args) => {
      if (name === 'get_current_view_state' || name === 'get_entity_context') return { ok: true };
      ran.push([name, args]);
      return { ok: true, action: name };
    },
    log: { push: () => {}, list: () => [] },
  });
  const result = await controller.handleChatText('zeig mir mark robers satellit und seine umlaufbahn');
  assert.equal(result.ok, true);
  assert.deepEqual(ran, [['track_entity', { query: 'Mark Rober Satellite' }]]);
});

test('empty-args brain envelope never executes', async () => {
  const fetchImpl = async () => ({
    ok: true, status: 200,
    json: async () => ({ answer: '{"name": "fly_to_location", "args": {}}', blocked: false, error: null }),
  });
  const ran = [];
  const controller = createFreeVoiceController({
    announce: false,
    ui: { detail: { textContent: '' } },
    fetchImpl,
    runner: async (name, args) => {
      if (name === 'get_current_view_state' || name === 'get_entity_context') return { ok: true };
      ran.push([name, args]);
      return { ok: false, action: name, error: 'should not run' };
    },
    log: { push: () => {}, list: () => [] },
  });
  await controller.handleChatText('zeige mir irgendwo irgendwas');
  assert.ok(ran.every(([name, args]) => !(name === 'fly_to_location' && Object.keys(args || {}).length === 0)), 'no empty fly call');
});

test('failed place flight with satellite words retries as tracking', async () => {
  const fetchImpl = async () => ({ ok: false, status: 503, json: async () => null });
  const ran = [];
  const controller = createFreeVoiceController({
    announce: false,
    ui: { detail: { textContent: '' } },
    fetchImpl,
    runner: async (name, args) => {
      if (name === 'get_current_view_state' || name === 'get_entity_context') return { ok: true };
      ran.push([name, args.query]);
      if (name === 'fly_to_location') return { ok: false, action: name, error: 'Place "SAT GUS" not found' };
      return { ok: true, action: name, label: 'SATGUS' };
    },
    log: { push: () => {}, list: () => [] },
  });
  const result = await controller.handleText('zeige mir SAT GUS');
  assert.equal(result.ok, true);
  assert.deepEqual(ran, [['fly_to_location', 'sat gus'], ['track_entity', 'sat gus']]);
  assert.match(result.speech, /Verfolge|Tracking/);
});

test('failed regex command gets one AI reinterpretation, never a loop', async () => {
  const posted = [];
  const fetchImpl = async (url, init) => {
    posted.push(url);
    return { ok: true, status: 200, json: async () => ({ answer: '{"name": "select_nearest_aircraft", "args": {"layerId": "military"}, "say": "Zeige Militärflieger."}', blocked: false, error: null }) };
  };
  const ran = [];
  const controller = createFreeVoiceController({
    announce: false,
    ui: { detail: { textContent: '' } },
    fetchImpl,
    runner: async (name, args) => {
      ran.push([name, JSON.stringify(args)]);
      // Simulate the old stupid path: geocoding the whole sentence fails, and
      // no catalog object matches the gibberish either — so the AI
      // reinterpretation still gets its chance after the entity fallback.
      if (name === 'fly_to_location') return { ok: false, action: name, error: 'Place "irgendein militärflugzeug" not found' };
      if (name === 'track_entity') return { ok: false, action: name, error: 'Nothing matched' };
      return { ok: true, action: name };
    },
    log: { push: () => {}, list: () => [{ who: 'you', text: 'zeige mir irgendein militärflugzeug' }] },
  });
  // Force the old behavior: fly_to_location straight past the new intent.
  const result = await controller.handleText('fliege nach irgendein militärflugzeug nirgendwo');
  assert.equal(result.ok, true);
  assert.ok(ran.some(([name]) => name === 'select_nearest_aircraft'), 'AI reinterpreted to the right tool');
  assert.ok(posted.includes('/api/zai/chat') || posted.includes('/api/ollama/chat'));
});

test('AI retry never repeats the identical dead call', async () => {
  const fetchImpl = async () => ({
    ok: true, status: 200,
    json: async () => ({ answer: '{"name": "track_entity", "args": {"query": "xyz"}, "say": "ok"}', blocked: false, error: null }),
  });
  const ran = [];
  const controller = createFreeVoiceController({
    announce: false,
    ui: { detail: { textContent: '' } },
    fetchImpl,
    runner: async (name, args) => {
      // Scene snapshots are plumbing, not the deduplication under test.
      if (name === 'get_current_view_state' || name === 'get_entity_context') return { ok: true };
      ran.push(name);
      return { ok: false, action: name, error: 'nope' };
    },
    log: { push: () => {}, list: () => [] },
  });
  // Direct executeCalls is internal; drive via a failing single call through
  // the public path: unknown text that the brain maps onto the same dead tool.
  const result = await controller.handleText('track xyz');
  assert.equal(result.ok, false);
  assert.deepEqual(ran, ['track_entity'], 'identical call ran exactly once');
});

test('pronouns skip regex extraction and go straight to the brain', () => {
  const insel = parseFreeVoiceCommand('zeige mir seine Insel');
  assert.deepEqual(insel.calls, []);
  assert.equal(insel.brainRoute.text, 'zeige mir seine Insel');
  assert.deepEqual(insel.brainRoute.fallbackCalls, [
    { name: 'fly_to_location', args: { query: 'seine insel' } },
  ]);

  const dort = parseFreeVoiceCommand('fliege dorthin');
  assert.ok(dort.brainRoute, 'dorthin routes to brain');
  assert.deepEqual(dort.brainRoute.fallbackCalls[0].name, 'fly_to_location');

  const track = parseFreeVoiceCommand('track that plane');
  assert.ok(track.brainRoute, 'that plane routes to brain');

  const mark = parseFreeVoiceCommand('markiere es');
  assert.ok(mark.brainRoute, 'es routes to brain');

  const tokyo = parseFreeVoiceCommand('take me to Tokyo');
  assert.equal(tokyo.brainRoute, undefined);
  assert.equal(tokyo.calls[0].name, 'fly_to_location');
});

test('brain route executes with history and falls back honestly', async () => {
  const routedAnswer = '{"name": "fly_to_location", "args": {"query": "epstein island", "viewMode": "close"}, "say": "Fliege hin."}';
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    assert.ok(body.message.includes('epstein island'), 'history disambiguates');
    return { ok: true, status: 200, json: async () => ({ answer: routedAnswer, blocked: false, error: null }) };
  };
  const ran = [];
  const seen = [];
  const controller = createFreeVoiceController({
    announce: false,
    ui: { detail: { textContent: '' } },
    fetchImpl,
    runner: async (name, args) => {
      if (name === 'get_current_view_state' || name === 'get_entity_context') return { ok: true };
      ran.push([name, args]);
      return { ok: true, action: name };
    },
    log: {
      push: (who, text) => seen.push([who, text]),
      list: () => [
        { who: 'you', text: 'zeig mir epstein island' },
        { who: 'app', text: 'Fliege nach epstein island.' },
      ],
    },
  });
  const result = await controller.handleText('zeige mir seine Insel');
  assert.equal(result.ok, true);
  assert.deepEqual(ran, [['fly_to_location', { query: 'epstein island', viewMode: 'close' }]]);

  const deadRan = [];
  const dead = createFreeVoiceController({
    announce: false,
    ui: { detail: { textContent: '' } },
    fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }),
    runner: async (name, args) => {
      if (name === 'get_current_view_state' || name === 'get_entity_context') return { ok: true };
      deadRan.push([name, args]);
      return { ok: true, action: name };
    },
    log: { push: () => {}, list: () => [] },
  });
  const fallback = await dead.handleText('zeige mir seine Insel');
  assert.equal(fallback.ok, true);
  assert.deepEqual(deadRan, [['fly_to_location', { query: 'seine insel' }]], 'dead brain runs the regex fallback');
});

test('highlight and german boundary words annotate the state', () => {
  const hl = parseFreeVoiceCommand('HIGHLIGHT TEXAS BORDER');
  assert.equal(hl.calls[0].name, 'annotate_map');
  assert.equal(hl.calls[0].args.annotations[0].type, 'area');
  assert.equal(hl.calls[0].args.annotations[0].target, 'texas');

  const de = parseFreeVoiceCommand('markiere die grenzen von texas');
  assert.equal(de.calls[0].name, 'annotate_map');
  assert.equal(de.calls[0].args.annotations[0].target, 'texas');
  assert.equal(de.calls[0].args.annotations[0].type, 'area');

  const outline = parseFreeVoiceCommand('Outline the state of Texas.');
  assert.equal(outline.calls[0].args.annotations[0].type, 'area');

  const ze = parseFreeVoiceCommand('zeichne colorado ein');
  assert.equal(ze.calls[0].name, 'annotate_map');
  assert.equal(ze.calls[0].args.annotations[0].target, 'colorado');
  assert.equal(ze.calls[0].args.annotations[0].type, 'area');

  const um = parseFreeVoiceCommand('umrande colorado');
  assert.equal(um.calls[0].name, 'annotate_map');
  assert.equal(um.calls[0].args.annotations[0].target, 'colorado');
  assert.equal(um.calls[0].args.annotations[0].type, 'area');
});

test('superlative generic places go to the brain, not the geocoder', () => {
  for (const text of [
    'Zeige mir die Stadt mit den meisten Einwohnern',
    'Flieg zum höchsten Berg der Welt',
  ]) {
    const parsed = parseFreeVoiceCommand(text);
    assert.deepEqual(parsed.calls, [], text);
    assert.ok(parsed.brainRoute, text);
  }
  // Question-shaped superlatives reach the Q&A chain instead of geocoding.
  const biggest = parseFreeVoiceCommand('What is the biggest city in the world');
  assert.deepEqual(biggest.calls, []);
  assert.ok(biggest.brainRoute || biggest.geminiQuestion);
  // Named superlatives still fly directly.
  const fire = parseFreeVoiceCommand('Take me to the biggest fire');
  assert.ok(fire.calls.length > 0);
  const tokyo = parseFreeVoiceCommand('take me to Tokyo');
  assert.equal(tokyo.brainRoute, undefined);
});

function chatTestController(fetchImpl) {
  const seen = [];
  const ran = [];
  const controller = createFreeVoiceController({
    announce: false,
    ui: { detail: { textContent: '' } },
    fetchImpl,
    runner: async (name, args) => {
      if (name === 'get_current_view_state' || name === 'get_entity_context') return { ok: true };
      ran.push([name, args]);
      return { ok: true, action: name };
    },
    log: { push: (who, text) => seen.push([who, text]), list: () => [] },
    captureViewport: async () => 'data:image/jpeg;base64,AAA=',
  });
  return { seen, ran, controller };
}

test('typed chat goes to ollama-vision first, with screenshot', async () => {
  const posted = [];
  const fetchImpl = async (url, init) => {
    posted.push([url, JSON.parse(init.body)]);
    return { ok: true, status: 200, json: async () => ({ answer: '{"name": "fly_to_location", "args": {"query": "hafenstadt"}, "say": "Fliege hin."}', blocked: false, error: null }) };
  };
  const { seen, ran, controller } = chatTestController(fetchImpl);
  const result = await controller.handleChatText('zoome in den hafen');
  assert.equal(result.ok, true);
  assert.deepEqual(ran, [['fly_to_location', { query: 'hafenstadt' }]]);
  assert.equal(posted[0][0], '/api/ollama/chat');
  assert.deepEqual(posted[0][1].images, ['data:image/jpeg;base64,AAA=']);
  assert.ok(posted[0][1].system.includes('screenshot') || posted[0][1].system.includes('Screenshot'));
  assert.ok(seen.some(([who, text]) => who === 'ollama' || (who === 'app' && text.includes('hafenstadt'))));
});

test('typed chat answers prose directly, falls back to parser offline', async () => {
  const prose = async () => ({ ok: true, status: 200, json: async () => ({ answer: 'Das ist der Hamburger Hafen, Europas größter Seehafen.', blocked: false, error: null }) });
  const first = chatTestController(prose);
  const result = await first.controller.handleChatText('was siehst du?');
  assert.equal(result.ok, true);
  assert.match(result.speech, /Hamburger Hafen/);

  const down = async () => ({ ok: false, status: 503, json: async () => ({}) });
  const second = chatTestController(down);
  const fallback = await second.controller.handleChatText('take me to tokyo');
  assert.equal(fallback.ok, true);
  assert.deepEqual(second.ran, [['fly_to_location', { locationId: 'tokyo' }]]);
});

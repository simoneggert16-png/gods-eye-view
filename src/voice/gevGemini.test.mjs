import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGeminiRequest,
  buildGeminiTTSRequest,
  buildLiveAudioMessage,
  buildLiveSetupMessage,
  buildLiveTokenRequest,
  buildSeeRequest,
  downsampleToPcm16,
  extractGeminiAnswerText,
  extractGeminiTTSAudio,
  GEMINI_DEFAULT_LIVE_MODEL,
  GEMINI_DEFAULT_MODEL,
  GEMINI_DEFAULT_TTS_MODEL,
  GEMINI_DEFAULT_TTS_VOICE,
  GEMINI_LIVE_WS_URL,
  GEMINI_MAX_CONTEXT_CHARS,
  GEMINI_MAX_QUESTION_CHARS,
  GEMINI_SYSTEM_PROMPT,
  isValidGeminiModel,
  isValidGeminiVoice,
  parseLiveServerMessage,
  resolveGeminiLiveModel,
  resolveGeminiModel,
  resolveGeminiVoice,
  stableActionKey,
  toGeminiFunctionDeclarations,
} from './gevGemini.js';

test('default model is the current flash id for new projects', () => {
  assert.equal(GEMINI_DEFAULT_MODEL, 'gemini-3.6-flash');
  assert.ok(isValidGeminiModel(GEMINI_DEFAULT_MODEL));
});

test('model gate rejects path-injection and garbage', () => {
  assert.equal(isValidGeminiModel('../evil'), false);
  assert.equal(isValidGeminiModel('model?key=x'), false);
  assert.equal(isValidGeminiModel('model name'), false);
  assert.equal(isValidGeminiModel(''), false);
  assert.equal(isValidGeminiModel(null), false);
  assert.equal(isValidGeminiModel('gemini-3.6-flash'), true);
  assert.equal(resolveGeminiModel('../evil'), GEMINI_DEFAULT_MODEL);
  assert.equal(resolveGeminiModel(' gemini-3.6-flash '), 'gemini-3.6-flash');
});

test('request builder caps question and context, carries grounding prompt', () => {
  const { model, body } = buildGeminiRequest({
    question: ` ${'q'.repeat(600)} `,
    contextText: ` ${'c'.repeat(3000)} `,
    model: 'gemini-3.6-flash',
  });
  assert.equal(model, 'gemini-3.6-flash');
  const text = body.contents[0].parts[0].text;
  assert.ok(text.length <= GEMINI_MAX_QUESTION_CHARS + GEMINI_MAX_CONTEXT_CHARS + 40);
  assert.ok(text.includes('Live scene context:'));
  assert.equal(body.system_instruction.parts[0].text, GEMINI_SYSTEM_PROMPT);
  assert.equal(body.generationConfig.maxOutputTokens, 300);

  const bare = buildGeminiRequest({ question: 'What city is this?' });
  assert.equal(bare.model, GEMINI_DEFAULT_MODEL);
  assert.ok(!bare.body.contents[0].parts[0].text.includes('Live scene context:'));
});

test('answer extractor joins parts and reports blocks honestly', () => {
  const ok = extractGeminiAnswerText({
    candidates: [{ content: { parts: [{ text: 'This is ' }, { text: 'Austin.' }] } }],
  });
  assert.deepEqual(ok, { text: 'This is Austin.', blocked: false });

  const empty = extractGeminiAnswerText({ candidates: [] });
  assert.equal(empty.text, null);
  assert.equal(empty.blocked, true);

  const safety = extractGeminiAnswerText({
    promptFeedback: { blockReason: 'SAFETY' },
    candidates: [{ finishReason: 'SAFETY', content: { parts: [] } }],
  });
  assert.equal(safety.blocked, true);
  assert.match(safety.reason, /SAFETY/);
});

test('tts request carries audio modality and a gated voice', () => {
  assert.equal(GEMINI_DEFAULT_TTS_MODEL, 'gemini-2.5-flash-preview-tts');
  assert.equal(GEMINI_DEFAULT_TTS_VOICE, 'Charon');
  assert.equal(isValidGeminiVoice('Charon'), true);
  assert.equal(isValidGeminiVoice('../evil'), false);
  assert.equal(isValidGeminiVoice(''), false);
  assert.equal(resolveGeminiVoice('../evil'), 'Charon');
  const { model, body } = buildGeminiTTSRequest({ text: ' Hallo. ', voice: 'Kore' });
  assert.equal(model, GEMINI_DEFAULT_TTS_MODEL);
  assert.deepEqual(body.generationConfig.responseModalities, ['AUDIO']);
  assert.equal(body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, 'Kore');
  assert.equal(body.contents[0].parts[0].text, 'Hallo.');
});

test('tts extractor returns base64 pcm and reports blocks', () => {
  const ok = extractGeminiTTSAudio({
    candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: 'AAA=' } }] } }],
  });
  assert.equal(ok.audio, 'AAA=');
  assert.equal(ok.blocked, false);
  assert.match(ok.mimeType, /pcm/);

  const empty = extractGeminiTTSAudio({ candidates: [] });
  assert.equal(empty.audio, null);
  assert.equal(empty.blocked, true);
});

test('live token request is a flat single-use auth token', () => {
  const before = Date.now();
  const body = buildLiveTokenRequest();
  assert.equal(body.uses, 1);
  const skew = Date.parse(body.expireTime) - before;
  assert.ok(skew > 29 * 60 * 1000 && skew <= 30 * 60 * 1000 + 2000);
  assert.ok(Date.parse(body.newSessionExpireTime) - before <= 60 * 1000 + 2000);
});

test('live setup nests modalities under generationConfig', () => {
  assert.equal(GEMINI_DEFAULT_LIVE_MODEL, 'gemini-2.5-flash-native-audio-preview-12-2025');
  assert.match(GEMINI_LIVE_WS_URL, /^wss:.*BidiGenerateContentConstrained$/);
  assert.equal(resolveGeminiLiveModel('../evil'), GEMINI_DEFAULT_LIVE_MODEL);
  const msg = buildLiveSetupMessage({ sceneContext: 'Austin, Texas' });
  // A top-level responseModalities is rejected with 1007 — it must nest.
  assert.equal(msg.setup.responseModalities, undefined);
  assert.deepEqual(msg.setup.generationConfig.responseModalities, ['AUDIO']);
  assert.match(msg.setup.model, /gemini-2\.5-flash-native-audio/);
  assert.ok(msg.setup.systemInstruction.parts[0].text.includes('Austin, Texas'));
  assert.deepEqual(msg.setup.inputAudioTranscription, {});
  assert.deepEqual(msg.setup.outputAudioTranscription, {});
});

test('live server parser surfaces audio, transcripts and lifecycle', () => {
  assert.deepEqual(parseLiveServerMessage({ setupComplete: {} }), [{ type: 'setupComplete' }]);
  assert.deepEqual(parseLiveServerMessage('nope'), [{ type: 'unknown' }]);
  assert.deepEqual(parseLiveServerMessage(null), [{ type: 'unknown' }]);
  const events = parseLiveServerMessage({
    serverContent: {
      interrupted: true,
      modelTurn: { parts: [{ text: 'thinking trace — never surfaced' }, { inlineData: { data: 'AAA=', mimeType: 'audio/pcm;rate=24000' } }] },
      inputTranscription: { text: 'take me to tokyo' },
      outputTranscription: { text: 'Flying to Tokyo.' },
      turnComplete: true,
    },
  });
  assert.deepEqual(events.map((e) => e.type), ['interrupted', 'audio', 'inputText', 'outputText', 'turnComplete']);
  assert.equal(events[1].base64, 'AAA=');
  assert.equal(events[2].text, 'take me to tokyo');
});

test('downsample converts 48k float to 16k pcm16', () => {
  const input = new Float32Array([0, 0.5, -0.5, 1, -1, 0.25]);
  const out = downsampleToPcm16(input, 48000, 16000);
  assert.ok(out instanceof Int16Array);
  assert.equal(out.length, 2);
  assert.equal(out[0], 0);
  assert.equal(downsampleToPcm16(new Float32Array(0), 48000).length, 0);
  assert.equal(downsampleToPcm16(null, 48000).length, 0);
});

test('live audio message carries base64 pcm with the right mime', () => {
  const toBase64 = (bytes) => Buffer.from(bytes).toString('base64');
  const msg = buildLiveAudioMessage(new Int16Array([0, 32767, -32768]), toBase64);
  assert.equal(msg.realtimeInput.audio.mimeType, 'audio/pcm;rate=16000');
  assert.deepEqual(Buffer.from(msg.realtimeInput.audio.data, 'base64'), Buffer.from([0, 0, 255, 127, 0, 128]));
});

test('openai tools convert to gemini declarations without rejected keys', () => {
  const converted = toGeminiFunctionDeclarations([
    { type: 'function', name: 'fly_to_location', description: 'Fly somewhere', parameters: { type: 'object', additionalProperties: false, properties: { query: { type: 'string', maxLength: 160 }, rangeM: { type: 'number', minimum: 100 } }, required: [] } },
    { type: 'not-a-function', name: 'skip_me' },
    { name: 'nameless-parameters' },
    null,
  ]);
  assert.equal(converted.length, 1);
  assert.equal(converted[0].name, 'fly_to_location');
  assert.equal(converted[0].type, undefined);
  assert.equal(converted[0].parameters.additionalProperties, undefined);
  assert.equal(converted[0].parameters.properties.query.maxLength, undefined);
  assert.equal(converted[0].parameters.properties.rangeM.minimum, 100);
  assert.deepEqual(converted[0].parameters.required, []);
  assert.equal(toGeminiFunctionDeclarations(null).length, 0);
  assert.equal(toGeminiFunctionDeclarations('nope').length, 0);
});

test('empty schemas normalize, setup carries declarations', () => {
  const converted = toGeminiFunctionDeclarations([
    { type: 'function', name: 'analyst_query', description: 'Ask data', parameters: { type: 'object', properties: { filters: { type: 'array', items: { type: 'object', properties: { value: {} } } } } } },
  ]);
  const value = converted[0].parameters.properties.filters.items.properties.value;
  assert.deepEqual(value, { type: 'string' });
  const setup = buildLiveSetupMessage({ tools: converted });
  assert.equal(setup.setup.tools[0].functionDeclarations.length, 1);
  const bare = buildLiveSetupMessage({});
  assert.equal(bare.setup.tools, undefined);
});

test('action signatures canonicalize shuffled args', () => {
  const a = stableActionKey('fly_to_location', { query: 'tokyo', rangeM: 100 });
  const b = stableActionKey('fly_to_location', { rangeM: 100, query: 'tokyo' });
  assert.equal(a, b);
  assert.notEqual(a, stableActionKey('fly_to_location', { query: 'paris' }));
  assert.notEqual(a, stableActionKey('zoom_to_globe', {}));
});

test('see request carries camelCase inline image plus grounded question', () => {
  const { model, body } = buildSeeRequest({
    imageBase64: 'data:image/jpeg;base64,AAA=',
    question: 'Was siehst du?',
    contextText: 'Austin, Texas',
  });
  assert.equal(model, GEMINI_DEFAULT_MODEL);
  const parts = body.contents[0].parts;
  assert.equal(parts[0].inlineData.mimeType, 'image/jpeg');
  assert.equal(parts[0].inlineData.data, 'AAA=');
  assert.ok(parts[1].text.includes('Austin, Texas'));
  assert.ok(parts[1].text.includes('Was siehst du?'));
  assert.equal(body.generationConfig.maxOutputTokens, 400);

  const bare = buildSeeRequest({ imageBase64: 'AAA=' });
  assert.ok(bare.body.contents[0].parts[1].text.includes('What do you see?'));
});

test('grounding is opt-in and well-formed', () => {
  const plain = buildGeminiRequest({ question: 'hi' });
  assert.equal(plain.body.tools, undefined);
  const grounded = buildGeminiRequest({ question: 'biggest city?', groundSearch: true });
  assert.deepEqual(grounded.body.tools, [{ google_search: {} }]);
});

/**
 * Gemini Live voice transport — realtime dialog over WebSocket.
 *
 * Sits next to the OpenAI Realtime path (`gevRealtime.js`, preferred when an
 * OpenAI key exists) and the keyless local path (`gevFreeVoice.js`). Live is
 * chosen when a Gemini key is configured but no OpenAI key is.
 *
 * Division of labor (deliberate, Phase 1):
 *   - Live streams STT (input transcription) + TTS (native audio) + open
 *     answers with sub-second latency, interruptible by barging in.
 *   - Map COMMANDS still run through the same local `runGevAction` runner
 *     via `parseFreeVoiceCommand` on the live transcript; the result is sent
 *     back as one text turn so the MODEL speaks the confirmation — the app
 *     itself stays silent to avoid double speech.
 *   - The long-lived Gemini key never touches the browser: the dev server
 *     mints a single-use ephemeral token (`/api/gemini/live-token`).
 *
 * @module voice/gevGeminiLive
 */

import {
  buildLiveAudioMessage,
  buildLiveSetupMessage,
  downsampleToPcm16,
  GEMINI_LIVE_OUTPUT_RATE,
  GEMINI_LIVE_WS_URL,
  parseLiveServerMessage,
  stableActionKey,
  toGeminiFunctionDeclarations,
} from './gevGemini.js';
import { decodePcm16ToFloat32, parseFreeVoiceCommand } from './gevFreeVoice.js';

/** Largest mic chunk (samples) forwarded per message. */
export const LIVE_MIC_CHUNK_SAMPLES = 3200;

/** Max automatic reconnects after an unexpected drop. */
export const LIVE_MAX_RECONNECTS = 3;

/** Reconnect backoff between attempts (ms). */
export const LIVE_RECONNECT_DELAY_MS = 2000;

/** Window in which a transcript action and a tool call collapse (ms). */
export const LIVE_ACTION_DEDUP_MS = 20000;

/** AudioWorklet capture source (Blob-URL, no extra file to ship). */
const LIVE_CAPTURE_WORKLET = `
class GevLiveCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(0);
  }
  process(inputs) {
    const channel = inputs?.[0]?.[0];
    if (channel && channel.length) {
      const next = new Float32Array(this.buffer.length + channel.length);
      next.set(this.buffer, 0);
      next.set(channel, this.buffer.length);
      this.buffer = next;
      while (this.buffer.length >= ${LIVE_MIC_CHUNK_SAMPLES}) {
        this.port.postMessage(this.buffer.slice(0, ${LIVE_MIC_CHUNK_SAMPLES}));
        this.buffer = this.buffer.slice(${LIVE_MIC_CHUNK_SAMPLES});
      }
    }
    return true;
  }
}
registerProcessor('gev-live-capture', GevLiveCapture);
`;

/** Base64-encode bytes without blowing the call stack on big chunks. */
export function bytesToBase64(bytes, encoder) {
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(0);
  const encode = encoder || ((bin) => {
    if (typeof btoa !== 'undefined') return btoa(bin);
    if (typeof Buffer !== 'undefined') return Buffer.from(bin, 'binary').toString('base64');
    throw new Error('No base64 encoder available');
  });
  let binary = '';
  const STEP = 8192;
  for (let i = 0; i < input.length; i += STEP) {
    binary += String.fromCharCode(...input.subarray(i, i + STEP));
  }
  return encode(binary);
}

/** Decode a base64 PCM chunk for tests/diagnostics (inverse of the above). */
export function base64ToBytes(base64, decoder) {
  const decode = decoder || ((b64) => {
    if (typeof atob !== 'undefined') return atob(b64);
    if (typeof Buffer !== 'undefined') return Buffer.from(b64, 'base64').toString('binary');
    throw new Error('No base64 decoder available');
  });
  const binary = decode(String(base64 || ''));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i) & 0xff;
  return out;
}

/**
 * Create the production Live playback sink: 24 kHz PCM chunks scheduled
 * back-to-back on one AudioContext (gapless model speech).
 *
 * @param {object} [options]
 * @param {AudioContext} [options.audioContext] - Injectable context (tests).
 * @param {()=>AudioContext} [options.createContext] - Injectable factory (tests).
 */
export function createLiveAudioOutput({ audioContext = null, createContext = null } = {}) {
  let ctx = audioContext || null;
  let nextTime = 0;
  const sources = new Set();

  function ensureCtx() {
    if (ctx) return ctx;
    if (typeof createContext === 'function') {
      ctx = createContext();
      return ctx;
    }
    const env = typeof window !== 'undefined' ? window : null;
    const Ctor = env?.AudioContext || env?.webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor({ sampleRate: GEMINI_LIVE_OUTPUT_RATE });
    return ctx;
  }

  return {
    playPcm(base64) {
      const context = ensureCtx();
      if (!context) return false;
      let samples;
      try {
        samples = decodePcm16ToFloat32(base64ToBytes(base64));
      } catch {
        return false;
      }
      if (!samples.length) return false;
      try {
        try { context.resume?.(); } catch { /* gesture-gated */ }
        const now = Number(context.currentTime) || 0;
        if (!(nextTime > now)) nextTime = now;
        const buffer = context.createBuffer(1, samples.length, GEMINI_LIVE_OUTPUT_RATE);
        buffer.getChannelData(0).set(samples);
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(context.destination);
        sources.add(source);
        source.onended = () => sources.delete(source);
        source.start(nextTime);
        nextTime += samples.length / GEMINI_LIVE_OUTPUT_RATE;
        return true;
      } catch {
        return false;
      }
    },
    stop() {
      for (const source of [...sources]) {
        try { source.stop(); } catch { /* already stopped */ }
      }
      sources.clear();
      nextTime = 0;
    },
  };
}

/**
 * Create the Gemini Live controller.
 *
 * @param {object} options
 * @param {(name:string, args:object)=>Promise<object>} options.runner - Same runGevAction runner.
 * @param {{ detail?: { textContent: string } }} [options.ui] - Optional readout.
 * @param {(url:string, init:object)=>Promise<{ok:boolean,status:number,json:()=>Promise<unknown>}>} [options.fetchImpl]
 * @param {new (url:string)=>WebSocket} [options.wsCtor] - Injectable socket (tests).
 * @param {{ playPcm:(base64:string)=>void, stop:()=>void }} [options.audioEnv] - Injectable playback (tests).
 * @param {()=>Promise<string>} [options.getSceneContext] - Grounding text for setup.
 * @param {'auto'|'off'} [options.mic] - 'off' skips capture (tests/headless).
 * @param {number} [options.updateDebounceMs] - Settle delay after camera motion (default 2500).
 * @param {number} [options.updateMinIntervalMs] - Min gap between scene updates (default 20000).
 * @param {object} [options.log] - Conversation log ({ push(who, text, calls) }).
 * @param {()=>Promise<string|null>} [options.captureViewport] - Screenshot (data URL) or null.
 */
export function createGeminiLiveController({
  runner,
  ui = null,
  fetchImpl = null,
  wsCtor = null,
  audioEnv = null,
  getSceneContext = null,
  mic = 'auto',
  updateDebounceMs = 2500,
  updateMinIntervalMs = 20000,
  log = null,
  captureViewport = null,
} = {}) {
  if (typeof runner !== 'function') throw new Error('createGeminiLiveController needs a runner function');
  const doFetch = fetchImpl || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
  const SocketCtor = wsCtor || (typeof WebSocket !== 'undefined' ? WebSocket : null);

  const state = {
    active: false,
    socket: null,
    sessionReady: false,
    reconnects: 0,
    reconnectTimer: null,
    micStream: null,
    micNodes: null,
    inputTranscript: '',
    outputTranscript: '',
    lastHeard: '',
    lastResult: null,
    lastPushedContext: '',
    lastPushAt: 0,
    viewDirtyTimer: null,
    toolDeclarations: [],
    recentActions: new Map(),
  };

  const setDetail = (text) => {
    try {
      if (ui?.detail) ui.detail.textContent = String(text || '').toUpperCase().slice(0, 120);
    } catch { /* readout is best effort */ }
  };
  const logTurn = (who, text, calls) => {
    try { log?.push?.(who, text, calls); } catch { /* logging never breaks voice */ }
  };

  async function defaultSceneContext() {
    try {
      const [view, entity] = await Promise.all([
        Promise.resolve().then(() => runner('get_current_view_state', {})).catch(() => null),
        Promise.resolve().then(() => runner('get_entity_context', { scope: 'auto' })).catch(() => null),
      ]);
      return JSON.stringify({ view, entity }).slice(0, 1500);
    } catch {
      return '';
    }
  }

  function sendJson(message) {
    try {
      if (state.socket && state.socket.readyState === 1) {
        state.socket.send(JSON.stringify(message));
        return true;
      }
    } catch { /* socket half-open */ }
    return false;
  }

  function stopAudio() {
    try { audioEnv?.stop?.(); } catch { /* noop */ }
  }

  function playAudioChunk(base64) {
    try {
      audioEnv?.playPcm?.(base64);
    } catch { /* one bad chunk must not kill the turn */ }
  }

  function summarizeOutcome(outcome) {
    if (!outcome) return 'no result';
    if (outcome.ok === false) return `failed: ${outcome.error || outcome.result?.error || 'unknown error'}`;
    const action = outcome.result?.action || outcome.name || 'action';
    return `ok (${action})`;
  }

  /** Normalize toolCall args (object or JSON string) into a plain object. */
  function normalizeToolArgs(args) {
    if (args && typeof args === 'object' && !Array.isArray(args)) return args;
    if (typeof args === 'string' && args.trim()) {
      try {
        const parsed = JSON.parse(args);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
      } catch { /* fall through to empty */ }
    }
    return {};
  }

  /** Remember a fresh outcome so a twin call collapses instead of re-running. */
  function rememberAction(name, args, outcome) {
    try {
      state.recentActions.set(stableActionKey(name, args), { outcome, at: Date.now() });
      while (state.recentActions.size > 60) {
        const oldest = state.recentActions.keys().next().value;
        if (oldest === undefined) break;
        state.recentActions.delete(oldest);
      }
    } catch { /* dedup is best effort */ }
  }

  /** Reuse a twin outcome from the transcript path (or an earlier tool). */
  function recallAction(name, args) {
    try {
      const hit = state.recentActions.get(stableActionKey(name, args));
      if (hit && Date.now() - hit.at < LIVE_ACTION_DEDUP_MS) return hit.outcome;
      if (hit) state.recentActions.delete(stableActionKey(name, args));
    } catch { /* dedup is best effort */ }
    return null;
  }

  async function readSceneContext() {
    try {
      const text = await (typeof getSceneContext === 'function' ? getSceneContext() : defaultSceneContext());
      return String(text || '').slice(0, 1500);
    } catch {
      return '';
    }
  }

  /**
   * Execute Live function calls through the map runner and answer every one:
   * an unanswered call strands the model's turn (same deadlock contract as
   * the OpenAI path). Twins of transcript actions reuse the cached outcome
   * instead of flying twice.
   */
  async function handleToolCalls(functionCalls) {
    const calls = Array.isArray(functionCalls) ? functionCalls : [];
    const responses = [];
    const logged = [];
    for (const call of calls) {
      const name = String(call?.name || '').trim();
      if (!name) continue;
      const args = normalizeToolArgs(call?.args);
      const id = typeof call?.id === 'string' && call.id ? call.id : `${name}-${Date.now()}`;
      let outcome = recallAction(name, args);
      if (!outcome) {
        try {
          const result = await runner(name, args);
          outcome = { name, args, ok: result?.ok !== false, result };
        } catch (error) {
          outcome = { name, args, ok: false, error: error?.message || String(error) };
        }
        rememberAction(name, args, outcome);
      }      const summary = `${name}: ${summarizeOutcome(outcome)}`;
      responses.push({ name, id, response: { output: summary } });
      logged.push({ name, ok: outcome.ok, ...(outcome.ok ? {} : { error: outcome.error || outcome.result?.error }) });
    }
    if (responses.length) {
      const answered = sendJson({ toolResponse: { functionResponses: responses } });
      logTurn('app', answered ? 'Tools executed.' : 'Tool results could not be sent (socket not open).', logged);
      if (answered) {
        setDetail(`TOOLS: ${logged.map((c) => c.name).join(', ').slice(0, 80)} · GEMINI LIVE`);
      }
    }
  }

  /**
   * Look at the screen through the Live session: capture the viewport and
   * send it as an image turn so the MODEL sees and describes it natively
   * (voice answer, no extra proxy roundtrip). Falls back to a context-only
   * text turn when capture is impossible.
   */
  async function describeLiveView(question, lang = 'en') {
    const prompt = lang === 'de'
      ? `Beschreibe, was du auf diesem Blick siehst, und nenne Fakten dazu: ${question}`
      : `Describe what you see in this view and give facts about it: ${question}`;
    let image = null;
    try {
      image = typeof captureViewport === 'function' ? await captureViewport() : null;
    } catch {
      image = null;
    }
    const base64 = String(image || '').replace(/^data:[^,]*,/, '');
    if (base64 && sendJson({ realtimeInput: { video: { mimeType: 'image/jpeg', data: base64 } } })) {
      sendJson({ realtimeInput: { text: prompt } });
      setDetail('SHOWING THE LIVE VIEW · GEMINI LIVE');
      return { ok: true };
    }
    // No capture (or dead socket): ask from scene context instead of silence.
    const context = await readSceneContext();
    const asked = sendJson({ realtimeInput: { text: `${prompt} (No screenshot available — answer from this scene context: ${context || 'unknown view'})` } });
    if (!asked) logTurn('app', 'Screen image could not be sent (Live session not open).');
    return { ok: asked };
  }

  /** Run transcript commands locally, then let the MODEL speak the result. */
  async function handleTranscript(transcript) {
    const text = String(transcript || '').trim();
    if (!text) return;
    state.lastHeard = text;
    logTurn('you', text);
    const parsed = parseFreeVoiceCommand(text);
    if (parsed.see) {
      await describeLiveView(parsed.see, parsed.lang);
      return;
    }
    if (!parsed.calls.length) return; // chatter/questions: the model answers from audio directly
    const outcomes = [];
    for (const call of parsed.calls) {
      try {
        const result = await runner(call.name, call.args);
        outcomes.push({ name: call.name, args: call.args, ok: result?.ok !== false, result });
      } catch (error) {
        outcomes.push({ name: call.name, args: call.args, ok: false, error: error?.message || String(error) });
      }
    }
    const summary = outcomes.map((o) => `${o.name}: ${summarizeOutcome(o)}`).join('; ');
    state.lastResult = { ok: outcomes.every((o) => o.ok), outcomes };
    for (const outcome of outcomes) rememberAction(outcome.name, outcome.args, outcome);
    setDetail(`${parsed.speech} · GEMINI LIVE`);
    logTurn('app', parsed.speech, outcomes.map((o) => ({ name: o.name, ok: o.ok, ...(o.ok ? {} : { error: o.error }) })));
    // One text turn so the model — not the app — voices the confirmation.
    // The FRESH post-flight view rides along, so follow-ups ("what city is
    // this?") answer from where the camera just landed, not where it was.
    const freshContext = await readSceneContext();
    if (freshContext) state.lastPushedContext = freshContext;
    state.lastPushAt = Date.now();
    const narrated = sendJson({ realtimeInput: { text: `The user asked the map to: "${text}". Executed locally: ${summary}. Confirm to the user in one short sentence.${freshContext ? ` Current view: ${freshContext}` : ''}` } });
    if (!narrated) logTurn('app', 'Confirmation turn could not be sent (socket not open).');
  }

  /**
   * Push a silent scene update after manual camera motion (mouse-driven
   * flights the command loop never sees). Throttled: identical context is
   * skipped and updates are spaced updateMinIntervalMs apart, so orbiting
   * the planet does not narrate itself — the model replies "noted".
   *
   * @returns {Promise<boolean>} True when an update was sent.
   */
  async function pushSceneUpdate() {
    if (!state.active || !state.sessionReady) return false;
    if (Date.now() - state.lastPushAt < updateMinIntervalMs) return false;
    const context = await readSceneContext();
    if (!context || context === state.lastPushedContext) return false;
    const sent = sendJson({ realtimeInput: { text: `Scene update — the camera moved. Do not announce this, reply with exactly one word: noted. New view: ${context}` } });
    if (sent) {
      state.lastPushedContext = context;
      state.lastPushAt = Date.now();
    }
    return sent;
  }

  /**
   * Called on camera moveEnd (wired in gevRealtime init). Debounces the
   * motion burst, then pushes one throttled scene update.
   */
  function noteViewChanged() {
    if (!state.active) return;
    try { clearTimeout(state.viewDirtyTimer); } catch { /* noop */ }
    state.viewDirtyTimer = setTimeout(() => {
      state.viewDirtyTimer = null;
      if (!state.active) return;
      void pushSceneUpdate();
    }, updateDebounceMs);
  }

  function unwatchCamera() {
    const unwatch = state.cameraUnwatch;
    state.cameraUnwatch = null;
    if (typeof unwatch === 'function') {
      try { unwatch(); } catch { /* listener already gone */ }
    }
  }

  /**
   * Follow the Cesium camera: every settled manual flight refreshes what the
   * model believes is on screen. Safe to call without a viewer (returns
   * false); detached automatically on stop().
   *
   * Also follows selection: clicks (gev:entity-selected) and tracking changes
   * (viewer.trackedEntityChanged) refresh the selected-entity context the
   * model answers "what's this?" from. Same debounce/throttle, same skip
   * when nothing changed — a selection that only re-affirms the view is free.
   */
  function watchCamera(viewer) {
    unwatchCamera();
    state.viewer = viewer || null;
    let watched = false;
    try {
      const moveEnd = viewer?.camera?.moveEnd;
      if (moveEnd && typeof moveEnd.addEventListener === 'function') {
        const listener = () => noteViewChanged();
        const remove = moveEnd.addEventListener(listener);
        state.cameraUnwatch = typeof remove === 'function'
          ? remove
          : () => { try { moveEnd.removeEventListener(listener); } catch { /* noop */ } };
        watched = true;
      }
    } catch { /* camera watch is best effort */ }
    try {
      const trackedChanged = viewer?.trackedEntityChanged;
      if (trackedChanged && typeof trackedChanged.addEventListener === 'function') {
        const listener = () => noteViewChanged();
        const remove = trackedChanged.addEventListener(listener);
        const prior = state.cameraUnwatch;
        state.cameraUnwatch = () => {
          try { prior?.(); } catch { /* noop */ }
          if (typeof remove === 'function') remove();
          else { try { trackedChanged.removeEventListener(listener); } catch { /* noop */ } }
        };
        watched = true;
      }
    } catch { /* selection watch is best effort */ }
    try {
      const env = typeof window !== 'undefined' ? window : null;
      if (env?.addEventListener) {
        const listener = () => noteViewChanged();
        env.addEventListener('gev:entity-selected', listener);
        const prior = state.cameraUnwatch;
        state.cameraUnwatch = () => {
          try { prior?.(); } catch { /* noop */ }
          try { env.removeEventListener('gev:entity-selected', listener); } catch { /* noop */ }
        };
        watched = true;
      }
    } catch { /* selection watch is best effort */ }
    return watched;
  }

  async function handleServerFrame(raw) {
    let frame = raw;
    // Live frames arrive as Blob in browsers — read before parsing.
    if (frame && typeof frame === 'object' && typeof frame.text === 'function' && typeof frame !== 'string') {
      try {
        frame = await frame.text();
      } catch {
        return;
      }
    }
    for (const event of parseLiveServerMessage(frame)) {
      if (event.type === 'setupComplete') {
        state.sessionReady = true;
        state.reconnects = 0;
        setDetail('LIVE — LISTENING · GEMINI LIVE');
      } else if (event.type === 'audio') {
        playAudioChunk(event.base64);
      } else if (event.type === 'inputText') {
        // Barge-in: stop model audio the moment the user speaks.
        stopAudio();
        state.inputTranscript += event.text;
        setDetail(`${state.inputTranscript} · GEMINI LIVE`);
      } else if (event.type === 'outputText') {
        state.outputTranscript = `${state.outputTranscript || ''}${event.text}`;
        setDetail(`${event.text} · GEMINI LIVE`);
      } else if (event.type === 'interrupted') {
        stopAudio();
      } else if (event.type === 'turnComplete' || event.type === 'generationComplete') {
        const transcript = state.inputTranscript.trim();
        state.inputTranscript = '';
        const spoken = String(state.outputTranscript || '').trim();
        state.outputTranscript = '';
        if (spoken) logTurn('gemini', spoken);
        if (transcript) void handleTranscript(transcript);
      } else if (event.type === 'toolCall') {
        const functionCalls = event.toolCall?.functionCalls
          || event.toolCall?.function_calls
          || event.toolCall;
        void handleToolCalls(functionCalls);
      }
    }
  }

  function teardownSocket() {
    const socket = state.socket;
    state.socket = null;
    state.sessionReady = false;
    try { socket?.close?.(1000, 'client stop'); } catch { /* noop */ }
  }

  function teardownMic() {
    const nodes = state.micNodes;
    state.micNodes = null;
    try { nodes?.processor?.disconnect?.(); } catch { /* noop */ }
    try { nodes?.source?.disconnect?.(); } catch { /* noop */ }
    try { nodes?.context?.close?.(); } catch { /* noop */ }
    const stream = state.micStream;
    state.micStream = null;
    try { stream?.getTracks?.().forEach?.((track) => track.stop?.()); } catch { /* noop */ }
  }

  async function startMic(socketSend) {
    const media = typeof navigator !== 'undefined' ? navigator.mediaDevices : null;
    if (!media?.getUserMedia) return { ok: false, reason: 'no-mic' };
    const Ctor = typeof AudioContext !== 'undefined' ? AudioContext
      : (typeof window !== 'undefined' ? window.AudioContext || window.webkitAudioContext : null);
    if (!Ctor) return { ok: false, reason: 'no-webaudio' };
    const stream = await media.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    const context = new Ctor();
    try { await context.resume?.(); } catch { /* gesture-gated */ }
    const source = context.createMediaStreamSource(stream);
    const inputRate = Number(context.sampleRate) || 48000;
    const forward = (samples) => {
      const pcm = downsampleToPcm16(samples, inputRate);
      if (!pcm.length) return;
      socketSend(buildLiveAudioMessage(pcm, (bytes) => bytesToBase64(bytes)));
    };
    let processor = null;
    let workletNode = null;
    try {
      if (context.audioWorklet) {
        const url = URL.createObjectURL(new Blob([LIVE_CAPTURE_WORKLET], { type: 'application/javascript' }));
        try {
          await context.audioWorklet.addModule(url);
          workletNode = new AudioWorkletNode(context, 'gev-live-capture');
          workletNode.port.onmessage = (event) => forward(event.data);
          source.connect(workletNode);
        } finally {
          try { URL.revokeObjectURL(url); } catch { /* noop */ }
        }
        processor = workletNode;
      }
    } catch { /* fall through to ScriptProcessor */ }
    if (!processor && context.createScriptProcessor) {
      const script = context.createScriptProcessor(4096, 1, 1);
      script.onaudioprocess = (event) => forward(event.inputBuffer.getChannelData(0));
      source.connect(script);
      try { script.connect(context.destination); } catch { /* keep the graph running */ }
      processor = script;
    }
    if (!processor) {
      try { await context.close?.(); } catch { /* noop */ }
      try { stream.getTracks().forEach((track) => track.stop?.()); } catch { /* noop */ }
      return { ok: false, reason: 'no-processor' };
    }
    state.micStream = stream;
    state.micNodes = { context, source, processor };
    return { ok: true };
  }

  async function connectOnce() {
    if (!doFetch) throw new Error('Live needs network access for its session token');
    if (!SocketCtor) throw new Error('Live needs WebSocket support');
    // Token and tool schemas resolve in parallel: same round, no sequencing.
    const [tokenResponse, toolsResponse] = await Promise.all([
      doFetch('/api/gemini/live-token', { method: 'POST', cache: 'no-store' }),
      doFetch('/api/voice/tools', { cache: 'no-store' }).catch(() => null),
    ]);
    const tokenData = await tokenResponse?.json?.().catch(() => null);
    if (!tokenResponse?.ok || typeof tokenData?.token !== 'string' || !tokenData.token) {
      const err = new Error(tokenData?.code === 'GEMINI_NOT_CONFIGURED'
        ? 'Add the free Gemini key in POWER UP → GEMINI (AI Studio, no billing).'
        : (tokenData?.error || `Live token failed: HTTP ${tokenResponse?.status}`));
      err.code = tokenData?.code;
      err.retryable = Boolean(tokenData?.retryable);
      throw err;
    }
    try {
      const toolsData = await toolsResponse?.json?.().catch(() => null);
      state.toolDeclarations = toGeminiFunctionDeclarations(toolsData?.tools);
    } catch {
      state.toolDeclarations = [];
    }
    const socket = new SocketCtor(`${GEMINI_LIVE_WS_URL}?access_token=${encodeURIComponent(tokenData.token)}`);
    state.socket = socket;
    // Handlers attach synchronously: the socket can open (~60 ms) before the
    // async scene context below resolves, and a missed open event means the
    // setup is never sent (silent session — no error, no close, no audio).
    socket.onopen = () => {
      void (async () => {
        const contextText = await (typeof getSceneContext === 'function' ? getSceneContext() : defaultSceneContext()).catch(() => '');
        if (state.socket !== socket || socket.readyState !== 1) return;
        const setup = buildLiveSetupMessage({ model: tokenData.model, voice: tokenData.voice, sceneContext: contextText, tools: state.toolDeclarations });
        if (!sendJson(setup)) logTurn('app', 'Live setup could not be sent (socket not open).');
      })();
    };
    socket.onmessage = (event) => { void handleServerFrame(event?.data); };
    socket.onerror = () => { /* close follows with the code */ };
    socket.onclose = (event) => onSocketClose(event);
  }

  function onSocketClose(event) {
    state.sessionReady = false;
    // Only clear our own socket: a late close from a replaced connection
    // must not null the fresh one.
    if (!event?.target || event.target === state.socket) state.socket = null;
    if (!state.active) return; // deliberate stop
    if (state.reconnects >= LIVE_MAX_RECONNECTS) {
      state.active = false;
      teardownMic();
      setDetail('LIVE DROPPED — TAP MIC TO RETRY');
      return;
    }
    state.reconnects += 1;
    setDetail('LIVE — RECONNECTING');
    try { clearTimeout(state.reconnectTimer); } catch { /* noop */ }
    state.reconnectTimer = setTimeout(() => {
      if (!state.active) return;
      connectOnce().catch((error) => {
        if (!state.active) return;
        state.active = false;
        teardownMic();
        setDetail(String(error?.message || 'Live connection failed').slice(0, 120));
      });
    }, LIVE_RECONNECT_DELAY_MS);
  }

  return {
    state,
    handleServerFrame,
    handleTranscript,
    handleToolCalls,
    describeLiveView,
    pushSceneUpdate,
    noteViewChanged,
    watchCamera,
    sendText(text) {
      const clean = String(text || '').trim().slice(0, 500);
      if (!clean || !state.sessionReady) return false;
      const sent = sendJson({ realtimeInput: { text: clean } });
      if (sent) logTurn('you', clean);
      return sent;
    },
    isActive: () => state.active,
    async start() {
      if (state.active) return { ok: true };
      state.active = true;
      state.reconnects = 0;
      state.inputTranscript = '';
      setDetail('LIVE — CONNECTING');
      try {
        await connectOnce();
      } catch (error) {
        state.active = false;
        setDetail(String(error?.message || 'Live connection failed').slice(0, 120));
        return { ok: false, error: error?.message, code: error?.code, retryable: error?.retryable };
      }
      // Re-arm view tracking (stop() detaches it).
      if (state.viewer) {
        try { watchCamera(state.viewer); } catch { /* voice works untracked */ }
      }
      if (mic !== 'off') {
        const captured = await startMic((message) => sendJson(message)).catch(() => ({ ok: false }));
        if (!captured?.ok) {
          // Voice dialog needs the mic; typed text still works via sendText.
          setDetail('LIVE — NO MIC · TYPE INSTEAD');
        }
      }
      return { ok: true };
    },
    stop() {
      state.active = false;
      try { clearTimeout(state.reconnectTimer); } catch { /* noop */ }
      try { clearTimeout(state.viewDirtyTimer); } catch { /* noop */ }
      state.viewDirtyTimer = null;
      unwatchCamera();
      teardownSocket();
      teardownMic();
      stopAudio();
      state.inputTranscript = '';
      setDetail('VOICE STANDBY');
      return { ok: true };
    },
    toggle() {
      if (state.active) return this.stop();
      return this.start();
    },
  };
}

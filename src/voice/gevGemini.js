/**
 * Gemini free-tier Q&A — the pure core for intelligent free-voice answers.
 *
 * Pattern follows src/keySetupCore.mjs: everything testable lives here with
 * zero dependencies, while the dev-server proxy (vite.config.js) and the
 * free-voice controller (gevFreeVoice.js) are thin shells over it.
 *
 * Facts (verified 2026-09-09 against ai.google.dev + a live call):
 *   - A key from https://aistudio.google.com/apikey costs $0, needs no
 *     billing, and covers flash-class input/output at $0 within quota.
 *   - gemini-2.5-flash rejects NEW projects ("no longer available to new
 *     users"); Google's error routes them to gemini-3.6-flash, so that is
 *     the default. Override per key with GEMINI_MODEL.
 *   - The quota is metered: past the ceiling the API answers 429 until the
 *     window resets — the client must treat 429 as "try again", not failure.
 *   - Free-tier prompts may train Google's models; the UI copy says so.
 *
 * @module voice/gevGemini
 */

/** Current flash default for new projects (per Google's own upgrade error). */
export const GEMINI_DEFAULT_MODEL = 'gemini-3.6-flash';

/** TTS model verified live 2026-09-09 against the project's free-tier key. */
export const GEMINI_DEFAULT_TTS_MODEL = 'gemini-2.5-flash-preview-tts';

/** Default prebuilt voice (deep, clear; speaks German for German text). */
export const GEMINI_DEFAULT_TTS_VOICE = 'Charon';

/** Longest text sent to TTS — spoken answers are short by design. */
export const GEMINI_MAX_TTS_CHARS = 500;

/** Cap on upstream TTS audio bytes we will buffer (~40 s of 24 kHz PCM). */
export const GEMINI_MAX_TTS_BYTES = 2 * 1024 * 1024;

/** Longest question accepted from the voice box — spoken questions are short. */
export const GEMINI_MAX_QUESTION_CHARS = 500;

/** Scene-context budget appended under each question (grounding, not chat). */
export const GEMINI_MAX_CONTEXT_CHARS = 2000;

/** Cap on upstream answer bytes we will buffer. */
export const GEMINI_MAX_RESPONSE_BYTES = 32 * 1024;

/**
 * Grounding instructions sent as the model system prompt. Every answer must
 * stay inside the supplied scene context; open world knowledge is allowed
 * only for stable facts (city names, landmarks) and must never invent a
 * label for something visible.
 */
export const GEMINI_SYSTEM_PROMPT = [
  'You answer short spoken questions about what the user is seeing in God\'s Eye View, a live 3D globe.',
  'Use the supplied live scene context (camera place, coordinates, enabled layers, selected entity) as ground truth.',
  'Answer in at most three short sentences, plain text, no markdown, no lists.',
  'Answer in the language of the question (English or German).',
  'Never invent a place, street, or building name for something visible: if the context does not name it, say you cannot tell from here.',
].join(' ');

/**
 * Strict model-id gate so a hostile/typoed GEMINI_MODEL value can never turn
 * the fixed upstream URL into an SSRF primitive. Lowercase alphanumerics,
 * dots, and dashes only — every documented Gemini id fits.
 */
export function isValidGeminiModel(id) {
  return typeof id === 'string' && /^[a-z0-9][a-z0-9.-]{0,60}$/i.test(id.trim());
}

/** Resolve the configured model id, falling back to the documented default. */
export function resolveGeminiModel(configured) {
  const id = String(configured || '').trim();
  return isValidGeminiModel(id) ? id : GEMINI_DEFAULT_MODEL;
}

/**
 * Build the generateContent request body (key attached server-side).
 *
 * @param {object} options
 * @param {string} options.question - User question (trimmed + capped here).
 * @param {string} [options.contextText] - Live scene context (capped here).
 * @param {string} [options.model] - Resolved model id (validated here).
 * @param {boolean} [options.groundSearch] - Add Google Search grounding for
 *   current facts (free tier: 500 RPD shared; off by default, the ask proxy
 *   enables it for knowledge questions).
 */
export function buildGeminiRequest({ question, contextText = '', model, groundSearch = false } = {}) {
  const q = String(question || '').trim().slice(0, GEMINI_MAX_QUESTION_CHARS);
  const ctx = String(contextText || '').trim().slice(0, GEMINI_MAX_CONTEXT_CHARS);
  const text = ctx ? `Live scene context:\n${ctx}\n\nQuestion: ${q}` : q;
  const body = {
    system_instruction: { parts: [{ text: GEMINI_SYSTEM_PROMPT }] },
    contents: [{ parts: [{ text }] }],
    generationConfig: { maxOutputTokens: 300, temperature: 0.4 },
  };
  if (groundSearch) body.tools = [{ google_search: {} }];
  return {
    model: resolveGeminiModel(model),
    body,
  };
}

/**
 * Strict voice-name gate (same SSRF hygiene as the model gate: the value
 * lands in the upstream request body, so it stays tightly shaped).
 */
export function isValidGeminiVoice(name) {
  return typeof name === 'string' && /^[A-Za-z][A-Za-z-]{0,30}$/.test(name.trim());
}

/** Resolve the configured TTS voice, falling back to the default. */
export function resolveGeminiVoice(configured) {
  const name = String(configured || '').trim();
  return isValidGeminiVoice(name) ? name : GEMINI_DEFAULT_TTS_VOICE;
}

/**
 * Build the TTS generateContent request (key attached server-side).
 *
 * @param {object} options
 * @param {string} options.text - Text to speak (trimmed + capped here).
 * @param {string} [options.voice] - Prebuilt voice name (validated here).
 * @returns {{ model: string, body: object }}
 */
export function buildGeminiTTSRequest({ text, voice } = {}) {
  return {
    model: GEMINI_DEFAULT_TTS_MODEL,
    body: {
      contents: [{ parts: [{ text: String(text || '').trim().slice(0, GEMINI_MAX_TTS_CHARS) }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: resolveGeminiVoice(voice) } },
        },
      },
    },
  };
}

/**
 * Extract base64 PCM audio from a TTS generateContent response.
 *
 * @param {unknown} data - Parsed upstream JSON.
 * @returns {{ audio: string|null, mimeType: string|null, blocked: boolean, reason?: string }}
 */
export function extractGeminiTTSAudio(data) {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) {
    const inline = parts.find((part) => typeof part?.inlineData?.data === 'string');
    if (inline) {
      return { audio: inline.inlineData.data, mimeType: String(inline.inlineData.mimeType || 'audio/L16;codec=pcm;rate=24000'), blocked: false };
    }
  }
  const reason = data?.promptFeedback?.blockReason
    || data?.candidates?.[0]?.finishReason
    || 'empty-response';
  return { audio: null, mimeType: null, blocked: true, reason: String(reason).slice(0, 80) };
}
/**
 * Extract the answer text from a generateContent response.
 *
 * @param {unknown} data - Parsed upstream JSON.
 * @returns {{ text: string|null, blocked: boolean, reason?: string }}
 */
export function extractGeminiAnswerText(data) {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) {
    const text = parts
      .map((part) => (typeof part?.text === 'string' ? part.text : ''))
      .join('')
      .trim();
    if (text) return { text, blocked: false };
  }
  const reason = data?.promptFeedback?.blockReason
    || data?.candidates?.[0]?.finishReason
    || 'empty-response';
  return { text: null, blocked: true, reason: String(reason).slice(0, 80) };
}

/* ------------------------------------------------------------------ *
 * LIVE API (realtime voice dialog over WebSocket)
 * ------------------------------------------------------------------ *
 * Verified live 2026-09-09 against the project's free-tier key:
 *   - Ephemeral token: POST /v1beta/auth_tokens (flat AuthToken body, key in
 *     x-goog-api-key header) → { name } used as ?access_token on the
 *     Constrained endpoint. Key never touches the browser.
 *   - Setup MUST nest modalities under generationConfig (a top-level
 *     responseModalities is rejected with 1007). Server frames arrive as
 *     Blob in browsers — read them with .text() before JSON.parse.
 *   - Audio in: 16-bit PCM mono 16 kHz base64. Audio out: 24 kHz PCM.
 *   - Model text parts in modelTurn are thinking traces: surface only
 *     outputTranscription + audio, never the text parts.
 *   - gemini-3.1-flash-live-preview needs paid billing (1011 on free keys);
 *     gemini-2.5-flash-native-audio-preview-12-2025 works on free tier.
 */

/** Live dialog model that works on free-tier keys (paid billing NOT needed). */
export const GEMINI_DEFAULT_LIVE_MODEL = 'gemini-2.5-flash-native-audio-preview-12-2025';

/** Constrained Live endpoint for ephemeral tokens (access_token query). */
export const GEMINI_LIVE_WS_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained';

/** Mic capture rate the Live API expects. */
export const GEMINI_LIVE_INPUT_RATE = 16000;

/** Playback rate of Live model audio. */
export const GEMINI_LIVE_OUTPUT_RATE = 24000;

/** Largest Live server frame we will parse (audio chunks are ~4-8 KB). */
export const GEMINI_LIVE_MAX_FRAME_CHARS = 256 * 1024;

/**
 * System prompt for the Live session. Map commands are executed by the app's
 * own tool runner from the live transcript — the model acknowledges briefly
 * and never narrates coordinates; open questions it answers directly from
 * the scene context below.
 */
export const GEMINI_LIVE_SYSTEM_PROMPT = [
  'You are the voice of God\'s Eye View, a live 3D globe. Speak briefly: at most two short sentences, plain speech, no markdown, no lists.',
  'You have map tools (fly_to_location, set_layer_visibility, set_visual_style, control_cockpit, track_entity, annotate_map, analyst_query, control_radio, control_cctv, and more): use them for ANY map action instead of describing it, then narrate the result briefly.',
  'Open questions answer directly using the live scene context. Never invent a place, street, or building name: if the context does not name it, say you cannot tell from here.',
].join(' ');

/** Resolve the configured Live model id, falling back to the free-tier one. */
export function resolveGeminiLiveModel(configured) {
  const id = String(configured || '').trim();
  return isValidGeminiModel(id) ? id : GEMINI_DEFAULT_LIVE_MODEL;
}

/**
 * Build the ephemeral-token request body (flat AuthToken). The Key is
 * attached server-side; the token is single-use with a short session window.
 */
export function buildLiveTokenRequest() {
  const now = Date.now();
  return {
    uses: 1,
    expireTime: new Date(now + 30 * 60 * 1000).toISOString(),
    newSessionExpireTime: new Date(now + 60 * 1000).toISOString(),
  };
}

/**
 * Build the first WebSocket message (setup). Modalities nest under
 * generationConfig — a top-level responseModalities is rejected (1007).
 *
 * @param {object} options
 * @param {string} [options.model] - Resolved Live model id.
 * @param {string} [options.voice] - Prebuilt voice name.
 * @param {string} [options.sceneContext] - Grounding appended to the prompt.
 * @param {Array<object>} [options.tools] - Gemini function declarations.
 */
export function buildLiveSetupMessage({ model, voice, sceneContext = '', tools = null } = {}) {
  const context = String(sceneContext || '').trim().slice(0, GEMINI_MAX_CONTEXT_CHARS);
  const setup = {
    model: `models/${resolveGeminiLiveModel(model)}`,
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: resolveGeminiVoice(voice) } } },
    },
    systemInstruction: {
      parts: [{
        text: context
          ? `${GEMINI_LIVE_SYSTEM_PROMPT}\n\nLive scene context:\n${context}`
          : GEMINI_LIVE_SYSTEM_PROMPT,
      }],
    },
    inputAudioTranscription: {},
    outputAudioTranscription: {},
  };
  if (Array.isArray(tools) && tools.length) setup.tools = [{ functionDeclarations: tools }];
  return { setup };
}

/**
 * Normalize one Live server message into UI/tool events. Accepts a parsed
 * object or a raw frame string ( oversized or unparsable frames → unknown ).
 *
 * @param {unknown} message - Parsed JSON or raw frame text.
 * @returns {Array<{type:string, [key:string]: unknown}>} Zero or more events.
 */
export function parseLiveServerMessage(message) {
  let data = message;
  if (typeof data === 'string') {
    if (data.length > GEMINI_LIVE_MAX_FRAME_CHARS) return [{ type: 'unknown' }];
    try {
      data = JSON.parse(data);
    } catch {
      return [{ type: 'unknown' }];
    }
  }
  if (!data || typeof data !== 'object') return [{ type: 'unknown' }];
  if (data.setupComplete) return [{ type: 'setupComplete' }];
  const events = [];
  const content = data.serverContent;
  if (content) {
    if (typeof content.interrupted === 'boolean' && content.interrupted) events.push({ type: 'interrupted' });
    const parts = content.modelTurn?.parts;
    if (Array.isArray(parts)) {
      for (const part of parts) {
        if (typeof part?.inlineData?.data === 'string' && part.inlineData.data) {
          events.push({ type: 'audio', base64: part.inlineData.data, mimeType: String(part.inlineData.mimeType || 'audio/pcm;rate=24000') });
        }
      }
    }
    if (typeof content.inputTranscription?.text === 'string' && content.inputTranscription.text.trim()) {
      events.push({ type: 'inputText', text: content.inputTranscription.text });
    }
    if (typeof content.outputTranscription?.text === 'string' && content.outputTranscription.text.trim()) {
      events.push({ type: 'outputText', text: content.outputTranscription.text });
    }
    if (content.turnComplete) events.push({ type: 'turnComplete' });
    if (content.generationComplete) events.push({ type: 'generationComplete' });
  }
  if (data.toolCall) events.push({ type: 'toolCall', toolCall: data.toolCall });
  return events.length ? events : [{ type: 'unknown' }];
}

/**
 * Downsample float samples to 16 kHz signed-16 PCM. Pure — unit-tested.
 *
 * @param {Float32Array} samples - Input samples in [-1, 1].
 * @param {number} inputRate - Input sample rate (e.g. 48000).
 * @param {number} [targetRate] - Defaults to GEMINI_LIVE_INPUT_RATE.
 * @returns {Int16Array} Mono PCM16 at the target rate.
 */
export function downsampleToPcm16(samples, inputRate, targetRate = GEMINI_LIVE_INPUT_RATE) {
  const input = samples instanceof Float32Array ? samples : new Float32Array(0);
  const rate = Number(inputRate) > 0 ? Number(inputRate) : targetRate;
  if (!input.length) return new Int16Array(0);
  const ratio = rate / targetRate;
  const length = Math.max(1, Math.floor(input.length / ratio));
  const out = new Int16Array(length);
  for (let i = 0; i < length; i += 1) {
    const at = Math.min(input.length - 1, Math.floor(i * ratio));
    const clamped = Math.max(-1, Math.min(1, input[at]));
    out[i] = clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
  }
  return out;
}

/**
 * Build a realtime audio input message from PCM16 samples.
 *
 * @param {Int16Array} pcm16 - Mono 16 kHz PCM.
 * @param {(bytes:Uint8Array)=>string} toBase64 - Base64 encoder (btoa-based in browsers).
 * @returns {{ realtimeInput: { audio: { data: string, mimeType: string } } }}
 */
export function buildLiveAudioMessage(pcm16, toBase64) {
  const view = pcm16 instanceof Int16Array ? new Uint8Array(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength) : new Uint8Array(0);
  return {
    realtimeInput: {
      audio: { data: toBase64(view), mimeType: `audio/pcm;rate=${GEMINI_LIVE_INPUT_RATE}` },
    },
  };
}

/* ------------------------------------------------------------------ *
 * VOICE TOOL SCHEMAS (OpenAI shape → Gemini function declarations)
 * ------------------------------------------------------------------ *
 * The server's GEV_REALTIME_TOOLS array (vite.config.js, also served via
 * GET /api/voice/tools) is the single source of truth. This converter maps
 * it onto Gemini's functionDeclarations so both voice transports offer
 * identical capabilities with zero drift by construction.
 */

/** Schema keys the Gemini API accepts in function declarations. */
export const GEMINI_TOOL_SCHEMA_KEEP = new Set([
  'type', 'description', 'enum', 'properties', 'items', 'required',
  'minimum', 'maximum', 'minItems', 'maxItems',
]);

/**
 * Recursively strip a JSON-schema node down to the Gemini-supported subset.
 * Empty objects normalize to {type:'string'} — the Live setup rejects
 * typeless schemas, and string is the permissive choice for free-form values.
 */
export function sanitizeGeminiToolSchema(node) {
  if (Array.isArray(node)) return node.map(sanitizeGeminiToolSchema);
  if (!node || typeof node !== 'object') return node;
  const out = {};
  for (const key of Object.keys(node)) {
    if (!GEMINI_TOOL_SCHEMA_KEEP.has(key)) continue;
    // `properties` maps names to schemas — sanitize the VALUES, not the keys.
    if (key === 'properties' && node.properties && typeof node.properties === 'object' && !Array.isArray(node.properties)) {
      const props = {};
      for (const [name, schema] of Object.entries(node.properties)) {
        props[name] = sanitizeGeminiToolSchema(schema);
      }
      out.properties = props;
      continue;
    }
    out[key] = sanitizeGeminiToolSchema(node[key]);
  }
  if (out.properties && typeof out.properties === 'object' && !Array.isArray(out.properties)) {
    if (!out.type) out.type = 'object';
  } else if (out.items && !out.type) {
    out.type = 'array';
  }
  if (Object.keys(out).length === 0) return { type: 'string' };
  return out;
}

/**
 * Convert OpenAI-shape voice tools ({type:'function',name,description,
 * parameters}) into Gemini functionDeclarations.
 *
 * @param {unknown} openAiTools - Array from GET /api/voice/tools.
 * @returns {Array<{name:string,description:string,parameters:object}>}
 */
export function toGeminiFunctionDeclarations(openAiTools) {
  if (!Array.isArray(openAiTools)) return [];
  const out = [];
  for (const tool of openAiTools) {
    if (!tool || typeof tool !== 'object') continue;
    if (tool.type !== 'function' || typeof tool.name !== 'string' || !tool.name) continue;
    out.push({
      name: tool.name,
      description: String(tool.description || '').slice(0, 2000),
      parameters: sanitizeGeminiToolSchema(tool.parameters),
    });
  }
  return out;
}

/**
 * Stable action signature for dedup: the same tool+args from the transcript
 * path and a Live toolCall must collapse instead of executing twice.
 * Key order is canonicalized so model-shuffled args still match.
 */
export function stableActionKey(name, args) {
  const canonical = (value) => {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object') {
      return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
    }
    return JSON.stringify(value === undefined ? null : value);
  };
  return `${String(name)}:${canonical(args && typeof args === 'object' ? args : {})}`;
}

/* ------------------------------------------------------------------ *
 * SEE (viewport screenshot → description + facts)
 * ------------------------------------------------------------------ */

/** Largest image payload accepted from the client (matches the ~200 KB capture ceiling + headroom). */
export const GEMINI_SEE_MAX_IMAGE_BYTES = 300 * 1024;

/** Longest user question attached to a see request. */
export const GEMINI_SEE_MAX_QUESTION_CHARS = 300;

/**
 * Grounding prompt for see requests: describe ONLY what is legible/visible,
 * combine with the scene context, and add a few stable facts about the
 * identified place. Never invent labels.
 */
export const GEMINI_SEE_SYSTEM_PROMPT = [
  'You describe a live 3D-globe viewport screenshot for a voice assistant.',
  'Describe what is actually visible (city layout, landmarks, labels legible in the image, terrain, water) in at most three short sentences, plain text, no markdown, no lists.',
  'Then add one or two stable, well-known facts about the identified place (name, what it is known for).',
  'Use the supplied live scene context (camera place, coordinates, enabled layers) as ground truth for the location.',
  'Never invent a place, street, or building name: if nothing is legible and the context names nothing, say what you can see generically.',
  'Answer in the language of the question (English or German).',
].join(' ');

/**
 * Build the see generateContent request (key attached server-side).
 *
 * @param {object} options
 * @param {string} options.imageBase64 - Raw base64 JPEG (no data: prefix).
 * @param {string} [options.mimeType] - Defaults to image/jpeg.
 * @param {string} [options.question] - User flavor ("what do you see?").
 * @param {string} [options.contextText] - Live scene context (capped here).
 * @param {string} [options.model] - Resolved model id (validated here).
 * @returns {{ model: string, body: object }}
 */
export function buildSeeRequest({ imageBase64, mimeType = 'image/jpeg', question = '', contextText = '', model } = {}) {
  const image = String(imageBase64 || '').replace(/^data:[^,]*,/, '');
  const q = String(question || '').trim().slice(0, GEMINI_SEE_MAX_QUESTION_CHARS) || 'What do you see? Describe it and give facts.';
  const ctx = String(contextText || '').trim().slice(0, GEMINI_MAX_CONTEXT_CHARS);
  return {
    model: resolveGeminiModel(model),
    body: {
      system_instruction: { parts: [{ text: GEMINI_SEE_SYSTEM_PROMPT }] },
      contents: [{
        parts: [
          { inlineData: { mimeType: String(mimeType || 'image/jpeg').slice(0, 60), data: image } },
          { text: ctx ? `Live scene context:\n${ctx}\n\nQuestion: ${q}` : q },
        ],
      }],
      generationConfig: { maxOutputTokens: 400, temperature: 0.4 },
    },
  };
}

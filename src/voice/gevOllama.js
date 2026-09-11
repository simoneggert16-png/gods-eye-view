/**
 * Ollama Cloud chat — pure core for the typed-chat fallback brain.
 *
 * Facts (verified 2026-09-10 against docs.ollama.com): native API
 * POST https://ollama.com/api/chat, `Authorization: Bearer` key,
 * {model, messages, stream:false} → message.content. Key from
 * https://ollama.com/settings/keys. Model override via OLLAMA_MODEL.
 * Key stays server-side (proxy).
 *
 * @module voice/gevOllama
 */

/** Default cloud model (documented cloud example; override with OLLAMA_MODEL). */
export const OLLAMA_DEFAULT_MODEL = 'gpt-oss:120b';

/** Default vision model: free on free-tier keys AND sees images (verified live). */
export const OLLAMA_DEFAULT_VISION_MODEL = 'gemma4:31b';

/** Longest user message sent. */
export const OLLAMA_MAX_MESSAGE_CHARS = 1000;

/** Scene-context budget appended under each message. */
export const OLLAMA_MAX_CONTEXT_CHARS = 1500;

/** Cap on upstream chat bytes we will buffer. */
export const OLLAMA_MAX_RESPONSE_BYTES = 32 * 1024;

/** System prompt: brief globe-assistant voice, grounded, honest. */
export const OLLAMA_SYSTEM_PROMPT = [
  'You are the text-chat brain of God\'s Eye View, a live 3D globe. The user types instead of speaking.',
  'Answer briefly: at most three short sentences, plain text, no markdown, no lists.',
  'Use the supplied live scene context (camera place, coordinates, enabled layers, selected entity) as ground truth.',
  'Explain visual phenomena, landscape features, colors (e.g. turquoise/cyan shallow water vs dark deep ocean, sandbanks, reefs, bathymetry, mountains, terrain) and geography accurately using the scene context and attached images.',
  'Answer in the language of the question (English or German).',
  'Never invent a place, street, or building name: if the context does not name it, say you cannot tell from here.',
].join(' ');

/** Strict model-id gate so a typoed OLLAMA_MODEL cannot SSRF the fixed URL. */
export function isValidOllamaModel(id) {
  return typeof id === 'string' && /^[a-z0-9][a-z0-9._:+-]{0,80}$/i.test(id.trim());
}

/** Resolve the configured model id, falling back to the default. */
export function resolveOllamaModel(configured) {
  const id = String(configured || '').trim();
  return isValidOllamaModel(id) ? id : OLLAMA_DEFAULT_MODEL;
}

/** Resolve the configured vision model id, falling back to the default. */
export function resolveOllamaVisionModel(configured) {
  const id = String(configured || '').trim();
  return isValidOllamaModel(id) ? id : OLLAMA_DEFAULT_VISION_MODEL;
}

/** Strip data-URL prefixes; keep raw base64 only (max ~400 KB total). */
export function cleanVisionImages(images) {
  if (!Array.isArray(images)) return [];
  const out = [];
  let bytes = 0;
  for (const item of images) {
    if (out.length >= 2) break;
    const base64 = String(item || '').replace(/^data:[^,]*,/, '').trim();
    if (!/^[A-Za-z0-9+/=]+$/.test(base64) || base64.length % 4 !== 0) continue;
    bytes += base64.length;
    if (bytes > 550000) break;
    out.push(base64);
  }
  return out;
}

/**
 * Build the native chat request (key attached server-side).
 *
 * @param {object} options
 * @param {string} options.message - User message (trimmed + capped here).
 * @param {string} [options.contextText] - Live scene context (capped here).
 * @param {string} [options.model] - Resolved text model id (validated here).
 * @param {string} [options.visionModel] - Resolved vision model id for image
 *   calls (validated here; the text model may not see images).
 * @param {string} [options.system] - System prompt override (capped here).
 * @param {Array<string>} [options.images] - Screenshot data URLs (cleaned here).
 * @returns {{ model: string, body: object }}
 */
export function buildOllamaChatRequest({ message, contextText = '', model, visionModel, system = '', images = null } = {}) {
  const text = String(message || '').trim().slice(0, OLLAMA_MAX_MESSAGE_CHARS);
  const ctx = String(contextText || '').trim().slice(0, OLLAMA_MAX_CONTEXT_CHARS);
  const prompt = String(system || '').trim().slice(0, 2000) || OLLAMA_SYSTEM_PROMPT;
  const cleanedImages = cleanVisionImages(images);
  const resolvedModel = cleanedImages.length
    ? resolveOllamaVisionModel(visionModel)
    : resolveOllamaModel(model);
  const userMessage = { role: 'user', content: ctx ? `Live scene context:\n${ctx}\n\nQuestion: ${text}` : text };
  if (cleanedImages.length) userMessage.images = cleanedImages;
  return {
    model: resolvedModel,
    body: {
      model: resolvedModel,
      messages: [
        { role: 'system', content: prompt },
        userMessage,
      ],
      stream: false,
    },
  };
}

/**
 * Extract the answer text from a native Ollama chat response.
 *
 * @param {unknown} data - Parsed upstream JSON.
 * @returns {{ text: string|null, blocked: boolean, reason?: string }}
 */
export function extractOllamaChatAnswer(data) {
  const content = data?.message?.content;
  if (typeof content === 'string' && content.trim()) return { text: content.trim(), blocked: false };
  const reason = data?.error || 'empty-response';
  return { text: null, blocked: true, reason: String(reason).slice(0, 80) };
}

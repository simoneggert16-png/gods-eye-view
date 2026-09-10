/**
 * Z.AI GLM chat — pure core for the typed-chat brain.
 *
 * Facts (verified 2026-09-10): OpenAI-compatible
 * POST https://api.z.ai/api/paas/v4/chat/completions, Bearer key,
 * {model, messages} → choices[0].message.content. GLM-5.3-Flash was
 * $0.15/M in + $0.50/M out (NOT free — needs a topped-up account, but
 * voice-chat turns cost fractions of a cent). Key from https://z.ai.
 * Model override via ZAI_MODEL. Key stays server-side (proxy).
 *
 * @module voice/gevZai
 */

/** Default: new + cheap flash (override with ZAI_MODEL). */
export const ZAI_DEFAULT_MODEL = 'glm-5.3-flash';

/** Longest user message sent. */
export const ZAI_MAX_MESSAGE_CHARS = 1000;

/** Scene-context budget appended under each message. */
export const ZAI_MAX_CONTEXT_CHARS = 1500;

/** Cap on upstream chat bytes we will buffer. */
export const ZAI_MAX_RESPONSE_BYTES = 32 * 1024;

/** System prompt: brief globe-assistant voice, grounded, honest. */
export const ZAI_SYSTEM_PROMPT = [
  'You are the text-chat brain of God\'s Eye View, a live 3D globe. The user types instead of speaking.',
  'Answer briefly: at most three short sentences, plain text, no markdown, no lists.',
  'Use the supplied live scene context (camera place, coordinates, enabled layers, selected entity) as ground truth.',
  'Answer in the language of the question (English or German).',
  'Never invent a place, street, or building name: if the context does not name it, say you cannot tell from here.',
].join(' ');

/** Strict model-id gate so a typoed ZAI_MODEL cannot SSRF the fixed URL. */
export function isValidZaiModel(id) {
  return typeof id === 'string' && /^[a-z0-9][a-z0-9._-]{0,60}$/i.test(id.trim());
}

/** Resolve the configured model id, falling back to the default. */
export function resolveZaiModel(configured) {
  const id = String(configured || '').trim();
  return isValidZaiModel(id) ? id : ZAI_DEFAULT_MODEL;
}

import { cleanVisionImages } from './gevOllama.js';

/**
 * Build the chat request (key attached server-side). Supports vision screenshots.
 *
 * @param {object} options
 * @param {string} options.message - User message (trimmed + capped here).
 * @param {string} [options.contextText] - Live scene context (capped here).
 * @param {string} [options.model] - Resolved model id (validated here).
 * @param {string} [options.system] - System prompt override (capped here).
 * @param {Array<string>} [options.images] - Screenshot data URLs (cleaned here).
 * @returns {{ model: string, body: object }}
 */
export function buildZaiChatRequest({ message, contextText = '', model, system = '', images = null } = {}) {
  const text = String(message || '').trim().slice(0, ZAI_MAX_MESSAGE_CHARS);
  const ctx = String(contextText || '').trim().slice(0, ZAI_MAX_CONTEXT_CHARS);
  const prompt = String(system || '').trim().slice(0, 2000) || ZAI_SYSTEM_PROMPT;
  const promptText = ctx ? `Live scene context:\n${ctx}\n\nQuestion: ${text}` : text;
  const cleanedImages = cleanVisionImages(images);
  const userContent = cleanedImages.length
    ? [
        { type: 'text', text: promptText },
        ...cleanedImages.map((b64) => ({
          type: 'image_url',
          image_url: { url: `data:image/jpeg;base64,${b64}` },
        })),
      ]
    : promptText;
  return {
    model: resolveZaiModel(model),
    body: {
      model: resolveZaiModel(model),
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: userContent },
      ],
      temperature: 0.4,
      max_tokens: 400,
    },
  };
}

/**
 * Extract the answer text from an OpenAI-shape chat response.
 *
 * @param {unknown} data - Parsed upstream JSON.
 * @returns {{ text: string|null, blocked: boolean, reason?: string }}
 */
export function extractZaiChatAnswer(data) {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === 'string' && content.trim()) return { text: content.trim(), blocked: false };
  const reason = data?.error?.message || data?.error?.code || 'empty-response';
  return { text: null, blocked: true, reason: String(reason).slice(0, 80) };
}

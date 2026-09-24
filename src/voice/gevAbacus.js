/**
 * Abacus.AI chat & vision — pure core for the typed-chat brain & tactical analyst.
 *
 * RouteLLM / chat completions:
 * POST https://api.abacus.ai/api/v0/chat/completions (OpenAI-compatible)
 * Bearer key (ABACUS_API_KEY), {model, messages} -> choices[0].message.content.
 *
 * @module voice/gevAbacus
 */

import { CHAT_SYSTEM_PROMPT_MAX_CHARS, cleanVisionImages } from './gevOllama.js';

/** Default model (override with ABACUS_MODEL). */
export const ABACUS_DEFAULT_MODEL = 'deepseek-ai/DeepSeek-V4.1-Flash';

/** Longest user message sent. */
export const ABACUS_MAX_MESSAGE_CHARS = 6000;

/** Scene-context budget appended under each message. */
export const ABACUS_MAX_CONTEXT_CHARS = 4000;

/** Cap on upstream chat bytes we will buffer. */
export const ABACUS_MAX_RESPONSE_BYTES = 32 * 1024;

/** System prompt: brief globe-assistant voice, grounded, tactical. */
export const ABACUS_SYSTEM_PROMPT = [
  'You are the text-chat brain of God\'s Eye View, a live 3D globe. The user types instead of speaking.',
  'Answer briefly: at most three short sentences, plain text, no markdown, no lists.',
  'Use the supplied live scene context (camera place, coordinates, enabled layers, selected entity) as ground truth.',
  'Answer in the language of the question (English or German).',
  'Never invent a place, street, or building name: if the context does not name it, say you cannot tell from here.',
].join(' ');

/** Strict model-id gate so a typoed ABACUS_MODEL cannot SSRF the fixed URL. */
export function isValidAbacusModel(id) {
  return typeof id === 'string' && /^[a-z0-9][a-z0-9._/-]{0,60}$/i.test(id.trim());
}

/** Resolve the configured model id, falling back to the default. */
export function resolveAbacusModel(configured) {
  const id = String(configured || '').trim();
  if (!id) return ABACUS_DEFAULT_MODEL;
  if (/^deepseek(-v4(\.1)?(-flash)?)?$/i.test(id)) return 'deepseek-ai/DeepSeek-V4.1-Flash';
  return isValidAbacusModel(id) ? id : ABACUS_DEFAULT_MODEL;
}

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
export function buildAbacusChatRequest({ message, contextText = '', model, system = '', images = null } = {}) {
  const text = String(message || '').trim().slice(0, ABACUS_MAX_MESSAGE_CHARS);
  const ctx = String(contextText || '').trim().slice(0, ABACUS_MAX_CONTEXT_CHARS);
  const prompt = String(system || '').trim().slice(0, CHAT_SYSTEM_PROMPT_MAX_CHARS) || ABACUS_SYSTEM_PROMPT;
  const promptText = ctx ? `Live scene context:\n${ctx}\n\nQuestion: ${text}` : text;
  const cleanedImages = cleanVisionImages(images);
  const userContent = cleanedImages.length
    ? [
        { type: 'text', text: promptText },
        ...cleanedImages.map((b64) => {
          const mime = b64.startsWith('iVBORw0KGgo') ? 'image/png' : 'image/jpeg';
          return {
            type: 'image_url',
            image_url: { url: `data:${mime};base64,${b64}` },
          };
        }),
      ]
    : promptText;
  return {
    model: resolveAbacusModel(model),
    body: {
      model: resolveAbacusModel(model),
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: userContent },
      ],
      temperature: 0.4,
      max_tokens: 800,
    },
  };
}

/**
 * Extract the answer text from an OpenAI-shape chat response.
 *
 * @param {unknown} data - Parsed upstream JSON.
 * @returns {{ text: string|null, blocked: boolean, reason?: string }}
 */
export function extractAbacusChatAnswer(data) {
  const message = data?.choices?.[0]?.message;
  let content = message?.content;
  if (!content && message?.reasoning_content) content = message.reasoning_content;
  if (typeof content === 'string') {
    const cleaned = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    if (cleaned) return { text: cleaned, blocked: false };
    if (content.trim()) return { text: content.trim(), blocked: false };
  }
  const reason = data?.error?.message || data?.error?.code || 'empty-response';
  return { text: null, blocked: true, reason: String(reason).slice(0, 80) };
}

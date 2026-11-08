/**
 * Read the person-search summary aloud with Gemini's free-tier TTS.
 *
 * The browser's own speech engine is a different voice on every classroom
 * machine, and on Windows it is often the old desktop synthesizer. One server
 * call with the existing GEMINI_API_KEY gives every listener the same voice.
 * The key stays on the server.
 */

const MODELS = ['gemini-3.8-flash-lite-tts', 'gemini-3.8-flash-tts'];
const MAX_CHARS = 900;
const CACHE_LIMIT = 12;
/** @type {Map<string, {mimeType: string, bytes: Buffer}>} */
const cache = new Map();

/** Collapse whitespace and cap the transcript the model is allowed to read. */
export function speechTranscript(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_CHARS);
}

/** Wrap headerless 16-bit mono PCM in a WAV container the browser can play. */
export function wavFromPcm(pcm, sampleRate = 24000) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/**
 * Pull the audio part out of a generateContent response.
 * @returns {{mimeType: string, bytes: Buffer}|null}
 */
export function audioFromGeminiBody(body) {
  const direct = body?.output_audio || body?.outputAudio;
  if (direct?.data) {
    const mimeType = String(direct.mime_type || direct.mimeType || 'audio/wav');
    const bytes = Buffer.from(String(direct.data), 'base64');
    if (bytes.length) {
      if (/l16|pcm/i.test(mimeType)) {
        const rate = Number(/rate=(\d+)/i.exec(mimeType)?.[1]) || 24000;
        return { mimeType: 'audio/wav', bytes: wavFromPcm(bytes, rate) };
      }
      return { mimeType: mimeType.split(';')[0] || 'audio/wav', bytes };
    }
  }
  const parts = body?.candidates?.[0]?.content?.parts || [];
  for (const part of parts) {
    const inline = part?.inlineData || part?.inline_data;
    if (!inline?.data) continue;
    const mimeType = String(inline.mimeType || inline.mime_type || 'audio/wav');
    const bytes = Buffer.from(String(inline.data), 'base64');
    if (!bytes.length) continue;
    if (/l16|pcm/i.test(mimeType)) {
      const rate = Number(/rate=(\d+)/i.exec(mimeType)?.[1]) || 24000;
      return { mimeType: 'audio/wav', bytes: wavFromPcm(bytes, rate) };
    }
    return { mimeType: mimeType.split(';')[0] || 'audio/wav', bytes };
  }
  return null;
}

function styleFor(lang) {
  return String(lang || 'de')
    .toLowerCase()
    .startsWith('de')
    ? 'ruhig, klar, natürliches Hochdeutsch, mittleres Tempo'
    : 'calm, clear, natural pace';
}

async function postJson(fetchImpl, url, apiKey, payload) {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) return null;
  return audioFromGeminiBody(await response.json());
}

async function synthesize(transcript, lang, apiKey, fetchImpl) {
  const style = styleFor(lang);
  for (const model of MODELS) {
    const generated = await postJson(
      fetchImpl,
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      apiKey,
      {
        contents: [
          {
            role: 'user',
            parts: [{ text: transcript, speechMetadata: { style } }],
          },
        ],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Kore' },
            },
          },
        },
      },
    );
    if (generated) return generated;
    const interaction = await postJson(
      fetchImpl,
      'https://generativelanguage.googleapis.com/v1beta/interactions',
      apiKey,
      {
        model,
        input: [
          {
            type: 'user_input',
            content: [
              {
                type: 'text',
                text: transcript,
                annotations: [{ type: 'speech_metadata', style }],
              },
            ],
          },
        ],
        response_format: { type: 'audio' },
        generation_config: { speech_config: [{ voice: 'Kore' }] },
      },
    );
    if (interaction) return interaction;
  }
  return null;
}

/**
 * @returns {Promise<{mimeType: string, bytes: Buffer}|null>}
 */
export async function speakSummaryText({
  text,
  lang = 'de',
  fetchImpl = fetch,
  apiKey = process.env.GEMINI_API_KEY,
} = {}) {
  const transcript = speechTranscript(text);
  if (transcript.length < 2) return null;
  const key = String(apiKey || '').trim();
  if (!key) return null;
  const cacheKey = `${lang}|${transcript}`;
  const hit = cache.get(cacheKey);
  if (hit) return hit;
  let audio = null;
  try {
    audio = await synthesize(transcript, lang, key, fetchImpl);
  } catch {
    audio = null;
  }
  if (!audio) return null;
  cache.set(cacheKey, audio);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
  return audio;
}

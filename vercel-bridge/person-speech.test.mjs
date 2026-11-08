import test from 'node:test';
import assert from 'node:assert/strict';
import {
  audioFromGeminiBody,
  speakSummaryText,
  speechTranscript,
  wavFromPcm,
} from './person-speech.js';

test('the transcript is one line and stays within the free-tier cap', () => {
  assert.equal(speechTranscript('  Hallo\nWelt  '), 'Hallo Welt');
  assert.equal(speechTranscript('a'.repeat(2000)).length, 900);
  assert.equal(speechTranscript(' '), '');
});

test('a WAV payload is returned as-is', () => {
  const audio = audioFromGeminiBody({
    candidates: [
      {
        content: {
          parts: [
            {
              inlineData: {
                mimeType: 'audio/wav',
                data: Buffer.from('RIFFdemo').toString('base64'),
              },
            },
          ],
        },
      },
    ],
  });
  assert.equal(audio.mimeType, 'audio/wav');
  assert.equal(audio.bytes.toString(), 'RIFFdemo');
});

test('headerless PCM is wrapped so the browser can play it', () => {
  const pcm = Buffer.alloc(8);
  const wav = wavFromPcm(pcm, 24000);
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
  assert.equal(wav.length, 52);
  const audio = audioFromGeminiBody({
    candidates: [
      {
        content: {
          parts: [
            {
              inlineData: {
                mimeType: 'audio/l16;rate=24000',
                data: pcm.toString('base64'),
              },
            },
          ],
        },
      },
    ],
  });
  assert.equal(audio.mimeType, 'audio/wav');
  assert.equal(audio.bytes.length, 52);
});

test('speak uses the free Gemini key and does not send it back', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  inlineData: {
                    mimeType: 'audio/wav',
                    data: Buffer.from('RIFFok').toString('base64'),
                  },
                },
              ],
            },
          },
        ],
      }),
    };
  };
  const audio = await speakSummaryText({
    text: 'Kurze Zusammenfassung.',
    lang: 'de',
    apiKey: 'free-test-key',
    fetchImpl,
  });
  assert.equal(audio.bytes.toString(), 'RIFFok');
  assert.match(calls[0].url, /gemini-3\.8-flash-lite-tts:generateContent/);
  assert.equal(calls[0].options.headers['x-goog-api-key'], 'free-test-key');
  const sent = JSON.parse(calls[0].options.body);
  assert.equal(sent.contents[0].parts[0].text, 'Kurze Zusammenfassung.');
  assert.equal(
    sent.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName,
    'Kore',
  );
  assert.equal(JSON.stringify(audio).includes('free-test-key'), false);
});

test('a failed generateContent call falls through to the interactions voice API', async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    if (String(url).includes(':generateContent')) {
      return { ok: false, status: 400, json: async () => ({}) };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        output_audio: {
          mime_type: 'audio/wav',
          data: Buffer.from('RIFFvia').toString('base64'),
        },
      }),
    };
  };
  const audio = await speakSummaryText({
    text: 'Zweite Stimme.',
    lang: 'de',
    apiKey: 'free-test-key',
    fetchImpl,
  });
  assert.equal(audio.bytes.toString(), 'RIFFvia');
  assert.match(urls[0], /generateContent/);
  assert.match(urls[1], /\/interactions$/);
});

test('without a key nothing is requested', async () => {
  let called = false;
  const audio = await speakSummaryText({
    text: 'Hallo',
    apiKey: '',
    fetchImpl: async () => {
      called = true;
      return { ok: false, status: 401, json: async () => ({}) };
    },
  });
  assert.equal(audio, null);
  assert.equal(called, false);
});

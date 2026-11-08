import test from 'node:test';
import assert from 'node:assert/strict';
import { personSummary } from './person-summary.js';

const TAVILY = process.env.TAVILY_API_KEY;
const GEMINI = process.env.GEMINI_API_KEY;
process.env.TAVILY_API_KEY = 'test-key';
process.env.GEMINI_API_KEY = 'test-key';

test.after(() => {
  for (const [key, value] of [
    ['TAVILY_API_KEY', TAVILY],
    ['GEMINI_API_KEY', GEMINI],
  ]) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const ADDRESS_ROWS = () => [
  {
    title: 'David Murdoch',
    url: 'https://ch.linkedin.com/in/david-murdoch',
    content: 'Profil von David Murdoch.',
  },
  {
    title: 'David James Murdoch Firn Studio • Jenaz • Graubünden',
    url: 'https://www.better-search.ch/de/detail/david-james-murdoch-firn-studio',
    content: 'Eintrag im Adressverzeichnis.',
    raw_content:
      '## David James Murdoch Firn Studio ### Kontaktinformationen Platz 8 7233 Jenaz Kanton: Graubünden CH',
  },
];

const plainRows = (name) => [
  {
    title: `${name} — Profil`,
    url: `https://ch.linkedin.com/in/${name.toLowerCase().replace(/\s+/g, '-')}`,
    content: `Berufsprofil von ${name}.`,
  },
];

function stub({ respond, rows = ADDRESS_ROWS }) {
  const seen = [];
  return {
    seen,
    fetchImpl: async (url, options) => {
      const target = String(url);
      const body = options?.body ? JSON.parse(options.body) : {};
      seen.push({ target, body });
      if (target.includes('api.tavily.com'))
        return { ok: true, status: 200, json: async () => ({ results: rows() }) };
      if (target.includes('generativelanguage.googleapis.com'))
        return respond(target, body);
      return { ok: false, status: 404, json: async () => ({}) };
    },
  };
}

test('the published address leads the digest the model reads', async () => {
  const stubbed = stub({
    respond: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: 'Firn Studio, Platz 8, Jenaz.' }] } }],
      }),
    }),
  });
  const body = await personSummary({
    name: 'David Murdoch',
    place: 'Graubünden',
    lang: 'de',
    fetchImpl: stubbed.fetchImpl,
  });
  assert.equal(body.summary, 'Firn Studio, Platz 8, Jenaz.');
  const prompt = stubbed.seen.find((call) => call.target.includes('generativelanguage'))
    .body.contents[0].parts[0].text;
  assert.match(prompt, /published address: Platz 8, 7233 Jenaz/);
  assert.match(prompt, /1\. David James Murdoch Firn Studio/);
});

test('the fast model is asked first', async () => {
  const stubbed = stub({
    rows: () => plainRows('Nina Okafor'),
    respond: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: 'ok' }] } }],
      }),
    }),
  });
  await personSummary({ name: 'Nina Okafor', place: 'Bern', fetchImpl: stubbed.fetchImpl });
  const model = stubbed.seen.find((call) =>
    call.target.includes('generativelanguage'),
  ).target;
  assert.match(model, /models\/gemini-3\.5-flash:generateContent/);
});

test('a 503 falls back and is retried on the next look-up', async () => {
  let calls = 0;
  const stubbed = stub({
    rows: () => plainRows('Reto Caduff'),
    respond: async () => {
      calls += 1;
      return { ok: false, status: 503, json: async () => ({}) };
    },
  });
  const options = { name: 'Reto Caduff', place: 'Galgenau', lang: 'de' };
  const first = await personSummary({ ...options, fetchImpl: stubbed.fetchImpl });
  assert.equal(first.fallback, true);
  assert.match(first.summary, /Keine veröffentlichte Adresse gefunden/);
  const before = calls;
  await personSummary({ ...options, fetchImpl: stubbed.fetchImpl });
  assert.ok(calls > before, 'a transient model failure must not be cached');
});

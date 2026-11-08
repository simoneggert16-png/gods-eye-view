/**
 * Gemini deep-research summary of the public web hits for a person.
 *
 * This does not verify identity and does not score it. It condenses the
 * titles, contextual excerpts, and published contact details (address, phone,
 * email) returned by the licensed search API; when they describe different
 * people, the model names the candidates and asks which one is meant.
 */

import { personWebSearch } from './person-web.js';

const CACHE_MS = 10 * 60 * 1000;
const CACHE_LIMIT = 100;
/**
 * Ordered by measured latency: 3.5-flash answers a grounded summary in about
 * two seconds, while 3.6-flash is both slower and the first model to hit the
 * per-minute quota. Leading with the slow one burned the whole timeout budget
 * and left the panel with the deterministic fallback.
 */
const MODELS = ['gemini-3.5-flash', 'gemini-3.6-flash', 'gemini-3.8-flash'];
/** @type {Map<string, {at:number, body:object}>} */
const cache = new Map();

function contactWeight(row) {
  return (
    (row?.address ? 4 : 0) +
    (row?.phone ? 2 : 0) +
    (row?.email ? 1 : 0)
  );
}

function resultDigest(results) {
  // Rows with a published address or contact details lead the digest so deep
  // passes (Impressum / Kontakt) are never truncated out of the prompt.
  const rows = [...(results || [])].sort(
    (a, b) => contactWeight(b) - contactWeight(a),
  );
  return rows
    .slice(0, 14)
    .map((row, index) => {
      const title = String(row?.title || '').slice(0, 140);
      const snippet = String(row?.snippet || '').slice(0, 320);
      const url = String(row?.url || '');
      const address = String(row?.address || '').slice(0, 100);
      const phones = row?.phones?.length
        ? row.phones.join(', ')
        : String(row?.phone || '');
      const emails = row?.emails?.length
        ? row.emails.join(', ')
        : String(row?.email || '');
      return [
        `${index + 1}. ${title} — ${snippet} (${url})`,
        address ? `   published address: ${address}` : '',
        phones ? `   published phone: ${phones.slice(0, 80)}` : '',
        emails ? `   published email: ${emails.slice(0, 120)}` : '',
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n')
    .slice(0, 5600);
}

function languageOf(lang) {
  return (
    String(lang || 'de')
      .trim()
      .slice(0, 2) || 'de'
  );
}

function promptFor({ name, place, age, lang, results }) {
  const language =
    String(lang || 'de')
      .trim()
      .slice(0, 2) || 'de';
  const ageHint = String(age || '').trim();
  return [
    `You synthesize a thorough public-source research summary about a person. Answer in the language with ISO code "${language}".`,
    'Use ONLY the hits below. Do not invent facts and do not assign an identity certainty score.',
    'Write 3–6 informative, natural sentences suitable for reading aloud: cover who the person is (profession, role, company/practice/organization, background, public activities or register entries) based on the hits.',
    'If the hits describe several different people with the same name, name up to three main candidates with their place, role, and any published contact details, and end by asking which person is meant.',
    'Hits may carry "published address", "published phone", and "published email" lines that the source page printed next to the name. Whenever any of these are present, state the street address, phone number, and email address clearly and name the source that published them.',
    'If none of the hits contains a street address, explicitly state that no public address was found; never guess a residence or property.',
    ageHint
      ? `The user supplied an age hint "${ageHint}". Mention it only if a hit supports it; otherwise say the sources do not state an age.`
      : '',
    `Person: ${name}${place ? `, place hint: ${place}` : ''}.`,
    '',
    resultDigest(results),
  ]
    .filter(Boolean)
    .join('\n');
}

async function callGemini(prompt, apiKey, fetchImpl) {
  // One deadline for the whole model ladder, one request budget per model:
  // Gemini regularly needs more than six seconds for a grounded summary, and a
  // shared short timeout turned every answer into the deterministic fallback.
  const deadline = Date.now() + 24_000;
  let lastError = null;
  for (const model of MODELS) {
    if (Date.now() >= deadline) {
      lastError = 'summary deadline reached';
      break;
    }
    try {
      const response = await fetchImpl(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.2,
              maxOutputTokens: 700,
              thinkingConfig: { thinkingBudget: 0 },
            },
          }),
          signal: AbortSignal.timeout(Math.min(10_000, deadline - Date.now())),
        },
      );
      if (!response.ok) {
        lastError = `HTTP ${response.status}`;
        continue;
      }
      const body = await response.json();
      const text = (body?.candidates?.[0]?.content?.parts || [])
        .map((part) => part?.text)
        .filter(Boolean)
        .join('\n')
        .trim();
      if (text) return { text, model };
      lastError = 'empty summary';
    } catch (error) {
      lastError = String(error?.message || error);
    }
  }
  return { text: '', model: '', error: lastError };
}

/**
 * Summary for a name (+ place/age hint), based on the cached Tavily hits.
 * Returns {summary:'', unavailable:true} when no provider/model answers.
 */
export async function personSummary({
  name,
  place,
  age,
  lang,
  fetchImpl = fetch,
} = {}) {
  const person = String(name || '').trim();
  if (person.length < 2) return { summary: '', unavailable: true };
  const key = `${person}|${place || ''}|${age || ''}|${lang || ''}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.body;

  const web = await personWebSearch({
    name: person,
    place,
    age,
    lang,
    fetchImpl,
  });
  if (!web?.results?.length) {
    return { summary: '', unavailable: true, results: 0 };
  }
  const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
  const prompt = promptFor({
    name: person,
    place,
    age,
    lang,
    results: web.results,
  });
  const answer = apiKey ? await callGemini(prompt, apiKey, fetchImpl) : {};
  const addresses = [
    ...new Set(
      web.results
        .map((row) => String(row.address || '').trim())
        .filter(Boolean),
    ),
  ].slice(0, 2);
  const phones = [
    ...new Set(
      web.results
        .map((row) => String(row.phone || '').trim())
        .filter(Boolean),
    ),
  ].slice(0, 2);
  const emails = [
    ...new Set(
      web.results
        .map((row) => String(row.email || '').trim())
        .filter(Boolean),
    ),
  ].slice(0, 2);
  const fallbackText =
    languageOf(lang) === 'de'
      ? `Ich habe ${web.results.length} öffentliche Treffer gefunden: ${web.results
          .slice(0, 3)
          .map((row) => row.title)
          .join('; ')}.${
          addresses.length
            ? ` Veröffentlichte Adresse: ${addresses.join(' und ')}.`
            : ' Keine veröffentlichte Adresse gefunden.'
        }${phones.length ? ` Telefon: ${phones.join(', ')}.` : ''}${
          emails.length ? ` E-Mail: ${emails.join(', ')}.` : ''
        } Welchen Eintrag meinst du?`
      : `I found ${web.results.length} public hits: ${web.results
          .slice(0, 3)
          .map((row) => row.title)
          .join('; ')}.${
          addresses.length
            ? ` Published address: ${addresses.join(' and ')}.`
            : ' No published address found.'
        }${phones.length ? ` Phone: ${phones.join(', ')}.` : ''}${
          emails.length ? ` Email: ${emails.join(', ')}.` : ''
        } Which entry do you mean?`;
  const body = answer.text
    ? {
        summary: answer.text,
        model: answer.model,
        results: web.results.length,
        contacts: web.contacts,
      }
    : {
        summary: fallbackText,
        fallback: true,
        error: answer.error || 'no summary',
        results: web.results.length,
        contacts: web.contacts,
      };
  // A 503 from the model is transient; caching it would keep the fallback on
  // screen for ten minutes instead of retrying on the next look-up.
  if (answer.text) {
    cache.set(key, { at: Date.now(), body });
    if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
  }
  return body;
}

/**
 * Web results about a person through a licensed search API.
 *
 * Google, Bing and DuckDuckGo do not allow robots to pull their result pages;
 * this module therefore talks to a search API that is meant for programmatic
 * use (Brave, Tavily or Google Programmable Search). It returns the ordinary
 * web hits — title, URL, snippet — and nothing else is fetched from result
 * pages. Snippets and provider raw_content may contain contact details the
 * source published; extracted fields are a public street address for the map
 * button and any phone/email published near the name.
 *
 * Configure one provider with environment variables:
 *   BRAVE_SEARCH_API_KEY
 *   TAVILY_API_KEY
 *   GOOGLE_SEARCH_API_KEY + GOOGLE_SEARCH_CX
 */

const CACHE_MS = 10 * 60 * 1000;
const CACHE_LIMIT = 200;
const RESULT_LIMIT = 18;
/** @type {Map<string, {at:number, body:object}>} */
const cache = new Map();
/** @type {Map<string, Promise<object>>} */
const inFlight = new Map();

function cleanText(value, maxLen = 320) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

function foldText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss')
    .toLowerCase();
}

function tokensOf(value) {
  return foldText(value)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3);
}

/**
 * Generates both diacritic-stripped ("buchel", "muller") and German digraph
 * ("buechel", "mueller") variants so names with umlauts match ASCII, umlaut,
 * and ae/oe/ue spellings in page text, URLs, and email addresses.
 */
function tokenVariants(value) {
  const raw = String(value || '').toLowerCase();
  const digraph = raw
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss');
  const set = new Set([
    ...tokensOf(raw),
    ...tokensOf(digraph),
  ]);
  for (const token of [...set]) {
    const collapsed = token
      .replace(/ae/g, 'a')
      .replace(/oe/g, 'o')
      .replace(/ue/g, 'u');
    if (collapsed.length >= 3) set.add(collapsed);
  }
  return [...set];
}

function webUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.href
      : '';
  } catch {
    return '';
  }
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
}

const STREET_GERMAN = [
  'strasse',
  'straße',
  'gasse',
  'platz',
  'ring',
  'allee',
  'weg',
  'steig',
  'halde',
  'rain',
  'vorstadt',
  'hofstatt',
  'hof',
  'matte',
  'matt',
  'feld',
  'acker',
  'wiese',
  'moos',
  'wydum',
  'widum',
  'eich',
  'stock',
  'burg',
  'tal',
  'berg',
  'au',
  'schulhaus',
  'dom',
  'dorf',
  'str',
  'damm',
  'promenade',
  'quai',
  'ufer',
  'graben',
  'brücke',
  'brucke',
  'stutz',
  'bühl',
  'buehl',
  'buel',
  'hub',
  'riet',
  'ried',
  'egg',
  'rank',
  'winkel',
  'garten',
  'park',
  'markt',
  'tor',
  'zelg',
  'boden',
  'stein',
  'tobel',
  'reute',
  'rüti',
  'rueti',
  'wis',
  'wies',
  'hag',
  'holz',
  'wald',
  'bach',
  'brunnen',
].join('|');

const STREET_ROMANCE = [
  'via',
  'rue',
  'chemin',
  'chauss[ée]e',
  'bo[u]levard',
  'route',
  'place',
  'impasse',
  'passage',
  'calle',
  'corso',
  'strada',
  'viale',
  'camin',
  'gass',
  'piazza',
  'all[ée]e',
].join('|');

/** Words that belong to a street name ("Untere Färschstrasse", "St. Gallerstrasse"), not prose. */
const STREET_QUALIFIERS = new Set([
  'st',
  'sankt',
  'dr',
  'prof',
  'general',
  'untere',
  'unterste',
  'oberste',
  'obere',
  'ober',
  'unter',
  'mittlere',
  'mittlerer',
  'innere',
  'äussere',
  'aeussere',
  'alte',
  'alten',
  'alter',
  'neue',
  'neuen',
  'neu',
  'hintere',
  'vordere',
  'niedere',
  'grosse',
  'große',
  'kleine',
  'am',
  'an',
  'auf',
  'bei',
  'beim',
  'zur',
  'zum',
  'im',
  'in',
  'den',
  'der',
  'vor',
  'hinter',
  'nider',
  'chi',
  'tier',
  'vecchia',
  'vechia',
]);

/** Place names that continue with a second word ("St. Moritz", "Bad Ragaz"). */
const CITY_PREFIXES = new Set([
  'st',
  'sankt',
  'bad',
  'ober',
  'unter',
  'nieder',
  'klein',
  'gross',
  'groß',
  'hinter',
  'vorder',
  'neu',
  'alt',
  'zur',
  'zum',
  'le',
  'la',
  'les',
  'des',
]);

const ADDRESS_TAIL =
  '[.,/]?\\s+(?<num>\\d{1,5}[a-z]?(?:\\s*[/\\u2013-]\\s*\\d{1,5}[a-z]?)?)' +
  '[,\\s]+(?:CH|D|A|FL|I|NL|B|LT|SL)?[-\\u2013]?\\s*(?<zip>\\d{4,5})' +
  '\\s+(?<city>[\\p{L}][\\p{L}.-]*)(?:\\s+(?<more>[\\p{L}][\\p{L}.-]*))?';

/** "Untere Färschstrasse 14, 9464 Rüthi" or "St. Galler Strasse 12, 9435 Heerbrugg" */
const GERMAN_ADDRESS_RE = new RegExp(
  '(?<![\\p{L}0-9])' +
    '(?:(?<qual>(?:(?:St\\.?|Sankt|Dr\\.?|Prof\\.?|General)\\s+[\\p{L}.-]+|[\\p{L}.-]+))\\s+)?' +
    '(?<street>[\\p{L}.-]*(?:' +
    STREET_GERMAN +
    ')(?![\\p{L}]))' +
    ADDRESS_TAIL,
  'giu',
);

/** "Via Maistra 42, 7500 St. Moritz" */
const ROMANCE_ADDRESS_RE = new RegExp(
  '(?<![\\p{L}0-9])' +
    '(?<street>(?:' +
    STREET_ROMANCE +
    ')(?![\\p{L}])' +
    '(?:\\s+[\\p{L}.-]{2,24}){1,3})' +
    ADDRESS_TAIL,
  'giu',
);

/** "Im Wingert 4, 9435 Heerbrugg" or "In der Au 5, 9434 Au" */
const PREPOSITION_ADDRESS_RE = new RegExp(
  '(?<![\\p{L}0-9])' +
    '(?<street>(?:Im|Am|Zum|Zur|Beim|In\\s+der|An\\s+der|Auf\\s+der)(?![\\p{L}])' +
    '\\s+[\\p{L}][\\p{L}.-]{2,24})' +
    ADDRESS_TAIL,
  'gu',
);

const PHONE_RE =
  /(?:\+\d{1,3}[\s./-]*(?:\(0\)[\s./-]*)?\d[\d\s()/.-]{5,16}\d|\b00\d{1,3}[\s./-]*(?:\(0\)[\s./-]*)?\d[\d\s()/.-]{5,16}\d|\(0\d{1,4}\)[\s/.-]*\d[\d\s/.-]{4,14}\d|\b0\d{1,4}[\s()/.-]+\d[\d\s()/.-]{4,14}\d|\b0\d{8,11}\b)/g;
const PHONE_LABEL_RE =
  /(?:tel(?:efon|ephone)?|phone|mobil(?:e)?|natel|handy|fon|direkt|praxis|b[üu]ro|kontakt|📞|☎)\s*[:.-]?\s*$/i;
const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const JUNK_EMAIL_RE =
  /^(?:no-?reply|donotreply|datenschutz|privacy|abuse|webmaster|hostmaster|postmaster|sentry|cookies)@|@(?:example\.|sentry\.|wixpress\.)/i;

function isCapitalised(word) {
  const first = String(word || '').charAt(0);
  return first === first.toUpperCase() && first !== first.toLowerCase();
}

function key(word) {
  return foldText(word).replace(/\.$/, '');
}

function untrail(word) {
  return String(word || '')
    .replace(/[.,;:)\]]+$/, '')
    .trim();
}

function addressFrom(match) {
  const { qual, street, num, zip, city, more } = match.groups;
  let prefix = street;
  if (qual) {
    const parts = qual.trim().split(/\s+/);
    const first = parts[0] || '';
    const second = parts[1] || '';
    if (
      parts.length === 2 &&
      isCapitalised(first) &&
      STREET_QUALIFIERS.has(key(first)) &&
      isCapitalised(second)
    ) {
      prefix = `${first} ${second} ${street}`;
    } else if (
      parts.length === 1 &&
      isCapitalised(first) &&
      STREET_QUALIFIERS.has(key(first))
    ) {
      prefix = `${first} ${street}`;
    }
  }
  if (!isCapitalised(prefix.replace(/^[^\p{L}]+/u, ''))) return '';
  let place = untrail(city);
  if (more && CITY_PREFIXES.has(key(city)))
    place = `${place} ${untrail(more)}`;
  if (!place) return '';
  return `${prefix} ${num}, ${zip} ${place}`.replace(/\s+/g, ' ').trim();
}

function nameDistance(text, personName, index) {
  const folded = foldText(text);
  let best = Infinity;
  for (const token of tokenVariants(personName)) {
    let at = folded.indexOf(token);
    while (at !== -1) {
      best = Math.min(best, Math.abs(at - index));
      at = folded.indexOf(token, at + 1);
    }
  }
  return best;
}

function firstNamePosition(text, personName) {
  const folded = foldText(text);
  let earliest = Infinity;
  for (const token of tokenVariants(personName)) {
    const at = folded.indexOf(token);
    if (at !== -1 && at < earliest) earliest = at;
  }
  return earliest;
}

function titleMatchesPerson(title, personName) {
  const tokens = tokensOf(personName);
  if (tokens.length < 2) return false;
  const foldedTitle = foldText(title);
  return tokens.every((token) =>
    tokenVariants(token).some((variant) => foldedTitle.includes(variant)),
  );
}

/**
 * A street address published on the result page, taken from the place where
 * the searched name actually appears. Directory pages print their own address
 * in the header, so the distance to the name decides which candidate wins.
 */
function extractAddress(text, personName, title = '') {
  const clean = String(text || '').replace(/\s+/g, ' ');
  if (!clean || tokensOf(personName).length < 2) return '';
  const dedicatedPage = titleMatchesPerson(title, personName);
  const namePos = firstNamePosition(clean, personName);
  let best = '';
  let bestDistance = dedicatedPage ? 1200 : 400;
  for (const re of [GERMAN_ADDRESS_RE, ROMANCE_ADDRESS_RE, PREPOSITION_ADDRESS_RE]) {
    re.lastIndex = 0;
    for (const match of clean.matchAll(re)) {
      const address = addressFrom(match);
      if (!address) continue;
      const distance = nameDistance(clean, personName, match.index);
      const maxAllowed =
        dedicatedPage && match.index >= namePos ? 1200 : 400;
      if (distance < maxAllowed && distance < bestDistance) {
        bestDistance = distance;
        best = address;
      }
    }
  }
  return best;
}

function normalizePhoneDigits(phone) {
  return String(phone || '')
    .replace(/\(0\)/g, '')
    .replace(/\D/g, '');
}

function extractPhones(text, personName, title = '') {
  const clean = String(text || '').replace(/\s+/g, ' ');
  if (!clean || tokensOf(personName).length < 2) {
    return { phone: '', phones: [] };
  }
  const dedicatedPage = titleMatchesPerson(title, personName);
  const namePos = firstNamePosition(clean, personName);
  const candidates = [];
  PHONE_RE.lastIndex = 0;
  for (const match of clean.matchAll(PHONE_RE)) {
    const candidate = match[0].trim();
    const digits = normalizePhoneDigits(candidate);
    if (digits.length < 8 || digits.length > 15) continue;
    // Skip date ranges, dates, Swiss UID numbers, AHV numbers
    if (/^\d{4}\s*[-–/]\s*\d{4}$/.test(candidate)) continue;
    if (/^\d{2}\.\d{2}\.\d{4}$/.test(candidate)) continue;
    if (/^\d{4}-\d{2}-\d{2}$/.test(candidate)) continue;
    if (/^756[.\s-]?\d{4}/.test(candidate)) continue;
    const prefixContext = clean.slice(Math.max(0, match.index - 32), match.index);
    if (/CHE-?\s*$|UID\s*[:.]?\s*$|IBAN\s*[:.]?\s*$/i.test(prefixContext)) {
      continue;
    }
    const hasLabel = PHONE_LABEL_RE.test(prefixContext);
    // Pure unspaced 8-11 digit numbers without a phone label are often IDs
    if (/^0\d{8,11}$/.test(candidate) && !hasLabel) continue;
    const distance = nameDistance(clean, personName, match.index);
    const maxAllowed =
      dedicatedPage && match.index >= namePos ? 1400 : 450;
    if (distance >= maxAllowed) continue;
    const score = hasLabel ? Math.max(0, distance - 120) : distance;
    candidates.push({ candidate, digits: digits.slice(-8), score });
  }
  candidates.sort((a, b) => a.score - b.score);
  const seen = new Set();
  const phones = [];
  for (const entry of candidates) {
    if (seen.has(entry.digits)) continue;
    seen.add(entry.digits);
    phones.push(entry.candidate);
    if (phones.length >= 3) break;
  }
  return { phone: phones[0] || '', phones };
}

function deobfuscateEmails(text) {
  return String(text || '')
    .replace(
      /([\w.+-]+)\s*(?:\[at\]|\(at\)|\{at\})\s*([\w.-]+\.[a-z]{2,})/gi,
      '$1@$2',
    )
    .replace(
      /([\w.+-]+@[\w-]+)\s*(?:\[dot\]|\(dot\)|\[punkt\]|\(punkt\))\s*([a-z]{2,})/gi,
      '$1.$2',
    );
}

function extractEmails(text, personName, title = '') {
  const clean = deobfuscateEmails(String(text || '').replace(/\s+/g, ' '));
  if (!clean || tokensOf(personName).length < 2) {
    return { email: '', emails: [] };
  }
  const dedicatedPage = titleMatchesPerson(title, personName);
  const namePos = firstNamePosition(clean, personName);
  const variants = tokenVariants(personName);
  const candidates = [];
  EMAIL_RE.lastIndex = 0;
  for (const match of clean.matchAll(EMAIL_RE)) {
    const candidate = match[0]
      .replace(/[.,;:)\]]+$/, '')
      .trim()
      .toLowerCase();
    if (
      !candidate ||
      /\.(png|jpg|jpeg|gif|svg|webp|css|js|woff2?|ttf)$/i.test(candidate) ||
      JUNK_EMAIL_RE.test(candidate)
    ) {
      continue;
    }
    const localPart = foldText(candidate.split('@')[0] || '');
    const carriesName = variants.some(
      (variant) => variant.length >= 3 && localPart.includes(variant),
    );
    const distance = nameDistance(clean, personName, match.index);
    const maxAllowed = carriesName
      ? 2400
      : dedicatedPage && match.index >= namePos
        ? 1400
        : 450;
    if (distance >= maxAllowed) continue;
    const score = carriesName ? Math.min(distance, 80) : distance;
    candidates.push({ candidate, score });
  }
  candidates.sort((a, b) => a.score - b.score);
  const seen = new Set();
  const emails = [];
  for (const entry of candidates) {
    if (seen.has(entry.candidate)) continue;
    seen.add(entry.candidate);
    emails.push(entry.candidate);
    if (emails.length >= 3) break;
  }
  return { email: emails[0] || '', emails };
}

/**
 * Extracts a rich excerpt around the person's name from raw_content when the
 * short snippet is generic or misses the section where the person appears.
 */
function extractContextSnippet(snippet, raw, personName) {
  const baseSnippet = cleanText(snippet, 340);
  const cleanRaw = String(raw || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[#*_`>|~]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleanRaw || tokensOf(personName).length < 1) return baseSnippet;
  const variants = tokenVariants(personName);
  const foldedRaw = foldText(cleanRaw);
  const foldedSnippet = foldText(baseSnippet);
  const snippetHasAll = tokensOf(personName).every((token) =>
    tokenVariants(token).some((variant) => foldedSnippet.includes(variant)),
  );
  if (snippetHasAll && baseSnippet.length >= 140) return baseSnippet;

  let bestIndex = -1;
  let bestScore = -1;
  for (const variant of variants) {
    let pos = foldedRaw.indexOf(variant);
    while (pos !== -1) {
      const windowFolded = foldedRaw.slice(
        Math.max(0, pos - 80),
        Math.min(foldedRaw.length, pos + 260),
      );
      let score = 0;
      for (const token of tokensOf(personName)) {
        if (tokenVariants(token).some((v) => windowFolded.includes(v))) {
          score += 3;
        }
      }
      if (/@|\btel\b|\btelefon\b|\b\d{4}\b/.test(windowFolded)) score += 2;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = pos;
      }
      pos = foldedRaw.indexOf(variant, pos + variant.length);
    }
  }
  if (bestIndex === -1) return baseSnippet;
  const start = Math.max(0, bestIndex - 60);
  const excerpt = cleanRaw
    .slice(start, start + 300)
    .replace(/^\S*\s/, start > 0 ? '…' : '')
    .trim();
  if (!excerpt) return baseSnippet;
  if (!baseSnippet || baseSnippet.length < 60) return excerpt.slice(0, 340);
  if (!snippetHasAll) return `${baseSnippet} — ${excerpt}`.slice(0, 360);
  return baseSnippet;
}

function normalize(rows, source, nameTokens = [], personName = '') {
  const seen = new Set();
  const results = [];
  const nameVariants = tokenVariants(personName);
  for (const row of Array.isArray(rows) ? rows : []) {
    const url = webUrl(row?.url || row?.link);
    if (!url || seen.has(url)) continue;
    const host = hostOf(url).toLowerCase();
    let title = cleanText(row?.title);
    if (!title || /^https?:\/\//i.test(title)) title = host;
    if (!title) continue;
    const rawSnippet = cleanText(
      row?.snippet || row?.description || row?.content || row?.text,
    );
    const raw = String(row?.raw_content || '')
      .replace(/<[^>]*>/g, ' ')
      .slice(0, 36_000);
    const combined = [title, rawSnippet, raw].filter(Boolean).join(' ');
    const address = extractAddress(combined, personName, title);
    const { phone, phones } = extractPhones(combined, personName, title);
    const { email, emails } = extractEmails(combined, personName, title);
    const snippet = extractContextSnippet(rawSnippet, raw, personName);
    if (nameTokens.length) {
      const haystack = foldText(`${title} ${snippet} ${raw} ${url}`);
      const checkTokens = nameVariants.length ? nameVariants : nameTokens;
      if (!checkTokens.some((token) => haystack.includes(token))) continue;
    }
    seen.add(url);
    results.push({
      title,
      url,
      snippet,
      source,
      ...(address ? { address } : {}),
      ...(phone ? { phone } : {}),
      ...(phones.length > 1 ? { phones } : {}),
      ...(email ? { email } : {}),
      ...(emails.length > 1 ? { emails } : {}),
    });
    if (results.length >= RESULT_LIMIT) break;
  }
  return results;
}

/**
 * Rank full-name matches, place matches, and contact-bearing hits ahead of
 * partial single-token hits while preserving relative order among ties.
 */
function rankResults(results, nameTokens, placeTokens) {
  if (!nameTokens.length || results.length <= 1) return results;
  return results
    .map((row, index) => {
      const folded = foldText(
        `${row.title} ${row.snippet} ${row.address || ''} ${row.email || ''} ${row.url}`,
      );
      let matchedName = 0;
      for (const token of nameTokens) {
        if (tokenVariants(token).some((variant) => folded.includes(variant))) {
          matchedName += 1;
        }
      }
      let matchedPlace = 0;
      for (const token of placeTokens) {
        if (tokenVariants(token).some((variant) => folded.includes(variant))) {
          matchedPlace += 1;
        }
      }
      const allNameMatched = matchedName === nameTokens.length ? 1 : 0;
      const contactBonus =
        allNameMatched && (row.address || row.phone || row.email) ? 2 : 0;
      const score =
        allNameMatched * 10 +
        matchedName * 2 +
        matchedPlace * 2 +
        contactBonus;
      return { row, index, score };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.row);
}

function mergePassResults(target, incoming) {
  for (const row of incoming) {
    const existing = target.find((entry) => entry.url === row.url);
    if (!existing) {
      target.push(row);
      continue;
    }
    if (!existing.address && row.address) existing.address = row.address;
    if (!existing.phone && row.phone) existing.phone = row.phone;
    if (!existing.email && row.email) existing.email = row.email;
    if (row.phones?.length) {
      const mergedPhones = [
        ...new Set([
          ...(existing.phones || (existing.phone ? [existing.phone] : [])),
          ...row.phones,
        ]),
      ];
      if (mergedPhones.length > 1) existing.phones = mergedPhones.slice(0, 3);
    }
    if (row.emails?.length) {
      const mergedEmails = [
        ...new Set([
          ...(existing.emails || (existing.email ? [existing.email] : [])),
          ...row.emails,
        ]),
      ];
      if (mergedEmails.length > 1) existing.emails = mergedEmails.slice(0, 3);
    }
    if (
      row.snippet &&
      (!existing.snippet || row.snippet.length > existing.snippet.length + 30)
    ) {
      existing.snippet = row.snippet;
    }
  }
}

function collectContacts(results) {
  const phones = [];
  const emails = [];
  const addresses = [];
  const seenPhones = new Set();
  const seenEmails = new Set();
  const seenAddresses = new Set();
  for (const row of results || []) {
    const rowPhones = row.phones?.length
      ? row.phones
      : row.phone
        ? [row.phone]
        : [];
    for (const phone of rowPhones) {
      const key = normalizePhoneDigits(phone).slice(-8);
      if (!key || seenPhones.has(key)) continue;
      seenPhones.add(key);
      phones.push({
        phone,
        title: row.title,
        url: row.url,
        source: row.source,
      });
    }
    const rowEmails = row.emails?.length
      ? row.emails
      : row.email
        ? [row.email]
        : [];
    for (const email of rowEmails) {
      const key = String(email).toLowerCase();
      if (!key || seenEmails.has(key)) continue;
      seenEmails.add(key);
      emails.push({
        email,
        title: row.title,
        url: row.url,
        source: row.source,
      });
    }
    if (row.address) {
      const key = String(row.address).toLowerCase();
      if (!seenAddresses.has(key)) {
        seenAddresses.add(key);
        addresses.push({
          address: row.address,
          phone: row.phone || '',
          email: row.email || '',
          title: row.title,
          url: row.url,
          source: row.source,
        });
      }
    }
  }
  return { phones, emails, addresses };
}

async function braveSearch(query, lang, nameTokens, personName, fetchImpl) {
  const key = String(process.env.BRAVE_SEARCH_API_KEY || '').trim();
  if (!key) return [];
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', String(RESULT_LIMIT));
  url.searchParams.set('safesearch', 'moderate');
  if (lang) url.searchParams.set('search_lang', lang);
  const response = await fetchImpl(url, {
    headers: {
      Accept: 'application/json',
      'X-Subscription-Token': key,
    },
    signal: AbortSignal.timeout(9_000),
  });
  if (!response.ok) return [];
  const body = await response.json();
  const rows = (body?.web?.results || []).map((row) => ({
    title: row?.title,
    url: row?.url,
    snippet: row?.description,
  }));
  return normalize(rows, 'Brave', nameTokens, personName);
}

async function tavilySearch(
  query,
  nameTokens,
  personName,
  fetchImpl,
  { includeRawContent = false, limit = RESULT_LIMIT } = {},
) {
  const key = String(process.env.TAVILY_API_KEY || '').trim();
  if (!key) return [];
  const response = await fetchImpl('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: key,
      query,
      search_depth: 'basic',
      include_answer: false,
      include_raw_content: includeRawContent,
      max_results: limit,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) return [];
  const body = await response.json();
  return normalize(body?.results, 'Tavily', nameTokens, personName);
}

async function googleCseSearch(query, lang, nameTokens, personName, fetchImpl) {
  const key = String(process.env.GOOGLE_SEARCH_API_KEY || '').trim();
  const cx = String(process.env.GOOGLE_SEARCH_CX || '').trim();
  if (!key || !cx) return [];
  const url = new URL('https://www.googleapis.com/customsearch/v1');
  url.searchParams.set('key', key);
  url.searchParams.set('cx', cx);
  url.searchParams.set('q', query);
  url.searchParams.set('num', '10');
  if (lang) url.searchParams.set('hl', lang);
  const response = await fetchImpl(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(9_000),
  });
  if (!response.ok) return [];
  const body = await response.json();
  const rows = (body?.items || []).map((row) => ({
    title: row?.title,
    url: row?.link,
    snippet: row?.snippet,
  }));
  return normalize(rows, 'Google', nameTokens, personName);
}

/**
 * Public web hits for a name (+ optional place) through the first configured
 * search provider. An unconfigured deployment answers with configured:false so
 * the panel can keep showing its manual search links.
 * @param {{name:string, place?:string, age?:string, lang?:string, fetchImpl?:Function}} options
 */
export async function personWebSearch({
  name,
  place,
  age,
  lang,
  fetchImpl = fetch,
} = {}) {
  const query = [name, place, age]
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(' ');
  if (query.length < 2 || query.length > 120) return null;
  const language = String(lang || '')
    .trim()
    .toLowerCase()
    .split('-')[0]
    .slice(0, 2);
  const configured = Boolean(
    process.env.BRAVE_SEARCH_API_KEY ||
      process.env.TAVILY_API_KEY ||
      (process.env.GOOGLE_SEARCH_API_KEY && process.env.GOOGLE_SEARCH_CX),
  );
  if (!configured) {
    return {
      configured: false,
      query,
      results: [],
      contacts: { phones: [], emails: [], addresses: [] },
      source: '',
    };
  }
  const placeTokens = new Set(tokensOf(place));
  const nameTokens = tokensOf(name).filter((token) => !placeTokens.has(token));
  const cacheKey = `${query}|${language}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.body;
  if (fetchImpl === fetch && inFlight.has(cacheKey)) {
    return inFlight.get(cacheKey);
  }

  const run = (async () => {
    let results = [];
    let source = '';
    try {
      results = await braveSearch(query, language, nameTokens, name, fetchImpl);
      if (results.length) source = 'Brave';
      if (!results.length && process.env.TAVILY_API_KEY) {
        const base = [name, place].filter(Boolean).join(' ');
        const impressumQuery = `${base} Impressum`.trim();
        const contactQuery = `${base} Kontakt Telefon E-Mail`.trim();
        const runImpressum =
          impressumQuery.toLowerCase() !== query.toLowerCase();
        const runContact =
          !/\b(telefon|kontakt|e-?mail)\b/i.test(query) &&
          tokensOf(name).length >= 2;
        const [primary, impressum, contactHits] = await Promise.all([
          tavilySearch(query, nameTokens, name, fetchImpl, {
            includeRawContent: true,
            limit: 12,
          }),
          runImpressum
            ? tavilySearch(impressumQuery, nameTokens, name, fetchImpl, {
                includeRawContent: true,
                limit: 6,
              }).catch(() => [])
            : Promise.resolve([]),
          runContact
            ? tavilySearch(contactQuery, nameTokens, name, fetchImpl, {
                includeRawContent: true,
                limit: 6,
              }).catch(() => [])
            : Promise.resolve([]),
        ]);
        results = [...primary];
        if (primary.length || impressum.length || contactHits.length) {
          source = 'Tavily';
        }
        mergePassResults(results, impressum);
        mergePassResults(results, contactHits);
      }
      if (!results.length) {
        results = await googleCseSearch(
          query,
          language,
          nameTokens,
          name,
          fetchImpl,
        );
        if (results.length) source = 'Google';
      }
      results = rankResults(results, nameTokens, placeTokens).slice(
        0,
        RESULT_LIMIT,
      );
    } catch {
      results = [];
      source = '';
    }
    const contacts = collectContacts(results);
    const body = {
      configured: true,
      query,
      results,
      contacts,
      source,
      fetchedAt: Date.now(),
    };
    cache.set(cacheKey, { at: Date.now(), body });
    if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
    return body;
  })();

  if (fetchImpl === fetch) {
    inFlight.set(cacheKey, run);
    run.finally(() => inFlight.delete(cacheKey));
  }
  return run;
}

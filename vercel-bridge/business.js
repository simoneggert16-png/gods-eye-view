/**
 * Public business and practice contacts: offices, practices, shops.
 *
 * Returns only what a business publishes for enquiries — name, trade,
 * address, business phone, business email, website and opening hours — with
 * the source attached. No private individuals, no profile building.
 *
 * TomTom's POI index is the primary source (the key the place search already
 * uses); OpenStreetMap's Nominatim covers POIs TomTom has no contact data
 * for. Nominatim asks for at most one request per second, so calls are spaced.
 * An optional place is geocoded first and bounds the search to 30 km.
 */

const CACHE_MS = 10 * 60 * 1000;
const CACHE_LIMIT = 200;
const SEARCH_RADIUS_KM = 30;
/** @type {Map<string, {at:number, body:object}>} */
const cache = new Map();

let nominatimLast = 0;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const STOPWORDS = new Set([
  'der',
  'die',
  'das',
  'und',
  'bei',
  'fur',
  'von',
  'the',
  'and',
  'of',
  'in',
  'im',
  'am',
  'an',
  'zu',
  'zur',
  'zum',
]);

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss')
    .toLowerCase();
}

/**
 * Name fragments in the query. A full personal name works because companies
 * named after their founder carry the surname ("André Eggert" → "eggert").
 */
function queryTokens(query) {
  return normalizeText(query)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}

function matchScore(result, tokens) {
  if (!tokens.length) return 0;
  const label = normalizeText(`${result.name} ${result.category}`);
  return tokens.reduce(
    (score, token) => score + (label.includes(token) ? 1 : 0),
    0,
  );
}

function matchesQuery(result, tokens) {
  return !tokens.length || matchScore(result, tokens) > 0;
}

/** Keep only the results matching the most query fragments. */
function bestMatches(results, tokens) {
  if (!tokens.length) return results;
  const scored = results.map((result) => ({
    result,
    score: matchScore(result, tokens),
  }));
  const best = Math.max(0, ...scored.map((entry) => entry.score));
  if (best <= 0) return [];
  // "André Eggert" must match Eggert, not every André: when only one fragment
  // matches anywhere, the surname (last fragment) wins or nothing does.
  if (best === 1 && tokens.length > 1) {
    const surname = tokens[tokens.length - 1];
    return scored
      .filter((entry) => matchScore(entry.result, [surname]) > 0)
      .map((entry) => entry.result);
  }
  return scored
    .filter((entry) => entry.score === best)
    .map((entry) => entry.result);
}

function dedupe(results) {
  const seen = new Set();
  return results.filter((result) => {
    const key = normalizeText(
      `${result.name}|${result.phone || result.address}`,
    );
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function distanceKm(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

function withinCenter(result, center) {
  if (!center) return true;
  if (!Number.isFinite(result.lat) || !Number.isFinite(result.lon))
    return false;
  return (
    distanceKm(center.lat, center.lon, result.lat, result.lon) <=
    SEARCH_RADIUS_KM
  );
}

async function throttleNominatim() {
  const wait = 1_000 - (Date.now() - nominatimLast);
  if (wait > 0) await sleep(wait);
  nominatimLast = Date.now();
}

function contactOf(...values) {
  return values.map((value) => String(value || '').trim()).find(Boolean) || '';
}

async function tomtomGeocode(place, fetchImpl) {
  const key = String(process.env.TOMTOM_API_KEY || '').trim();
  if (!key) return null;
  try {
    const url = new URL(
      'https://api.tomtom.com/search/2/geocode/' +
        encodeURIComponent(place) +
        '.json',
    );
    url.searchParams.set('key', key);
    url.searchParams.set('limit', '1');
    url.searchParams.set('language', 'de-DE');
    const response = await fetchImpl(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(6_000),
    });
    if (!response.ok) return null;
    const body = await response.json();
    const result = body?.results?.[0];
    if (!Number.isFinite(result?.position?.lat)) return null;
    return {
      lat: result.position.lat,
      lon: result.position.lon,
      label: String(result.address?.freeformAddress || place),
    };
  } catch {
    return null;
  }
}

async function nominatimGeocode(place, fetchImpl) {
  try {
    await throttleNominatim();
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('q', place);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', '1');
    url.searchParams.set('accept-language', 'de,en');
    const response = await fetchImpl(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent':
          'gods-eye-view/1.0 (business contact search; https://gods-eye-view-fresh.vercel.app)',
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return null;
    const body = await response.json();
    const result = Array.isArray(body) ? body[0] : null;
    if (!Number.isFinite(Number(result?.lat))) return null;
    return {
      lat: Number(result.lat),
      lon: Number(result.lon),
      label: String(result.display_name || place),
    };
  } catch {
    return null;
  }
}

async function geocodePlace(place, fetchImpl) {
  return (
    (await tomtomGeocode(place, fetchImpl)) ||
    (await nominatimGeocode(place, fetchImpl))
  );
}

async function tomtomSearch(query, tokens, center, fetchImpl) {
  const key = String(process.env.TOMTOM_API_KEY || '').trim();
  if (!key) return { ok: false, results: [] };
  try {
    const url = new URL(
      'https://api.tomtom.com/search/2/poiSearch/' +
        encodeURIComponent(query) +
        '.json',
    );
    url.searchParams.set('key', key);
    url.searchParams.set('limit', '15');
    url.searchParams.set('language', 'de-DE');
    url.searchParams.set('idxSet', 'POI');
    if (center) {
      url.searchParams.set('lat', String(center.lat));
      url.searchParams.set('lon', String(center.lon));
      url.searchParams.set('radius', String(SEARCH_RADIUS_KM * 1000));
    }
    const response = await fetchImpl(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return { ok: false, results: [] };
    const body = await response.json();
    const results = (Array.isArray(body?.results) ? body.results : [])
      .map((result) => {
        const poi = result?.poi || {};
        return {
          name: String(poi.name || result?.address?.streetName || '').trim(),
          category: Array.isArray(poi.categories)
            ? poi.categories.join(', ')
            : '',
          address: String(result?.address?.freeformAddress || '').trim(),
          phone: String(poi.phone || '').trim(),
          email: String(poi.email || '').trim(),
          website: String(poi.url || '').trim(),
          openingHours: '',
          lat: Number(result?.position?.lat),
          lon: Number(result?.position?.lon),
          source: 'TomTom',
          sourceUrl: '',
        };
      })
      .filter(
        (result) =>
          result.name &&
          (result.phone || result.email || result.website) &&
          matchesQuery(result, tokens) &&
          withinCenter(result, center),
      );
    return { ok: true, results };
  } catch {
    return { ok: false, results: [] };
  }
}

async function nominatimSearch(query, tokens, center, fetchImpl) {
  try {
    await throttleNominatim();
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('extratags', '1');
    url.searchParams.set('limit', '10');
    url.searchParams.set('accept-language', 'de,en');
    if (center) {
      const span = 0.4;
      url.searchParams.set(
        'viewbox',
        [
          center.lon - span,
          center.lat + span,
          center.lon + span,
          center.lat - span,
        ].join(','),
      );
      url.searchParams.set('bounded', '1');
    }
    const response = await fetchImpl(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent':
          'gods-eye-view/1.0 (business contact search; https://gods-eye-view-fresh.vercel.app)',
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return { ok: false, results: [] };
    const body = await response.json();
    const results = (Array.isArray(body) ? body : [])
      .map((result) => {
        const tags = result?.extratags || {};
        const category = contactOf(tags.healthcare, tags.amenity, tags.shop, result?.type);
        const osmType = String(result?.osm_type || '');
        const osmId = String(result?.osm_id || '');
        return {
          name: String(result?.name || result?.display_name || '').trim(),
          category,
          address: String(result?.display_name || '').trim(),
          phone: contactOf(tags.phone, tags['contact:phone']),
          email: contactOf(tags.email, tags['contact:email']),
          website: contactOf(tags.website, tags['contact:website'], tags.url),
          openingHours: String(tags.opening_hours || '').trim(),
          lat: Number(result?.lat),
          lon: Number(result?.lon),
          source: 'OpenStreetMap',
          sourceUrl:
            osmType && osmId
              ? `https://www.openstreetmap.org/${osmType}/${osmId}`
              : '',
        };
      })
      .filter(
        (result) =>
          result.name &&
          (result.phone || result.email || result.website) &&
          matchesQuery(result, tokens) &&
          withinCenter(result, center),
      );
    return { ok: true, results };
  } catch {
    return { ok: false, results: [] };
  }
}

/**
 * Public contacts of businesses and practices matching a free-text query.
 * @param {{query:string, place?:string, fetchImpl?:Function}} options
 */
export async function businessSearch({ query, place, fetchImpl = fetch } = {}) {  const text = String(query || '').trim().replace(/\s+/g, ' ');
  const area = String(place || '').trim().replace(/\s+/g, ' ');
  if (text.length < 2 || text.length > 80 || area.length > 60) return null;
  const key = `${text}|${area}`.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.body;

  const center = area ? await geocodePlace(area, fetchImpl) : null;
  if (area && !center) {
    return {
      query: text,
      place: area,
      placeResolved: false,
      results: [],
      source: '',
      fetchedAt: Date.now(),
    };
  }

  // A place given in its own field must not also match company names or
  // steer the POI query ("Akupunktur Rüthi" + Rüthi → "Akupunktur").
  const placeTokens = new Set(queryTokens(area));
  const tokens = queryTokens(text).filter((token) => !placeTokens.has(token));
  const searchText =
    text
      .split(/\s+/)
      .filter((word) => !placeTokens.has(normalizeText(word)))
      .join(' ') || text;
  const tomtom = await tomtomSearch(searchText, tokens, center, fetchImpl);
  let results = tomtom.results;
  let source = 'TomTom';
  if (!results.length) {
    const osm = await nominatimSearch(searchText, tokens, center, fetchImpl);
    if (!tomtom.ok && !osm.ok) return null;
    if (osm.results.length) {
      results = osm.results;
      source = 'OpenStreetMap';
    }
  }
  results = dedupe(bestMatches(results, tokens));
  const body = {
    query: text,
    place: center?.label || area,
    placeResolved: Boolean(center) || !area,
    results,
    source,
    fetchedAt: Date.now(),
  };
  cache.set(key, { at: Date.now(), body });
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
  return body;
}

/**
 * Business and practice listings for a personal name. Directories can only
 * match a name a company carries — founder and owner surnames — so the last
 * name fragment is searched: "Sybille Baumgartner-Büchel" looks up "Büchel".
 * Returns published business contacts only, never private individuals.
 * @param {{name:string, place?:string, limit?:number, fetchImpl?:Function}} options
 */
export async function personBusinessSearch({
  name,
  place,
  limit = 8,
  fetchImpl = fetch,
} = {}) {
  const tokens = queryTokens(name);
  if (!tokens.length) return { ok: true, query: '', results: [], source: '' };
  const surname = tokens[tokens.length - 1];
  const fullQuery = tokens.length > 1 ? String(name || '').trim() : '';
  const [fullBody, surnameBody] = await Promise.all([
    fullQuery && fullQuery.toLowerCase() !== surname.toLowerCase()
      ? businessSearch({ query: fullQuery, place, fetchImpl }).catch(() => null)
      : Promise.resolve(null),
    businessSearch({ query: surname, place, fetchImpl }).catch(() => null),
  ]);
  const primary = fullBody?.results?.length ? fullBody : surnameBody;
  if (!fullBody && !surnameBody) {
    return { ok: false, query: surname, results: [], source: '' };
  }
  const merged = dedupe([
    ...(fullBody?.results || []),
    ...(surnameBody?.results || []),
  ]);
  return {
    ok: true,
    query: surname,
    place: primary?.place || surnameBody?.place || place || '',
    placeResolved: Boolean(
      primary?.placeResolved ?? surnameBody?.placeResolved ?? !place,
    ),
    results: merged.slice(0, limit),
    source: primary?.source || surnameBody?.source || '',
  };
}

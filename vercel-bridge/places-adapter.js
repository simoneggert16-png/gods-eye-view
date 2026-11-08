/**
 * TomTom-backed adapter for the Google Places / Geocoding proxy routes.
 *
 * Why this exists
 * ---------------
 * `/api/google/nearby-places`, `/api/google/text-search`,
 * `/api/google/reverse-geocode` and `/api/google/geocode` are thin, key-holding
 * proxies over Google's paid Places + Geocoding APIs. Without a
 * `GOOGLE_MAPS_API_KEY` (or the split `GOOGLE_SERVER_API_KEY`) upstream answers
 * `{configured:false, places:[]}` — a deliberate, correct keyless contract. The
 * consequence on the client is silent: annotation resolution
 * (`src/annotations/resolver.js` → `placesTextSearch`) and the nearby-place
 * context simply never resolve, so labelled features stay unnamed.
 *
 * A TomTom Search key IS configured on this deployment (it already powers
 * `/api/route` and the traffic-flow tiles), and TomTom Search v2 offers the same
 * three primitives: POI text search with geo-bias, nearby search, and reverse
 * geocoding. So the bridge answers those routes from TomTom, translated into the
 * exact payload shapes upstream's own projectors emit, and steps aside the
 * moment a real Google key appears.
 *
 * Boundaries
 * ----------
 * - No upstream file is modified; this is a pre-dispatch hook in the bridge, the
 *   same pattern as the OpenSky egress shim and the AIS warm-up.
 * - It only activates when Google is NOT configured. With a Google key present,
 *   `handlePlacesRequest` returns false and upstream serves the route unchanged.
 * - The TomTom key never leaves the server, never appears in a cache key, a log
 *   line, or a response body.
 * - Bounded: in-memory LRU + per-client rate limit + a per-instance daily cap on
 *   billed upstream calls, so a runaway client cannot exhaust the TomTom budget
 *   that the traffic layer also depends on.
 */

import {
  makeRateLimiter,
  clientKey,
} from '../server/providers/common/rate-limit.js';
import { admitSameSite } from '../server/providers/common/same-site.js';
import { googleServerApiKey } from '../server/providers/places/google-key.js';

const TOMTOM_SEARCH_BASE = 'https://api.tomtom.com/search/2';

/** Routes this adapter owns. Anything else falls through to upstream. */
const ADAPTED = new Set([
  '/api/google/nearby-places',
  '/api/google/text-search',
  '/api/google/reverse-geocode',
  '/api/google/geocode',
]);

const CACHE_MAX_ENTRIES = 400;
const CACHE_TTL_MS = 10 * 60_000;
const NEGATIVE_TTL_MS = 60_000;
/** Billed upstream calls per instance-day. Cache hits never count. */
const DAILY_UPSTREAM_CAP = 1500;
const MAX_RESULTS = 20;
const REQUEST_TIMEOUT_MS = 12_000;

const cache = new Map();
let dailyCount = 0;
let dailyKey = null;

const limiter = makeRateLimiter({
  windowMs: 60_000,
  max: 30,
  globalMax: 90,
});

/** UTC day key, matching the TomTom budget governor's rollover semantics. */
function utcDayKey(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

function rollDaily(now = Date.now()) {
  const key = utcDayKey(now);
  if (key !== dailyKey) {
    dailyKey = key;
    dailyCount = 0;
  }
}

function cacheRead(key, now = Date.now()) {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (now - hit.at > (hit.negative ? NEGATIVE_TTL_MS : CACHE_TTL_MS)) {
    cache.delete(key);
    return undefined;
  }
  // Refresh recency so hot entries survive eviction.
  cache.delete(key);
  cache.set(key, hit);
  return hit;
}

function cacheWrite(key, payload, negative = false) {
  cache.set(key, { payload, negative, at: Date.now() });
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/**
 * Great-circle distance in metres; upstream's projectors compute this themselves
 * from the coordinates, so the field only has to be plausible and finite.
 */
function approximateDistanceM(lat1, lon1, lat2, lon2) {
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return null;
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return Math.round(6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function finiteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * TomTom POI result → the place object upstream's `projectNearbyPlaces` /
 * `projectTextSearchPlaces` produce. Field names and nullability match exactly,
 * because that is what `src/search/http.js` and the annotation resolver read.
 */
function tomtomPlace(result, anchorLat, anchorLon) {
  const latitude = finiteNumber(result?.position?.lat);
  const longitude = finiteNumber(result?.position?.lon);
  if (latitude === null || longitude === null) return null;

  const poi = result?.poi || {};
  const address = result?.address || {};
  const categories = Array.isArray(poi.categories) ? poi.categories : [];
  const classifications = Array.isArray(poi.classifications)
    ? poi.classifications
    : [];

  // TomTom's viewport is NW/SE corners; Google's contract is low (SW) / high
  // (NE). Swap the longitudes so the box is the same rectangle.
  const topLeft = result?.viewport?.topLeftPoint;
  const bottomRight = result?.viewport?.btmRightPoint;
  const viewport =
    finiteNumber(topLeft?.lat) !== null &&
    finiteNumber(topLeft?.lon) !== null &&
    finiteNumber(bottomRight?.lat) !== null &&
    finiteNumber(bottomRight?.lon) !== null
      ? {
          low: {
            latitude: finiteNumber(bottomRight.lat),
            longitude: finiteNumber(topLeft.lon),
          },
          high: {
            latitude: finiteNumber(topLeft.lat),
            longitude: finiteNumber(bottomRight.lon),
          },
        }
      : null;

  return {
    id: result?.id || null,
    name: poi.name || null,
    address: address.freeformAddress || null,
    latitude,
    longitude,
    distanceM:
      finiteNumber(result?.dist) !== null
        ? Math.round(Number(result.dist))
        : approximateDistanceM(anchorLat, anchorLon, latitude, longitude),
    primaryType: classifications[0]?.code || categories[0] || null,
    types: categories.slice(0, 8),
    viewport,
  };
}

/** Project a TomTom Search answer into upstream's `{places:[…]}` payload. */
function projectPlaces(data, anchorLat, anchorLon) {
  const seen = new Set();
  const places = [];
  for (const raw of Array.isArray(data?.results) ? data.results : []) {
    const place = tomtomPlace(raw, anchorLat, anchorLon);
    if (!place || !place.name) continue;
    const key = `${place.name}:${place.address || ''}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    places.push(place);
    if (places.length >= MAX_RESULTS) break;
  }
  // Nearest first, mirroring the DISTANCE rank preference upstream requests.
  places.sort((a, b) => (a.distanceM ?? 0) - (b.distanceM ?? 0));
  return places;
}

/**
 * TomTom reverse-geocode address → Google Geocoding result.
 * `normalizeGoogleReverse` in `src/search/http.js` requires `status:'OK'`,
 * `results[0].formatted_address`, `results[0].address_components` with
 * `long_name` + `types`, and reads `types` off each result.
 */
function tomtomReverseToGoogle(data) {
  const addresses = Array.isArray(data?.addresses) ? data.addresses : [];
  const results = [];
  for (const entry of addresses) {
    const a = entry?.address || {};
    const position = entry?.position || {};
    const lat = finiteNumber(position.lat);
    const lng = finiteNumber(position.lon);
    const components = [
      { long_name: a.streetName, types: ['route'] },
      { long_name: a.streetNumber, types: ['street_number'] },
      { long_name: a.neighbourhood, types: ['neighborhood'] },
      { long_name: a.municipalitySubdivision, types: ['sublocality'] },
      { long_name: a.municipality, types: ['locality'] },
      {
        long_name: a.countrySecondarySubdivision,
        types: ['administrative_area_level_2'],
      },
      {
        long_name: a.countrySubdivision,
        types: ['administrative_area_level_1'],
      },
      { long_name: a.postalCode, types: ['postal_code'] },
      { long_name: a.country, types: ['country'] },
      { long_name: a.countryCodeISO3, types: ['country_iso3'] },
    ]
      .filter((component) => component.long_name)
      .map((component) => ({
        long_name: String(component.long_name),
        short_name: String(component.long_name),
        types: component.types,
      }));
    results.push({
      formatted_address: a.freeformAddress || null,
      address_components: components,
      types: a.countryCode ? ['address'] : [],
      geometry:
        lat !== null && lng !== null
          ? { location: { lat, lng } }
          : { location: null },
    });
    if (results.length >= 12) break;
  }
  return {
    status: results.length ? 'OK' : 'ZERO_RESULTS',
    results,
    provider: 'tomtom',
  };
}

/** Forward geocode → the same Google shape `createGoogleGeocoder` consumes. */
function tomtomForwardToGoogle(data) {
  const results = [];
  for (const entry of Array.isArray(data?.results) ? data.results : []) {
    const a = entry?.address || {};
    const position = entry?.position || {};
    const lat = finiteNumber(position.lat);
    const lng = finiteNumber(position.lon);
    if (lat === null || lng === null) continue;
    results.push({
      formatted_address: a.freeformAddress || null,
      address_components: [
        a.municipality && {
          long_name: a.municipality,
          short_name: a.municipality,
          types: ['locality'],
        },
        a.countrySubdivision && {
          long_name: a.countrySubdivision,
          short_name: a.countrySubdivision,
          types: ['administrative_area_level_1'],
        },
        a.country && {
          long_name: a.country,
          short_name: a.countryCode || a.country,
          types: ['country'],
        },
      ].filter(Boolean),
      types: entry?.type === 'POI' ? ['point_of_interest'] : ['address'],
      geometry: { location: { lat, lng } },
    });
    if (results.length >= 10) break;
  }
  return {
    status: results.length ? 'OK' : 'ZERO_RESULTS',
    results,
    provider: 'tomtom',
  };
}

/** Build a TomTom Search URL for one adapted route. Key excluded from cache keys. */
function tomtomUrlFor(pathname, params, key) {
  const lat = finiteNumber(params.get('lat'));
  const lon = finiteNumber(params.get('lon'));

  if (
    pathname === '/api/google/nearby-places' ||
    pathname === '/api/google/text-search'
  ) {
    if (lat === null || lon === null) return null;
    if (pathname === '/api/google/nearby-places') {
      const radius = Math.max(
        25,
        Math.min(5000, finiteNumber(params.get('radiusM')) ?? 250),
      );
      const url = new URL(`${TOMTOM_SEARCH_BASE}/nearbySearch/.json`);
      url.searchParams.set('key', key);
      url.searchParams.set('lat', String(lat));
      url.searchParams.set('lon', String(lon));
      url.searchParams.set('radius', String(radius));
      url.searchParams.set('limit', String(MAX_RESULTS));
      return url;
    }
    const query = String(params.get('q') || '').trim();
    if (!query || query.length > 200) return null;
    // TomTom's geo-bias radius is much wider than Google's nearby circle; the
    // client passes a view-scale radius (default 6000 m), clamp to its range.
    const radius = Math.max(
      1000,
      Math.min(50_000, finiteNumber(params.get('radiusM')) ?? 6000),
    );
    const url = new URL(
      `${TOMTOM_SEARCH_BASE}/poiSearch/${encodeURIComponent(query)}.json`,
    );
    url.searchParams.set('key', key);
    url.searchParams.set('lat', String(lat));
    url.searchParams.set('lon', String(lon));
    url.searchParams.set('radius', String(radius));
    url.searchParams.set('limit', String(MAX_RESULTS));
    return url;
  }

  if (pathname === '/api/google/reverse-geocode') {
    if (lat === null || lon === null) return null;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
    const url = new URL(
      `${TOMTOM_SEARCH_BASE}/reverseGeocode/${lat},${lon}.json`,
    );
    url.searchParams.set('key', key);
    url.searchParams.set('radius', '1000');
    url.searchParams.set('limit', '5');
    return url;
  }

  // /api/google/geocode
  const query = String(params.get('address') || params.get('q') || '').trim();
  if (!query || query.length > 200) return null;
  const url = new URL(
    `${TOMTOM_SEARCH_BASE}/geocode/${encodeURIComponent(query)}.json`,
  );
  url.searchParams.set('key', key);
  url.searchParams.set('limit', '10');
  const biasLat = finiteNumber(params.get('lat'));
  const biasLon = finiteNumber(params.get('lon'));
  if (biasLat !== null && biasLon !== null) {
    url.searchParams.set('lat', String(biasLat));
    url.searchParams.set('lon', String(biasLon));
  }
  return url;
}

/** Cache identity: everything the answer depends on, never the key. */
function cacheKeyFor(pathname, params) {
  const parts = [pathname];
  for (const name of ['q', 'address', 'lat', 'lon', 'radiusM']) {
    parts.push(`${name}=${String(params.get(name) ?? '')}`);
  }
  return parts.join('|');
}

function project(pathname, data, params) {
  if (pathname === '/api/google/reverse-geocode')
    return tomtomReverseToGoogle(data);
  if (pathname === '/api/google/geocode') return tomtomForwardToGoogle(data);
  return {
    places: projectPlaces(
      data,
      finiteNumber(params.get('lat')),
      finiteNumber(params.get('lon')),
    ),
    error: null,
    provider: 'tomtom',
  };
}

function send(res, status, payload, { cacheable = true } = {}) {
  if (res.writableEnded || res.headersSent) return;
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': cacheable ? 'private, max-age=300' : 'no-store',
  });
  res.end(JSON.stringify(payload));
}

/**
 * True when this adapter is the right answer for the deployment: a TomTom key and
 * no Google server key. Checked per request so a later-added Google key takes
 * over on the next deploy without touching code.
 * @returns {string|null} The TomTom key when the adapter should serve, else null.
 */
function adapterActive() {
  const tomtom = String(process.env.TOMTOM_API_KEY || '').trim();
  if (!tomtom) return null;
  if (googleServerApiKey()) return null;
  return tomtom;
}

/**
 * Pre-dispatch hook. Answers the request and returns true, or returns false to
 * let upstream's Google proxy handle it (key present, route not adapted, or the
 * adapter declined for a validation reason upstream reports better).
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {string} pathname Full request pathname.
 * @returns {Promise<boolean>}
 */
export async function handlePlacesRequest(req, res, pathname) {
  if (req.method !== 'GET' || !ADAPTED.has(pathname)) return false;

  const key = adapterActive();
  if (!key) return false;

  // Same-site gate first, exactly like upstream, so a cross-site caller learns
  // nothing about this route's surface from the adapter either.
  if (admitSameSite(req, res)) return true;

  const url = new URL(String(req.url || ''), 'http://localhost');
  const params = url.searchParams;

  // Validation failures fall through to upstream: its 400 messages describe the
  // contract the client actually coded against, and re-wording them here would
  // only create a second source of truth.
  const target = tomtomUrlFor(pathname, params, key);
  if (!target) return false;

  const cacheKey = cacheKeyFor(pathname, params);
  const cached = cacheRead(cacheKey);
  if (cached) {
    send(res, 200, cached.payload, { cacheable: false });
    return true;
  }

  rollDaily();
  if (dailyCount >= DAILY_UPSTREAM_CAP) {
    send(
      res,
      429,
      { error: 'Place search budget exhausted', places: [] },
      {
        cacheable: false,
      },
    );
    return true;
  }

  if (!limiter(clientKey(req))) {
    if (!res.writableEnded && !res.headersSent) {
      res.writeHead(429, {
        'Content-Type': 'application/json',
        'Retry-After': '5',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify({ error: 'Rate limit exceeded', places: [] }));
    }
    return true;
  }

  let data;
  try {
    dailyCount += 1;
    const response = await fetch(target, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      // Upstream key/billing failures surface as an empty, honest answer rather
      // than a 5xx the client would cache as a network fault.
      const body = await response.text().catch(() => '');
      console.warn(
        `[gev-bridge] TomTom places ${pathname} upstream ${response.status}`,
        body.slice(0, 120).replace(/[A-Za-z0-9_-]{20,}/g, '[redacted]'),
      );
      send(
        res,
        200,
        pathname.endsWith('geocode')
          ? { status: 'ZERO_RESULTS', results: [], provider: 'tomtom' }
          : {
              places: [],
              error: 'Place search unavailable',
              provider: 'tomtom',
            },
        { cacheable: false },
      );
      cacheWrite(cacheKey, null, true);
      return true;
    }
    data = await response.json();
  } catch (err) {
    console.warn(
      '[gev-bridge] TomTom places request failed:',
      err?.message || err,
    );
    send(
      res,
      200,
      pathname.endsWith('geocode')
        ? { status: 'ZERO_RESULTS', results: [], provider: 'tomtom' }
        : { places: [], error: 'Place search unavailable', provider: 'tomtom' },
      { cacheable: false },
    );
    return true;
  }

  const payload = project(pathname, data, params);
  const negative = pathname.endsWith('geocode')
    ? !payload.results?.length
    : !payload.places?.length;
  cacheWrite(cacheKey, payload, negative);
  send(res, 200, payload, { cacheable: false });
  return true;
}

export { ADAPTED as PLACES_ADAPTER_ROUTES };

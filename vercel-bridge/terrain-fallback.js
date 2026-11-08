/**
 * Terrain-height fallback: Open-Meteo + bundled EGM96 when Re:Earth refuses.
 *
 * Why this exists
 * ---------------
 * `/api/terrain/heights` resolves ground height for every aircraft, vessel and
 * trail waypoint so entities sit on the mesh instead of under it. Upstream
 * answers it from `https://terrain.reearth.land/heights.json` — a free,
 * keyless community service. On Vercel that service answers **HTTP 429** on
 * essentially every poll (the platform's shared egress IP range is rate-limited
 * as a whole), so the provider enters its 60 s cooldown, finds an empty
 * per-instance `/tmp` cache, and returns
 * `502 terrain heights fetch failed and no cache available for every point`.
 * One browsing session produced 57 such 502s.
 *
 * The client degrades to its bundled geoid when the server has nothing, so this
 * is not a crash — but it does mean trail waypoints and low aircraft are placed
 * against an approximate surface instead of the real one.
 *
 * What this does
 * --------------
 * Upstream still runs first and still owns its disk cache, single-flight
 * coalescing and cooldown logic. The bridge runs the chain against a
 * body-capturing response; a 2xx is replayed verbatim. Only when upstream
 * cannot answer does this module resolve the same points from Open-Meteo's
 * elevation API (Copernicus GLO-90, keyless) and compute the geoid undulation
 * with the very same `egm96-universal` grid the client uses, producing the
 * identical `{lon, lat, elevation, geoid, ellipsoid}` result shape.
 *
 * Honest caveat: Open-Meteo returns integer metres from a ~90 m DEM, so
 * fallback heights differ from Re:Earth's EGM08 tileset by a few metres. That
 * is far better than no height at all, and every response carries
 * `provider: 'open-meteo+egm96'` so the substitution is visible.
 *
 * Boundaries: no upstream file is modified, the fallback never fires on a
 * successful upstream answer, and it fails closed (returns null → the original
 * upstream error is sent) rather than inventing heights.
 */

import { TERRAIN_POINT_PRECISION } from '../src/data/terrainHeightsProxy.js';

const OPEN_METEO_ELEVATION = 'https://api.open-meteo.com/v1/elevation';

/**
 * Upstream's per-request cap (`server/providers/terrain.js`: `MAX_POINTS =
 * UPSTREAM_CHUNK`). A batch over it is answered `413 too many points`, so the
 * bridge splits it and serves the merged results itself.
 */
export const TERRAIN_UPSTREAM_MAX_POINTS = 64;

/**
 * Ceiling for the substitute itself. Higher than upstream's on purpose — the
 * point of splitting oversized batches is that Open-Meteo takes a long
 * coordinate list — but finite, so a runaway caller cannot pin a function.
 */
const MAX_FALLBACK_POINTS = 1024;
/** Open-Meteo accepts a long coordinate list; chunk anyway to bound latency. */
const OPEN_METEO_CHUNK = 64;
const REQUEST_TIMEOUT_MS = Number(process.env.GEV_TERRAIN_FALLBACK_MS || 8_000);
const CACHE_MAX_ENTRIES = 4_000;

const heightCache = new Map();

let egm96 = null;
let egm96Promise = null;
let egm96Failed = false;

/** Lazily load the EGM96 grid once; never throws. */
async function ensureEgm96() {
  if (egm96) return egm96;
  if (egm96Failed) return null;
  if (!egm96Promise) {
    egm96Promise = import('egm96-universal')
      .then((mod) => {
        egm96 = mod;
        return mod;
      })
      .catch((err) => {
        egm96Failed = true;
        console.warn(
          '[gev-bridge] terrain fallback: EGM96 grid unavailable:',
          err?.message || err,
        );
        return null;
      });
  }
  return egm96Promise;
}

/** Cache key: 5-decimal grid, ~1 m — terrain does not move. */
function cacheKey(lon, lat) {
  return `${lon.toFixed(5)},${lat.toFixed(5)}`;
}

/**
 * Parse upstream's `points=lon,lat;lon,lat;…` exactly as `parseTerrainPoints`
 * does, returning null for anything malformed so upstream's own 400 stands.
 * @returns {null | Array<{lon:number, lat:number}>}
 */
function parsePoints(rawPoints) {
  const raw = String(rawPoints ?? '').trim();
  if (!raw) return null;
  const points = [];
  for (const pair of raw.split(';')) {
    const token = pair.trim();
    if (!token) continue;
    const [lonText, latText] = token.split(',');
    const lon = Number(lonText);
    const lat = Number(latText);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
    points.push({ lon, lat });
  }
  return points.length ? points : null;
}

/**
 * How many points a `points=` value carries, or null when it is malformed.
 * @param {string|null|undefined} rawPoints
 * @returns {null | number}
 */
export function countTerrainPoints(rawPoints) {
  const points = parsePoints(rawPoints);
  return points ? points.length : null;
}

/**
 * Split a batch that is too large for upstream into pieces of at most `size`
 * points, re-serialised exactly the way the client serialises them (`lon,lat`
 * at 5 decimals, `;`-joined).
 *
 * Returns null for anything upstream can answer in one call (or for a malformed
 * value), so the caller leaves upstream's own 400/413 untouched and only the
 * genuinely oversized batches take the split path.
 * @param {string|null|undefined} rawPoints
 * @param {number} [size]
 * @returns {null | string[]} the chunk values, in request order
 */
export function splitTerrainPoints(
  rawPoints,
  size = TERRAIN_UPSTREAM_MAX_POINTS,
) {
  const points = parsePoints(rawPoints);
  if (!points || points.length <= size) return null;
  const chunks = [];
  for (let i = 0; i < points.length; i += size) {
    chunks.push(
      points
        .slice(i, i + size)
        .map(
          ({ lon, lat }) =>
            `${lon.toFixed(TERRAIN_POINT_PRECISION)},${lat.toFixed(TERRAIN_POINT_PRECISION)}`,
        )
        .join(';'),
    );
  }
  return chunks;
}

/** Fetch orthometric heights for one chunk. Returns null on any failure. */
async function fetchOpenMeteoElevations(chunk, signal) {
  const url = new URL(OPEN_METEO_ELEVATION);
  url.searchParams.set(
    'latitude',
    chunk.map((p) => p.lat.toFixed(5)).join(','),
  );
  url.searchParams.set(
    'longitude',
    chunk.map((p) => p.lon.toFixed(5)).join(','),
  );
  const response = await fetch(url, {
    signal,
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    console.warn(
      `[gev-bridge] terrain fallback: Open-Meteo answered ${response.status}`,
    );
    return null;
  }
  const data = await response.json().catch(() => null);
  const elevations = Array.isArray(data?.elevation) ? data.elevation : null;
  if (!elevations || elevations.length !== chunk.length) return null;
  return elevations.map((value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  });
}

/**
 * Resolve terrain heights for a request upstream could not answer.
 * @param {string} rawPoints The `points` query value.
 * @returns {Promise<null | {status:number, body:object}>} Null when the
 *   fallback cannot answer either — the caller then sends upstream's error.
 */
export async function resolveTerrainFallback(rawPoints) {
  const points = parsePoints(rawPoints);
  if (!points || points.length > MAX_FALLBACK_POINTS) return null;

  const grid = await ensureEgm96();

  const results = new Array(points.length).fill(null);
  /**
   * One fetch per distinct coordinate: a multi-hundred-point batch is usually a
   * trail or a grid that revisits the same ~111 m cells, and the request order
   * is restored from `positions` afterwards.
   */
  const pending = new Map();
  points.forEach((point, index) => {
    const key = cacheKey(point.lon, point.lat);
    const cached = heightCache.get(key);
    if (cached) results[index] = cached;
    else if (!pending.has(key)) pending.set(key, { point, positions: [] });
    if (!cached) pending.get(key)?.positions.push(index);
  });

  const missing = [...pending.values()];

  if (missing.length) {
    const controller = new AbortController();
    // The per-request budget scales with the number of upstream calls a batch
    // needs, so a split 1000-point request is not aborted three quarters
    // through — a partial answer fails closed and would be worth nothing.
    const chunksNeeded = Math.ceil(missing.length / OPEN_METEO_CHUNK);
    const budgetMs = Math.min(
      45_000,
      REQUEST_TIMEOUT_MS * Math.max(1, chunksNeeded),
    );
    const timer = setTimeout(() => controller.abort(), budgetMs);
    try {
      for (let start = 0; start < missing.length; start += OPEN_METEO_CHUNK) {
        const slice = missing.slice(start, start + OPEN_METEO_CHUNK);
        const chunk = slice.map((entry) => entry.point);
        const elevations = await fetchOpenMeteoElevations(
          chunk,
          controller.signal,
        );
        if (!elevations) continue;
        slice.forEach((waiting, position) => {
          const elevation = elevations[position];
          if (elevation === null) return;
          const { lon, lat } = waiting.point;
          const geoid = grid ? Number(grid.meanSeaLevel(lat, lon)) : null;
          const entry = {
            lon,
            lat,
            elevation,
            geoid: Number.isFinite(geoid) ? geoid : null,
            // Upstream's servable field: `ellipsoid` must be finite for the
            // entry to be cacheable/servable there, and h = H + N.
            ellipsoid: Number.isFinite(geoid) ? elevation + geoid : null,
          };
          // One answer, every position that asked for this coordinate.
          for (const index of waiting.positions) results[index] = entry;
          const key = cacheKey(lon, lat);
          heightCache.set(key, entry);
          while (heightCache.size > CACHE_MAX_ENTRIES) {
            const oldest = heightCache.keys().next().value;
            if (oldest === undefined) break;
            heightCache.delete(oldest);
          }
        });
      }
    } catch (err) {
      console.warn(
        '[gev-bridge] terrain fallback failed:',
        err?.message || err,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  // Fail closed: a partial answer would place some entities on the mesh and
  // others against the geoid approximation, which is worse than upstream's
  // honest 502 that tells the client to use its own bundled geoid throughout.
  const unresolved = results.filter(
    (entry) => !entry || !Number.isFinite(entry.ellipsoid),
  ).length;
  if (unresolved) {
    console.warn(
      `[gev-bridge] terrain fallback incomplete: ${unresolved}/${points.length} point(s) unresolved (Open-Meteo or EGM96 unavailable)`,
    );
    return null;
  }

  return {
    status: 200,
    body: { results, provider: 'open-meteo+egm96', fallback: true },
  };
}

/**
 * A response stand-in that keeps status, headers and body so the dispatcher can
 * replay a successful upstream answer or substitute the fallback.
 * Only used for the small `/api/terrain/heights` JSON body.
 */
export function createBodyCapturingResponse() {
  const headers = new Map();
  const chunks = [];
  /** @type {any} */
  const res = {
    statusCode: 200,
    statusMessage: '',
    headersSent: false,
    writableEnded: false,
    finished: false,
    setHeader(name, value) {
      headers.set(String(name).toLowerCase(), value);
      return res;
    },
    getHeader(name) {
      return headers.get(String(name).toLowerCase());
    },
    getHeaders() {
      return Object.fromEntries(headers);
    },
    removeHeader(name) {
      headers.delete(String(name).toLowerCase());
    },
    writeHead(status, reasonOrHeaders, maybeHeaders) {
      res.statusCode = status;
      const candidate =
        typeof reasonOrHeaders === 'string' ? maybeHeaders : reasonOrHeaders;
      if (candidate) {
        for (const [key, value] of Object.entries(candidate)) {
          headers.set(String(key).toLowerCase(), value);
        }
      }
      res.headersSent = true;
      return res;
    },
    write(chunk) {
      if (chunk != null) chunks.push(Buffer.from(chunk));
      return true;
    },
    end(chunk) {
      if (chunk != null && typeof chunk !== 'function') {
        chunks.push(Buffer.from(chunk));
      }
      res.writableEnded = true;
      res.finished = true;
      return res;
    },
    on() {
      return res;
    },
    once() {
      return res;
    },
    emit() {
      return false;
    },
    flushHeaders() {},
    /** The captured answer, for the dispatcher to inspect and replay. */
    captured() {
      return {
        status: res.statusCode,
        headers: Object.fromEntries(headers),
        body: Buffer.concat(chunks),
      };
    },
  };
  return res;
}

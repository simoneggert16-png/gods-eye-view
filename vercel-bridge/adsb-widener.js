/**
 * Wider-area ADS-B snapshot for `GET /api/flights`.
 *
 * Why this exists
 * ---------------
 * `terrain`-style problem, ADS-B edition: OpenSky Network refuses Vercel's
 * shared egress ranges (timeout from fra1, immediate reset from iad1, with and
 * without client credentials), so upstream's own regional substitute answers
 * every flight poll — `server/providers/aircraft/opensky.js` asks
 * `https://api.adsb.lol/v2/lat/…/dist/250`, a **250 nm** bubble. Field
 * measurement 2026-11-03 over Berlin: 250 nm ≈ 490 aircraft, 500 nm ≈ 1520,
 * 750 nm ≈ 2300, 1000 nm ≈ 3030, 1500 nm ≈ 3380 — and `GET /v2/mil` shows the
 * whole adsb.lol network tracking only ~250 military contacts worldwide at
 * that moment. So the visible count was bounded by a constant in upstream code
 * that we must not edit, not by the data available.
 *
 * What this module does
 * ---------------------
 * Asks adsb.lol for the same anchor with a configurable radius (default
 * `GEV_ADSB_RADIUS_NM=750`) and returns the OpenSky-shaped snapshot. The
 * dispatcher runs upstream first — upstream still owns auth-mode headers, the
 * cache and the OpenSky path when it works — and merges: upstream vectors win
 * per ICAO24, this feed only adds aircraft upstream did not report. Anything
 * unexpected (bad anchor, upstream error, non-2xx, timeout, oversized
 * payload) returns null and the upstream answer is replayed verbatim.
 *
 * Notes
 *  - The record→OpenSky translation is imported from
 *    `src/data/adsbLolFallback.js` — the same normalizer upstream uses, so the
 *    client contract is not reimplemented here.
 *  - adsb.lol's point query already includes military transponders; the separate
 *    `/v2/mil` feed is NOT merged into this endpoint (see the comment on the
 *    flights hook in `dispatcher.js` — worldwide military hexes make the
 *    civilian client layer suppress its own regional fleet).
 *  - Cached per rounded anchor for `GEV_ADSB_WIDEN_TTL_MS` (default 9 s) with
 *    in-flight coalescing, because the client polls the same anchor every few
 *    seconds and the provider rate-limits per IP. During a failure cooldown — or
 *    right after a failed refresh — the previous frame is served for up to
 *    `GEV_ADSB_WIDEN_STALE_MS` (default 120 s) instead of nothing: a slightly
 *    old wide snapshot beats a 250 nm bubble around the same anchor.
 */

import { normalizeAdsbLolPointResponse } from '../src/data/adsbLolFallback.js';

const PROVIDER = 'https://api.adsb.lol/v2/lat';
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const CACHE_MAX = 64;

function intFromEnv(key, fallback) {
  const raw = Number(process.env[key]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

export function widenRadiusNm() {
  return Math.min(1500, intFromEnv('GEV_ADSB_RADIUS_NM', 750));
}

/** Anchor exactly the way upstream does: quarter-degree rounding + cache key. */
export function anchorFromQuery(searchParams) {
  const latitude = Number(searchParams.get('lat'));
  const longitude = Number(searchParams.get('lon'));
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)
    return null;
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180)
    return null;
  const roundedLat = Math.round(latitude * 4) / 4;
  const roundedLon = Math.round(longitude * 4) / 4;
  return { roundedLat, roundedLon };
}

/** @type {Map<string, {body: object, count: number, at: number}>} */
const cache = new Map();
/**
 * Single-flight map, keyed by rounded anchor + radius.
 * @type {Map<string, Promise<any>>}
 */
const inflight = new Map();
/** @type {number} Epoch-ms before which the point provider is asked again. */
let cooldownUntil = 0;

async function fetchPoint(roundedLat, roundedLon, radiusNm, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(
      `${PROVIDER}/${roundedLat}/lon/${roundedLon}/dist/${radiusNm}`,
      {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'gods-eye-view-adsblol-widen/1.0',
        },
        signal: controller.signal,
      },
    );
    if (!response.ok) throw new Error(`upstream HTTP ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_RESPONSE_BYTES)
      throw new Error(`payload too large (${buffer.length}B)`);
    const normalized = normalizeAdsbLolPointResponse(
      JSON.parse(buffer.toString('utf8')),
    );
    if (!Array.isArray(normalized?.states)) throw new Error('no states array');
    return {
      body: normalized,
      count: normalized.states.length,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch (or reuse) the wide snapshot for one anchor.
 * @returns {Promise<{body: object, count: number, cache: string}|null>}
 */
export async function wideFlightsSnapshot(searchParams) {
  if (process.env.GEV_ADSB_WIDEN === 'off') return null;
  const anchor = anchorFromQuery(searchParams);
  if (!anchor) return null;

  const radiusNm = widenRadiusNm();
  const timeoutMs = intFromEnv('GEV_ADSB_WIDEN_TIMEOUT_MS', 8000);
  const ttlMs = intFromEnv('GEV_ADSB_WIDEN_TTL_MS', 9000);
  const staleMs = intFromEnv('GEV_ADSB_WIDEN_STALE_MS', 120_000);
  const key = `${anchor.roundedLat.toFixed(2)},${anchor.roundedLon.toFixed(
    2,
  )},${radiusNm}`;

  /** Recent-enough previous frame for this anchor, if one is held. */
  const staleFrame = () => {
    const held = cache.get(key);
    return held && Date.now() - held.at < staleMs
      ? { body: held.body, count: held.count, cache: 'STALE' }
      : null;
  };

  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs)
    return { body: hit.body, count: hit.count, cache: 'HIT' };

  // After a failure (rate limit, timeout, dead provider) stop asking for a
  // while. The client polls the same anchor every few seconds, and hammering a
  // 429 is how a free public API gets its egress range blocked for everyone.
  // The cooldown still serves the last frame — nothing is worse than the bubble.
  if (Date.now() < cooldownUntil) return staleFrame();

  const pending = inflight.get(key);
  if (pending) {
    const shared = await pending.catch(() => null);
    return shared ? { ...shared, cache: 'INFLIGHT' } : null;
  }

  const job = fetchPoint(
    anchor.roundedLat,
    anchor.roundedLon,
    radiusNm,
    timeoutMs,
  )
    .then((result) => {
      cache.set(key, {
        body: result.body,
        count: result.count,
        at: Date.now(),
      });
      while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
      return result;
    })
    .finally(() => inflight.delete(key));

  inflight.set(key, job);
  try {
    const result = await job;
    return { ...result, cache: 'MISS' };
  } catch (error) {
    cooldownUntil =
      Date.now() + intFromEnv('GEV_ADSB_WIDEN_COOLDOWN_MS', 30_000);
    console.warn(
      `[gev-bridge] ADS-B widen failed (${error?.message || error}); ` +
        'holding off before the next point query.',
    );
    return staleFrame();
  }
}

/**
 * Worldwide ADS-B frame for a zoomed-out camera.
 *
 * Measured 2026-11-03: `dist=10000` around any anchor returns the same
 * ~9 800-9 900 aircraft — the API caps the point query at its whole tracked
 * fleet instead of a 10 000 nm circle — while four far-apart anchors union to
 * 9 914. One request is therefore enough for a worldwide frame; anchors add
 * nothing. The document is ~5.4 MB, so it is cached for
 * `GEV_ADSB_GLOBAL_TTL_MS` (default 60 s), served stale for five minutes after
 * a failure, and only requested when the client reports a high camera
 * (`?alt=`), never for a regional poll.
 * @returns {Promise<{body: object, count: number, cache: string}|null>}
 */
export async function globalFlightsSnapshot() {
  if (process.env.GEV_ADSB_GLOBAL === 'off') return null;
  const ttlMs = intFromEnv('GEV_ADSB_GLOBAL_TTL_MS', 60_000);
  const timeoutMs = intFromEnv('GEV_ADSB_GLOBAL_TIMEOUT_MS', 12_000);

  if (GLOBAL_CACHE.body && Date.now() - GLOBAL_CACHE.at < ttlMs)
    return {
      body: GLOBAL_CACHE.body,
      count: GLOBAL_CACHE.count,
      cache: 'HIT',
    };

  const pending = inflight.get('global');
  if (pending) {
    const shared = await pending.catch(() => null);
    return shared ? { ...shared, cache: 'INFLIGHT' } : null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const job = (async () => {
    try {
      const response = await fetch(`${PROVIDER}/0/lon/0/dist/10000`, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'gods-eye-view-adsblol-global/1.0',
        },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`upstream HTTP ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > 16 * 1024 * 1024)
        throw new Error(`payload too large (${buffer.length}B)`);
      const normalized = normalizeAdsbLolPointResponse(
        JSON.parse(buffer.toString('utf8')),
      );
      if (!Array.isArray(normalized?.states) || !normalized.states.length)
        throw new Error('no states array');
      GLOBAL_CACHE.body = normalized;
      GLOBAL_CACHE.count = normalized.states.length;
      GLOBAL_CACHE.at = Date.now();
      return {
        body: normalized,
        count: normalized.states.length,
        cache: 'MISS',
      };
    } finally {
      clearTimeout(timer);
    }
  })().finally(() => inflight.delete('global'));
  inflight.set('global', job);

  try {
    return await job;
  } catch (error) {
    console.warn(
      `[gev-bridge] ADS-B global frame failed (${error?.message || error}); ` +
        'serving the previous frame when it is still recent.',
    );
    if (GLOBAL_CACHE.body && Date.now() - GLOBAL_CACHE.at < ttlMs * 5)
      return {
        body: GLOBAL_CACHE.body,
        count: GLOBAL_CACHE.count,
        cache: 'STALE',
      };
    return null;
  }
}

/** @type {{body: object|null, count: number, at: number}} */
const GLOBAL_CACHE = { body: null, count: 0, at: 0 };

/**
 * Merge two OpenSky-shaped payloads. Vectors already present in `base` are
 * kept untouched; only aircraft `base` never reported are appended.
 * @returns {{body: object, added: number}}
 */
export function mergeOpenSkyPayloads(base, extra) {
  const states = Array.isArray(base?.states) ? [...base.states] : [];
  const seen = new Set(states.map((row) => String(row?.[0] || '')));
  let added = 0;
  for (const row of Array.isArray(extra?.states) ? extra.states : []) {
    const id = String(row?.[0] || '');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    states.push(row);
    added += 1;
  }
  const emergencyByIcao = {
    ...(base?.emergencyByIcao || {}),
    ...(extra?.emergencyByIcao || {}),
  };
  return {
    body: {
      ...extra,
      ...base,
      time: base?.time ?? extra?.time ?? Math.floor(Date.now() / 1000),
      states,
      ...(Object.keys(emergencyByIcao).length ? { emergencyByIcao } : {}),
    },
    added,
  };
}

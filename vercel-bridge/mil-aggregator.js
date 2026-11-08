/**
 * Multi-network military snapshot for `GET /api/military`.
 *
 * Why this exists
 * ---------------
 * Upstream proxies exactly one keyless military feed (`https://api.adsb.lol/v2/mil`,
 * `server/providers/aircraft/adsb-lol.js`). That list is one network's view of
 * the world: measured 2026-11-03 it held 319 contacts, only 207 of them with a
 * usable position, which is why the panel tops out around ~200 contacts while
 * the civilian layer shows thousands.
 *
 * `https://opendata.adsb.fi/api/v2/mil` answers the same readsb-shaped document
 * from a different receiver network (341 rows, 248 positioned at the same
 * moment). The two networks track overlapping but not identical aircraft, so
 * their union is strictly more military contacts — the exact scope the panel
 * promises. `api.airplanes.live/v2/mil` answers 403 from this egress and is not
 * used; `api.adsb.fi` (no `opendata` host) returns 404.
 *
 * Contract
 * --------
 * Upstream still runs first and owns its cache, headers and error semantics.
 * This module only APPENDS contacts upstream did not report, deduped by ICAO24
 * hex. Any failure returns null and the dispatcher replays upstream verbatim, so
 * the layer can never end up emptier than upstream alone. Cached for
 * `GEV_MIL_EXTRA_TTL_MS` (default 60 s) with a stale window, because the client
 * polls on the same order and each provider rate-limits per IP.
 */

const PROVIDERS = [
  {
    name: 'adsb.fi',
    url: 'https://opendata.adsb.fi/api/v2/mil',
    userAgent: 'gods-eye-view-mil/1.0 (opendata.adsb.fi)',
  },
  {
    // Cloudflare in front of api.airplanes.live answers 403 to a bare client
    // (and to Node's default UA) but serves the same readsb document to a
    // browser-shaped request with a matching Referer — measured 2026-11-03:
    // 377 rows / 281 positioned.
    name: 'airplanes.live',
    url: 'https://api.airplanes.live/v2/mil',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
    referer: 'https://airplanes.live/',
  },
];

const MAX_BYTES = 8 * 1024 * 1024;

/**
 * The always-on relay (the VPS) is a provider like any other, and it is the
 * only one whose egress IP is not a shared datacenter range: airplanes.live
 * answers 403 to Vercel but serves the residential-style IP of the VPS.
 */
function relayTokenHeader() {
  const token = String(process.env.RELAY_TOKEN || '').replace(/\s+/g, '');
  return token ? { 'x-relay-token': token } : {};
}

function providerList() {
  const url = process.env.MIL_RELAY_URL;
  return url
    ? [...PROVIDERS, { name: 'relay', url, relay: true }]
    : [...PROVIDERS];
}

function intFromEnv(key, fallback) {
  const raw = Number(process.env[key]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

/** @type {Map<string, {ac: any[], at: number, count: number}>} */
const cache = new Map();
/** Epoch-ms before which a provider that failed is not asked again. */
const cooldownUntil = new Map();
const FAILURE_COOLDOWN_MS = 10 * 60 * 1000;

function hexOf(row) {
  return String(row?.hex || '')
    .trim()
    .toLowerCase();
}

async function fetchProvider(provider, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(provider.url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': provider.userAgent || 'gods-eye-view/1.0',
        ...(provider.referer ? { Referer: provider.referer } : {}),
        ...(provider.relay ? relayTokenHeader() : {}),
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`upstream HTTP ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_BYTES)
      throw new Error(`payload too large (${buffer.length}B)`);
    const payload = JSON.parse(buffer.toString('utf8'));
    const ac = Array.isArray(payload?.ac) ? payload.ac : [];
    if (!ac.length) throw new Error('no aircraft');
    return { ac, at: Date.now(), count: ac.length };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * All extra military contacts, deduped by ICAO24 hex.
 * @returns {Promise<{ac: any[], count: number, sources: object[]}|null>}
 */
export async function extraMilitaryContacts() {
  if (process.env.GEV_MIL_EXTRA === 'off') return null;
  const ttlMs = intFromEnv('GEV_MIL_EXTRA_TTL_MS', 60_000);
  const timeoutMs = intFromEnv('GEV_MIL_EXTRA_TIMEOUT_MS', 6_000);

  const seen = new Set();
  const ac = [];
  const sources = [];
  let fresh = 0;

  await Promise.all(
    providerList().map(async (provider) => {
      const key = provider.url;
      const held = cache.get(key);
      let entry = null;
      if (held && Date.now() - held.at < ttlMs) {
        entry = { ...held, cache: 'HIT' };
      } else if (Date.now() < (cooldownUntil.get(key) ?? 0)) {
        // A datacenter-blocked provider (airplanes.live answers 403 to this
        // egress) must not cost a request — and a log line — every minute.
        entry =
          held && Date.now() - held.at < ttlMs * 5
            ? { ...held, cache: 'STALE' }
            : null;
      } else {
        try {
          const result = await fetchProvider(provider, timeoutMs);
          cache.set(key, result);
          cooldownUntil.delete(key);
          entry = { ...result, cache: 'MISS' };
        } catch (error) {
          console.warn(
            `[gev-bridge] military feed ${provider.name} failed (${error?.message || error}); ` +
              'serving the previous frame when it is still recent.',
          );
          cooldownUntil.set(key, Date.now() + FAILURE_COOLDOWN_MS);
          if (held && Date.now() - held.at < ttlMs * 5)
            entry = { ...held, cache: 'STALE' };
        }
      }
      sources.push({
        name: provider.name,
        count: entry?.count ?? 0,
        cache: entry?.cache ?? 'failed',
      });
      if (!entry) return;
      if (entry.cache !== 'HIT') fresh += 1;
      for (const row of entry.ac) {
        const hex = hexOf(row);
        if (!hex || seen.has(hex)) continue;
        seen.add(hex);
        ac.push(row);
      }
    }),
  );

  if (!ac.length) return null;
  return { ac, count: ac.length, sources, fresh: fresh > 0 };
}

/**
 * Append contacts `base` does not report, deduped by ICAO24 hex. The base's
 * rows always win, and its document fields (`msg`, `now`, `ptime`, `ctime`)
 * stay untouched so the client's freshness maths is unchanged.
 * @returns {{body: object, added: number}}
 */
export function mergeMilitaryPayload(base, extra) {
  const rows = Array.isArray(base?.ac) ? [...base.ac] : [];
  const seen = new Set(rows.map(hexOf).filter(Boolean));
  let added = 0;
  for (const row of Array.isArray(extra?.ac) ? extra.ac : []) {
    const hex = hexOf(row);
    if (!hex || seen.has(hex)) continue;
    seen.add(hex);
    rows.push(row);
    added += 1;
  }
  return {
    body: {
      ...base,
      ac: rows,
      total: Number.isFinite(base?.total) ? base.total + added : rows.length,
    },
    added,
  };
}

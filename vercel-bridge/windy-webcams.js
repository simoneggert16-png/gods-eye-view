/**
 * Windy Webcams as an extra CCTV pack.
 *
 * Upstream's camera packs are keyless open-data feeds. Windy publishes a
 * worldwide webcam directory behind a free API key (`x-windy-api-key`), which
 * is what fills the Swiss gap (1 462 Swiss webcams measured 2026-11-03) and can
 * be pointed at any country with `GEV_WINDY_COUNTRIES`.
 *
 * The dispatcher appends these items to `/api/cctv/sources` and answers
 * `/api/cctv/stream|frame/windy-<id>` itself, because upstream's catalog cannot
 * resolve ids it never loaded. Cameras are stills (`feedType: 'image'`), so the
 * frame route proxies the preview JPEG and `media` stays empty.
 *
 * Dormant without `WINDY_WEBCAMS_KEY`. Attribution "Windy.com" rides on every
 * item's provider/credit/license fields, as the API terms require.
 */

const API = 'https://api.windy.com/webcams/api/v3/webcams';
const CACHE_MS = 10 * 60 * 1000;
const PAGE = 50;

/** @type {{at: number, items: object[], byId: Map<string, object>}} */
const cache = { at: 0, items: [], byId: new Map() };

function toSourceItem(cam) {
  const lat = Number(cam?.location?.latitude);
  const lon = Number(cam?.location?.longitude);
  const id = String(cam?.webcamId || '').trim();
  if (!id || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const preview = String(cam?.images?.current?.preview || '');
  if (!preview) return null;
  return {
    id: `windy-${id}`,
    pack: 'Windy Webcams',
    name: String(cam?.title || id)
      .trim()
      .slice(0, 120),
    city: String(cam?.location?.city || '').trim(),
    cityId: String(cam?.location?.country_code || ''),
    country: String(cam?.location?.country_code || '').toUpperCase(),
    provider: 'Windy Webcams',
    lat,
    lon,
    feedType: 'image',
    sourceKind: 'configured',
    license: 'Windy.com',
    credit: 'Windy.com',
    code: '',
    snapshotUrl: preview,
    detailUrl: String(cam?.urls?.detail || ''),
    // When the provider last republished this picture: the panel's "age of the
    // shot" line. 0 when the API left it out.
    updatedAt: Date.parse(cam?.lastUpdatedOn) || 0,
  };
}

async function fetchPage(key, countries, offset) {
  const params = new URLSearchParams({
    limit: String(PAGE),
    offset: String(offset),
    include: 'location,images,urls',
    lang: 'en',
  });
  if (countries) params.set('countries', countries);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${API}?${params}`, {
      headers: { Accept: 'application/json', 'x-windy-api-key': key },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/** How many cameras the map can carry: the crawl holds far more. */
function camLimit() {
  return Math.min(
    20000,
    Math.max(200, Number(process.env.GEV_CAM_LIMIT) || 6000),
  );
}

/**
 * The catalog form of a camera: everything the map draws and labels, minus the
 * picture and detail URLs. Those stay in the bridge — it resolves a frame from
 * the camera id — and dropping them keeps a several-thousand-camera catalog
 * small enough to load on a phone.
 */
export function toCatalogEntry(item) {
  const { snapshotUrl, detailUrl, refreshedAt, ...rest } = item;
  return rest;
}

/** Countries the operator watches; they are served in full before the world. */
function priorityCountries() {
  return process.env.GEV_CAM_PRIORITY || 'CH,LI,DE,AT,IT,FR,ES,GB,US,JP,AU';
}

/**
 * The relay answers 401 without its token. Vercel secret values can carry the
 * newline an `echo` added, and a header value containing whitespace throws
 * before the request is sent — so the token is squeezed to its printable
 * content on the way out (the relay does the same on the way in).
 */
function relayAuthHeader() {
  const token = String(process.env.RELAY_TOKEN || '').replace(/\s+/g, '');
  return token ? { 'x-relay-token': token } : {};
}

async function fetchRelayList(relayUrl) {
  const target = new URL(relayUrl);
  // The relay holds the whole crawl and deals the subset: home countries in
  // full, then one camera per country at a time so every continent stays on the
  // map instead of being crowded out by the busiest networks.
  target.searchParams.set('limit', String(camLimit()));
  target.searchParams.set('home', process.env.GEV_CAM_HOME || 'CH,LI');
  target.searchParams.set('priority', priorityCountries());
  target.searchParams.set('weight', process.env.GEV_CAM_WEIGHT || '6');
  const response = await fetch(target, {
    headers: { Accept: 'application/json', ...relayAuthHeader() },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) return [];
  const body = await response.json();
  return (Array.isArray(body?.items) ? body.items : [])
    .map((item) => ({
      id: String(item.id || ''),
      pack: 'Windy Webcams',
      name: String(item.name || ''),
      city: String(item.city || ''),
      cityId: String(item.country || ''),
      country: String(item.country || '').toUpperCase(),
      provider: 'Windy Webcams',
      lat: Number(item.lat),
      lon: Number(item.lon),
      feedType: 'image',
      sourceKind: 'configured',
      license: 'Windy.com',
      credit: 'Windy.com',
      code: '',
      snapshotUrl: String(item.snapshotUrl || ''),
      detailUrl: String(item.detailUrl || ''),
      updatedAt: Number(item.updatedAt) || 0,
    }))
    .filter(
      (item) =>
        item.id &&
        Number.isFinite(item.lat) &&
        Number.isFinite(item.lon) &&
        item.snapshotUrl,
    );
}

/** Fetch (or reuse) the mapped webcam list. */
export async function windyWebcams() {
  if (cache.items.length && Date.now() - cache.at < CACHE_MS)
    return cache.items;
  // The VPS sampler collects Windy pages over time; prefer its list so the map
  // sees every camera gathered so far instead of one 300-camera page.
  const relayUrl = process.env.CAMERAS_RELAY_URL;
  if (relayUrl) {
    try {
      const items = await fetchRelayList(relayUrl);
      if (items.length) {
        cache.items = items;
        cache.byId = new Map(items.map((item) => [item.id, item]));
        cache.at = Date.now();
        return items;
      }
    } catch {
      /* fall through to the direct API */
    }
  }
  const key = process.env.WINDY_WEBCAMS_KEY;
  if (!key) return [];
  const countries = process.env.GEV_WINDY_COUNTRIES ?? 'CH';
  const pages = Number(process.env.GEV_WINDY_PAGES) || 6;
  const items = [];
  const seen = new Set();
  try {
    for (let page = 0; page < pages; page += 1) {
      const payload = await fetchPage(key, countries, page * PAGE);
      const webcams = Array.isArray(payload?.webcams) ? payload.webcams : [];
      if (!webcams.length) break;
      for (const cam of webcams) {
        const item = toSourceItem(cam);
        if (!item || seen.has(item.id)) continue;
        seen.add(item.id);
        items.push(item);
      }
      if (webcams.length < PAGE) break;
    }
  } catch (error) {
    console.warn(
      `[gev-bridge] Windy webcams failed (${error?.message || error})`,
    );
    if (!cache.items.length) return [];
  }
  const byId = new Map(items.map((item) => [item.id, item]));
  cache.at = Date.now();
  cache.items = items;
  cache.byId = byId;
  return items;
}

/** One cached webcam item by its catalog id (`windy-<webcamId>`). */
export function windyCamera(id) {
  return cache.byId.get(String(id || '')) || null;
}

/**
 * Re-read one camera from Windy: the current picture URL and the time the
 * provider last republished it. The preview URL is a stable `.../current/...`
 * path, so age only comes from this call, never from the URL.
 * Returns the cached item when the API is unavailable, so a refresh degrades to
 * "same picture, honest age" instead of an error.
 */
export async function windyCameraRefresh(id) {
  const key = String(id || '');
  const numeric = key.replace(/^windy-/, '');
  const cachedItem = cache.byId.get(key) || null;
  if (!/^\d+$/.test(numeric)) return cachedItem;
  const apiKey = process.env.WINDY_WEBCAMS_KEY;
  if (!apiKey) return cachedItem;
  try {
    const response = await fetch(
      `${API}/${numeric}?include=location,images,urls&lang=en`,
      {
        headers: { Accept: 'application/json', 'x-windy-api-key': apiKey },
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!response.ok) return cachedItem;
    const cam = await response.json();
    const item = toSourceItem({ webcamId: numeric, ...cam }) || cachedItem;
    if (!item) return null;
    item.id = key;
    const next = { ...cachedItem, ...item, refreshedAt: Date.now() };
    cache.byId.set(key, next);
    const position = cache.items.findIndex((entry) => entry.id === key);
    if (position >= 0) cache.items[position] = next;
    return next;
  } catch {
    return cachedItem;
  }
}

/** Fetch a camera's preview JPEG (bounded). */
export async function windyCameraFrame(item, { bust = false } = {}) {
  if (!item?.snapshotUrl) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    // Windy's imgproxy serves `.../current/...original.jpg?v=2` and rewrites it
    // in place, so a requested refresh must ask for a distinct URL.
    const target = bust
      ? `${item.snapshotUrl}${item.snapshotUrl.includes('?') ? '&' : '?'}gev=${Math.floor(Date.now() / 1000)}`
      : item.snapshotUrl;
    const response = await fetch(target, {
      headers: {
        Accept: 'image/jpeg,image/*',
        'User-Agent': 'gods-eye-view/1.0',
      },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const type = response.headers.get('content-type') || 'image/jpeg';
    if (!type.startsWith('image/')) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 64 || bytes.length > 6 * 1024 * 1024) return null;
    return { type, bytes };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

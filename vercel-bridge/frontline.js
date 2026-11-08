/**
 * Front line and occupied areas, from the DeepState map.
 *
 * DeepState publishes one GeoJSON snapshot per day (`/api/history/last`,
 * ~600 KB): polygons of occupied territory, areas of unknown status and the
 * frozen conflict territories (Crimea, ORDLO, Transnistria, Abkhazia …). Their
 * outlines are the front line; there is no separate line layer to fetch.
 *
 * The source sets no CORS headers worth relying on and changes once a day, so
 * the bridge fetches and caches it. `datetime` in the payload is the snapshot
 * time and becomes the layer's freshness, not the fetch time.
 */

const URL = 'https://deepstatemap.live/api/history/last';
/**
 * Same provenance, different packaging: a daily GeoJSON feed built from
 * DeepStateMap with a clean contact line (LineString) and control polygons.
 * Used only when the primary API does not answer.
 */
const FALLBACK_URL =
  'https://raw.githubusercontent.com/longlinecode/russo-ukrainian-front-daily/main/data/latest.geojson';
const CACHE_MS = 3 * 60 * 60 * 1000;

/** @type {{at:number, body:object|null}} */
const cache = { at: 0, body: null };

/** The current snapshot, from cache while it is young, or the last good one. */
function adaptFallback(payload) {
  const features = Array.isArray(payload?.features) ? payload.features : [];
  if (!features.length) return null;
  const names = {
    russian_control: 'Окуповано /// Occupied /// fallback feed',
    contact_line: 'Лінія фронту /// Contact line /// fallback feed',
    ukrainian_control_in_russia:
      'Український контроль /// Ukrainian control in Russia',
  };
  return {
    datetime: String(features[0]?.properties?.date || ''),
    map: {
      type: 'FeatureCollection',
      features: features.map((feature) => ({
        type: 'Feature',
        properties: {
          name: names[feature?.properties?.kind] || String(feature?.properties?.kind || ''),
        },
        geometry: feature.geometry,
      })),
    },
    fallback: true,
  };
}

export async function frontlineSnapshot() {
  if (cache.body && Date.now() - cache.at < CACHE_MS) return cache.body;
  try {
    const primary = await fetchPrimary();
    if (primary) return primary;
  } catch {
    /* fall through to the daily feed */
  }
  try {
    const response = await fetch(FALLBACK_URL, {
      headers: { Accept: 'application/json', 'User-Agent': 'gods-eye-view/1.0' },
      signal: AbortSignal.timeout(20_000),
    });
    if (response.ok) {
      const adapted = adaptFallback(await response.json());
      if (adapted) {
        cache.at = Date.now();
        cache.body = adapted;
        return adapted;
      }
    }
  } catch {
    /* keep the last good snapshot */
  }
  return cache.body;
}

async function fetchPrimary() {
  const response = await fetch(URL, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'gods-eye-view/1.0',
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) return cache.body;
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    return cache.body;
  }
  if (!Array.isArray(body?.map?.features) || !body.map.features.length)
    return null;
  cache.at = Date.now();
  cache.body = body;
  return body;
}

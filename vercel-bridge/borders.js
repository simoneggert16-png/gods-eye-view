/**
 * Country borders (Natural Earth 1:50m, public domain).
 *
 * The boundary-lines set, not the country polygons: polygon rings also trace
 * every coastline, which turns the map into a glowing wireframe. 1:110m looked
 * visibly broken at street zooms; 1:10m follows rivers best but splits into
 * ~8,000 segments and lags the scene. 1:50m keeps ~390 segments with enough
 * detail that borders follow the Rhine and the ridges. Fetched once a day and
 * stripped to geometry plus the country name.
 */

const URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_boundary_lines_land.geojson';
const CACHE_MS = 24 * 60 * 60 * 1000;

/** @type {{at:number, body:object|null}} */
const cache = { at: 0, body: null };

export async function bordersSnapshot() {
  if (cache.body && Date.now() - cache.at < CACHE_MS) return cache.body;
  try {
    const response = await fetch(URL, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'gods-eye-view/1.0',
      },
      signal: AbortSignal.timeout(25_000),
    });
    if (!response.ok) return cache.body;
    const payload = await response.json();
    const features = Array.isArray(payload?.features) ? payload.features : [];
    if (!features.length) return cache.body;
    const body = {
      type: 'FeatureCollection',
      features: features
        .filter((feature) => feature?.geometry)
        .map((feature) => ({
          type: 'Feature',
          properties: {
            name: String(
              feature?.properties?.NAME || feature?.properties?.name || '',
            ),
          },
          geometry: feature.geometry,
        })),
    };
    cache.at = Date.now();
    cache.body = body;
    return body;
  } catch {
    return cache.body;
  }
}

/**
 * Supplementary vessel positions for `GET /api/vessels`.
 *
 * Why this exists
 * ---------------
 * AISStream is a websocket with one connection per API key. On a serverless
 * host every warm instance wants that one connection, so a deployment or a
 * burst of parallel requests makes instances compete; the store then grows only
 * in bursts and positions can freeze while static messages still arrive.
 * Measured 2026-11-03: the primary store held 2 800 vessels, `newestPositionAt`
 * was 20+ minutes old, and the client showed the honest VERALTET/reconnecting
 * state.
 *
 * `https://meri.digitraffic.fi/api/ais/v1/locations` is the Finnish Transport
 * Agency's open AIS service: keyless, plain HTTP, GeoJSON, ~950 positioned
 * vessels in the Baltic at any moment, no rate-limit headers in the way. It
 * cannot replace the worldwide socket, but adding it means the layer always has
 * live traffic even while the socket reconnects, and it raises every frame by
 * whichever of those vessels the socket store does not already hold.
 *
 * Contract
 * --------
 * Rows are converted into the same display-row shape the AIS provider serves
 * (`mmsi`, `lat`, `lon`, `speed` in knots, `course`, `heading`,
 * `last_position_epoch`/`_UTC`). Only positions are merged: names, IMO numbers
 * and destinations live in a separate Digitraffic endpoint and are not worth a
 * second request per poll. Cached for `GEV_AIS_EXTRA_TTL_MS` (default 60 s) with
 * a stale window, and any failure returns null so the primary answer stands.
 */

const SOURCE = 'https://meri.digitraffic.fi/api/ais/v1/locations';
const MAX_BYTES = 8 * 1024 * 1024;

function intFromEnv(key, fallback) {
  const raw = Number(process.env[key]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

const cache = { at: 0, rows: null, count: 0 };

async function fetchPositions(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(SOURCE, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'gods-eye-view-vessels/1.0 (meri.digitraffic.fi)',
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`upstream HTTP ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_BYTES)
      throw new Error(`payload too large (${buffer.length}B)`);
    const payload = JSON.parse(buffer.toString('utf8'));
    const features = Array.isArray(payload?.features) ? payload.features : [];
    const rows = [];
    for (const feature of features) {
      const properties = feature?.properties || {};
      const coordinates = feature?.geometry?.coordinates;
      if (!Array.isArray(coordinates) || coordinates.length < 2) continue;
      const lon = Number(coordinates[0]);
      const lat = Number(coordinates[1]);
      const mmsi = String(properties.mmsi || '').trim();
      if (!mmsi || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const at = Number(properties.timestampExternal);
      const observedMs = Number.isFinite(at) && at > 0 ? at : Date.now();
      rows.push({
        mmsi,
        lat,
        lon,
        name: '',
        imo: '',
        type: '',
        destination: '',
        speed: Number.isFinite(Number(properties.sog))
          ? Number(properties.sog)
          : null,
        course: Number.isFinite(Number(properties.cog))
          ? Number(properties.cog)
          : null,
        heading: Number.isFinite(Number(properties.heading))
          ? Number(properties.heading)
          : null,
        last_position_epoch: Math.round(observedMs / 1000),
        last_position_UTC: new Date(observedMs).toISOString(),
      });
    }
    if (!rows.length) throw new Error('no positioned vessels');
    return { rows, at: Date.now(), count: rows.length };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch (or reuse) the supplementary positions.
 * @returns {Promise<{rows: object[], count: number, cache: string}|null>}
 */
export async function extraVesselRows() {
  if (process.env.GEV_AIS_EXTRA === 'off') return null;
  const ttlMs = intFromEnv('GEV_AIS_EXTRA_TTL_MS', 60_000);
  const timeoutMs = intFromEnv('GEV_AIS_EXTRA_TIMEOUT_MS', 8_000);

  if (cache.rows && Date.now() - cache.at < ttlMs)
    return { rows: cache.rows, count: cache.count, cache: 'HIT' };

  // A single attempt, bounded well under the client's 10 s abort: the extras
  // run in parallel with the upstream handler and the warm-up, and a retry
  // after a timeout would push the whole request past that deadline.
  try {
    const result = await fetchPositions(timeoutMs);
    cache.rows = result.rows;
    cache.count = result.count;
    cache.at = result.at;
    return { rows: result.rows, count: result.count, cache: 'MISS' };
  } catch (error) {
    console.warn(
      `[gev-bridge] vessel supplement failed (${error?.message || error}); ` +
        'serving the previous frame when it is still recent.',
    );
    if (cache.rows && Date.now() - cache.at < ttlMs * 5)
      return { rows: cache.rows, count: cache.count, cache: 'STALE' };
    return null;
  }
}

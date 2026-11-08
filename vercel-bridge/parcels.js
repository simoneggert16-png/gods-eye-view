/**
 * Official Swiss parcel lookup (Amtliche Vermessung, AV).
 *
 * geodienste.ch publishes the cantonal cadastral parcels through a public WFS.
 * The response is GeoJSON already, so the containing parcel is selected here
 * and returned with number, area, canton and EGRID. Private APIs or paid
 * sources are not involved. Attribution: geodienste.ch / Amtliche Vermessung.
 */

const WFS = 'https://geodienste.ch/db/avc_0/deu';
const CACHE_MS = 10 * 60 * 1000;
const CACHE_LIMIT = 200;
const CACHE_MISS_MS = 2 * 60 * 1000;
/** @type {Map<string, {at:number, body:object}>} */
const cache = new Map();

function pointInRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i] || [];
    const [xj, yj] = ring[j] || [];
    if (
      (yi > point[1]) !== (yj > point[1]) &&
      point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInPolygon(point, polygon) {
  if (!Array.isArray(polygon) || !polygon.length) return false;
  if (!pointInRing(point, polygon[0])) return false;
  for (let i = 1; i < polygon.length; i += 1) {
    if (pointInRing(point, polygon[i])) return false;
  }
  return true;
}

function pointInGeometry(point, geometry) {
  if (!geometry) return false;
  if (geometry.type === 'Polygon') return pointInPolygon(point, geometry.coordinates);
  if (geometry.type === 'MultiPolygon')
    return geometry.coordinates.some((polygon) => pointInPolygon(point, polygon));
  return false;
}

/**
 * The cadastral parcel containing a WGS84 point, or {found:false}.
 * The WFS expects BBOX in lat,lon order for EPSG:4326.
 * @param {{lat:number|string, lon:number|string, fetchImpl?:Function}} options
 */
export async function parcelAt({ lat, lon, fetchImpl = fetch } = {}) {
  const latitude = Number(lat);
  const longitude = Number(lon);
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 85 ||
    Math.abs(longitude) > 180
  )
    return { found: false, source: 'geodienste.ch' };
  const key = `${latitude.toFixed(6)}|${longitude.toFixed(6)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < (hit.body.found ? CACHE_MS : CACHE_MISS_MS))
    return hit.body;

  const padLat = 0.0005;
  const padLon = 0.0008;
  try {
    const url = new URL(WFS);
    url.searchParams.set('SERVICE', 'WFS');
    url.searchParams.set('VERSION', '2.0.0');
    url.searchParams.set('REQUEST', 'GetFeature');
    url.searchParams.set('TYPENAMES', 'ms:RESF');
    url.searchParams.set('COUNT', '50');
    url.searchParams.set('SRSNAME', 'EPSG:4326');
    url.searchParams.set(
      'BBOX',
      [
        (latitude - padLat).toFixed(6),
        (longitude - padLon).toFixed(6),
        (latitude + padLat).toFixed(6),
        (longitude + padLon).toFixed(6),
        'EPSG:4326',
      ].join(','),
    );
    url.searchParams.set('OUTPUTFORMAT', 'geojson');
    const response = await fetchImpl(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent':
          'gods-eye-view/1.0 (parcel lookup; https://gods-eye-view-fresh.vercel.app)',
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) return { found: false, source: 'geodienste.ch' };
    const body = await response.json();
    const features = Array.isArray(body?.features) ? body.features : [];
    const point = [longitude, latitude];
    const match = features.find((feature) =>
      pointInGeometry(point, feature?.geometry),
    );
    let result = { found: false, source: 'geodienste.ch' };
    if (match?.geometry) {
      const properties = match.properties || {};
      result = {
        found: true,
        number: String(properties.Nummer || ''),
        area: Number(properties.Flaeche) || 0,
        canton: String(properties.Kanton || ''),
        egrid: String(properties.EGRIS_EGRID || ''),
        geometry: match.geometry,
        source: 'geodienste.ch (Amtliche Vermessung)',
        fetchedAt: Date.now(),
      };
    }
    cache.set(key, { at: Date.now(), body: result });
    if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
    return result;
  } catch {
    return { found: false, source: 'geodienste.ch' };
  }
}

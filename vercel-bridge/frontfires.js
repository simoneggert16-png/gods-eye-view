/**
 * Fires near the front line (last 24 h), derived from two existing feeds.
 *
 * NASA FIRMS reports thermal anomalies worldwide (about 100 000 in a day, 21 MB
 * of JSON); on their own they are wildfires, burn-offs and industry. What makes
 * them intelligence here is the distance to the DeepState front: a heat source
 * within a few dozen kilometres of the line is worth looking at, and the list is
 * small enough to draw. The filtering happens server-side so the browser gets a
 * few hundred points instead of the whole planet.
 *
 * "Near" is a cell test, not a geodesic distance: boundary points are bucketed
 * into ~11 km cells and a fire counts when any occupied/unknown-area boundary
 * lies in its 5×5-cell neighbourhood (≈55 km). That is the honest resolution of
 * a cell test and keeps 100 000 fires cheap to scan.
 */

const CELL_DEG = 0.1;
const CACHE_MS = 10 * 60 * 1000;

/** @type {{at:number, body:object|null}} */
const cache = { at: 0, body: null };

const keyOf = (lat, lon) =>
  `${Math.round(lat / CELL_DEG)},${Math.round(lon / CELL_DEG)}`;

/** Boundary points of every occupied/unknown area, bucketed for the cell test. */
function boundaryCells(features) {
  const cells = new Set();
  let points = 0;
  for (const feature of features) {
    const name = String(feature?.properties?.name || '').toLowerCase();
    if (!name.includes('occupied') && !name.includes('unknown status'))
      continue;
    const geometry = feature?.geometry;
    const polygons =
      geometry?.type === 'Polygon'
        ? [geometry.coordinates]
        : geometry?.type === 'MultiPolygon'
          ? geometry.coordinates
          : [];
    for (const rings of polygons) {
      for (const ring of rings) {
        // Every 3rd vertex: cells are ~11 km wide, so this cannot miss one.
        for (let i = 0; i < ring.length; i += 3) {
          const lon = Number(ring[i]?.[0]);
          const lat = Number(ring[i]?.[1]);
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
          cells.add(keyOf(lat, lon));
          points += 1;
        }
      }
    }
  }
  return { cells, points };
}

function nearFront(cells, lat, lon) {
  const cy = Math.round(lat / CELL_DEG);
  const cx = Math.round(lon / CELL_DEG);
  for (let dy = -5; dy <= 5; dy += 1) {
    for (let dx = -5; dx <= 5; dx += 1) {
      if (cells.has(`${cy + dy},${cx + dx}`)) return true;
    }
  }
  return false;
}

/**
 * Filter the FIRMS snapshot down to fires near the front.
 * @param {object[]} fires FIRMS rows (`lat`, `lon`, `frp`, `acqDate`, `acqTime`).
 * @param {object} snapshot DeepState payload.
 */
export function frontFiresFrom(fires, snapshot) {
  const features = Array.isArray(snapshot?.map?.features)
    ? snapshot.map.features
    : [];
  const { cells, points } = boundaryCells(features);
  if (!cells.size) return null;
  const near = [];
  for (const fire of fires) {
    const lat = Number(fire?.lat);
    const lon = Number(fire?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (!nearFront(cells, lat, lon)) continue;
    near.push({
      lat,
      lon,
      frp: Number(fire?.frp) || 0,
      confidence: String(fire?.confidence || ''),
      acqDate: String(fire?.acqDate || ''),
      acqTime: String(fire?.acqTime || ''),
      satellite: String(fire?.satellite || ''),
    });
  }
  near.sort((a, b) => b.frp - a.frp);
  return {
    fires: near.slice(0, 600),
    count: near.length,
    scanned: fires.length,
    boundaryPoints: points,
    updatedAt: Date.now(),
  };
}

/** Cached wrapper: the same FIRMS snapshot within ten minutes reuses the answer. */
export async function frontFires(firesPromise, snapshotPromise) {
  if (cache.body && Date.now() - cache.at < CACHE_MS) return cache.body;
  const [fires, snapshot] = await Promise.all([firesPromise, snapshotPromise]);
  if (!Array.isArray(fires) || !fires.length || !snapshot) return cache.body;
  const body = frontFiresFrom(fires, snapshot);
  if (!body) return cache.body;
  cache.at = Date.now();
  cache.body = body;
  return body;
}

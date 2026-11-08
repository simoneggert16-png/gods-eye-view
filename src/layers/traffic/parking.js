import * as Cesium from 'cesium';

/**
 * Parked cars in OSM parking areas.
 *
 * The traffic layer has always shown moving dots on roads; car parks stayed
 * empty, which reads as "the simulation only exists while a car is underway".
 * This pass asks the keyless Overpass proxy for `amenity=parking` areas in the
 * current view and stands a few dim, motionless dots in each one, at the height
 * of the nearest loaded road (so they sit on the sampled ground, not at sea
 * level). The list is cached per view cell; moving the camera clears the parked
 * dots and, when the new view has lots, places them again.
 */

const CACHE_MS = 5 * 60 * 1000;
const MAX_PARKED = 220;
const CELL_DEG = 0.01; // ~1 km — the cache/refresh granularity
const MAX_LOT_DISTANCE_M = 140;

export function createParking({ state: layerState, parts }) {
  let box = '';
  let generation = 0;
  const cache = new Map(); // box -> {at, lots}
  const cartoScratch = new Cesium.Cartographic();

  /** The camera's ground rectangle in degrees, or null when it has none. */
  function cameraBox(viewer) {
    const rectangle = viewer?.camera?.computeViewRectangle?.();
    if (!rectangle) return null;
    const toDeg = Cesium.Math.toDegrees;
    const west = Math.max(-180, toDeg(rectangle.west));
    const east = Math.min(180, toDeg(rectangle.east));
    const south = Math.max(-85, toDeg(rectangle.south));
    const north = Math.min(85, toDeg(rectangle.north));
    if (!(east > west && north > south)) return null;
    return { west, south, east, north };
  }

  const snap = (value) => Math.round(value / CELL_DEG) * CELL_DEG;

  /** Road waypoints as lat/lon/height, so a lot can borrow the local ground. */
  function roadSamples(roads) {
    const samples = [];
    for (const road of roads) {
      for (const waypoint of road.waypoints) {
        const carto = Cesium.Cartographic.fromCartesian(
          waypoint,
          undefined,
          cartoScratch,
        );
        samples.push({
          lat: carto.latitude,
          lon: carto.longitude,
          height: carto.height,
        });
      }
    }
    return samples;
  }

  /** Height of the nearest loaded road within the limit, or NaN. */
  function groundNear(samples, latRad, lonRad) {
    let best = Infinity;
    let height = Number.NaN;
    const cos = Math.cos(latRad);
    for (const sample of samples) {
      const dLat = sample.lat - latRad;
      let dLon = sample.lon - lonRad;
      if (dLon > Math.PI) dLon -= 2 * Math.PI;
      if (dLon < -Math.PI) dLon += 2 * Math.PI;
      const d = dLat * dLat + dLon * dLon * cos * cos;
      if (d < best) {
        best = d;
        height = sample.height;
      }
    }
    const metres = Math.sqrt(best) * 6371008.8;
    return metres <= MAX_LOT_DISTANCE_M ? height : Number.NaN;
  }

  async function fetchLots(q, signal) {
    const ql =
      '[out:json][timeout:15];' +
      `way["amenity"="parking"](${q.south},${q.west},${q.north},${q.east});` +
      'out center tags;';
    const response = await fetch('/api/overpass', {
      method: 'POST',
      // The proxy takes exactly one `data` field in a form body (it validates
      // and clamps the query before forwarding it).
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(ql)}`,
      signal,
    });
    if (!response.ok) return [];
    const body = await response.json();
    return (Array.isArray(body?.elements) ? body.elements : [])
      .map((element) => {
        const center = element?.center;
        if (!center) return null;
        return {
          lat: Number(center.lat),
          lon: Number(center.lon),
          capacity: Number(element.tags?.capacity) || 0,
        };
      })
      .filter(
        (lot) => lot && Number.isFinite(lot.lat) && Number.isFinite(lot.lon),
      );
  }

  /**
   * Reconcile the parked cars with the current view. Cheap when the view stays
   * in the same cell; a new cell clears and refills.
   * @param {object[]} roads Roads currently drawn (for local ground height).
   */
  async function refresh(roads) {
    const viewer = layerState._viewer;
    if (!viewer || !layerState._enabled || !roads?.length) return;
    const raw = cameraBox(viewer);
    if (!raw) return;
    const q = {
      west: snap(raw.west),
      south: snap(raw.south),
      east: snap(raw.east),
      north: snap(raw.north),
    };
    const key = `${q.west},${q.south},${q.east},${q.north}`;
    if (key === box) return;
    box = key;
    const gen = ++generation;
    parts.animation.clearParkedDots();

    let entry = cache.get(key);
    if (!entry || Date.now() - entry.at > CACHE_MS) {
      try {
        entry = { at: Date.now(), lots: await fetchLots(q) };
        cache.set(key, entry);
      } catch {
        return;
      }
    }
    if (gen !== generation || !entry.lots.length) return;

    const samples = roadSamples(roads);
    let placed = 0;
    for (const lot of entry.lots) {
      if (placed >= MAX_PARKED) break;
      const latRad = Cesium.Math.toRadians(lot.lat);
      const lonRad = Cesium.Math.toRadians(lot.lon);
      const height = groundNear(samples, latRad, lonRad);
      if (!Number.isFinite(height)) continue;
      // A stated capacity spreads the dots out; otherwise a car park reads as
      // a small cluster.
      const count = lot.capacity
        ? Math.min(8, Math.max(1, Math.round(lot.capacity / 40)))
        : 3;
      for (let i = 0; i < count && placed < MAX_PARKED; i += 1) {
        const jitterLat = (Math.random() - 0.5) * 0.00016; // ±9 m
        const jitterLon = (Math.random() - 0.5) * 0.00024;
        parts.animation.spawnParkedDot(
          Cesium.Cartesian3.fromDegrees(
            lot.lon + jitterLon,
            lot.lat + jitterLat,
            height,
          ),
          3,
        );
        placed += 1;
      }
    }
  }

  /** Forget the current lot list (next refresh refetches). */
  function clear() {
    generation += 1;
    box = '';
    parts.animation.clearParkedDots();
  }

  return { refresh, clear };
}

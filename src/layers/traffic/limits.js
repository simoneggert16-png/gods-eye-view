import * as Cesium from 'cesium';

/**
 * Posted speed limits for the traffic simulation.
 *
 * The road geometry comes from OpenFreeMap vector tiles, which carry the road
 * class but not its limit; TomTom's flow tiles say how fast traffic currently
 * moves, not what is allowed. `maxspeed` is an OpenStreetMap tag, so this pass
 * asks the keyless Overpass proxy for every way in view that states one and
 * matches them to the drawn roads by position (the tile roads and the OSM ways
 * share the same geometry, but not an id).
 *
 * The match is approximate by design: a road takes the most common limit among
 * the limit ways in its ~110 m cells, so a street keeps its 30 even when a 50
 * road crosses it. Without a match the road keeps the class speed from
 * `SPEED_MPS`, which is the old behaviour.
 */

const CACHE_MS = 5 * 60 * 1000;
const CELL = 0.001; // ~110 m — the matching and cache cell
const SAMPLES_PER_ROAD = 5;

/** Parse an OSM `maxspeed` value into km/h, or null when it says nothing numeric. */
export function parseMaxspeed(value) {
  if (value == null) return null;
  const text = String(value).trim().toLowerCase();
  if (!text) return null;
  const zone = {
    'ch:urban': 50,
    'ch:rural': 80,
    'ch:motorway': 120,
    'de:urban': 50,
    'de:rural': 100,
    'at:urban': 50,
    'at:rural': 100,
    'at:motorway': 130,
    'de:motorway': 130,
    'fr:motorway': 130,
    'it:motorway': 130,
    'fr:urban': 50,
    'fr:rural': 80,
    'it:urban': 50,
    'it:rural': 90,
  }[text];
  if (zone) return zone;
  if (text === 'walk' || text === 'foot') return 7;
  if (text === 'none' || text === 'signals' || text === 'variable') return null;
  const match = /^(\d+(?:\.\d+)?)\s*(mph|km\/h|kmh)?$/.exec(text);
  if (!match) return null;
  const number = Number(match[1]);
  if (!Number.isFinite(number) || number <= 0 || number > 160) return null;
  return match[2] === 'mph' ? Math.round(number * 1.609) : Math.round(number);
}

/** Cell key for a lon/lat pair. */
function cellKey(lon, lat) {
  return `${Math.round(lon / CELL)},${Math.round(lat / CELL)}`;
}

/** Most common value, ties broken by the smaller limit. */
function mode(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  let best = null;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount || (count === bestCount && value < best)) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

export function createLimits({ state: layerState, parts }) {
  const cache = new Map(); // box -> {at, grid}
  let box = '';
  let grid = null;
  let generation = 0;

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

  const snap = (value) => Math.round(value / 0.01) * 0.01;

  async function fetchGrid(q, signal) {
    const query =
      '[out:json][timeout:15];' +
      `way["highway"]["maxspeed"](${q.south},${q.west},${q.north},${q.east});` +
      'out tags geom;';
    const response = await fetch('/api/overpass', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`,
      signal,
    });
    if (!response.ok) return null;
    const body = await response.json();
    const cells = new Map();
    for (const element of Array.isArray(body?.elements) ? body.elements : []) {
      const limit = parseMaxspeed(element?.tags?.maxspeed);
      const geometry = element?.geometry;
      if (!limit || !Array.isArray(geometry)) continue;
      for (const point of geometry) {
        if (!Number.isFinite(point?.lat) || !Number.isFinite(point?.lon))
          continue;
        const key = cellKey(point.lon, point.lat);
        const list = cells.get(key) || [];
        list.push(limit);
        cells.set(key, list);
      }
    }
    return cells;
  }

  /**
   * Refresh the limit grid for the current view (cached per ~1 km box). Safe to
   * call on every road publication: it returns early when the view stays put.
   * @param {object[]} roads Roads currently drawn (sampled for matching).
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
    let entry = cache.get(key);
    if (!entry || Date.now() - entry.at > CACHE_MS) {
      try {
        entry = { at: Date.now(), grid: await fetchGrid(q) };
        if (entry.grid) cache.set(key, entry);
      } catch {
        return;
      }
    }
    if (gen !== generation) return;
    grid = entry.grid;
    // New limits apply to the next spawns; existing dots pick them up when
    // their road is repopulated.
    parts.model?.applyLimits?.();
  }

  /**
   * The matched limit for a road in km/h, or null.
   * @param {{coords:number[][]}} road Drawn road.
   */
  function limitFor(road) {
    if (!grid || !grid.size || !Array.isArray(road?.coords)) return null;
    const coords = road.coords;
    const step = Math.max(1, Math.floor(coords.length / SAMPLES_PER_ROAD));
    const found = [];
    for (let i = 0; i < coords.length; i += step) {
      const [lon, lat] = coords[i];
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      const cx = Math.round(lon / CELL);
      const cy = Math.round(lat / CELL);
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          const list = grid.get(`${cx + dx},${cy + dy}`);
          if (list) found.push(...list);
        }
      }
      if (found.length > 24) break;
    }
    return found.length ? mode(found) : null;
  }

  /** Forget the grid (layer off); the next refresh refetches. */
  function clear() {
    generation += 1;
    box = '';
    grid = null;
  }

  return { refresh, limitFor, clear };
}

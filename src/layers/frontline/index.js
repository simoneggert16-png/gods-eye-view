import * as Cesium from 'cesium';
import { createInfoPopover } from '../../ui/conflictInfo.js';

// A portable package (no i18n): the panel translates the layer's own text.
const msg = (text) => text;

/** Colour per area kind: occupied red, unknown amber, frozen territory violet. */
const AREA_COLORS = Object.freeze({
  occupied: Cesium.Color.fromCssColorString('#ff4d4d'),
  unknown: Cesium.Color.fromCssColorString('#ffb84d'),
  territory: Cesium.Color.fromCssColorString('#b48cff'),
  front: Cesium.Color.fromCssColorString('#ff6b4a'),
});

/**
 * DeepState area kind from its bilingual name ("Окуповано /// Occupied …",
 * "Статус невідомий /// Unknown status …", "… /// geoJSON.territories.crimea").
 * Territories are named separately so Crimea stays a territory, not a status.
 */
export function classifyFrontlineArea(name) {
  const text = String(name || '').toLowerCase();
  if (text.includes('contact line') || text.includes('front line'))
    return 'front';
  if (text.includes('geojson.territories.')) return 'territory';
  if (text.includes('unknown status')) return 'unknown';
  if (text.includes('occupied')) return 'occupied';
  return 'territory';
}

/** One ring (`[lon, lat, 0]` triples) as a clamped ground polyline. */
function ringPositions(ring) {
  const flat = [];
  for (const point of ring) {
    const lon = Number(point?.[0]);
    const lat = Number(point?.[1]);
    if (Number.isFinite(lon) && Number.isFinite(lat)) flat.push(lon, lat);
  }
  return flat.length >= 4 ? Cesium.Cartesian3.fromDegreesArray(flat) : null;
}

/** Every ring of a Polygon / MultiPolygon geometry. */
function polygonRings(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates;
  return [];
}

/** Every line of a LineString / MultiLineString geometry. */
function geometryLines(geometry) {
  if (geometry?.type === 'LineString') return [geometry.coordinates];
  if (geometry?.type === 'MultiLineString') return geometry.coordinates;
  return [];
}

/**
 * Front line and occupied areas (DeepState).
 *
 * One polygon per area for the fill and one clamped polyline per ring for the
 * outline — Cesium does not draw `polygon.outline` on ground-clamped geometry,
 * and the outlines are the point of this layer: the boundary of the occupied
 * areas is the front line.
 */
export function createFrontlineLayer({ source } = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('Front line requires a snapshot source');
  let _viewer = null;
  let _request = null;
  let _dataSource = null;
  let _count = 0;
  let _lastUpdate = null;
  let _lastError = null;
  let _enabled = false;
  let _popover = null;

  const layer = {
    id: 'frontline',
    name: 'Front line & occupied areas',
    icon: '⚔️',
    source: 'DeepState',
    updateInterval: 30 * 60 * 1000,

    init(viewer) {
      if (_viewer) throw new Error('Front line layer is already initialized');
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource('frontline');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
      _enabled = false;
      _popover = createInfoPopover(viewer, {
        prefix: 'frontline:',
        describe: (read) => ({
          title: String(read('areaName') || '')
            .split('///')[0]
            .trim(),
          lines: [
            [
              'Status',
              read('kind') === 'occupied'
                ? 'besetzt'
                : read('kind') === 'unknown'
                  ? 'unklarer Status'
                  : 'eingefrorenes Konfliktgebiet',
            ],
          ],
        }),
      });
      console.log('[Data:Frontline] Initialized');
    },

    enable() {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
    },

    disable() {
      _request?.abort();
      _request = null;
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
    },

    async update() {
      if (!_enabled || !_dataSource) return false;
      _request?.abort();
      const request = new AbortController();
      _request = request;
      try {
        const snapshot = await source.getSnapshot({ signal: request.signal });
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;

        const entities = [];
        let count = 0;
        snapshot.features.forEach((feature, index) => {
          // A contact line has no area: draw it as a bright polyline.
          const lines = geometryLines(feature?.geometry);
          if (lines.length) {
            const name = String(feature?.properties?.name || '');
            const kind = classifyFrontlineArea(name);
            const color = AREA_COLORS[kind] || AREA_COLORS.front;
            for (const line of lines) {
              const positions = ringPositions(line);
              if (!positions) continue;
              count += 1;
              entities.push(
                new Cesium.Entity({
                  id: `frontline:line:${index}:${count}`,
                  polyline: {
                    positions,
                    width: 2,
                    material: color.withAlpha(0.95),
                    clampToGround: true,
                  },
                  properties: { areaName: name, kind },
                }),
              );
            }
            return;
          }
          const name = String(feature?.properties?.name || '');
          const kind = classifyFrontlineArea(name);
          const color = AREA_COLORS[kind] || AREA_COLORS.territory;
          for (const rings of polygonRings(feature?.geometry)) {
            const positions = ringPositions(rings[0] || []);
            if (!positions) continue;
            count += 1;
            const id = `frontline:${index}:${count}`;
            entities.push(
              new Cesium.Entity({
                id,
                polygon: {
                  hierarchy: new Cesium.PolygonHierarchy(positions),
                  material: color.withAlpha(0.2),
                  outline: false,
                },
                properties: { areaName: name, kind },
              }),
            );
            for (const ring of rings) {
              const line = ringPositions(ring);
              if (!line) continue;
              entities.push(
                new Cesium.Entity({
                  id: `${id}:outline:${entities.length}`,
                  polyline: {
                    positions: line,
                    width: 1.6,
                    material: color.withAlpha(0.9),
                    clampToGround: true,
                  },
                }),
              );
            }
          }
        });

        _dataSource.entities.removeAll();
        for (const entity of entities) _dataSource.entities.add(entity);
        _count = count;
        _lastUpdate = snapshot.updatedAt
          ? Date.parse(snapshot.updatedAt) || Date.now()
          : Date.now();
        _lastError = null;
        console.log(`[Data:Frontline] Updated: ${_count} areas`);
        return true;
      } catch (error) {
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        console.warn('[Data:Frontline] Fetch error:', error);
        _lastError = error?.message || msg('Front line source unavailable');
        return false;
      } finally {
        if (_request === request) _request = null;
      }
    },

    destroy(viewer = _viewer) {
      _popover?.destroy();
      _popover = null;
      _request?.abort();
      _request = null;
      _viewer = null;
      _enabled = false;
      if (_dataSource) {
        viewer.dataSources.remove(_dataSource, true);
        _dataSource = null;
      }
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
    },

    getStats() {
      return {
        count: _count,
        lastUpdate: _lastUpdate,
        error: _lastError,
        source: 'DeepState',
        coverage: 'occupied areas',
      };
    },
  };
  return layer;
}

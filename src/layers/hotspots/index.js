import * as Cesium from 'cesium';
import { createInfoPopover } from '../../ui/conflictInfo.js';

const msg = (text) => text;
const CELL_DEG = 0.25; // ≈ 28 km at these latitudes
const MIN_REPORTS = 2;

/** Fill colour by how many located reports name a target in the cell. */
export function hotspotColor(count) {
  if (count >= 5) return Cesium.Color.fromCssColorString('#ff3b30');
  if (count >= 3) return Cesium.Color.fromCssColorString('#ff8c00');
  return Cesium.Color.fromCssColorString('#ffc247');
}

/** Bin located, target-naming reports into fixed cells. */
export function binHotspots(reports) {
  const cells = new Map();
  for (const report of reports || []) {
    if (!Number.isFinite(report?.lat) || !Number.isFinite(report?.lon))
      continue;
    if (!report.target) continue;
    const lat = Math.floor(report.lat / CELL_DEG) * CELL_DEG;
    const lon = Math.floor(report.lon / CELL_DEG) * CELL_DEG;
    const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
    let cell = cells.get(key);
    if (!cell) {
      cell = {
        lat,
        lon,
        count: 0,
        places: new Set(),
        targets: new Set(),
        latest: '',
        sample: '',
      };
      cells.set(key, cell);
    }
    cell.count += 1;
    if (report.place) cell.places.add(report.place);
    cell.targets.add(report.target);
    if (report.updated > cell.latest) {
      cell.latest = report.updated;
      cell.sample = report.title;
    }
  }
  return [...cells.values()]
    .filter((cell) => cell.count >= MIN_REPORTS)
    .sort((a, b) => b.count - a.count);
}

/**
 * Conflict hotspots: cells where at least two located strike headlines of the
 * last cycle name a target. Derived, not reported — a concentration of
 * headlines, never a claim about who controls the ground.
 */
export function createHotspotsLayer({ source } = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('Hotspots require a snapshot source');
  let _viewer = null;
  let _request = null;
  let _dataSource = null;
  let _popover = null;
  let _count = 0;
  let _lastUpdate = null;
  let _lastError = null;
  let _enabled = false;

  const layer = {
    id: 'hotspots',
    name: 'Conflict hotspots (derived)',
    icon: '⚠️',
    source: 'OSINT density',
    updateInterval: 2 * 60 * 1000,

    init(viewer) {
      if (_viewer) throw new Error('Hotspot layer is already initialized');
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource('hotspots');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _popover = createInfoPopover(viewer, {
        prefix: 'hotspot:',
        describe: (read) => ({
          title: msg('Conflict hotspot (derived)'),
          lines: [
            ['Meldungen', read('count')],
            ['Orte', read('places')],
            ['Ziele', read('targets')],
            [
              'Neueste',
              read('latest') ? new Date(read('latest')).toLocaleString() : '',
            ],
            ['Beispiel', read('sample')],
          ],
        }),
      });
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
      _enabled = false;
      console.log('[Data:Hotspots] Initialized');
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
        const cells = binHotspots(snapshot.reports);
        _dataSource.entities.removeAll();
        cells.forEach((cell, index) => {
          const color = hotspotColor(cell.count);
          const west = cell.lon;
          const south = cell.lat;
          _dataSource.entities.add(
            new Cesium.Entity({
              id: `hotspot:${index}`,
              rectangle: {
                coordinates: Cesium.Rectangle.fromDegrees(
                  west,
                  south,
                  west + CELL_DEG,
                  south + CELL_DEG,
                ),
                material: color.withAlpha(0.32),
                outline: true,
                outlineColor: color.withAlpha(0.9),
                outlineWidth: 1.5,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
              },
              properties: {
                count: cell.count,
                places: [...cell.places].slice(0, 6).join(', '),
                targets: [...cell.targets].slice(0, 6).join(', '),
                latest: cell.latest,
                sample: cell.sample,
              },
            }),
          );
        });
        _count = cells.length;
        _lastUpdate = Date.now();
        _lastError = null;
        console.log(`[Data:Hotspots] Updated: ${_count} cells`);
        return true;
      } catch (error) {
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        console.warn('[Data:Hotspots] Fetch error:', error);
        _lastError = error?.message || msg('Hotspot source unavailable');
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
        source: 'OSINT density',
        coverage: `${MIN_REPORTS}+ located reports per ${Math.round(CELL_DEG * 111)} km cell`,
      };
    },
  };
  return layer;
}

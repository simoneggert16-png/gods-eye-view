import * as Cesium from 'cesium';
import { createInfoPopover } from '../../ui/conflictInfo.js';

const msg = (text) => text;

/**
 * Geocoded OSINT headlines (Reddit RSS).
 *
 * The bridge matches each headline against a compact gazetteer of conflict
 * places; only reports that name a place become points here. The rest stay in
 * the bridge's list, visible to the analyst records, so a vague post never
 * lands somewhere on the map by accident.
 */
/** Point colour by what the headline says was hit. */
const CATEGORY_COLORS = Object.freeze({
  military: Cesium.Color.fromCssColorString('#ff3b30'),
  energy: Cesium.Color.fromCssColorString('#ff8c00'),
  infrastructure: Cesium.Color.fromCssColorString('#ffd166'),
  other: Cesium.Color.fromCssColorString('#ffd166'),
});

export function createOsintLayer({ source } = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('OSINT layer requires a snapshot source');
  let _viewer = null;
  let _request = null;
  let _dataSource = null;
  let _count = 0;
  let _lastUpdate = null;
  let _lastError = null;
  let _enabled = false;
  let _popover = null;

  const layer = {
    id: 'osint',
    name: 'OSINT reports (Reddit)',
    icon: '📡',
    source: 'Reddit RSS × gazetteer',
    updateInterval: 2 * 60 * 1000,

    init(viewer) {
      if (_viewer) throw new Error('OSINT layer is already initialized');
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource('osint');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
      _enabled = false;
      _popover = createInfoPopover(viewer, {
        prefix: 'osint:',
        describe: (read) => ({
          title: read('title'),
          lines: [
            ['Ort', read('place')],
            ['Ziel', read('target')],
            ['Quelle', read('sub')],
            [
              'Zeit',
              read('updated') ? new Date(read('updated')).toLocaleString() : '',
            ],
          ],
          link: { href: read('url'), text: 'Meldung �ffnen' },
        }),
      });
      console.log('[Data:OSINT] Initialized');
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
        _dataSource.entities.removeAll();
        let count = 0;
        for (const report of snapshot.reports) {
          if (!Number.isFinite(report.lat) || !Number.isFinite(report.lon))
            continue;
          _dataSource.entities.add(
            new Cesium.Entity({
              id: `osint:${count}`,
              position: Cesium.Cartesian3.fromDegrees(report.lon, report.lat),
              point: {
                pixelSize: 6,
                color: (
                  CATEGORY_COLORS[report.category] || CATEGORY_COLORS.other
                ).withAlpha(0.9),
                outlineColor: Cesium.Color.BLACK.withAlpha(0.8),
                outlineWidth: 1,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                disableDepthTestDistance: 0,
              },
              properties: {
                title: report.title,
                sub: report.sub,
                place: report.place || '',
                target: report.target || '',
                category: report.category || 'other',
                updated: report.updated,
                url: report.url,
              },
            }),
          );
          count += 1;
        }
        _count = count;
        _lastUpdate = Date.now();
        _lastError = null;
        console.log(`[Data:OSINT] Updated: ${_count} located reports`);
        return true;
      } catch (error) {
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        console.warn('[Data:OSINT] Fetch error:', error);
        _lastError = error?.message || msg('OSINT source unavailable');
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
        source: 'Reddit',
        coverage: 'located headlines',
      };
    },
  };
  return layer;
}

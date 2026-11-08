import * as Cesium from 'cesium';
import { createInfoPopover } from '../../ui/conflictInfo.js';

const msg = (text) => text;

/** Colour by fire radiative power: a bigger heat source burns brighter. */
export function fireColor(frp) {
  if (frp >= 20) return Cesium.Color.fromCssColorString('#ff3b30');
  if (frp >= 5) return Cesium.Color.fromCssColorString('#ff8c00');
  return Cesium.Color.fromCssColorString('#ffc247');
}

/**
 * Fires within ~55 km of the front line, from the 24 h FIRMS snapshot.
 *
 * The filtering happens in the bridge (100 000 detections worldwide, a few
 * dozen near the front); this layer only draws them: a ground-clamped point per
 * detection, sized and coloured by radiative power, with the acquisition time
 * and satellite kept on the entity for the analyst records.
 */
export function createFrontFiresLayer({ source } = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('Front fires require a snapshot source');
  let _viewer = null;
  let _request = null;
  let _dataSource = null;
  let _count = 0;
  let _lastUpdate = null;
  let _lastError = null;
  let _enabled = false;
  let _popover = null;

  const layer = {
    id: 'frontfires',
    name: 'Fires near the front',
    icon: '💥',
    source: 'NASA FIRMS × DeepState',
    updateInterval: 10 * 60 * 1000,

    init(viewer) {
      if (_viewer) throw new Error('Front-fire layer is already initialized');
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource('frontfires');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
      _enabled = false;
      _popover = createInfoPopover(viewer, {
        prefix: 'frontfire:',
        describe: (read) => ({
          title: msg('FIRMS'),
          lines: [
            ['Strahlungsleistung', read('frp') + ' MW'],
            ['Aufnahme', (read('acqDate') + ' ' + read('acqTime')).trim()],
            ['Satellit', read('satellite')],
            ['Konfidenz', read('confidence')],
          ],
        }),
      });
      console.log('[Data:FrontFires] Initialized');
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
        for (const fire of snapshot.fires) {
          const color = fireColor(fire.frp);
          _dataSource.entities.add(
            new Cesium.Entity({
              id: `frontfire:${count}`,
              position: Cesium.Cartesian3.fromDegrees(fire.lon, fire.lat),
              point: {
                pixelSize: Math.max(4, Math.min(14, 4 + fire.frp / 4)),
                color: color.withAlpha(0.9),
                outlineColor: Cesium.Color.BLACK.withAlpha(0.8),
                outlineWidth: 1,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                disableDepthTestDistance: 0,
              },
              properties: {
                frp: fire.frp,
                confidence: fire.confidence,
                acqDate: fire.acqDate,
                acqTime: fire.acqTime,
                satellite: fire.satellite,
              },
            }),
          );
          count += 1;
        }
        _count = count;
        _lastUpdate = Date.now();
        _lastError = null;
        console.log(`[Data:FrontFires] Updated: ${_count} fires`);
        return true;
      } catch (error) {
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        console.warn('[Data:FrontFires] Fetch error:', error);
        _lastError = error?.message || msg('Front-fire source unavailable');
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
        source: 'NASA FIRMS',
        coverage: 'within ~55 km of the front',
      };
    },
  };
  return layer;
}

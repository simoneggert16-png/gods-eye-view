import * as Cesium from 'cesium';

const msg = (text) => text;

/** Ring (`[lon, lat]` pairs) as a clamped ground polyline. */
function ringPositions(ring) {
  const flat = [];
  for (const point of ring || []) {
    const lon = Number(point?.[0]);
    const lat = Number(point?.[1]);
    if (Number.isFinite(lon) && Number.isFinite(lat)) flat.push(lon, lat);
  }
  return flat.length >= 4 ? Cesium.Cartesian3.fromDegreesArray(flat) : null;
}

/**
 * Country borders (Natural Earth 110m).
 *
 * One clamped polyline per polygon ring: no fill, no label, just the outline —
 * a reference layer that can stay on under everything else. Borders are coarse
 * at street zoom by design (1:110m); a denser set is one URL away in the
 * bridge if the map ever needs it.
 */
export function createBordersLayer({ source } = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('Borders require a snapshot source');
  let _viewer = null;
  let _request = null;
  let _dataSource = null;
  let _count = 0;
  let _lastUpdate = null;
  let _lastError = null;
  let _enabled = false;
  let _syncVisibility = null;

  const layer = {
    id: 'borders',
    name: 'National borders',
    icon: '🗺️',
    source: 'Natural Earth',
    updateInterval: 6 * 60 * 60 * 1000,

    init(viewer) {
      if (_viewer) throw new Error('Borders layer is already initialized');
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource('borders');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
      _enabled = false;
      // The photoreal 3D tileset hides the globe: clamped ground lines have
      // nothing to drape on there. Each border has a second, depth-fail line
      // that stays visible through the tiles; show exactly one of the pair.
      _syncVisibility = () => {
        if (!_dataSource) return;
        const globeVisible = Boolean(viewer.scene?.globe?.show);
        for (const entity of _dataSource.entities.values) {
          if (entity.id.startsWith('border-ground:'))
            entity.show = globeVisible;
          else if (entity.id.startsWith('border-xray:'))
            entity.show = !globeVisible;
        }
      };
      window.addEventListener('gev:map-stack-changed', _syncVisibility);
      console.log('[Data:Borders] Initialized');
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
        const addBorder = (positions) => {
          const color = Cesium.Color.fromCssColorString('#7fd8e7');
          _dataSource.entities.add(
            new Cesium.Entity({
              id: `border-ground:${count}`,
              polyline: {
                positions,
                width: 1.2,
                // Without clamping the line sits on the ellipsoid and
                // disappears under the terrain it is meant to outline.
                clampToGround: true,
                material: color.withAlpha(0.55),
              },
            }),
          );
          _dataSource.entities.add(
            new Cesium.Entity({
              id: `border-xray:${count}`,
              show: false,
              polyline: {
                positions,
                width: 1.2,
                // Both materials must be equally visible: the line sits on
                // the ellipsoid under the photoreal mesh, so depth precision
                // makes neighbouring fragments flip between pass and fail.
                // A nearly transparent pass material turned that flip into
                // the dashed border that made the layer look broken.
                material: color.withAlpha(0.5),
                depthFailMaterial: color.withAlpha(0.5),
              },
            }),
          );
          count += 1;
        };
        for (const feature of snapshot.features) {
          const geometry = feature?.geometry;
          const polygons =
            geometry?.type === 'Polygon'
              ? [geometry.coordinates]
              : geometry?.type === 'MultiPolygon'
                ? geometry.coordinates
                : [];
          for (const rings of polygons) {
            for (const ring of rings) {
              const positions = ringPositions(ring);
              if (positions) addBorder(positions);
            }
          }
          const lines =
            geometry?.type === 'LineString'
              ? [geometry.coordinates]
              : geometry?.type === 'MultiLineString'
                ? geometry.coordinates
                : [];
          for (const line of lines) {
            const positions = ringPositions(line);
            if (positions) addBorder(positions);
          }
        }
        _count = count;
        _syncVisibility?.();
        _lastUpdate = Date.now();
        _lastError = null;
        console.log(`[Data:Borders] Updated: ${_count} outlines`);
        return true;
      } catch (error) {
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        console.warn('[Data:Borders] Fetch error:', error);
        _lastError = error?.message || msg('Border source unavailable');
        return false;
      } finally {
        if (_request === request) _request = null;
      }
    },

    destroy(viewer = _viewer) {
      _request?.abort();
      _request = null;
      _viewer = null;
      _enabled = false;
      if (_syncVisibility) {
        window.removeEventListener('gev:map-stack-changed', _syncVisibility);
        _syncVisibility = null;
      }
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
        source: 'Natural Earth',
        coverage: 'national outlines',
      };
    },
  };
  return layer;
}

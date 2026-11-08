import * as Cesium from 'cesium';
import { t } from '../i18n/index.js';
import {
  clearOverlaySource,
  setOverlayEntries,
} from '../overlays/worldOverlay.js';

const OVERLAY_SOURCE = 'map-focus';

const FALLBACK_RADIUS_M = 45;

function ringPositions(ring, height = 0) {
  const flat = [];
  for (const point of ring || []) {
    const lon = Number(point?.[0]);
    const lat = Number(point?.[1]);
    if (Number.isFinite(lon) && Number.isFinite(lat))
      flat.push(lon, lat, height);
  }
  return flat.length >= 9
    ? Cesium.Cartesian3.fromDegreesArrayHeights(flat)
    : [];
}

/** Ellipsoidal ground height: terrain provider first, then the GEV terrain API. */
async function groundHeightAt(viewer, lon, lat) {
  try {
    const carto = new Cesium.Cartographic(
      Cesium.Math.toRadians(lon),
      Cesium.Math.toRadians(lat),
    );
    const height = viewer.scene.globe.getHeight(carto);
    if (Number.isFinite(height)) return height;
  } catch {
    /* The photoreal stack hides the globe; fall through to the API. */
  }
  try {
    const response = await fetch(
      `/api/terrain/heights?points=${encodeURIComponent(lon)},${encodeURIComponent(lat)}`,
      { cache: 'no-store', signal: AbortSignal.timeout(8_000) },
    );
    if (response.ok) {
      const body = await response.json();
      const value = Number(body?.results?.[0]?.ellipsoid);
      if (Number.isFinite(value)) return value;
    }
  } catch {
    /* fall back to the ellipsoid */
  }
  return 0;
}

/**
 * Fly to a published address and mark the official cadastral parcel around it.
 *
 * The parcel geometry comes from the public geodienste.ch AV WFS. Where the
 * cadastre has no parcel (or the canton does not publish it), a 45 m circle is
 * drawn instead and labelled as an estimate. Nothing here infers a private
 * residence; only published addresses and typed addresses are focused.
 */
export function installMapFocus(viewer, placeSearch) {
  const source = new Cesium.CustomDataSource('map-focus');
  viewer.dataSources.add(source);

  const notify = (ok, label, extra = {}) => {
    window.dispatchEvent(
      new CustomEvent('gev:map-focus-result', {
        detail: { ok, label: label || '', ...extra },
      }),
    );
  };

  const clear = () => {
    source.entities.removeAll();
    clearOverlaySource(OVERLAY_SOURCE);
  };

  const addCircleFallback = (targetLat, targetLon, groundHeight) => {
    const color = Cesium.Color.fromCssColorString('#7fd8e7');
    const latRadius = FALLBACK_RADIUS_M / 111_320;
    const lonRadius =
      FALLBACK_RADIUS_M / (111_320 * Math.cos((targetLat * Math.PI) / 180));
    const ring = [];
    for (let step = 0; step <= 64; step += 1) {
      const angle = (step / 64) * Math.PI * 2;
      ring.push(
        targetLon + Math.cos(angle) * lonRadius,
        targetLat + Math.sin(angle) * latRadius,
        groundHeight,
      );
    }
    const positions = Cesium.Cartesian3.fromDegreesArrayHeights(ring);
    const center = Cesium.Cartesian3.fromDegrees(
      targetLon,
      targetLat,
      groundHeight,
    );
    source.entities.add({
      position: center,
      polyline: {
        positions,
        width: 2,
        material: color.withAlpha(0.85),
        depthFailMaterial: color.withAlpha(0.85),
      },
      point: {
        pixelSize: 8,
        color,
        outlineColor: Cesium.Color.fromCssColorString('#04141c'),
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
    setOverlayEntries(OVERLAY_SOURCE, [
      {
        id: 'estimate',
        position: () =>
          Cesium.Cartesian3.fromDegrees(
            targetLon,
            targetLat,
            groundHeight + 25,
          ),
        variant: 'label',
        title: t('Estimated area'),
        priority: 6,
      },
    ]);
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(
        targetLon,
        targetLat,
        groundHeight + 140,
      ),
      orientation: {
        heading: 0,
        pitch: Cesium.Math.toRadians(-55),
        roll: 0,
      },
      duration: 2.5,
    });
  };

  const addParcel = (parcel, groundHeight) => {
    const color = Cesium.Color.fromCssColorString('#7fd8e7');
    const polygons =
      parcel.geometry?.type === 'Polygon'
        ? [parcel.geometry.coordinates]
        : parcel.geometry?.type === 'MultiPolygon'
          ? parcel.geometry.coordinates
          : [];
    const all = [];
    for (const polygon of polygons) {
      const outer = ringPositions(polygon?.[0], groundHeight);
      if (!outer.length) continue;
      all.push(...outer);
      source.entities.add({
        polyline: {
          positions: outer,
          width: 2.5,
          material: color.withAlpha(0.9),
          depthFailMaterial: color.withAlpha(0.9),
        },
      });
      const holes = (polygon || [])
        .slice(1)
        .map((hole) => ringPositions(hole, groundHeight))
        .filter((hole) => hole.length)
        .map((hole) => new Cesium.PolygonHierarchy(hole));
      source.entities.add({
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy(outer, holes),
          material: color.withAlpha(0.12),
          height: groundHeight,
        },
      });
    }
    if (!all.length) return false;
    const sphere = Cesium.BoundingSphere.fromPoints(all);
    const carto = Cesium.Cartographic.fromCartesian(sphere.center);
    const labelPosition = Cesium.Cartesian3.fromRadians(
      carto.longitude,
      carto.latitude,
      groundHeight + 25,
    );
    source.entities.add({
      position: labelPosition,
      point: {
        pixelSize: 8,
        color,
        outlineColor: Cesium.Color.fromCssColorString('#04141c'),
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
    setOverlayEntries(OVERLAY_SOURCE, [
      {
        id: 'parcel',
        position: labelPosition,
        variant: 'label',
        title: [
          parcel.number ? `#${parcel.number}` : '',
          parcel.area ? `${parcel.area} m²` : '',
          parcel.canton || '',
          'AV',
        ]
          .filter(Boolean)
          .join(' · '),
        priority: 6,
      },
    ]);
    viewer.camera.flyToBoundingSphere(sphere, {
      // 260 m of stand-off, not 90: the ground guard re-aims any arrival whose
      // eye sits under 120 m of clearance, and a tight approach on a valley
      // floor reads as buried once the coarse terrain cell is sampled. The
      // margin keeps the parcel framed instead of lifted a kilometre up.
      offset: new Cesium.HeadingPitchRange(
        0,
        Cesium.Math.toRadians(-55),
        Math.max(260, sphere.radius * 4.5),
      ),
      duration: 2.5,
    });
    return true;
  };

  const focus = async ({ address, lat, lon, label } = {}) => {
    let targetLat = Number(lat);
    let targetLon = Number(lon);
    let targetLabel = String(label || address || '').trim();
    if (
      (!Number.isFinite(targetLat) || !Number.isFinite(targetLon)) &&
      address
    ) {
      try {
        const { place } = await placeSearch.geocode(String(address).trim());
        if (!place) {
          notify(false, targetLabel);
          return;
        }
        targetLat = Number(place.lat);
        targetLon = Number(place.lng);
        targetLabel = String(place.label || targetLabel);
      } catch {
        notify(false, targetLabel);
        return;
      }
    }
    if (!Number.isFinite(targetLat) || !Number.isFinite(targetLon)) {
      notify(false, targetLabel);
      return;
    }

    const groundHeight = await groundHeightAt(viewer, targetLon, targetLat);
    clear();
    let parcel = null;
    try {
      const response = await fetch(
        `/api/parcel?lat=${encodeURIComponent(targetLat)}&lon=${encodeURIComponent(targetLon)}`,
        { cache: 'no-store', signal: AbortSignal.timeout(12_000) },
      );
      if (response.ok) {
        const body = await response.json();
        if (body?.found && body.geometry) parcel = body;
      }
    } catch {
      parcel = null;
    }
    if (parcel && addParcel(parcel, groundHeight)) {
      notify(true, targetLabel, {
        parcel: true,
        number: parcel.number,
        area: parcel.area,
        canton: parcel.canton,
      });
      return;
    }
    addCircleFallback(targetLat, targetLon, groundHeight);
    notify(true, targetLabel, { parcel: false });
  };

  const onFocus = (event) => {
    void focus(event.detail || {});
  };
  window.addEventListener('gev:map-focus', onFocus);
  return () => {
    window.removeEventListener('gev:map-focus', onFocus);
    viewer.dataSources.remove(source, true);
    clearOverlaySource(OVERLAY_SOURCE);
  };
}

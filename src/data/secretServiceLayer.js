/**
 * @module secretServiceLayer
 *
 * Dedicated data layer for Secret Service, Diplomatic Security & VIP Protective Details ('secret-service').
 * Visualizes Presidential Motorcade routes, VIP Temporary Flight Restrictions (TFR 3D airspaces),
 * counter-sniper rooftop positions, inner/outer security rings, and emergency trauma facilities.
 */

import * as Cesium from 'cesium';
import { SEED_SECRET_SERVICE_OPS } from './specialOpsEngine.js';

let _viewer = null;
let _enabled = false;
let _entities = [];
let _records = [...SEED_SECRET_SERVICE_OPS];
let _lastUpdate = null;
const _listeners = new Set();

function emit(event, data) {
  for (const fn of _listeners) {
    try { fn(event, data); } catch { /* best effort */ }
  }
}

function clearEntities() {
  if (!_viewer) return;
  for (const ent of _entities) {
    _viewer.entities.remove(ent);
  }
  _entities = [];
}

function renderSecretService() {
  clearEntities();
  if (!_viewer || !_enabled) return;

  for (const op of _records) {
    const goldColor = Cesium.Color.fromCssColorString('#ffb300');
    const redColor = Cesium.Color.fromCssColorString('#e53935');
    const tfrInnerColor = new Cesium.Color(0.9, 0.1, 0.1, 0.18);
    const tfrOuterColor = new Cesium.Color(1.0, 0.6, 0.0, 0.08);

    const baseIntel = {
      ...op,
      category: 'secret-service',
      title: `${op.operation} (${op.protectee})`,
      location: { lat: op.tfr?.center?.lat || 30.2672, lon: op.tfr?.center?.lon || -97.7431 },
      target: { name: op.city, lat: op.tfr?.center?.lat || 30.2672, lon: op.tfr?.center?.lon || -97.7431 },
      summary: `USSS Schutzoperation: ${op.operation}. Schutzperson: ${op.protectee}. Schauplatz: ${op.city}. Sicherheitsstufe: ${op.securityLevel}. Motorcade: ${op.motorcade?.callsign}. Status: ${op.status}.`,
    };

    // 1. VIP Temporary Flight Restriction (TFR) 3D Cylindrical Airspace
    if (op.tfr) {
      const tfrCenter = Cesium.Cartesian3.fromDegrees(
        op.tfr.center.lon,
        op.tfr.center.lat,
        (op.tfr.maxAltitudeM || 5000) / 2,
      );

      // Inner Core Cylinder (Surface to FL180)
      const tfrInnerEntity = _viewer.entities.add({
        id: `usss-tfr-inner-${op.id}`,
        name: `${op.tfr.name} [Inner Core]`,
        position: tfrCenter,
        cylinder: {
          length: op.tfr.maxAltitudeM || 5000,
          topRadius: op.tfr.innerRadiusM,
          bottomRadius: op.tfr.innerRadiusM,
          material: tfrInnerColor,
          outline: true,
          outlineColor: redColor,
          outlineWidth: 2,
        },
        description: `
          <div style="font-family: monospace; padding: 6px;">
            <h3 style="margin: 0 0 6px 0; color: #ff3333;">⛔ ${op.tfr.name}</h3>
            <p><strong>Status:</strong> NO-FLY ZONE // ACTIVE VIP PROTECTION</p>
            <p><strong>Innenradius:</strong> ${Math.round(op.tfr.innerRadiusM / 1852)} NM (${Math.round(op.tfr.innerRadiusM / 1000)} km)</p>
            <p><strong>Obergrenze:</strong> FL180 (${op.tfr.maxAltitudeM} m MSL)</p>
            <p><strong>Abfangbereitschaft:</strong> ${op.tfr.interceptReadiness}</p>
          </div>
        `,
      });
      tfrInnerEntity.__gevIntelRecord = baseIntel;
      _entities.push(tfrInnerEntity);

      // Outer Ring Ground Disc
      const tfrOuterDisc = _viewer.entities.add({
        id: `usss-tfr-outer-${op.id}`,
        name: `${op.tfr.name} [Outer Ring]`,
        position: Cesium.Cartesian3.fromDegrees(op.tfr.center.lon, op.tfr.center.lat, 0),
        ellipse: {
          semiMajorAxis: op.tfr.outerRadiusM,
          semiMinorAxis: op.tfr.outerRadiusM,
          material: tfrOuterColor,
          classificationType: Cesium.ClassificationType.BOTH,
        },
      });
      tfrOuterDisc.__gevIntelRecord = baseIntel;
      _entities.push(tfrOuterDisc);
    }

    // 2. Presidential Motorcade Routes
    if (op.motorcade) {
      // Primary Route (Gold glowing polyline)
      const primaryPositions = op.motorcade.primaryRoute.map(([lon, lat]) =>
        Cesium.Cartesian3.fromDegrees(lon, lat),
      );
      const primaryEntity = _viewer.entities.add({
        id: `usss-motorcade-pri-${op.id}`,
        name: `Motorcade Primary Route — ${op.motorcade.callsign}`,
        polyline: {
          positions: primaryPositions,
          width: 5.5,
          material: new Cesium.PolylineGlowMaterialProperty({
            glowPower: 0.35,
            color: goldColor,
          }),
          clampToGround: true,
        },
        description: `
          <div style="font-family: monospace; padding: 6px;">
            <h3 style="margin: 0 0 6px 0; color: #ffb300;">🕶️ ${op.motorcade.callsign}</h3>
            <p><strong>Schutzperson:</strong> ${op.protectee}</p>
            <p><strong>Operation:</strong> ${op.operation}</p>
            <p><strong>Fahrzeuganzahl:</strong> ${op.motorcade.vehicleCount} (Beast, CAT, Jammer, Roadrunner)</p>
            <p><strong>Kolonnentempo:</strong> ~${op.motorcade.speedKmh} km/h</p>
            <p><strong>Status:</strong> ${op.status}</p>
          </div>
        `,
      });
      primaryEntity.__gevIntelRecord = baseIntel;
      _entities.push(primaryEntity);

      // Alternate Route (Cyan dashed/glow polyline)
      if (op.motorcade.alternateRoute) {
        const altPositions = op.motorcade.alternateRoute.map(([lon, lat]) =>
          Cesium.Cartesian3.fromDegrees(lon, lat),
        );
        const altEntity = _viewer.entities.add({
          id: `usss-motorcade-alt-${op.id}`,
          name: `Motorcade Alternate Route — ${op.operation}`,
          polyline: {
            positions: altPositions,
            width: 3.5,
            material: new Cesium.PolylineDashMaterialProperty({
              color: Cesium.Color.fromCssColorString('#00e5ff'),
              dashLength: 16.0,
            }),
            clampToGround: true,
          },
        });
        altEntity.__gevIntelRecord = baseIntel;
        _entities.push(altEntity);
      }
    }

    // 3. Inner Security Perimeter
    if (op.perimeters?.inner) {
      const innerCoords = op.perimeters.inner.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat));
      const innerPoly = _viewer.entities.add({
        id: `usss-inner-perim-${op.id}`,
        name: `Inner Security Perimeter — ${op.city}`,
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy(innerCoords),
          material: new Cesium.Color(1.0, 0.1, 0.1, 0.25),
          classificationType: Cesium.ClassificationType.BOTH,
        },
        polyline: {
          positions: [...innerCoords, innerCoords[0]],
          width: 2.5,
          material: redColor,
          clampToGround: true,
        },
      });
      innerPoly.__gevIntelRecord = baseIntel;
      _entities.push(innerPoly);
    }

    // 4. Counter-Sniper (CS) Positions
    if (Array.isArray(op.counterSnipers)) {
      for (let s = 0; s < op.counterSnipers.length; s++) {
        const cs = op.counterSnipers[s];
        const csEntity = _viewer.entities.add({
          id: `usss-cs-${op.id}-${s}`,
          position: Cesium.Cartesian3.fromDegrees(cs.lon, cs.lat, (cs.elevationM || 0) + 15),
          point: {
            pixelSize: 8,
            color: Cesium.Color.BLACK,
            outlineColor: goldColor,
            outlineWidth: 2,
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 1000000),
          },
          label: {
            text: `🎯 ${cs.name}`,
            font: 'bold 10px monospace',
            fillColor: goldColor,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 3,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            pixelOffset: new Cesium.Cartesian2(0, -9),
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 35000),
          },
        });
        csEntity.__gevIntelRecord = {
          ...baseIntel,
          title: `${cs.name} (USSS Counter-Sniper)`,
          location: { lat: cs.lat, lon: cs.lon },
          target: { name: cs.name, lat: cs.lat, lon: cs.lon },
          summary: `Dach-Scharfschützenstellung: ${cs.name} in ${op.city}. Höhe: ${cs.elevationM}m MSL. Sichert den Nahperimeter für ${op.protectee}.`,
        };
        _entities.push(csEntity);
      }
    }

    // 5. Designated Level 1 Trauma Facility
    if (op.traumaHospital) {
      const hosp = op.traumaHospital;
      const hospEntity = _viewer.entities.add({
        id: `usss-hosp-${op.id}`,
        position: Cesium.Cartesian3.fromDegrees(hosp.lon, hosp.lat, 50),
        point: {
          pixelSize: 9,
          color: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.RED,
          outlineWidth: 2.5,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 2000000),
        },
        label: {
          text: `🏥 ${hosp.name}\n[${hosp.evacCorridorMinutes} Min. Notfallkorridor]`,
          font: 'bold 10px monospace',
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -10),
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 45000),
        },
      });
      hospEntity.__gevIntelRecord = {
        ...baseIntel,
        title: `${hosp.name} (Trauma-Klinik)`,
        location: { lat: hosp.lat, lon: hosp.lon },
        target: { name: hosp.name, lat: hosp.lat, lon: hosp.lon },
        summary: `Primäres Traumazentrum Level 1 für Evakuierungsfall. Distanz/Fahrzeit: ${hosp.evacCorridorMinutes} Min. Notfallkorridor ab Veranstaltungsort.`,
      };
      _entities.push(hospEntity);
    }
  }

  _lastUpdate = new Date().toISOString();
  emit('update', { count: _records.length, lastUpdate: _lastUpdate });
}

export const secretServiceLayer = {
  id: 'secret-service',
  name: 'Secret Service & VIP Detail',
  icon: '🕶️',
  source: 'USSS / DIPLOMATIC SECURITY',
  showInTogglePanel: true,

  init(viewer) {
    _viewer = viewer;
  },

  enable() {
    _enabled = true;
    renderSecretService();
    emit('enabled', true);
  },

  disable() {
    _enabled = false;
    clearEntities();
    emit('disabled', true);
  },

  isEnabled() {
    return _enabled;
  },

  update() {
    // Polling hook
  },

  destroy() {
    this.disable();
    _viewer = null;
    _listeners.clear();
  },

  getStats() {
    return {
      count: _records.length,
      lastUpdate: _lastUpdate,
      status: _enabled ? 'nominal' : 'idle',
      source: 'USSS / DIPLOMATIC SECURITY',
    };
  },

  getEntities() {
    return [..._entities];
  },

  getRecords() {
    return [..._records];
  },

  on(event, handler) {
    _listeners.add(handler);
  },

  off(event, handler) {
    _listeners.delete(handler);
  },

  addOperation(operation) {
    if (!operation || !operation.id) return;
    _records = [operation, ..._records.filter((o) => o.id !== operation.id)];
    if (_enabled) renderSecretService();
  },
};

export default secretServiceLayer;

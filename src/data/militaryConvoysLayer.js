/**
 * @module militaryConvoysLayer
 *
 * Dedicated data layer for Ground Military Convoys & Logistics Echelons ('military-convoys').
 * Visualizes heavy armor movements, ammunition supply lines, rail echelons,
 * checkpoint gates, and escort status.
 */

import * as Cesium from 'cesium';
import { SEED_MILITARY_CONVOYS } from './specialOpsEngine.js';

let _viewer = null;
let _enabled = false;
let _entities = [];
let _records = [...SEED_MILITARY_CONVOYS];
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

function renderMilitaryConvoys() {
  clearEntities();
  if (!_viewer || !_enabled) return;

  for (const cv of _records) {
    const routeColor = Cesium.Color.fromCssColorString('#00e676');
    const checkpointColor = Cesium.Color.fromCssColorString('#ffee55');

    // 1. Clamped Ground Route Corridor
    const positions = cv.route.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat));
    const lineEntity = _viewer.entities.add({
      id: `convoy-line-${cv.id}`,
      name: `${cv.name} [Transit Route]`,
      polyline: {
        positions,
        width: 5.0,
        material: new Cesium.PolylineGlowMaterialProperty({
          glowPower: 0.3,
          color: routeColor,
        }),
        clampToGround: true,
      },
      description: `
        <div style="font-family: monospace; padding: 6px;">
          <h3 style="margin: 0 0 6px 0; color: #00e676;">🚛 ${cv.name}</h3>
          <p><strong>Kriegsschauplatz / Korridor:</strong> ${cv.theater}</p>
          <p><strong>Typus:</strong> ${cv.type}</p>
          <p><strong>Fahrzeugstärke:</strong> ${cv.vehicleCount} Fahrzeuge</p>
          <p><strong>Kolonnen-Zusammensetzung:</strong> ${cv.composition}</p>
          <p><strong>Marschgeschwindigkeit:</strong> ~${cv.speedKmh} km/h</p>
          <p><strong>Eskorte & Begleitschutz:</strong> ${cv.escortLevel}</p>
          <p><strong>Ladung:</strong> ${cv.cargo}</p>
          <p><strong>Status:</strong> ${cv.status}</p>
        </div>
      `,
    });
    const leadCoord = cv.route[Math.floor(cv.route.length / 2)] || cv.route[0];
    const intelRecord = {
      ...cv,
      category: 'military-convoys',
      title: `${cv.name} (${cv.vehicleCount} FZG)`,
      location: { lat: leadCoord[1], lon: leadCoord[0] },
      target: { name: cv.theater, lat: leadCoord[1], lon: leadCoord[0] },
      summary: `Militär-Konvoi & Logistikmarsch: ${cv.name}. Stärke: ${cv.vehicleCount} Einheiten (${cv.composition}). Marschtempo: ${cv.speedKmh} km/h. Ladung: ${cv.cargo}. Status: ${cv.status}.`,
    };

    lineEntity.__gevIntelRecord = intelRecord;
    _entities.push(lineEntity);

    // 2. Convoy Lead Head Position Marker
    const leadEntity = _viewer.entities.add({
      id: `convoy-lead-${cv.id}`,
      position: Cesium.Cartesian3.fromDegrees(leadCoord[0], leadCoord[1], 120),
      point: {
        pixelSize: 12,
        color: routeColor,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 15000000),
      },
      label: {
        text: `🚛 ${cv.name}\n[${cv.vehicleCount} FZG · ${cv.speedKmh} km/h]`,
        font: 'bold 11px monospace',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -12),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 180000),
      },
    });
    leadEntity.__gevIntelRecord = intelRecord;
    _entities.push(leadEntity);

    // 3. Checkpoints & Gates
    for (let i = 0; i < cv.checkpoints.length; i++) {
      const cp = cv.checkpoints[i];
      const cpEntity = _viewer.entities.add({
        id: `convoy-cp-${cv.id}-${i}`,
        position: Cesium.Cartesian3.fromDegrees(cp.lon, cp.lat, 80),
        point: {
          pixelSize: 8,
          color: checkpointColor,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 1.5,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 3000000),
        },
        label: {
          text: `🚩 ${cp.name} [${cp.status}]`,
          font: 'bold 10px monospace',
          fillColor: Cesium.Color.fromCssColorString('#ffeeaa'),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -9),
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 150000),
        },
      });
      cpEntity.__gevIntelRecord = {
        ...cv,
        category: 'military-convoys',
        title: `${cv.name} — Kontrollpunkt ${cp.name}`,
        location: { lat: cp.lat, lon: cp.lon },
        target: { name: cp.name, lat: cp.lat, lon: cp.lon },
        summary: `Sicherheits- und Versorgungskontrollpunkt: ${cp.name}. Konvoi: ${cv.name}. Status: ${cp.status}.`,
      };
      _entities.push(cpEntity);
    }
  }

  _lastUpdate = new Date().toISOString();
  emit('update', { count: _records.length, lastUpdate: _lastUpdate });
}

export const militaryConvoysLayer = {
  id: 'military-convoys',
  name: 'Military Convoys',
  icon: '🚛',
  source: 'MILITARY LOGISTICS / OSINT',
  showInTogglePanel: true,

  init(viewer) {
    _viewer = viewer;
  },

  enable() {
    _enabled = true;
    renderMilitaryConvoys();
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
      source: 'MILITARY LOGISTICS / OSINT',
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

  addConvoy(convoy) {
    if (!convoy || !convoy.id) return;
    _records = [convoy, ..._records.filter((c) => c.id !== convoy.id)];
    if (_enabled) renderMilitaryConvoys();
  },
};

export default militaryConvoysLayer;

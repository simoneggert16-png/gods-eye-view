/**
 * @module terrorAttacksLayer
 *
 * Dedicated data layer for Terror Attacks & Mass Casualty Events ('terror-attacks').
 * Visualizes suicide bombings, mass shootings, vehicle ramming attacks,
 * and other acts of terrorism worldwide.
 */

import * as Cesium from 'cesium';
import { SEED_TERROR_ATTACKS } from './droneAttacksEngine.js';

let _viewer = null;
let _enabled = false;
let _entities = [];
let _records = [...SEED_TERROR_ATTACKS];
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

function getTerrorSeverityColor(severity, alpha) {
  if (severity >= 8) return new Cesium.Color(0.75, 0.22, 0.17, alpha);
  if (severity >= 5) return new Cesium.Color(0.83, 0.33, 0.0, alpha);
  return new Cesium.Color(0.95, 0.77, 0.06, alpha);
}

function renderTerrorAttacks() {
  clearEntities();
  if (!_viewer || !_enabled) return;

  for (const ta of _records) {
    const lat = ta.location.lat;
    const lon = ta.location.lon;
    const radius = ta.impactRadiusM || 1500;
    const innerRadius = radius * 0.4;
    const severity = ta.severity || 5;

    const intelRecord = { ...ta, category: 'terror-attacks' };

    const descHtml = `
<div style="font-family: monospace; padding: 6px;">
  <h3 style="margin: 0 0 6px 0; color: #c0392b;">☠️ ${ta.title}</h3>
  <p><strong>Angriffstyp:</strong> ${ta.type}</p>
  <p><strong>Tätergruppe:</strong> ${ta.perpetrator}</p>
  <p><strong>Schauplatz:</strong> ${ta.theater}</p>
  <p><strong>Tatort:</strong> ${ta.location.name}</p>
  <p><strong>Tatwaffe:</strong> ${ta.weaponUsed}</p>
  <p><strong>Opferbilanz:</strong> ${ta.casualties.killed} Tote, ${ta.casualties.wounded} Verletzte</p>
  <p><strong>Status:</strong> ${ta.status}</p>
  <p><strong>Zeitpunkt:</strong> ${ta.timestamp}</p>
  <p><strong>Lagebericht:</strong> ${ta.summary}</p>
</div>`;

    // 1. Danger Zone Disc
    const outerEntity = _viewer.entities.add({
      id: `terror-disc-${ta.id}`,
      name: ta.title,
      position: Cesium.Cartesian3.fromDegrees(lon, lat, 0),
      ellipse: {
        semiMajorAxis: radius,
        semiMinorAxis: radius,
        material: getTerrorSeverityColor(severity, 0.35),
        classificationType: Cesium.ClassificationType.BOTH,
      },
      description: descHtml,
    });
    outerEntity.__gevIntelRecord = intelRecord;
    _entities.push(outerEntity);

    // 2. Inner Shockwave Ring
    const innerEntity = _viewer.entities.add({
      id: `terror-inner-${ta.id}`,
      position: Cesium.Cartesian3.fromDegrees(lon, lat, 0),
      ellipse: {
        semiMajorAxis: innerRadius,
        semiMinorAxis: innerRadius,
        material: new Cesium.Color(0.95, 0.77, 0.06, 0.30),
        classificationType: Cesium.ClassificationType.BOTH,
      },
    });
    innerEntity.__gevIntelRecord = intelRecord;
    _entities.push(innerEntity);

    // 3. Attack Point Marker & Label
    const markerEntity = _viewer.entities.add({
      id: `terror-marker-${ta.id}`,
      name: ta.title,
      position: Cesium.Cartesian3.fromDegrees(lon, lat, 200),
      point: {
        pixelSize: 10,
        color: Cesium.Color.fromCssColorString('#c0392b'),
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 10000000),
      },
      label: {
        text: `☠️ ${ta.title}\n[${ta.type}] · ${ta.casualties.killed} Tote`,
        font: 'bold 11px monospace',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -12),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 180000),
      },
      description: descHtml,
    });
    markerEntity.__gevIntelRecord = intelRecord;
    _entities.push(markerEntity);
  }

  _lastUpdate = new Date().toISOString();
  emit('update', { count: _records.length, lastUpdate: _lastUpdate });
}

export const terrorAttacksLayer = {
  id: 'terror-attacks',
  name: 'Terror Attacks',
  icon: '☠️',
  source: 'COUNTER-TERRORISM INTEL',
  showInTogglePanel: true,

  init(viewer) {
    _viewer = viewer;
  },

  enable() {
    _enabled = true;
    renderTerrorAttacks();
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
      source: 'COUNTER-TERRORISM INTEL',
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

  addTerrorAttack(attack) {
    if (!attack || !attack.id) return;
    _records = [attack, ..._records.filter((t) => t.id !== attack.id)];
    if (_enabled) renderTerrorAttacks();
  },
};

export default terrorAttacksLayer;

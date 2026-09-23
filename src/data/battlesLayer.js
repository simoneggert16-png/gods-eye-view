/**
 * @module battlesLayer
 *
 * Dedicated data layer for Ground Battles & Tactical Clashes ('battles').
 * Visualizes active infantry assaults, urban battles, armor engagements,
 * and high-intensity ground combat zones.
 */

import * as Cesium from 'cesium';
import { SEED_BATTLES, getIntensityColor } from './militaryConflictEngine.js';

let _viewer = null;
let _enabled = false;
let _entities = [];
let _records = [...SEED_BATTLES];
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

function renderBattles() {
  clearEntities();
  if (!_viewer || !_enabled) return;

  for (const bt of _records) {
    const color = getIntensityColor(bt.intensity, 0.28);
    const strokeColor = getIntensityColor(bt.intensity, 0.95);
    const radiusM = bt.dangerRadiusM || 5000;

    const centerPos = Cesium.Cartesian3.fromDegrees(bt.location.lon, bt.location.lat, 0);

    // 1. Contested Engagement Ground Disc
    const discEntity = _viewer.entities.add({
      id: `bt-disc-${bt.id}`,
      name: bt.name,
      position: centerPos,
      ellipse: {
        semiMajorAxis: radiusM,
        semiMinorAxis: radiusM,
        material: color,
        classificationType: Cesium.ClassificationType.BOTH,
      },
      description: `
        <div style="font-family: monospace; padding: 6px;">
          <h3 style="margin: 0 0 6px 0; color: #ff5500;">💥 ${bt.name}</h3>
          <p><strong>Schauplatz:</strong> ${bt.theater}</p>
          <p><strong>Beteiligte Streitkräfte:</strong> ${bt.forces}</p>
          <p><strong>Gefechtstaktik:</strong> ${bt.tactics}</p>
          <p><strong>Lage & Status:</strong> ${bt.status}</p>
          <p><strong>Lageaufklärung:</strong> ${bt.summary}</p>
        </div>
      `,
    });
    const intelRecord = { ...bt, category: 'battles' };
    discEntity.__gevIntelRecord = intelRecord;
    _entities.push(discEntity);

    // 2. Battle Point Marker & Label
    const markerEntity = _viewer.entities.add({
      id: `bt-marker-${bt.id}`,
      position: Cesium.Cartesian3.fromDegrees(bt.location.lon, bt.location.lat, 180),
      point: {
        pixelSize: 9,
        color: strokeColor,
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 10000000),
      },
      label: {
        text: `💥 ${bt.name}\n[${bt.status}]`,
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
    markerEntity.__gevIntelRecord = intelRecord;
    _entities.push(markerEntity);
  }

  _lastUpdate = new Date().toISOString();
  emit('update', { count: _records.length, lastUpdate: _lastUpdate });
}

export const battlesLayer = {
  id: 'battles',
  name: 'Ground Battles',
  icon: '💥',
  source: 'TACTICAL BATTLE INTEL / OSINT',
  showInTogglePanel: true,

  init(viewer) {
    _viewer = viewer;
  },

  enable() {
    _enabled = true;
    renderBattles();
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
      source: 'TACTICAL BATTLE INTEL / OSINT',
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

  addBattle(battle) {
    if (!battle || !battle.id) return;
    _records = [battle, ..._records.filter((b) => b.id !== battle.id)];
    if (_enabled) renderBattles();
  },
};

export default battlesLayer;

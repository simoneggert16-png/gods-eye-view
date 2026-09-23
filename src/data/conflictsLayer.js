/**
 * @module conflictsLayer
 *
 * Dedicated data layer for Active Conflict Zones ('conflicts').
 * Visualizes global armed conflict operational sectors, crisis polygons,
 * and high-tension zones with belligerents and tactical status.
 */

import * as Cesium from 'cesium';
import { SEED_CONFLICT_ZONES, getIntensityColor } from './militaryConflictEngine.js';

let _viewer = null;
let _enabled = false;
let _entities = [];
let _records = [...SEED_CONFLICT_ZONES];
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

function renderConflicts() {
  clearEntities();
  if (!_viewer || !_enabled) return;

  for (const cz of _records) {
    const color = getIntensityColor(cz.intensity, 0.22);
    const outlineColor = getIntensityColor(cz.intensity, 0.9);

    // Flat hierarchy array of Cartesian3 positions for polygon
    const positions = cz.polygon.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat));

    const polyEntity = _viewer.entities.add({
      id: `conflict-poly-${cz.id}`,
      name: cz.name,
      polygon: {
        hierarchy: new Cesium.PolygonHierarchy(positions),
        material: color,
        classificationType: Cesium.ClassificationType.BOTH,
      },
      polyline: {
        positions: [...positions, positions[0]],
        width: 2.5,
        material: outlineColor,
        clampToGround: true,
      },
      description: `
        <div style="font-family: monospace; padding: 6px;">
          <h3 style="margin: 0 0 6px 0; color: #ff4444;">⚔️ ${cz.name}</h3>
          <p><strong>Region:</strong> ${cz.region}</p>
          <p><strong>Status:</strong> ${cz.status}</p>
          <p><strong>Konfliktparteien:</strong> ${cz.belligerents}</p>
          <p><strong>Lage:</strong> ${cz.summary}</p>
        </div>
      `,
    });
    const intelRecord = { ...cz, category: 'conflicts' };
    polyEntity.__gevIntelRecord = intelRecord;
    _entities.push(polyEntity);

    // Center Tactical Marker
    const markerEntity = _viewer.entities.add({
      id: `conflict-marker-${cz.id}`,
      position: Cesium.Cartesian3.fromDegrees(cz.center.lon, cz.center.lat, 200),
      point: {
        pixelSize: 10,
        color: outlineColor,
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 15000000),
      },
      label: {
        text: `⚔️ ${cz.name}\n[${cz.status}]`,
        font: 'bold 12px monospace',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -12),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 1800000),
      },
    });
    markerEntity.__gevIntelRecord = intelRecord;
    _entities.push(markerEntity);
  }

  _lastUpdate = new Date().toISOString();
  emit('update', { count: _records.length, lastUpdate: _lastUpdate });
}

export const conflictsLayer = {
  id: 'conflicts',
  name: 'Conflict Zones',
  icon: '⚔️',
  source: 'GLOBAL CONFLICT INTEL',
  showInTogglePanel: true,

  init(viewer) {
    _viewer = viewer;
  },

  enable() {
    _enabled = true;
    renderConflicts();
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
    // Polling or refresh hook
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
      source: 'GLOBAL CONFLICT INTEL',
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

  /** Allow adding live conflict sectors dynamically */
  addConflict(conflictData) {
    if (!conflictData || !conflictData.id) return;
    _records = [conflictData, ..._records.filter((r) => r.id !== conflictData.id)];
    if (_enabled) renderConflicts();
  },
};

export default conflictsLayer;

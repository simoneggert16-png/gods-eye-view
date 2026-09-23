/**
 * @module frontlinesLayer
 *
 * Dedicated data layer for Tactical Frontlines & Lines of Control ('frontlines').
 * Visualizes fortified contact lines, trench segments, and demarcation borders.
 */

import * as Cesium from 'cesium';
import { SEED_FRONTLINES } from './militaryConflictEngine.js';

let _viewer = null;
let _enabled = false;
let _entities = [];
let _records = [...SEED_FRONTLINES];
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

function renderFrontlines() {
  clearEntities();
  if (!_viewer || !_enabled) return;

  for (const fl of _records) {
    const mainColor = Cesium.Color.fromCssColorString(fl.color || '#ff2222');
    const glowColor = Cesium.Color.fromCssColorString(fl.glowColor || '#ff8800');

    for (let i = 0; i < fl.segments.length; i++) {
      const seg = fl.segments[i];
      const positions = seg.coords.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat));

      // 1. Glowing outer polyline corridor
      const lineEntity = _viewer.entities.add({
        id: `frontline-${fl.id}-seg-${i}`,
        name: `${fl.name} — ${seg.name}`,
        polyline: {
          positions,
          width: 4.5,
          material: new Cesium.PolylineGlowMaterialProperty({
            glowPower: 0.28,
            color: mainColor,
          }),
          clampToGround: true,
        },
        description: `
          <div style="font-family: monospace; padding: 6px;">
            <h3 style="margin: 0 0 6px 0; color: #ff3333;">⚡ ${fl.name}</h3>
            <p><strong>Frontabschnitt:</strong> ${seg.name}</p>
            <p><strong>Kriegsschauplatz:</strong> ${fl.theater}</p>
            <p><strong>Typus:</strong> ${fl.type}</p>
            <p><strong>Status:</strong> ${fl.status}</p>
          </div>
        `,
      });
      const midCoord = seg.coords[Math.floor(seg.coords.length / 2)] || seg.coords[0];
      const intelRecord = {
        id: `${fl.id}-seg-${i}`,
        category: 'frontlines',
        title: `${fl.name} — ${seg.name}`,
        theater: fl.theater,
        status: fl.status,
        forces: fl.belligerents || 'Ukrainische Streitkräfte / Russische Streitkräfte',
        summary: `Taktischer Frontlinien-Abschnitt (${seg.name}) im Operationsgebiet ${fl.theater}. Befestigte Stellungen, Schützengräben und Drohnen-Überwachungssektoren.`,
        source: 'DEEPSTATE / ISW / TACTICAL',
        timestamp: _lastUpdate || new Date().toISOString(),
        location: { lat: midCoord[1], lon: midCoord[0] },
        target: { name: seg.name, lat: midCoord[1], lon: midCoord[0] },
      };

      lineEntity.__gevIntelRecord = intelRecord;
      _entities.push(lineEntity);

      // 2. Sector Midpoint Tag
      if (midCoord) {
        const tagEntity = _viewer.entities.add({
          id: `frontline-tag-${fl.id}-seg-${i}`,
          position: Cesium.Cartesian3.fromDegrees(midCoord[0], midCoord[1], 150),
          point: {
            pixelSize: 6,
            color: glowColor,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 1.5,
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 3000000),
          },
          label: {
            text: `⚡ ${seg.name}`,
            font: 'bold 11px monospace',
            fillColor: Cesium.Color.fromCssColorString('#ffddaa'),
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 3,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            pixelOffset: new Cesium.Cartesian2(0, -10),
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 180000),
          },
        });
        tagEntity.__gevIntelRecord = intelRecord;
        _entities.push(tagEntity);
      }
    }
  }

  _lastUpdate = new Date().toISOString();
  emit('update', { count: _records.reduce((acc, f) => acc + f.segments.length, 0), lastUpdate: _lastUpdate });
}

export const frontlinesLayer = {
  id: 'frontlines',
  name: 'Frontlines',
  icon: '⚡',
  source: 'DEEPSTATE / ISW / TACTICAL VECTORS',
  showInTogglePanel: true,

  init(viewer) {
    _viewer = viewer;
  },

  enable() {
    _enabled = true;
    renderFrontlines();
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
    // Refresh hook
  },

  destroy() {
    this.disable();
    _viewer = null;
    _listeners.clear();
  },

  getStats() {
    const totalSegments = _records.reduce((acc, f) => acc + f.segments.length, 0);
    return {
      count: totalSegments,
      lastUpdate: _lastUpdate,
      status: _enabled ? 'nominal' : 'idle',
      source: 'DEEPSTATE / ISW / TACTICAL',
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

  addFrontlineSegment(frontlineId, segment) {
    const fl = _records.find((r) => r.id === frontlineId);
    if (fl && segment?.coords) {
      fl.segments.push(segment);
      if (_enabled) renderFrontlines();
    }
  },
};

export default frontlinesLayer;

/**
 * @module missileTestsLayer
 *
 * Dedicated data layer for ICBM, SLBM & Hypersonic Missile Tests ('missile-tests').
 * Visualizes test launch sites, parabolic ballistic arcs, NOTAM exclusion hazard zones,
 * and target splashdown atolls.
 */

import * as Cesium from 'cesium';
import { SEED_MISSILE_TESTS, computeTrajectoryArc } from './specialOpsEngine.js';

let _viewer = null;
let _enabled = false;
let _entities = [];
let _records = [...SEED_MISSILE_TESTS];
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

function renderMissileTests() {
  clearEntities();
  if (!_viewer || !_enabled) return;

  for (const mt of _records) {
    const mainColor = Cesium.Color.fromCssColorString(mt.trajectoryColor || '#00e5ff');
    const hazardColor = mainColor.withAlpha(0.22);
    const apogeeM = (mt.apogeeKm || 1000) * 1000;

    // 1. 3D Parabolic Trajectory Arc
    const arcPoints = computeTrajectoryArc(
      mt.launchSite.lon,
      mt.launchSite.lat,
      mt.targetSite.lon,
      mt.targetSite.lat,
      apogeeM,
      40,
    );
    const arcPositions = arcPoints.map((p) => Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.alt));

    const arcEntity = _viewer.entities.add({
      id: `mtest-arc-${mt.id}`,
      name: `${mt.name} [Trajectory]`,
      polyline: {
        positions: arcPositions,
        width: 3.5,
        material: new Cesium.PolylineGlowMaterialProperty({
          glowPower: 0.35,
          color: mainColor,
        }),
      },
      description: `
        <div style="font-family: monospace; padding: 6px;">
          <h3 style="margin: 0 0 6px 0; color: #00e5ff;">🧪 ${mt.name}</h3>
          <p><strong>Typus:</strong> ${mt.type}</p>
          <p><strong>Waffensystem:</strong> ${mt.missileType}</p>
          <p><strong>Betreiber:</strong> ${mt.operator}</p>
          <p><strong>Gipfelhöhe (Apogäum):</strong> ${mt.apogeeKm} km</p>
          <p><strong>Startgelände:</strong> ${mt.launchSite.name}</p>
          <p><strong>Zielgebiet:</strong> ${mt.targetSite.name}</p>
          <p><strong>Status:</strong> ${mt.status}</p>
          <p><strong>Telemetrie:</strong> ${mt.telemetry}</p>
          <p><strong>Datum:</strong> ${mt.date}</p>
        </div>
      `,
    });
    const intelRecord = {
      ...mt,
      category: 'missile-tests',
      title: `${mt.name} (${mt.missileType})`,
      location: { lat: mt.launchSite.lat, lon: mt.launchSite.lon },
      target: { name: mt.targetSite.name, lat: mt.targetSite.lat, lon: mt.targetSite.lon },
      summary: `Strategischer Testflug: ${mt.name}. Typ: ${mt.missileType}. Start: ${mt.launchSite.name} ➔ Ziel: ${mt.targetSite.name}. Apogäum: ${mt.apogeeKm} km. Status: ${mt.status}.`,
    };

    arcEntity.__gevIntelRecord = intelRecord;
    _entities.push(arcEntity);

    // 2. Launch Site Marker
    const launchEntity = _viewer.entities.add({
      id: `mtest-launch-${mt.id}`,
      position: Cesium.Cartesian3.fromDegrees(mt.launchSite.lon, mt.launchSite.lat, 100),
      point: {
        pixelSize: 9,
        color: mainColor,
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 15000000),
      },
      label: {
        text: `🚀 LAUNCH: ${mt.launchSite.name}\n[${mt.missileType}]`,
        font: 'bold 11px monospace',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -10),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 1500000),
      },
    });
    launchEntity.__gevIntelRecord = intelRecord;
    _entities.push(launchEntity);

    // 3. Target Splashdown Marker
    const targetEntity = _viewer.entities.add({
      id: `mtest-target-${mt.id}`,
      position: Cesium.Cartesian3.fromDegrees(mt.targetSite.lon, mt.targetSite.lat, 100),
      point: {
        pixelSize: 10,
        color: Cesium.Color.RED,
        outlineColor: mainColor,
        outlineWidth: 2,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 15000000),
      },
      label: {
        text: `🎯 IMPACT ZONE: ${mt.targetSite.name}`,
        font: 'bold 11px monospace',
        fillColor: Cesium.Color.fromCssColorString('#ff7777'),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -10),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 1500000),
      },
    });
    targetEntity.__gevIntelRecord = intelRecord;
    _entities.push(targetEntity);

    // 4. NOTAM Exclusion Hazard Box
    if (mt.notamHazardBox && mt.notamHazardBox.length >= 3) {
      const hazardPositions = mt.notamHazardBox.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat));
      const notamPoly = _viewer.entities.add({
        id: `mtest-notam-${mt.id}`,
        name: `NOTAM Hazard Zone — ${mt.name}`,
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy(hazardPositions),
          material: hazardColor,
          classificationType: Cesium.ClassificationType.BOTH,
        },
        polyline: {
          positions: [...hazardPositions, hazardPositions[0]],
          width: 2,
          material: mainColor,
          clampToGround: true,
        },
        description: `
          <div style="font-family: monospace; padding: 6px;">
            <h4 style="margin: 0 0 4px 0; color: #ffaa00;">⚠️ NOTAM AIRSPACE HAZARD CLOSURE</h4>
            <p><strong>Operation:</strong> ${mt.name}</p>
            <p><strong>Sperrgrund:</strong> Raketentest / Trümmerabwurffeld</p>
          </div>
        `,
      });
      notamPoly.__gevIntelRecord = intelRecord;
      _entities.push(notamPoly);
    }
  }

  _lastUpdate = new Date().toISOString();
  emit('update', { count: _records.length, lastUpdate: _lastUpdate });
}

export const missileTestsLayer = {
  id: 'missile-tests',
  name: 'Missile & Weapons Tests',
  icon: '🧪',
  source: 'DEFENSE TEST MONITOR / NOTAM',
  showInTogglePanel: true,

  init(viewer) {
    _viewer = viewer;
  },

  enable() {
    _enabled = true;
    renderMissileTests();
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
      source: 'DEFENSE TEST MONITOR / NOTAM',
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

  addTest(testData) {
    if (!testData || !testData.id) return;
    _records = [testData, ..._records.filter((t) => t.id !== testData.id)];
    if (_enabled) renderMissileTests();
  },
};

export default missileTestsLayer;

/**
 * @module missileStrikesLayer
 *
 * Dedicated data layer for Missile & Drone Strikes ('missile-strikes').
 * Visualizes ballistic missile trajectories, cruise missile paths,
 * drone swarm impact points, and air-defense interception zones.
 */

import * as Cesium from 'cesium';
import { SEED_MISSILE_STRIKES, getIntensityColor } from './militaryConflictEngine.js';

let _viewer = null;
let _enabled = false;
let _entities = [];
let _records = [...SEED_MISSILE_STRIKES];
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

/**
 * Generate a 3D parabolic trajectory arc between two points.
 */
function createTrajectoryArc(origin, target, apexAltitudeM = 180000, steps = 32) {
  const positions = [];
  const startCarto = Cesium.Cartographic.fromDegrees(origin.lon, origin.lat, 0);
  const endCarto = Cesium.Cartographic.fromDegrees(target.lon, target.lat, 0);

  for (let i = 0; i <= steps; i++) {
    const frac = i / steps;
    const lat = Cesium.Math.lerp(startCarto.latitude, endCarto.latitude, frac);
    const lon = Cesium.Math.lerp(startCarto.longitude, endCarto.longitude, frac);
    // Parabolic arc height formula: 4 * h * frac * (1 - frac)
    const height = 4 * apexAltitudeM * frac * (1 - frac);
    positions.push(Cesium.Cartesian3.fromRadians(lon, lat, height));
  }
  return positions;
}

function renderMissileStrikes() {
  clearEntities();
  if (!_viewer || !_enabled) return;

  for (const ms of _records) {
    const isIntercepted = Boolean(ms.interceptionReported);
    const strokeColor = isIntercepted
      ? Cesium.Color.fromCssColorString('#00d4ff')
      : Cesium.Color.fromCssColorString('#ff2200');
    const blastColor = isIntercepted
      ? new Cesium.Color(0.0, 0.8, 1.0, 0.25)
      : new Cesium.Color(1.0, 0.2, 0.0, 0.35);

    const intelRecord = { ...ms, category: 'missile-strikes' };

    // 1. Trajectory Arc in 3D
    if (ms.launchOrigin && ms.target) {
      const arcPositions = createTrajectoryArc(
        ms.launchOrigin,
        ms.target,
        ms.weaponType.includes('Hyperschall') || ms.weaponType.includes('Ballist') ? 220000 : 45000
      );
      const arcEntity = _viewer.entities.add({
        id: `ms-arc-${ms.id}`,
        name: `Flugbahn: ${ms.weaponType}`,
        polyline: {
          positions: arcPositions,
          width: 3.0,
          material: new Cesium.PolylineGlowMaterialProperty({
            glowPower: 0.35,
            color: strokeColor,
          }),
        },
      });
      arcEntity.__gevIntelRecord = intelRecord;
      _entities.push(arcEntity);
    }

    // 2. Impact / Intercept Blast Cylinder / Circle on ground
    const targetPos = Cesium.Cartesian3.fromDegrees(ms.target.lon, ms.target.lat, 0);
    const blastEntity = _viewer.entities.add({
      id: `ms-blast-${ms.id}`,
      name: ms.title,
      position: targetPos,
      ellipse: {
        semiMajorAxis: ms.blastRadiusM || 2000,
        semiMinorAxis: ms.blastRadiusM || 2000,
        material: blastColor,
        outline: true,
        outlineColor: strokeColor,
        outlineWidth: 2,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
      description: `
        <div style="font-family: monospace; padding: 6px;">
          <h3 style="margin: 0 0 6px 0; color: #ff3300;">🚀 ${ms.title}</h3>
          <p><strong>Waffensystem:</strong> ${ms.weaponType}</p>
          <p><strong>Einsatzraum:</strong> ${ms.theater}</p>
          <p><strong>Startpunkt:</strong> ${ms.launchOrigin?.name || 'Unbekannt'}</p>
          <p><strong>Zielgebiet:</strong> ${ms.target.name}</p>
          <p><strong>Status:</strong> ${ms.status}</p>
          <p><strong>Zeitpunkt:</strong> ${ms.timestamp}</p>
          <p><strong>Lagebericht:</strong> ${ms.summary}</p>
        </div>
      `,
    });
    blastEntity.__gevIntelRecord = intelRecord;
    _entities.push(blastEntity);

    // 3. Impact Point Tag
    const tagEntity = _viewer.entities.add({
      id: `ms-tag-${ms.id}`,
      position: Cesium.Cartesian3.fromDegrees(ms.target.lon, ms.target.lat, 250),
      point: {
        pixelSize: 8,
        color: strokeColor,
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 10000000),
      },
      label: {
        text: `${isIntercepted ? '🛡️ ABFANG' : '🚀 EINSCHLAG'}\n${ms.weaponType}`,
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
    tagEntity.__gevIntelRecord = intelRecord;
    _entities.push(tagEntity);

    // 4. Granular Missile Impact Points & Craters (BDA)
    if (Array.isArray(ms.impactPoints)) {
      for (const ip of ms.impactPoints) {
        const craterDiameter = ip.craterDiameterM != null ? ip.craterDiameterM : (ip.craterRadiusM ? ip.craterRadiusM * 2 : 20);
        const craterRadius = craterDiameter > 0 ? Math.max(craterDiameter / 2, 4) : 8;
        const bdaStatus = ip.damageStatus || ip.bda || ip.status || 'VOLLE WIRKUNG';

        const craterIntel = {
          id: `crater-${ms.id}-${ip.id}`,
          parentId: ms.id,
          title: `💥 Einschlagskrater: ${ip.name}`,
          category: 'craters',
          parentCategory: 'missile-strikes',
          theater: ms.theater,
          target: { name: ip.name, lat: ip.lat, lon: ip.lon },
          ordnance: ip.ordnance || ms.weaponType,
          craterDiameterM: craterDiameter,
          status: bdaStatus,
          bda: bdaStatus,
          parentTitle: ms.title,
          timestamp: ms.timestamp,
          summary: `Punktgenauer Raketen-/Drohneneinschlag bei ${ip.lat.toFixed(5)}°N, ${ip.lon.toFixed(5)}°E (${ip.name}). Waffentyp: ${ip.ordnance || ms.weaponType}. Kraterdurchmesser: ${craterDiameter}m. BDA: ${bdaStatus}`,
          impactPoints: ms.impactPoints,
        };

        // Charred ground crater disc
        const craterDiscEntity = _viewer.entities.add({
          id: `crater-disc-${ms.id}-${ip.id}`,
          name: `Krater: ${ip.name}`,
          position: Cesium.Cartesian3.fromDegrees(ip.lon, ip.lat, 0),
          ellipse: {
            semiMajorAxis: craterRadius,
            semiMinorAxis: craterRadius,
            material: Cesium.Color.fromCssColorString('#140b07').withAlpha(0.85),
            outline: true,
            outlineColor: Cesium.Color.fromCssColorString('#ff3300').withAlpha(0.85),
            outlineWidth: 2,
            classificationType: Cesium.ClassificationType.BOTH,
          },
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 150000),
        });
        craterDiscEntity.__gevIntelRecord = craterIntel;
        _entities.push(craterDiscEntity);

        // Pinpoint Impact Marker & Target Label
        const craterHitEntity = _viewer.entities.add({
          id: `crater-hit-${ms.id}-${ip.id}`,
          name: `Einschlag: ${ip.name}`,
          position: Cesium.Cartesian3.fromDegrees(ip.lon, ip.lat, 15),
          point: {
            pixelSize: 7,
            color: Cesium.Color.fromCssColorString('#ff3300'),
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 1.5,
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 75000),
          },
          label: {
            text: `💥 EINSCHLAG: ${ip.name}\nØ ${craterDiameter}m | [${bdaStatus}]`,
            font: 'bold 10px monospace',
            fillColor: Cesium.Color.fromCssColorString('#fff3eb'),
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 3,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            pixelOffset: new Cesium.Cartesian2(0, -10),
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 35000),
          },
        });
        craterHitEntity.__gevIntelRecord = craterIntel;
        _entities.push(craterHitEntity);
      }
    }
  }

  _lastUpdate = new Date().toISOString();
  emit('update', { count: _records.length, lastUpdate: _lastUpdate });
}

export const missileStrikesLayer = {
  id: 'missile-strikes',
  name: 'Missile Strikes',
  icon: '🚀',
  source: 'TACTICAL AIR DEFENSE & OSINT',
  showInTogglePanel: true,

  init(viewer) {
    _viewer = viewer;
  },

  enable() {
    _enabled = true;
    renderMissileStrikes();
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
      source: 'AIR DEFENSE / OSINT',
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

  addStrike(strike) {
    if (!strike || !strike.id) return;
    _records = [strike, ..._records.filter((s) => s.id !== strike.id)];
    if (_enabled) renderMissileStrikes();
  },
};

export default missileStrikesLayer;

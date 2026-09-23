/**
 * @module droneAttacksLayer
 *
 * Dedicated data layer for Drone Attacks & UAV Strikes ('drone-attacks').
 * Visualizes kamikaze drone swarms (Shahed-136, Lancet), reconnaissance drone strikes,
 * loitering munitions, and naval drone attacks.
 */

import * as Cesium from 'cesium';
import { SEED_DRONE_ATTACKS } from './droneAttacksEngine.js';

let _viewer = null;
let _enabled = false;
let _entities = [];
let _records = [...SEED_DRONE_ATTACKS];
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

function getDroneSeverityColor(severity, alpha) {
  if (severity >= 7) return new Cesium.Color(0.91, 0.30, 0.24, alpha);
  if (severity >= 4) return new Cesium.Color(0.90, 0.49, 0.13, alpha);
  return new Cesium.Color(0.61, 0.35, 0.71, alpha);
}

function renderDroneAttacks() {
  clearEntities();
  if (!_viewer || !_enabled) return;

  for (const da of _records) {
    const descHtml = `
<div style="font-family: monospace; padding: 6px;">
  <h3 style="margin: 0 0 6px 0; color: #9b59b6;">🛩️ ${da.title}</h3>
  <p><strong>Drohnentyp:</strong> ${da.droneType}</p>
  <p><strong>Schwarmgröße:</strong> ${da.swarmSize} Einheiten</p>
  <p><strong>Betreiber:</strong> ${da.operator}</p>
  <p><strong>Schauplatz:</strong> ${da.theater}</p>
  <p><strong>Ziel:</strong> ${da.target.name}</p>
  <p><strong>Startort:</strong> ${da.launchOrigin.name}</p>
  <p><strong>Waffensystem:</strong> ${da.weaponSystem}</p>
  <p><strong>Status:</strong> ${da.status}</p>
  <p><strong>Zeitpunkt:</strong> ${da.timestamp}</p>
  <p><strong>Lageaufklärung:</strong> ${da.summary}</p>
</div>`;

    const intelRecord = { ...da, category: 'drone-attacks' };

    // 1. Flight Path Line (dashed purple polyline from launch to target)
    const pathEnt = _viewer.entities.add({
      id: `drone-path-${da.id}`,
      name: `Anflugvektor ${da.title}`,
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArrayHeights([
          da.launchOrigin.lon, da.launchOrigin.lat, 8000,
          da.target.lon, da.target.lat, 8000,
        ]),
        width: 3,
        material: new Cesium.PolylineDashMaterialProperty({
          color: Cesium.Color.fromCssColorString('#9b59b6'),
          dashLength: 16,
        }),
      },
      description: descHtml,
    });
    pathEnt.__gevIntelRecord = intelRecord;
    _entities.push(pathEnt);

    // 2. Target Impact Disc & Swarm Threat Envelope
    const severityAlpha = da.severity >= 7 ? 0.35 : da.severity >= 4 ? 0.30 : 0.25;
    const discColor = getDroneSeverityColor(da.severity, severityAlpha);
    const radiusM = Math.max(15000, da.impactRadiusM || ((da.swarmSize || 1) * 1500));

    const discEnt = _viewer.entities.add({
      id: `drone-disc-${da.id}`,
      name: da.title,
      position: Cesium.Cartesian3.fromDegrees(da.target.lon, da.target.lat, 0),
      ellipse: {
        semiMajorAxis: radiusM,
        semiMinorAxis: radiusM,
        material: discColor,
        outline: true,
        outlineColor: Cesium.Color.fromCssColorString('#9b59b6'),
        outlineWidth: 2,
        classificationType: Cesium.ClassificationType.BOTH,
      },
      description: descHtml,
    });
    discEnt.__gevIntelRecord = intelRecord;
    _entities.push(discEnt);

    // Outer perimeter detection ring
    const ringEnt = _viewer.entities.add({
      id: `drone-ring-${da.id}`,
      name: `${da.title} Detection Perimeter`,
      position: Cesium.Cartesian3.fromDegrees(da.target.lon, da.target.lat, 0),
      ellipse: {
        semiMajorAxis: radiusM * 1.3,
        semiMinorAxis: radiusM * 1.3,
        material: Cesium.Color.TRANSPARENT,
        outline: true,
        outlineColor: Cesium.Color.fromCssColorString('rgba(155, 89, 182, 0.45)'),
        outlineWidth: 2,
        classificationType: Cesium.ClassificationType.BOTH,
      },
    });
    _entities.push(ringEnt);

    // 3. Drone Icon Marker & Label
    const markerEnt = _viewer.entities.add({
      id: `drone-marker-${da.id}`,
      name: da.title,
      position: Cesium.Cartesian3.fromDegrees(da.target.lon, da.target.lat, 300),
      point: {
        pixelSize: 12,
        color: Cesium.Color.fromCssColorString('#9b59b6'),
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 10000000),
      },
      label: {
        text: `🛩️ ${da.title}\n[${da.droneType} × ${da.swarmSize}]`,
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
    markerEnt.__gevIntelRecord = intelRecord;
    _entities.push(markerEnt);

    // 4. Pinpoint Impact Points & Charred Craters (BDA granularity)
    if (Array.isArray(da.impactPoints)) {
      for (const ip of da.impactPoints) {
        const craterDiameter = ip.craterDiameterM != null ? ip.craterDiameterM : (ip.craterRadiusM ? ip.craterRadiusM * 2 : 12);
        const craterRadius = craterDiameter > 0 ? Math.max(craterDiameter / 2, 4) : 6;
        const bdaStatus = ip.damageStatus || ip.bda || ip.status || 'VOLLE WIRKUNG';

        const craterIntel = {
          id: `crater-${da.id}-${ip.id}`,
          parentId: da.id,
          title: `💥 Einschlagskrater: ${ip.name}`,
          category: 'craters',
          parentCategory: 'drone-attacks',
          theater: da.theater,
          target: { name: ip.name, lat: ip.lat, lon: ip.lon },
          ordnance: ip.ordnance || da.weaponSystem,
          craterDiameterM: craterDiameter,
          status: bdaStatus,
          bda: bdaStatus,
          parentTitle: da.title,
          timestamp: da.timestamp,
          summary: `Drohneneinschlag bei ${ip.lat.toFixed(5)}°N, ${ip.lon.toFixed(5)}°E (${ip.name}). Munition: ${ip.ordnance || da.weaponSystem}. Kraterdurchmesser: ${craterDiameter}m. BDA: ${bdaStatus}`,
          impactPoints: da.impactPoints,
        };

        // Charred ground crater disc
        const craterDiscEntity = _viewer.entities.add({
          id: `crater-disc-${da.id}-${ip.id}`,
          name: `Krater: ${ip.name}`,
          position: Cesium.Cartesian3.fromDegrees(ip.lon, ip.lat, 0),
          ellipse: {
            semiMajorAxis: craterRadius,
            semiMinorAxis: craterRadius,
            material: Cesium.Color.fromCssColorString('#120a06').withAlpha(0.85),
            outline: true,
            outlineColor: Cesium.Color.fromCssColorString('#ff4400').withAlpha(0.85),
            outlineWidth: 2,
            classificationType: Cesium.ClassificationType.BOTH,
          },
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 150000),
        });
        craterDiscEntity.__gevIntelRecord = craterIntel;
        _entities.push(craterDiscEntity);

        // Pinpoint Impact Marker & Target Label
        const craterHitEntity = _viewer.entities.add({
          id: `crater-hit-${da.id}-${ip.id}`,
          name: `Einschlag: ${ip.name}`,
          position: Cesium.Cartesian3.fromDegrees(ip.lon, ip.lat, 12),
          point: {
            pixelSize: 7,
            color: Cesium.Color.fromCssColorString('#ff2200'),
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 1.5,
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 75000),
          },
          label: {
            text: `💥 EINSCHLAG: ${ip.name}\nØ ${craterDiameter}m | [${bdaStatus}]`,
            font: 'bold 10px monospace',
            fillColor: Cesium.Color.fromCssColorString('#fff1e8'),
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

export const droneAttacksLayer = {
  id: 'drone-attacks',
  name: 'Drone Attacks',
  icon: '🛩️',
  source: 'UAV & DRONE WARFARE INTEL',
  showInTogglePanel: true,

  init(viewer) {
    _viewer = viewer;
  },

  enable() {
    _enabled = true;
    renderDroneAttacks();
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
      source: 'UAV & DRONE WARFARE INTEL',
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

  addDroneAttack(attack) {
    if (!attack || !attack.id) return;
    _records = [attack, ..._records.filter((a) => a.id !== attack.id)];
    if (_enabled) renderDroneAttacks();
  },
};

export default droneAttacksLayer;

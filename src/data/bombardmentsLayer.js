/**
 * @module bombardmentsLayer
 *
 * Dedicated data layer for Airstrikes, Glide Bombs & Heavy Bombardments ('bombardments').
 * Visualizes tactical aviation FAB/KAB glide bomb strikes, heavy MLRS barrages,
 * artillery concentration zones, and naval bombardments.
 */

import * as Cesium from 'cesium';
import { SEED_BOMBARDMENTS, getIntensityColor } from './militaryConflictEngine.js';

let _viewer = null;
let _enabled = false;
let _entities = [];
let _records = [...SEED_BOMBARDMENTS];
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

function renderBombardments() {
  clearEntities();
  if (!_viewer || !_enabled) return;

  for (const bm of _records) {
    const color = getIntensityColor(bm.severity, 0.32);
    const strokeColor = getIntensityColor(bm.severity, 0.92);
    const radiusM = bm.impactRadiusM || 2500;

    const targetPos = Cesium.Cartesian3.fromDegrees(bm.target.lon, bm.target.lat, 0);

    // 1. Impact / Crater Cluster Disc
    const clusterEntity = _viewer.entities.add({
      id: `bm-disc-${bm.id}`,
      name: bm.title,
      position: targetPos,
      ellipse: {
        semiMajorAxis: radiusM,
        semiMinorAxis: radiusM,
        material: color,
        classificationType: Cesium.ClassificationType.BOTH,
      },
      description: `
        <div style="font-family: monospace; padding: 6px;">
          <h3 style="margin: 0 0 6px 0; color: #ff2200;">💣 ${bm.title}</h3>
          <p><strong>Waffensystem:</strong> ${bm.weaponSystem}</p>
          <p><strong>Schauplatz:</strong> ${bm.theater}</p>
          <p><strong>Zielareal:</strong> ${bm.target.name}</p>
          <p><strong>Munitionslast / Salve:</strong> ${bm.ordnanceCount}</p>
          <p><strong>Wirkung / Status:</strong> ${bm.status}</p>
          <p><strong>Zeitpunkt:</strong> ${bm.timestamp}</p>
          <p><strong>Lageaufklärung:</strong> ${bm.summary}</p>
        </div>
      `,
    });
    const intelRecord = { ...bm, category: 'bombardments' };
    clusterEntity.__gevIntelRecord = intelRecord;
    _entities.push(clusterEntity);

    // 2. Inner Shockwave Ring
    const innerEntity = _viewer.entities.add({
      id: `bm-inner-${bm.id}`,
      position: targetPos,
      ellipse: {
        semiMajorAxis: radiusM * 0.45,
        semiMinorAxis: radiusM * 0.45,
        material: new Cesium.Color(1.0, 0.9, 0.1, 0.25),
        classificationType: Cesium.ClassificationType.BOTH,
      },
    });
    innerEntity.__gevIntelRecord = intelRecord;
    _entities.push(innerEntity);

    // 3. Bombardment Point Marker & Tag
    const markerEntity = _viewer.entities.add({
      id: `bm-marker-${bm.id}`,
      position: Cesium.Cartesian3.fromDegrees(bm.target.lon, bm.target.lat, 200),
      point: {
        pixelSize: 8,
        color: strokeColor,
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 10000000),
      },
      label: {
        text: `💣 ${bm.title}\n[${bm.weaponSystem}]`,
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

    // 4. Pinpoint Impact Points & Charred Craters (BDA granularity)
    if (Array.isArray(bm.impactPoints)) {
      for (const ip of bm.impactPoints) {
        const craterDiameter = ip.craterDiameterM != null ? ip.craterDiameterM : (ip.craterRadiusM ? ip.craterRadiusM * 2 : 24);
        const craterRadius = craterDiameter > 0 ? Math.max(craterDiameter / 2, 4) : 8;
        const bdaStatus = ip.damageStatus || ip.bda || ip.status || 'VOLLE WIRKUNG';

        const craterIntel = {
          id: `crater-${bm.id}-${ip.id}`,
          parentId: bm.id,
          title: `💥 Einschlagskrater: ${ip.name}`,
          category: 'craters',
          parentCategory: 'bombardments',
          theater: bm.theater,
          target: { name: ip.name, lat: ip.lat, lon: ip.lon },
          ordnance: ip.ordnance || bm.weaponSystem,
          craterDiameterM: craterDiameter,
          status: bdaStatus,
          bda: bdaStatus,
          parentTitle: bm.title,
          timestamp: bm.timestamp,
          summary: `Punktgenauer Bombeneinschlag bei ${ip.lat.toFixed(5)}°N, ${ip.lon.toFixed(5)}°E (${ip.name}). Munitionsart: ${ip.ordnance || bm.weaponSystem}. Kraterdurchmesser: ${craterDiameter}m. BDA-Schadensbewertung: ${bdaStatus}`,
          impactPoints: bm.impactPoints,
        };

        // Charred ground crater disc with scorching effect
        const craterDiscEntity = _viewer.entities.add({
          id: `crater-disc-${bm.id}-${ip.id}`,
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
          id: `crater-hit-${bm.id}-${ip.id}`,
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

export const bombardmentsLayer = {
  id: 'bombardments',
  name: 'Bombardments',
  icon: '💣',
  source: 'TACTICAL AIR & ARTILLERY STRIKES',
  showInTogglePanel: true,

  init(viewer) {
    _viewer = viewer;
  },

  enable() {
    _enabled = true;
    renderBombardments();
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
      source: 'AIR & ARTILLERY INTEL',
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

  addBombardment(bombardment) {
    if (!bombardment || !bombardment.id) return;
    _records = [bombardment, ..._records.filter((b) => b.id !== bombardment.id)];
    if (_enabled) renderBombardments();
  },
};

export default bombardmentsLayer;

/**
 * @module liveOsintLayer
 *
 * Dedicated real-time geospatial intelligence layer for Live OSINT & Telegram Feeds ('live-osint').
 * Ingests multi-channel open-source dispatches (Liveuamap, Ukrainian Air Force, DeepState, Nahost OSINT),
 * geoparses events via osintGeoparser, and renders cybernetic cyan markers, impact radii, and SITREP
 * records onto the Cesium globe.
 */

import * as Cesium from 'cesium';
import { geoparseOsintBatch } from './osintGeoparser.js';
import { registerTacticalRecord, unregisterTacticalRecord } from './tacticalInspector.js';

export const SEED_OSINT_RECORDS = [
  {
    id: 'osint-seed-kharkiv',
    channel: 'kpszsu',
    title: 'Drone Activity: Kharkiv',
    locationName: 'Kharkiv, Ukraine',
    theater: 'EAST UKRAINE / KHARKIV',
    latitude: 50.0038,
    longitude: 36.2304,
    altitude: 300,
    impactRadiusM: 35000,
    category: 'DROHNENANGRIFF',
    severity: 'CRITICAL',
    weaponSystem: 'Shahed-136 / Geran-2 Kamikaze UAV',
    summary: 'Multiple groups of Shahed-136 strike drones reported inbound toward greater Kharkiv. Air defense on high alert.',
    originalText: 'Увага! Група ударних БпЛА Shahed курсом на Харків! Перебувайте в укриттях.',
    timestamp: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
    source: 'OSINT [KPSZSU]',
    isLiveOsint: true,
  },
  {
    id: 'osint-seed-dnipro',
    channel: 'liveuamap',
    title: 'Missile Strike: Dnipro',
    locationName: 'Dnipro, Ukraine',
    theater: 'CENTRAL UKRAINE / DNIPRO',
    latitude: 48.4647,
    longitude: 35.0462,
    altitude: 250,
    impactRadiusM: 30000,
    category: 'RAKETENANGRIFF',
    severity: 'CRITICAL',
    weaponSystem: 'Iskander-M Quasi-Ballistic Missile',
    summary: 'Explosions and ballistic missile alert reported in Dnipro sector. Deployment of Iskander-M confirmed.',
    originalText: 'Explosions reported in Dnipro following ballistic missile threat warning.',
    timestamp: new Date(Date.now() - 75 * 60 * 1000).toISOString(),
    source: 'OSINT [LIVEUAMAP]',
    isLiveOsint: true,
  },
  {
    id: 'osint-seed-odesa',
    channel: 'DeepStateUA',
    title: 'Air Defense Active: Odesa',
    locationName: 'Odesa, Ukraine',
    theater: 'SOUTH UKRAINE / BLACK SEA COAST',
    latitude: 46.4825,
    longitude: 30.7233,
    altitude: 200,
    impactRadiusM: 25000,
    category: 'LUFTABWEHR',
    severity: 'MODERATE',
    weaponSystem: 'Integrated Air Defense (SAM Interception)',
    summary: 'Successful air defense engagement against inbound cruise missiles over Odesa maritime waters.',
    originalText: 'Працює ППО над акваторією Чорного моря біля Одеси. Ціль знищено.',
    timestamp: new Date(Date.now() - 140 * 60 * 1000).toISOString(),
    source: 'OSINT [DEEPSTATEUA]',
    isLiveOsint: true,
  },
  {
    id: 'osint-seed-pokrovsk',
    channel: 'DeepStateUA',
    title: 'Combat & Glide Bombs: Pokrovsk',
    locationName: 'Pokrovsk, Donbas',
    theater: 'DONBAS / POKROVSK SECTOR',
    latitude: 48.2825,
    longitude: 37.1758,
    altitude: 220,
    impactRadiusM: 28000,
    category: 'RAKETENANGRIFF',
    severity: 'CRITICAL',
    weaponSystem: 'Guided Glide Bomb (KAB/FAB-UMPK)',
    summary: 'Intensive deployment of KAB guided glide bombs and heavy artillery combat reported along Pokrovsk front.',
    originalText: 'Покровський напрямок: активність ворожої авіації, пуски КАБ по укріпрайонах.',
    timestamp: new Date(Date.now() - 190 * 60 * 1000).toISOString(),
    source: 'OSINT [DEEPSTATEUA]',
    isLiveOsint: true,
  },
  {
    id: 'osint-seed-beirut',
    channel: 'liveuamap',
    title: 'Airstrike: Beirut',
    locationName: 'Beirut, Lebanon',
    theater: 'LEBANON / BEIRUT METRO',
    latitude: 33.8938,
    longitude: 35.5018,
    altitude: 150,
    impactRadiusM: 25000,
    category: 'RAKETENANGRIFF',
    severity: 'CRITICAL',
    weaponSystem: 'Precision Guided Munition Strike',
    summary: 'Precision airstrikes reported targeting southern suburbs of Beirut (Dahiyeh).',
    originalText: 'Heavy airstrikes reported in southern suburbs of Beirut (Dahiyeh).',
    timestamp: new Date(Date.now() - 280 * 60 * 1000).toISOString(),
    source: 'OSINT [LIVEUAMAP]',
    isLiveOsint: true,
  },
];

let _viewer = null;
let _enabled = false;
let _entities = [];
let _records = [...SEED_OSINT_RECORDS];
let _lastUpdate = null;
let _pollIntervalId = null;
const _listeners = new Set();

function emit(event, data) {
  for (const fn of _listeners) {
    try { fn(event, data); } catch { /* best effort */ }
  }
}

function clearEntities() {
  if (!_viewer) return;
  for (const ent of _entities) {
    unregisterTacticalRecord(ent.id);
    _viewer.entities.remove(ent);
  }
  _entities = [];
}

function getOsintCyanColor(severity, alpha = 0.3) {
  // Cybernetic cyan palette (strict theme compliance: no red)
  if (severity === 'CRITICAL') return Cesium.Color.fromCssColorString('#00d4ff').withAlpha(alpha);
  if (severity === 'SEVERE') return Cesium.Color.fromCssColorString('#00e5ff').withAlpha(alpha * 0.9);
  return Cesium.Color.fromCssColorString('#00b4d8').withAlpha(alpha * 0.75);
}

function renderLiveOsint() {
  clearEntities();
  if (!_viewer || !_enabled) return;

  for (const rec of _records) {
    const intelRecord = {
      ...rec,
      category: 'live-osint',
      status: 'ACTIVE // OSINT DISPATCH',
      theater: rec.theater || 'OPERATIONAL THEATER',
    };

    const descHtml = `
<div style="font-family: monospace; padding: 8px; color: #e0f7fa;">
  <h3 style="margin: 0 0 6px 0; color: #00d4ff;">📡 [LIVE OSINT] ${rec.title}</h3>
  <p><strong>Schauplatz:</strong> ${rec.theater}</p>
  <p><strong>Kanal:</strong> ${rec.channel}</p>
  <p><strong>Waffensystem:</strong> ${rec.weaponSystem}</p>
  <p><strong>Schweregrad:</strong> ${rec.severity}</p>
  <p><strong>Zeitpunkt:</strong> ${rec.timestamp}</p>
  <p><strong>Lageaufklärung:</strong> ${rec.summary}</p>
  ${rec.messageUrl ? `<p><a href="${rec.messageUrl}" target="_blank" rel="noreferrer" style="color: #00d4ff;">Telegram Original-Meldung öffnen ↗</a></p>` : ''}
</div>`;

    // 1. Impact / Warning Radius Disc (Cybernetic Cyan)
    const discColor = getOsintCyanColor(rec.severity, 0.28);
    const radiusM = rec.impactRadiusM || 2500;

    const discEnt = _viewer.entities.add({
      id: `live-osint-disc-${rec.id}`,
      name: rec.title,
      position: Cesium.Cartesian3.fromDegrees(rec.longitude, rec.latitude, 0),
      ellipse: {
        semiMajorAxis: radiusM,
        semiMinorAxis: radiusM,
        material: discColor,
        classificationType: Cesium.ClassificationType.BOTH,
      },
      description: descHtml,
    });
    discEnt.__gevIntelRecord = intelRecord;
    registerTacticalRecord(discEnt.id, intelRecord);
    _entities.push(discEnt);

    // 2. Tactical OSINT Beacon & Label
    const markerEnt = _viewer.entities.add({
      id: `live-osint-marker-${rec.id}`,
      name: rec.title,
      position: Cesium.Cartesian3.fromDegrees(rec.longitude, rec.latitude, rec.altitude || 250),
      point: {
        pixelSize: 10,
        color: Cesium.Color.fromCssColorString('#00d4ff'),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 15000000),
      },
      label: {
        text: `📡 ${rec.title}\n[${rec.weaponSystem || 'OSINT'} // ${rec.channel}]`,
        font: 'bold 11px monospace',
        fillColor: Cesium.Color.fromCssColorString('#e0f7fa'),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -14),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 4000000),
      },
      description: descHtml,
    });
    markerEnt.__gevIntelRecord = intelRecord;
    registerTacticalRecord(markerEnt.id, intelRecord);
    _entities.push(markerEnt);
  }

  _lastUpdate = new Date().toISOString();
  emit('update', { count: _records.length, lastUpdate: _lastUpdate });
}

/**
 * Fetches live OSINT messages from /api/osint/telegram, geoparses them, and merges them.
 */
export async function fetchLiveOsintData({ forceRefresh = false, fetchImpl = null } = {}) {
  const fetchFn = fetchImpl || (typeof window !== 'undefined' ? window.fetch : fetch);
  if (!fetchFn) return _records;

  try {
    const base = typeof window !== 'undefined' && window.location?.origin ? window.location.origin : 'http://localhost';
    const relative = `/api/osint/telegram${forceRefresh ? '?refresh=true' : ''}`;
    const url = typeof window !== 'undefined' ? relative : `${base}${relative}`;
    const res = await fetchFn(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout ? AbortSignal.timeout(10000) : undefined,
    });

    if (!res.ok) return _records;
    const data = await res.json();
    if (!data || !Array.isArray(data.messages)) return _records;

    const parsedRecords = geoparseOsintBatch(data.messages);
    if (parsedRecords.length > 0) {
      // Merge with seed records, deduplicating by ID
      const seen = new Set();
      const merged = [];

      for (const rec of [...parsedRecords, ...SEED_OSINT_RECORDS]) {
        if (!seen.has(rec.id)) {
          seen.add(rec.id);
          merged.push(rec);
        }
      }

      _records = merged.slice(0, 50);
      if (_enabled) renderLiveOsint();
    }
  } catch (err) {
    console.warn('[LiveOsintLayer] Live fetch failed, preserving existing records:', err?.message || err);
  }

  return _records;
}

export const liveOsintLayer = {
  id: 'live-osint',
  name: 'Live OSINT / Telegram',
  icon: '📡',
  source: 'TELEGRAM OSINT FEED',
  showInTogglePanel: true,

  init(viewer) {
    _viewer = viewer;
  },

  enable() {
    _enabled = true;
    renderLiveOsint();
    fetchLiveOsintData();

    if (!_pollIntervalId && typeof window !== 'undefined') {
      _pollIntervalId = window.setInterval(() => {
        if (_enabled) fetchLiveOsintData();
      }, 120_000);
    }

    emit('enabled', true);
  },

  disable() {
    _enabled = false;
    clearEntities();
    if (_pollIntervalId && typeof window !== 'undefined') {
      window.clearInterval(_pollIntervalId);
      _pollIntervalId = null;
    }
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
      source: 'TELEGRAM OSINT FEED',
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

  addRecord(record) {
    if (!record || !record.id) return;
    _records = [record, ..._records.filter((r) => r.id !== record.id)];
    if (_enabled) renderLiveOsint();
  },
};

export default liveOsintLayer;

/**
 * @module campaignTrailsLayer
 *
 * Dedicated data layer for Presidential & VIP Campaign Trails ('campaign-trails').
 * Visualizes candidate air mobility routes, motorcade connections, arena rally venues,
 * crowd capacities, and event security postures.
 */

import * as Cesium from 'cesium';
import { SEED_CAMPAIGN_TRAILS } from './specialOpsEngine.js';

let _viewer = null;
let _enabled = false;
let _entities = [];
let _records = [...SEED_CAMPAIGN_TRAILS];
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

function renderCampaignTrails() {
  clearEntities();
  if (!_viewer || !_enabled) return;

  for (const ct of _records) {
    const tourColor = Cesium.Color.fromCssColorString('#38bdf8'); // Sky blue
    const venueColor = Cesium.Color.fromCssColorString('#f43f5e'); // Rose / rally highlight

    // 1. Air / Transit Legs
    for (let i = 0; i < ct.legs.length; i++) {
      const leg = ct.legs[i];
      const positions = leg.coords.map(([lon, lat]) => {
        const alt = leg.mode === 'FLIGHT' ? 8000 : 0;
        return Cesium.Cartesian3.fromDegrees(lon, lat, alt);
      });

      const legEntity = _viewer.entities.add({
        id: `campaign-leg-${ct.id}-${i}`,
        name: `${ct.title} [${leg.from} → ${leg.to}]`,
        polyline: {
          positions,
          width: 3.5,
          material: new Cesium.PolylineGlowMaterialProperty({
            glowPower: 0.25,
            color: tourColor,
          }),
          ...(leg.mode !== 'FLIGHT' ? { clampToGround: true } : {}),
        },
        description: `
          <div style="font-family: monospace; padding: 6px;">
            <h4 style="margin: 0 0 4px 0; color: #38bdf8;">✈️ ${ct.title}</h4>
            <p><strong>Etappe:</strong> ${leg.from} ➔ ${leg.to}</p>
            <p><strong>Modus:</strong> ${leg.mode}</p>
            <p><strong>Distanz:</strong> ~${leg.distanceKm} km</p>
            <p><strong>VIP-Flugzeug:</strong> ${ct.aircraft}</p>
          </div>
        `,
      });
      const legMid = leg.coords[Math.floor(leg.coords.length / 2)] || leg.coords[0];
      const legIntel = {
        ...ct,
        category: 'campaign-trails',
        title: `${ct.title} [${leg.from} → ${leg.to}]`,
        location: { lat: legMid[1], lon: legMid[0] },
        target: { name: leg.to, lat: legMid[1], lon: legMid[0] },
        summary: `VIP-Transit-Route (${ct.candidate}) von ${leg.from} nach ${leg.to}. Modus: ${leg.mode}. Distanz: ${leg.distanceKm} km. Flugzeug: ${ct.aircraft}.`,
      };
      legEntity.__gevIntelRecord = legIntel;
      _entities.push(legEntity);
    }

    // 2. Rally Arenas & Campaign Stops
    for (let j = 0; j < ct.stops.length; j++) {
      const stop = ct.stops[j];
      const stopPos = Cesium.Cartesian3.fromDegrees(stop.lon, stop.lat, 100);

      const venueEntity = _viewer.entities.add({
        id: `campaign-stop-${ct.id}-${j}`,
        name: `${stop.name} [${stop.city}]`,
        position: stopPos,
        point: {
          pixelSize: 10,
          color: venueColor,
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 2,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 10000000),
        },
        label: {
          text: `🗳️ ${stop.name}\n[${stop.capacity.toLocaleString()} Kapazität · ${stop.time}]`,
          font: 'bold 11px monospace',
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -12),
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 180000),
        },
        description: `
          <div style="font-family: monospace; padding: 6px;">
            <h3 style="margin: 0 0 6px 0; color: #f43f5e;">🗳️ ${stop.name}</h3>
            <p><strong>Stadt / Arena:</strong> ${stop.city} — ${stop.venue}</p>
            <p><strong>Kandidat / Tour:</strong> ${ct.candidate}</p>
            <p><strong>Kapazität:</strong> ${stop.capacity.toLocaleString()} Besucher</p>
            <p><strong>Uhrzeit:</strong> ${stop.time}</p>
            <p><strong>Sicherheitsstatus:</strong> ${stop.securityPosture}</p>
            <p><strong>Lage & Status:</strong> ${stop.status}</p>
          </div>
        `,
      });
      const stopIntel = {
        ...ct,
        category: 'campaign-trails',
        title: `${stop.name} (${stop.city})`,
        location: { lat: stop.lat, lon: stop.lon },
        target: { name: stop.venue, lat: stop.lat, lon: stop.lon },
        summary: `Wahlkampfveranstaltung & Kundgebung in ${stop.city} (${stop.venue}). Erwartete Besucher: ${stop.capacity.toLocaleString()}. Sicherheitslage: ${stop.securityPosture}. Uhrzeit: ${stop.time}. Status: ${stop.status}.`,
      };
      venueEntity.__gevIntelRecord = stopIntel;
      _entities.push(venueEntity);
    }
  }

  _lastUpdate = new Date().toISOString();
  emit('update', { count: _records.length, lastUpdate: _lastUpdate });
}

export const campaignTrailsLayer = {
  id: 'campaign-trails',
  name: 'Campaign Trails & Rallies',
  icon: '🗳️',
  source: 'CAMPAIGN PRESS / AIR MOBILITY',
  showInTogglePanel: true,

  init(viewer) {
    _viewer = viewer;
  },

  enable() {
    _enabled = true;
    renderCampaignTrails();
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
      source: 'CAMPAIGN PRESS / AIR MOBILITY',
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

  addCampaign(campaign) {
    if (!campaign || !campaign.id) return;
    _records = [campaign, ..._records.filter((c) => c.id !== campaign.id)];
    if (_enabled) renderCampaignTrails();
  },
};

export default campaignTrailsLayer;

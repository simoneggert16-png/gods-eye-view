/**
 * @module tacticalSitrepModal
 *
 * Interactive Tactical SITREP & Intel Dispatch modal.
 * Displays comprehensive military intelligence, theater data, weapon systems,
 * belligerents, and operational status when any tactical entity is clicked.
 */

import * as Cesium from 'cesium';

let _modalContainer = null;
let _currentRecord = null;
let _viewer = null;

export function initTacticalSitrepModal(viewer) {
  _viewer = viewer;
  if (typeof document === 'undefined') return;

  if (document.getElementById('tactical-sitrep-modal')) {
    _modalContainer = document.getElementById('tactical-sitrep-modal');
    return;
  }

  const modal = document.createElement('div');
  modal.id = 'tactical-sitrep-modal';
  modal.className = 'tactical-sitrep-modal';
  modal.hidden = true;
  modal.innerHTML = `
    <div class="tactical-sitrep-backdrop" data-action="close"></div>
    <div class="tactical-sitrep-dialog" role="dialog" aria-modal="true" aria-labelledby="tactical-sitrep-title">
      <div class="tactical-sitrep-header">
        <div class="tactical-sitrep-tag">
          <span class="tactical-pulse-dot" aria-hidden="true"></span>
          <span id="tactical-sitrep-badge" class="tactical-badge">TACTICAL INTEL // SITREP</span>
        </div>
        <button id="tactical-sitrep-close-btn" class="tactical-close-btn" type="button" aria-label="Schließen">✕</button>
      </div>

      <div class="tactical-sitrep-body">
        <div class="tactical-title-row">
          <div id="tactical-sitrep-icon" class="tactical-icon">⚔️</div>
          <div class="tactical-title-wrap">
            <h2 id="tactical-sitrep-title" class="tactical-title">OPERATIONAL SECTOR</h2>
            <div id="tactical-sitrep-theater" class="tactical-theater">THEATER OF OPERATIONS</div>
          </div>
        </div>

        <div class="tactical-status-strip">
          <div class="tactical-status-pill">
            <span class="tactical-label">STATUS:</span>
            <span id="tactical-sitrep-status" class="tactical-value">ACTIVE</span>
          </div>
          <div class="tactical-status-pill">
            <span class="tactical-label">KOORDINATEN:</span>
            <span id="tactical-sitrep-coords" class="tactical-value">00.0000° N, 00.0000° E</span>
          </div>
        </div>

        <div class="tactical-intel-grid">
          <div class="tactical-grid-item">
            <span class="tactical-grid-label">PARTEIEN / EINHEITEN</span>
            <span id="tactical-sitrep-forces" class="tactical-grid-val">—</span>
          </div>
          <div class="tactical-grid-item">
            <span class="tactical-grid-label">WAFFENSYSTEM / TYP</span>
            <span id="tactical-sitrep-weapon" class="tactical-grid-val">—</span>
          </div>
          <div class="tactical-grid-item">
            <span class="tactical-grid-label">QUELLE & ZEITSTEMPEL</span>
            <span id="tactical-sitrep-meta" class="tactical-grid-val">—</span>
          </div>
          <div class="tactical-grid-item">
            <span class="tactical-grid-label">TAKTIK & WIRKUNG</span>
            <span id="tactical-sitrep-impact" class="tactical-grid-val">—</span>
          </div>
        </div>

        <div class="tactical-section-label">LAGEAUFKLÄRUNG (SITREP)</div>
        <div id="tactical-sitrep-summary" class="tactical-summary-box">
          Lageaufklärung wird geladen...
        </div>

        <div id="tactical-extra-content" class="tactical-extra-box"></div>
      </div>

      <div class="tactical-sitrep-footer">
        <button id="tactical-flyto-btn" class="tactical-action-btn primary-action" type="button">
          🎯 ZENTRIEREN & ANFLIEGEN
        </button>
        <button id="tactical-dismiss-btn" class="tactical-action-btn secondary-action" type="button">
          SCHLIESSEN (ESC)
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  _modalContainer = modal;

  // Event Listeners
  modal.addEventListener('click', (e) => {
    if (e.target.dataset.action === 'close' || e.target.id === 'tactical-sitrep-close-btn' || e.target.id === 'tactical-dismiss-btn') {
      hideTacticalSitrep();
    }
  });

  const flyToBtn = modal.querySelector('#tactical-flyto-btn');
  flyToBtn?.addEventListener('click', () => {
    if (_currentRecord && _viewer) {
      flyToRecordSector(_currentRecord, _viewer);
      hideTacticalSitrep();
    }
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isTacticalSitrepOpen()) {
      hideTacticalSitrep();
    }
  });
}

/**
 * Fly camera smoothly to the sector of the given tactical intel record.
 */
function flyToRecordSector(record, viewer) {
  if (!viewer || !record) return;
  const lon = record.location?.lon ?? record.target?.lon ?? record.launchOrigin?.lon ?? record.center?.lon ?? (Array.isArray(record.route) ? record.route[0][0] : null);
  const lat = record.location?.lat ?? record.target?.lat ?? record.launchOrigin?.lat ?? record.center?.lat ?? (Array.isArray(record.route) ? record.route[0][1] : null);
  if (lon == null || lat == null) return;

  const isSingleCrater = Boolean(record.selectedCraterId || record.craterDiameterM);
  const alt = isSingleCrater
    ? 380
    : (record.category === 'conflicts' ? 600000 : (record.category === 'missile-tests' ? 1200000 : 120000));

  if (Cesium) {
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(lon, lat, alt),
      orientation: {
        heading: Cesium.Math.toRadians(0),
        pitch: Cesium.Math.toRadians(isSingleCrater ? -40 : -55),
        roll: 0.0,
      },
      duration: 1.6,
    });
  }
}

/**
 * Opens the SITREP modal with full intelligence data.
 */
export function showTacticalSitrep(intelRecord) {
  if (!_viewer && typeof window !== 'undefined') {
    _viewer = window.__gevDataManager?.viewer || window.dataManager?.viewer || null;
  }
  if (!_modalContainer) {
    initTacticalSitrepModal(_viewer);
  }
  if (!intelRecord || !_modalContainer) return;
  _currentRecord = intelRecord;

  const titleEl = _modalContainer.querySelector('#tactical-sitrep-title');
  const theaterEl = _modalContainer.querySelector('#tactical-sitrep-theater');
  const iconEl = _modalContainer.querySelector('#tactical-sitrep-icon');
  const badgeEl = _modalContainer.querySelector('#tactical-sitrep-badge');
  const statusEl = _modalContainer.querySelector('#tactical-sitrep-status');
  const coordsEl = _modalContainer.querySelector('#tactical-sitrep-coords');
  const forcesEl = _modalContainer.querySelector('#tactical-sitrep-forces');
  const weaponEl = _modalContainer.querySelector('#tactical-sitrep-weapon');
  const metaEl = _modalContainer.querySelector('#tactical-sitrep-meta');
  const impactEl = _modalContainer.querySelector('#tactical-sitrep-impact');
  const summaryEl = _modalContainer.querySelector('#tactical-sitrep-summary');
  const extraEl = _modalContainer.querySelector('#tactical-extra-content');

  const title = intelRecord.title || intelRecord.name || intelRecord.operation || 'Taktisches Einsatzereignis';
  const theater = intelRecord.theater || intelRecord.region || intelRecord.city || 'Globaler Sektor';
  const icon = intelRecord.icon || getCategoryIcon(intelRecord.category);
  const status = intelRecord.status || 'AKTIV // LAGEÜBERWACHUNG';

  const lon = intelRecord.location?.lon ?? intelRecord.target?.lon ?? intelRecord.launchOrigin?.lon ?? intelRecord.center?.lon ?? (Array.isArray(intelRecord.route) ? intelRecord.route[0][0] : null);
  const lat = intelRecord.location?.lat ?? intelRecord.target?.lat ?? intelRecord.launchOrigin?.lat ?? intelRecord.center?.lat ?? (Array.isArray(intelRecord.route) ? intelRecord.route[0][1] : null);
  const coordsStr = (lat != null && lon != null)
    ? `${lat.toFixed(4)}° N, ${lon.toFixed(4)}° E`
    : 'Sektorübergreifend';

  const forces = intelRecord.forces || intelRecord.belligerents || intelRecord.protectee || intelRecord.operator || intelRecord.candidate || 'Militärische Verbände';
  const weapon = intelRecord.weaponSystem || intelRecord.weaponType || intelRecord.missileType || intelRecord.composition || intelRecord.tourType || intelRecord.type || 'Konventionell / Taktisch';
  const source = `${intelRecord.source || 'INTEL WIRE / OSINT'} · ${intelRecord.timestamp || intelRecord.date || 'Echtzeit'}`;
  const impact = intelRecord.tactics || intelRecord.telemetry || intelRecord.cargo || intelRecord.securityPosture || intelRecord.status || 'Gefechtsbereich gesichert';
  const summary = intelRecord.summary || intelRecord.description || 'Aktuelle Gefechts- und Lageaufklärung aktiv. Einheiten im Zielsektor operativ.';

  if (titleEl) titleEl.textContent = title;
  if (theaterEl) theaterEl.textContent = theater.toUpperCase();
  if (iconEl) iconEl.textContent = icon;
  if (badgeEl) badgeEl.textContent = `${(intelRecord.category || 'MILITARY INTEL').toUpperCase()} // SITREP`;
  if (statusEl) statusEl.textContent = status;
  if (coordsEl) coordsEl.textContent = coordsStr;
  if (forcesEl) forcesEl.textContent = forces;
  if (weaponEl) weaponEl.textContent = weapon;
  if (metaEl) metaEl.textContent = source;
  if (impactEl) impactEl.textContent = impact;
  if (summaryEl) summaryEl.textContent = summary;

  // Extra details & BDA impact points
  if (extraEl) {
    extraEl.innerHTML = '';
    if (Array.isArray(intelRecord.impactPoints) && intelRecord.impactPoints.length > 0) {
      const cratersHtml = intelRecord.impactPoints.map((cp, idx) => `
        <div class="tactical-crater-row ${intelRecord.selectedCraterId === cp.id ? 'active-crater' : ''}">
          <div class="tactical-crater-header">
            <span class="tactical-crater-num">#${idx + 1}</span>
            <span class="tactical-crater-name">${cp.name}</span>
            <span class="tactical-crater-badge">${cp.damageStatus}</span>
          </div>
          <div class="tactical-crater-meta">
            <span><strong>GPS:</strong> ${cp.lat.toFixed(5)}° N, ${cp.lon.toFixed(5)}° E</span>
            <span><strong>Munition:</strong> ${cp.ordnance}</span>
            <span><strong>Krater:</strong> Ø ${cp.craterDiameterM} m</span>
          </div>
          <button class="tactical-crater-jump-btn" type="button" data-lat="${cp.lat}" data-lon="${cp.lon}">
            🎯 KRATER ANFLIEGEN (350m)
          </button>
        </div>
      `).join('');

      extraEl.innerHTML = `
        <div class="tactical-bda-container">
          <div class="tactical-section-label">💥 PUNKTGENAUE EINSCHLÄGE & SCHADENSERFASSUNG (${intelRecord.impactPoints.length} TREFFER)</div>
          <div class="tactical-craters-list">
            ${cratersHtml}
          </div>
        </div>
      `;

      extraEl.querySelectorAll('.tactical-crater-jump-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const cLat = parseFloat(e.currentTarget.dataset.lat);
          const cLon = parseFloat(e.currentTarget.dataset.lon);
          const v = _viewer || window.__gevDataManager?.viewer || window.dataManager?.viewer;
          if (!isNaN(cLat) && !isNaN(cLon) && v) {
            v.camera.flyTo({
              destination: Cesium.Cartesian3.fromDegrees(cLon, cLat, 380),
              orientation: {
                heading: Cesium.Math.toRadians(0),
                pitch: Cesium.Math.toRadians(-45),
                roll: 0.0,
              },
              duration: 1.5,
            });
            hideTacticalSitrep();
          }
        });
      });
    } else if (intelRecord.checkpoints) {
      extraEl.innerHTML = `<strong>Checkpoints:</strong> ${intelRecord.checkpoints.map(c => `${c.name} [${c.status}]`).join(' ➔ ')}`;
    } else if (intelRecord.stops) {
      extraEl.innerHTML = `<strong>Rally-Stationen:</strong> ${intelRecord.stops.map(s => `${s.name} (${s.capacity?.toLocaleString() || '—'} Plätze)`).join(' · ')}`;
    } else if (intelRecord.counterSnipers) {
      extraEl.innerHTML = `<strong>Präsidialschutz & Scharfschützen:</strong> ${intelRecord.counterSnipers.map(s => s.name).join(' · ')}`;
    } else if (intelRecord.isLiveOsint || intelRecord.messageUrl) {
      extraEl.innerHTML = `
        <div class="tactical-osint-extra" style="margin-top: 8px; font-family: monospace; font-size: 11px; color: #a5f3fc; background: rgba(0, 212, 255, 0.08); border: 1px solid rgba(0, 212, 255, 0.3); border-radius: 4px; padding: 8px;">
          <div style="font-weight: bold; margin-bottom: 4px; color: #00d4ff;">📡 ORIGINAL OSINT MELDUNG [${intelRecord.channel || 'TELEGRAM'}]:</div>
          <div style="white-space: pre-wrap; line-height: 1.4; color: #e0f7fa;">${intelRecord.originalText || intelRecord.summary}</div>
          ${intelRecord.messageUrl ? `<div style="margin-top: 6px;"><a href="${intelRecord.messageUrl}" target="_blank" rel="noreferrer" style="color: #00d4ff; text-decoration: underline;">Telegram Original-Nachricht öffnen ↗</a></div>` : ''}
        </div>
      `;
    }
  }

  _modalContainer.hidden = false;
  _modalContainer.classList.add('visible');
}

export function hideTacticalSitrep() {
  if (_modalContainer) {
    _modalContainer.hidden = true;
    _modalContainer.classList.remove('visible');
  }
  _currentRecord = null;
}

export function isTacticalSitrepOpen() {
  return Boolean(_modalContainer && !_modalContainer.hidden);
}

function getCategoryIcon(cat) {
  switch (cat) {
    case 'conflicts': return '⚔️';
    case 'frontlines': return '⚡';
    case 'missile-strikes': return '🚀';
    case 'battles': return '💥';
    case 'bombardments': return '💣';
    case 'missile-tests': return '🧪';
    case 'military-convoys': return '🚛';
    case 'campaign-trails': return '🗳️';
    case 'secret-service': return '🕶️';
    case 'drone-attacks': return '🛩️';
    case 'terror-attacks': return '☠️';
    default: return '🛡️';
  }
}

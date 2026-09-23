/**
 * God's Eye View — Aesthetic Live Visitor & Surveillance Radar Modal
 *
 * Provides a real-time Ops Room dashboard to observe incoming website visitors,
 * their locations, devices, active camera coordinates, and user interactions.
 * Includes live Spectator mode to follow any visitor's viewpoint in real-time.
 *
 * @module liveMonitorModal
 */

let _modalEl = null;
let _pollInterval = null;
let _viewer = null;
let _app = null;
let _spectatingSessionId = null;
let _spectatorTicker = null;
let _spectatorEventSource = null;
let _lastStats = null;

/**
 * Injects or retrieves the live monitor modal container in DOM.
 * @returns {HTMLElement}
 */
export function getOrCreateLiveMonitorDom() {
  if (_modalEl && document.body.contains(_modalEl)) {
    return _modalEl;
  }

  const existing = document.getElementById('gev-live-monitor-modal');
  if (existing) {
    _modalEl = existing;
    return _modalEl;
  }

  const wrap = document.createElement('div');
  wrap.id = 'gev-live-monitor-modal';
  wrap.className = 'gev-live-monitor-modal';
  wrap.hidden = true;

  wrap.innerHTML = `
    <div class="gev-monitor-backdrop"></div>
    <div class="gev-monitor-dialog" role="dialog" aria-modal="true" aria-labelledby="gev-monitor-title">
      <div class="gev-monitor-scanline" aria-hidden="true"></div>

      <!-- Header -->
      <header class="gev-monitor-header">
        <div class="gev-monitor-title-group">
          <div class="gev-monitor-kicker">
            <span class="gev-monitor-pulse"></span>
            <span>GLOBAL SURVEILLANCE // VISITOR RADAR & TELEMETRY</span>
          </div>
          <h2 id="gev-monitor-title" class="gev-monitor-heading">Live Besucher- & Lage-Monitor</h2>
        </div>
        <div class="gev-monitor-header-actions">
          <span class="gev-monitor-tag" id="gev-monitor-tunnel-tag">CLOUDFLARE EDGE · LIVE</span>
          <button type="button" class="gev-monitor-btn-refresh" id="gev-monitor-refresh-btn" title="Aktualisieren">
            <span class="material-symbols-outlined" style="font-size: 16px;">sync</span>
          </button>
          <button type="button" class="gev-monitor-btn-close" id="gev-monitor-close-btn" aria-label="Schließen">✕</button>
        </div>
      </header>

      <!-- Top KPI Metric Strip -->
      <div class="gev-monitor-kpi-strip">
        <div class="gev-monitor-kpi">
          <span class="kpi-label">ONLINE BESUCHER</span>
          <div class="kpi-val"><span class="kpi-dot"></span> <strong id="kpi-active-count">—</strong></div>
        </div>
        <div class="gev-monitor-kpi">
          <span class="kpi-label">LÄNDER & REGIONEN</span>
          <div class="kpi-val" id="kpi-countries">—</div>
        </div>
        <div class="gev-monitor-kpi">
          <span class="kpi-label">INTERAKTIONEN</span>
          <div class="kpi-val" id="kpi-events-count">—</div>
        </div>
        <div class="gev-monitor-kpi">
          <span class="kpi-label">TELEMETRIE-STREAM</span>
          <div class="kpi-val" id="kpi-stream-status" style="color: #00ffcc;">AKTIV · 1.5s</div>
        </div>
      </div>

      <!-- Main Ops Room Grid -->
      <div class="gev-monitor-body">
        <!-- Left: Active Visitors Roster -->
        <section class="gev-monitor-col-roster">
          <div class="gev-monitor-col-title">
            <span class="material-symbols-outlined" style="font-size: 15px;">group</span>
            <span>VERBUNDENE OPERATOR & BESUCHER</span>
          </div>
          <div class="gev-visitor-list" id="gev-visitor-list">
            <div class="gev-monitor-loading">Suche nach Live-Signalen...</div>
          </div>
        </section>

        <!-- Right: Real-time Terminal Log Stream -->
        <section class="gev-monitor-col-terminal">
          <div class="gev-monitor-col-title">
            <span class="material-symbols-outlined" style="font-size: 15px;">terminal</span>
            <span>ECHTZEIT-AKTIVITÄT & COMMAND STREAM</span>
          </div>
          <div class="gev-terminal-feed" id="gev-terminal-feed">
            <div class="gev-monitor-loading">Warte auf Aktivitäts-Telemetrie...</div>
          </div>
        </section>
      </div>

      <!-- Footer controls -->
      <footer class="gev-monitor-footer">
        <div class="gev-monitor-footer-left">
          <button type="button" id="gev-toggle-demo-btn" class="gev-monitor-btn-secondary">
            🧪 DEMO-BESUCHER: AKTIV
          </button>
          <span class="gev-monitor-hint">Tipp: Klicke auf "Zuschauen", um die Karte auf den Blickwinkel des Besuchers zu synchronisieren!</span>
        </div>
        <div class="gev-monitor-footer-right">
          <button type="button" id="gev-monitor-close-btn-bottom" class="gev-monitor-btn-primary">
            SCHLIESSEN
          </button>
        </div>
      </footer>
    </div>
  `;

  document.body.appendChild(wrap);
  _modalEl = wrap;

  // Bind close events
  wrap.querySelector('#gev-monitor-close-btn')?.addEventListener('click', closeLiveMonitor);
  wrap.querySelector('#gev-monitor-close-btn-bottom')?.addEventListener('click', closeLiveMonitor);
  wrap.querySelector('.gev-monitor-backdrop')?.addEventListener('click', closeLiveMonitor);

  // Bind manual refresh
  wrap.querySelector('#gev-monitor-refresh-btn')?.addEventListener('click', () => {
    void fetchAndRenderStats();
  });

  // Bind demo toggle
  wrap.querySelector('#gev-toggle-demo-btn')?.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/telemetry/simulate', { method: 'POST', body: '{}' });
      if (res.ok) {
        const d = await res.json();
        const btn = wrap.querySelector('#gev-toggle-demo-btn');
        if (btn) btn.textContent = `🧪 DEMO-BESUCHER: ${d.demoSimulated ? 'AKTIV' : 'AUS'}`;
        void fetchAndRenderStats();
      }
    } catch {}
  });

  // Bind exit spectator
  wrap.querySelector('#gev-spectator-exit-btn')?.addEventListener('click', stopSpectating);

  return wrap;
}

/**
 * Opens the Live Visitor Monitor.
 */
export function openLiveMonitor() {
  const dom = getOrCreateLiveMonitorDom();
  dom.hidden = false;

  void fetchAndRenderStats();

  if (_pollInterval) clearInterval(_pollInterval);
  _pollInterval = setInterval(() => {
    void fetchAndRenderStats();
  }, 1500);
}

/**
 * Closes the Live Visitor Monitor.
 */
export function closeLiveMonitor() {
  if (_modalEl) _modalEl.hidden = true;
  if (_pollInterval) {
    clearInterval(_pollInterval);
    _pollInterval = null;
  }
}

/**
 * Toggles the Live Visitor Monitor.
 */
export function toggleLiveMonitor() {
  const dom = getOrCreateLiveMonitorDom();
  if (dom.hidden) {
    openLiveMonitor();
  } else {
    closeLiveMonitor();
  }
}

/**
 * Checks if the monitor is currently visible.
 * @returns {boolean}
 */
export function isLiveMonitorOpen() {
  return _modalEl ? !_modalEl.hidden : false;
}

/**
 * Fetches current telemetry stats from server and updates DOM.
 */
async function fetchAndRenderStats() {
  if (!_modalEl) return;
  try {
    const res = await fetch('/api/telemetry/stats');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const stats = await res.json();
    _lastStats = stats;
    renderStats(stats);
  } catch {
    const roster = _modalEl.querySelector('#gev-visitor-list');
    if (roster && !roster.children.length) {
      roster.innerHTML = '<div class="gev-monitor-err">Verbindung zum Telemetrie-Dienst unterbrochen</div>';
    }
  }
}

/**
 * Renders stats into the modal elements.
 * @param {object} stats
 */
function renderStats(stats) {
  if (!_modalEl || !stats) return;

  // 1. KPI Strip
  const activeCountEl = _modalEl.querySelector('#kpi-active-count');
  if (activeCountEl) activeCountEl.textContent = `${stats.activeCount || 0} LIVE`;

  const countriesEl = _modalEl.querySelector('#kpi-countries');
  if (countriesEl) {
    const entries = Object.entries(stats.countriesBreakdown || {});
    if (entries.length) {
      countriesEl.textContent = entries.map(([c, n]) => `${c} (${n})`).join(', ');
    } else {
      countriesEl.textContent = '1 (Lokal)';
    }
  }

  const eventsCountEl = _modalEl.querySelector('#kpi-events-count');
  if (eventsCountEl) eventsCountEl.textContent = `${stats.totalEventsLogged || 0} Aktionen`;

  const demoBtn = _modalEl.querySelector('#gev-toggle-demo-btn');
  if (demoBtn) {
    if (stats.demoSimulated) {
      demoBtn.innerHTML = '🧪 SIMULATION: AKTIV [KLICKEN ZUM AUSSCHALTEN]';
      demoBtn.classList.add('demo-active');
      demoBtn.classList.remove('demo-inactive');
    } else {
      demoBtn.innerHTML = '🟢 100% ECHTE BESUCHER (SIMULATION: AUS)';
      demoBtn.classList.add('demo-inactive');
      demoBtn.classList.remove('demo-active');
    }
  }

  // Update top-bar badge count if element exists
  const topBadge = document.getElementById('monitor-pulse-badge');
  if (topBadge) topBadge.textContent = String(stats.activeCount || 1);

  // 2. Active Visitors Roster
  const roster = _modalEl.querySelector('#gev-visitor-list');
  if (roster) {
    const sessions = stats.activeSessions || [];
    if (sessions.length === 0) {
      roster.innerHTML = `
        <div class="gev-monitor-empty">
          <div style="font-size: 20px; margin-bottom: 6px;">🟢 Keine aktiven Fremdbesucher</div>
          <p style="font-size: 11px; opacity: 0.8; margin: 0;">Simulation ist deaktiviert. Sobald jemand deine Seite über Cloudflare oder das Netzwerk öffnet, siehst du ihn hier in Echtzeit!</p>
        </div>`;
    } else {
      roster.innerHTML = '';
      for (const s of sessions) {
        const card = document.createElement('div');
        card.className = `gev-visitor-card ${s.isSimulated ? 'simulated' : 'real'}`;
        if (_spectatingSessionId === s.id) card.classList.add('spectating');

        const esc = (t) => String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const cam = s.camera;
        const coordsText = cam ? `${cam.latitude.toFixed(2)}° N, ${cam.longitude.toFixed(2)}° E (${Math.round(cam.altitude || 0)} m)` : 'Globus';

        let deviceIcon = 'computer';
        if (s.device === 'Mobile') deviceIcon = 'smartphone';
        else if (s.device === 'Tablet') deviceIcon = 'tablet';

        const layersPills = (s.activeLayers || []).map((l) => `<span class="layer-pill">${esc(l.toUpperCase())}</span>`).join(' ') || '<span class="layer-pill-none">Keine Layer aktiv</span>';

        const lastActionText = s.recentActions?.[0]?.text || 'Beobachtet den Globus';

        const typeBadge = s.isSimulated
          ? '<span class="visitor-type-tag demo-tag">🧪 SIMULIERT</span>'
          : '<span class="visitor-type-tag real-tag">🟢 LIVE BESUCHER</span>';

        card.innerHTML = `
          <div class="gev-visitor-card-top">
            <div class="visitor-origin">
              <span class="visitor-flag">${s.flag || '🌐'}</span>
              <div>
                <div style="display: flex; align-items: center; gap: 6px;">
                  <strong class="visitor-city">${esc(s.city || 'Unbekannt')}, ${esc(s.countryName || '')}</strong>
                  ${typeBadge}
                </div>
                <span class="visitor-ip">${esc(s.ipMasked)} · ID: ${esc(s.id.slice(0, 16))}</span>
              </div>
            </div>
            <div class="visitor-device-badge">
              <span class="material-symbols-outlined" style="font-size: 13px;">${deviceIcon}</span>
              <span>${esc(s.os)} · ${esc(s.browser)}</span>
            </div>
          </div>

          <div class="gev-visitor-card-view">
            <span class="material-symbols-outlined" style="font-size: 13px; color: #00ffcc;">my_location</span>
            <span><strong>Blickpunkt:</strong> ${esc(s.viewName || 'Weltansicht')} <small>(${coordsText})</small></span>
          </div>

          <div class="gev-visitor-card-layers">
            <span>Aktive Layer:</span>
            ${layersPills}
          </div>

          <div class="gev-visitor-card-action">
            <span class="action-icon">⚡</span>
            <span class="action-text">${esc(lastActionText)}</span>
          </div>

          <div class="gev-visitor-card-footer">
            <span class="visitor-time">Online: ${Math.floor((s.durationSec || 0) / 60)}m ${(s.durationSec || 0) % 60}s</span>
            <button type="button" class="btn-spectate" data-session-id="${s.id}">
              <span class="material-symbols-outlined" style="font-size: 13px;">visibility</span>
              <span>${_spectatingSessionId === s.id ? 'BEENDEN' : 'ZUSCHAUEN'}</span>
            </button>
          </div>
        `;

        // Bind spectate button
        const spectateBtn = card.querySelector('.btn-spectate');
        spectateBtn?.addEventListener('click', (e) => {
          e.stopPropagation();
          if (_spectatingSessionId === s.id) {
            stopSpectating();
          } else {
            startSpectating(s);
          }
        });

        roster.appendChild(card);
      }
    }
  }

  // 3. Real-time Terminal Log Stream
  const terminal = _modalEl.querySelector('#gev-terminal-feed');
  if (terminal) {
    const events = stats.recentEvents || [];
    if (events.length === 0) {
      terminal.innerHTML = '<div class="gev-monitor-empty">Warte auf Aktionen...</div>';
    } else {
      terminal.innerHTML = '';
      for (const ev of events) {
        const row = document.createElement('div');
        row.className = 'terminal-row';
        const esc = (t) => String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        row.innerHTML = `
          <span class="term-time">[${esc(ev.time)}]</span>
          <span class="term-flag">${ev.flag || '🌐'}</span>
          <span class="term-city">${esc(ev.city || '')}</span>
          <span class="term-arrow">→</span>
          <span class="term-action">${esc(ev.action || '')}</span>
        `;
        terminal.appendChild(row);
      }
    }
  }
}

let _spectatorBannerEl = null;

/**
 * Injects or retrieves the floating spectator banner element.
 * @returns {HTMLElement}
 */
export function getOrCreateSpectatorBanner() {
  if (_spectatorBannerEl && document.body.contains(_spectatorBannerEl)) {
    return _spectatorBannerEl;
  }
  const existing = document.getElementById('gev-spectator-banner');
  if (existing) {
    _spectatorBannerEl = existing;
    return _spectatorBannerEl;
  }
  const banner = document.createElement('div');
  banner.id = 'gev-spectator-banner';
  banner.className = 'gev-spectator-banner';
  banner.hidden = true;
  banner.innerHTML = `
    <span class="gev-spectator-pulse"></span>
    <span class="material-symbols-outlined" style="font-size: 16px; color: #00ffcc;">visibility</span>
    <span id="gev-spectator-label">SPECTATOR-MODUS AKTIV</span>
    <button type="button" id="gev-spectator-exit-btn" class="gev-spectator-exit">BEENDEN [ESC]</button>
  `;
  document.body.appendChild(banner);
  banner.querySelector('#gev-spectator-exit-btn')?.addEventListener('click', stopSpectating);
  _spectatorBannerEl = banner;
  return banner;
}

/**
 * Starts spectating a visitor with ZERO delay using real-time SSE stream.
 * @param {object} session
 */
export function startSpectating(session) {
  if (!session) return;
  stopSpectating(); // Clean up previous connection
  _spectatingSessionId = session.id;

  // Show floating HUD banner with zero-delay indicator
  const banner = getOrCreateSpectatorBanner();
  const label = banner.querySelector('#gev-spectator-label');
  if (banner && label) {
    banner.hidden = false;
    const tag = session.isSimulated ? 'DEMO' : 'LIVE';
    label.innerHTML = `SPECTATOR <strong>[⚡ ZERO-DELAY LIVE]</strong>: Folge ${session.flag || '🌐'} ${session.city} (${session.ipMasked}) [${tag}]`;
  }

  // Initial jump to visitor location
  if (session.camera) {
    applySpectatorCamera(session.camera, true);
  }

  // Connect to SSE real-time low-latency stream
  try {
    const streamUrl = `/api/telemetry/spectate-stream?sessionId=${encodeURIComponent(session.id)}`;
    _spectatorEventSource = new EventSource(streamUrl);

    _spectatorEventSource.onmessage = (event) => {
      if (!_spectatingSessionId) return;
      try {
        const payload = JSON.parse(event.data);
        if (payload?.camera) {
          applySpectatorCamera(payload.camera, false);
        }
      } catch {}
    };

    _spectatorEventSource.onerror = () => {
      // Fallback: if SSE drops or proxy interrupts, use fast 200ms poll
      if (!_spectatorTicker && _spectatingSessionId) {
        _spectatorTicker = setInterval(async () => {
          if (!_spectatingSessionId) return;
          try {
            const res = await fetch('/api/telemetry/stats');
            if (res.ok) {
              const d = await res.json();
              const s = d.activeSessions?.find((x) => x.id === _spectatingSessionId);
              if (s?.camera) applySpectatorCamera(s.camera, false);
            }
          } catch {}
        }, 220);
      }
    };
  } catch {
    // If EventSource is unsupported in environment, fallback
  }

  // Close monitor modal so spectator has unhindered view of globe
  closeLiveMonitor();
}

/**
 * Stops active spectating mode and disconnects the SSE stream.
 */
export function stopSpectating() {
  _spectatingSessionId = null;
  if (_spectatorEventSource) {
    try { _spectatorEventSource.close(); } catch {}
    _spectatorEventSource = null;
  }
  if (_spectatorTicker) {
    clearInterval(_spectatorTicker);
    _spectatorTicker = null;
  }
  const banner = document.getElementById('gev-spectator-banner');
  if (banner) banner.hidden = true;
  void fetchAndRenderStats();
}

/**
 * Smoothly synchronizes the Cesium camera to the visitor's live coordinates without lag.
 * @param {object} camera
 * @param {boolean} [isFirst=false]
 */
function applySpectatorCamera(camera, isFirst = false) {
  if (!camera) return;
  const { latitude, longitude, altitude, heading, pitch, roll } = camera;
  const alt = Math.max(500, altitude || 5000);
  const targetHeading = heading != null ? heading : 0;
  const targetPitch = pitch != null ? pitch : -45;

  if (isFirst) {
    if (_app?.applyCameraState) {
      _app.applyCameraState({
        lat: latitude,
        lon: longitude,
        alt,
        pitch: targetPitch,
        heading: targetHeading,
      }, 0.8);
    } else if (_viewer?.camera) {
      const Cesium = window.Cesium;
      if (Cesium) {
        _viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(longitude, latitude, alt),
          orientation: {
            heading: Cesium.Math.toRadians(targetHeading),
            pitch: Cesium.Math.toRadians(targetPitch),
            roll: Cesium.Math.toRadians(roll || 0),
          },
          duration: 0.8,
        });
      }
    }
    return;
  }

  // Real-time tracking: 0.15s short interpolation for seamless 60fps tracking without delay
  if (_app?.applyCameraState) {
    _app.applyCameraState({
      lat: latitude,
      lon: longitude,
      alt,
      pitch: targetPitch,
      heading: targetHeading,
    }, 0.15);
  } else if (_viewer?.camera) {
    const Cesium = window.Cesium;
    if (Cesium) {
      _viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(longitude, latitude, alt),
        orientation: {
          heading: Cesium.Math.toRadians(targetHeading),
          pitch: Cesium.Math.toRadians(targetPitch),
          roll: Cesium.Math.toRadians(roll || 0),
        },
        duration: 0.15,
      });
    }
  }
}

/**
 * Initializes the Live Monitor module, binding global button and keyboard shortcuts.
 * @param {object} params
 */
export function initLiveMonitor({ viewer = null, app = null } = {}) {
  _viewer = viewer;
  _app = app;

  // Bind top-center button if in DOM
  const topBtn = document.getElementById('live-monitor-btn');
  topBtn?.addEventListener('click', toggleLiveMonitor);

  // Global hotkey 'M' (only when not typing in text fields)
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isLiveMonitorOpen()) {
      closeLiveMonitor();
      return;
    }
    if (e.key === 'Escape' && _spectatingSessionId) {
      stopSpectating();
      return;
    }
    const tag = (e.target?.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return;

    if (e.key === 'm' || e.key === 'M') {
      if (!e.ctrlKey && !e.altKey && !e.metaKey) {
        toggleLiveMonitor();
      }
    }
  });

  // Pre-create DOM
  getOrCreateLiveMonitorDom();
}

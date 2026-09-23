/**
 * GlobalMarketSitrepModal — Global Executive Intelligence & Financial Markets Dashboard.
 *
 * Displays live quotes for commodities, safe havens, equities, and defense stocks,
 * combined with interactive click-to-inspect deep dives, real-time symbol search,
 * and Abacus geopolitical & macroeconomic forecasts with 3D camera jumps to linked events.
 */

import * as Cesium from 'cesium';

let _modalElement = null;
let _currentData = null;
let _activeDeepDiveSymbol = null;
let _searchDebounceTimer = null;

export function initGlobalMarketSitrepModal() {
  if (document.getElementById('global-market-sitrep-modal')) return;

  const modal = document.createElement('div');
  modal.id = 'global-market-sitrep-modal';
  modal.className = 'sitrep-modal-backdrop hidden';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'global-sitrep-title');

  modal.innerHTML = `
    <div class="sitrep-modal-window market-sitrep-window">
      <header class="sitrep-modal-header">
        <div class="sitrep-modal-title-wrap">
          <span class="sitrep-globe-icon" aria-hidden="true">🌐</span>
          <div>
            <h2 id="global-sitrep-title" class="sitrep-modal-title">GLOBAL SITREP &amp; FINANZMÄRKTE</h2>
            <p class="sitrep-modal-subtitle">ABACUS GEO-MAKRO ANALYSE · ECHTZEIT-MARKTREAKTIONEN · ROHSTOFFE &amp; RISIKEN</p>
          </div>
        </div>

        <div class="market-search-box">
          <span class="material-symbols-outlined market-search-icon">search</span>
          <input
            id="market-search-input"
            type="text"
            placeholder="Aktie / Rohstoff / Ticker suchen (z.B. Rheinmetall, NVDA, Gold)..."
            autocomplete="off"
            spellcheck="false"
          />
          <button id="market-search-clear" class="market-search-clear hidden" type="button" aria-label="Suche leeren">✕</button>
          <div id="market-search-dropdown" class="market-search-dropdown hidden"></div>
        </div>

        <button id="global-sitrep-close-btn" class="sitrep-modal-close" type="button" aria-label="Schließen">✕</button>
      </header>

      <div class="market-sitrep-tabs" role="tablist">
        <button class="market-tab-btn active" data-tab="markets" type="button">📊 LIVE MÄRKTE</button>
        <button class="market-tab-btn" data-tab="causality" type="button">⚖️ GEOPOLITISCHE AUSWIRKUNGEN</button>
        <button class="market-tab-btn" data-tab="sitrep" type="button">🌍 EXECUTIVE LAGEBILD</button>
        <button class="market-tab-btn hidden" id="market-tab-prognosis" data-tab="prognosis" type="button">📈 IN-DEPTH PROGNOSE</button>
      </div>

      <div class="sitrep-modal-body" id="global-sitrep-body">
        <div class="market-loading-state">
          <span class="botnet-pulse-indicator"></span>
          <span>Lade Echtzeit-Marktdaten und aggregiere geopolitische Lage...</span>
        </div>
      </div>

      <footer class="sitrep-modal-footer">
        <div class="market-footer-left">
          <span id="market-last-update" class="market-update-time">Stand: —</span>
        </div>
        <div class="market-footer-actions">
          <button id="market-refresh-btn" class="scene-btn" type="button">
            <span class="material-symbols-outlined" style="font-size: 15px; vertical-align: middle;">sync</span> AKTUALISIEREN
          </button>
          <button id="market-chat-btn" class="scene-btn primary" type="button">
            <span class="material-symbols-outlined" style="font-size: 15px; vertical-align: middle;">chat</span> IM CHAT VERTIEFEN
          </button>
          <button id="global-sitrep-bottom-close-btn" class="scene-btn" type="button">SCHLIESSEN</button>
        </div>
      </footer>
    </div>
  `;

  document.body.appendChild(modal);
  _modalElement = modal;

  // Search input listeners
  const searchInput = modal.querySelector('#market-search-input');
  const searchClear = modal.querySelector('#market-search-clear');
  const searchDropdown = modal.querySelector('#market-search-dropdown');

  searchInput?.addEventListener('input', () => {
    const val = searchInput.value.trim();
    if (val.length > 0) {
      searchClear?.classList.remove('hidden');
    } else {
      searchClear?.classList.add('hidden');
      searchDropdown?.classList.add('hidden');
      return;
    }

    clearTimeout(_searchDebounceTimer);
    _searchDebounceTimer = setTimeout(async () => {
      await performMarketSearch(val);
    }, 220);
  });

  searchInput?.addEventListener('focus', () => {
    const val = searchInput.value.trim();
    if (val.length > 0 && searchDropdown && searchDropdown.children.length > 0) {
      searchDropdown.classList.remove('hidden');
    }
  });

  searchClear?.addEventListener('click', () => {
    if (searchInput) searchInput.value = '';
    searchClear.classList.add('hidden');
    searchDropdown?.classList.add('hidden');
    searchInput?.focus();
  });

  // Close search dropdown on click outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.market-search-box')) {
      searchDropdown?.classList.add('hidden');
    }
  });

  // Modal event listeners
  modal.querySelector('#global-sitrep-close-btn')?.addEventListener('click', closeGlobalMarketSitrepModal);
  modal.querySelector('#global-sitrep-bottom-close-btn')?.addEventListener('click', closeGlobalMarketSitrepModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeGlobalMarketSitrepModal();
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
      if (!searchDropdown?.classList.contains('hidden')) {
        searchDropdown?.classList.add('hidden');
      } else {
        closeGlobalMarketSitrepModal();
      }
    }
  });

  modal.querySelectorAll('.market-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      modal.querySelectorAll('.market-tab-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      if (tab === 'prognosis' && _activeDeepDiveSymbol) {
        openAssetDeepDive(_activeDeepDiveSymbol);
      } else {
        renderTabContent(tab);
      }
    });
  });

  modal.querySelector('#market-refresh-btn')?.addEventListener('click', async () => {
    const btn = modal.querySelector('#market-refresh-btn');
    btn?.classList.add('spinning');
    const activeTab = modal.querySelector('.market-tab-btn.active')?.dataset.tab;
    if (activeTab === 'prognosis' && _activeDeepDiveSymbol) {
      await openAssetDeepDive(_activeDeepDiveSymbol);
    } else {
      await loadMarketSitrepData(true);
    }
    btn?.classList.remove('spinning');
  });

  modal.querySelector('#market-chat-btn')?.addEventListener('click', () => {
    closeGlobalMarketSitrepModal();
    const chatInput = document.getElementById('gev-free-chat-input') || document.querySelector('.chat-input');
    if (chatInput) {
      const queryText = _activeDeepDiveSymbol
        ? `Erstelle eine detaillierte geopolitische und makroökonomische Prognose für ${_activeDeepDiveSymbol} basierend auf den aktuellen weltweiten Lageberichten.`
        : 'Wie wirken sich die aktuellen weltweiten militärischen und geopolitischen Ereignisse auf die Finanzmärkte und Rohstoffe aus?';
      chatInput.value = queryText;
      chatInput.focus();
      const sendBtn = document.getElementById('gev-free-chat-send') || document.querySelector('.chat-send');
      sendBtn?.click();
    }
  });
}

/**
 * Searches symbols and renders dropdown.
 */
async function performMarketSearch(query) {
  if (!_modalElement) return;
  const dropdown = _modalElement.querySelector('#market-search-dropdown');
  if (!dropdown) return;

  dropdown.innerHTML = `
    <div class="search-loading">
      <span class="botnet-pulse-indicator"></span>
      <span>Suche Märkte weltweit...</span>
    </div>
  `;
  dropdown.classList.remove('hidden');

  try {
    const res = await fetch(`/api/finance/search?q=${encodeURIComponent(query)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const results = data.results || [];

    if (results.length === 0) {
      dropdown.innerHTML = `
        <div class="search-empty">
          <span>Kein passendes Finanzinstrument gefunden für "${esc(query)}"</span>
        </div>
      `;
      return;
    }

    dropdown.innerHTML = results.map((item) => `
      <div class="search-item" data-symbol="${esc(item.symbol)}" tabindex="0">
        <div class="search-item-left">
          <span class="search-item-symbol">${esc(item.symbol)}</span>
          <span class="search-item-name">${esc(item.name)}</span>
        </div>
        <div class="search-item-right">
          ${item.sector ? `<span class="search-item-sector">${esc(item.sector)}</span>` : ''}
          <span class="search-item-exchange">${esc(item.exchange)}</span>
        </div>
      </div>
    `).join('');

    dropdown.querySelectorAll('.search-item').forEach((el) => {
      const handleSelect = () => {
        const symbol = el.dataset.symbol;
        dropdown.classList.add('hidden');
        const input = _modalElement.querySelector('#market-search-input');
        if (input) input.value = symbol;
        openAssetDeepDive(symbol);
      };
      el.addEventListener('click', handleSelect);
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleSelect();
      });
    });
  } catch (err) {
    dropdown.innerHTML = `
      <div class="search-error">
        <span>Fehler bei der Suche: ${esc(err?.message || 'Verbindungsfehler')}</span>
      </div>
    `;
  }
}

/**
 * Loads data from /api/finance/markets and renders the active view.
 */
export async function loadMarketSitrepData(forceRefresh = false) {
  if (!_modalElement) initGlobalMarketSitrepModal();
  const body = _modalElement.querySelector('#global-sitrep-body');
  if (!body) return;

  try {
    const res = await fetch(`/api/finance/markets${forceRefresh ? '?refresh=1' : ''}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Fehler beim Laden');

    _currentData = data;

    const timeStr = data.timestamp
      ? new Date(data.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      : new Date().toLocaleTimeString();
    const updateEl = _modalElement.querySelector('#market-last-update');
    if (updateEl) updateEl.textContent = `Stand: ${timeStr} · 60s Cache`;

    const activeTab = _modalElement.querySelector('.market-tab-btn.active')?.dataset.tab || 'markets';
    if (activeTab !== 'prognosis') {
      renderTabContent(activeTab);
    }
  } catch (err) {
    body.innerHTML = `
      <div class="market-error-state">
        <span class="material-symbols-outlined" style="font-size: 28px; color: #ff5555;">error</span>
        <p>Marktdaten konnten nicht geladen werden: ${err?.message || 'Verbindungsfehler'}</p>
        <button class="scene-btn" onclick="document.getElementById('market-refresh-btn')?.click()">ERNEUT VERSUCHEN</button>
      </div>
    `;
  }
}

/**
 * Opens the In-Depth Prognosis view for a given asset symbol.
 * @param {string} symbol Financial symbol (e.g. 'RHM.DE', 'BZ=F')
 */
export async function openAssetDeepDive(symbol) {
  if (!symbol) return;
  if (!_modalElement) initGlobalMarketSitrepModal();
  _activeDeepDiveSymbol = symbol;

  const modal = _modalElement;
  modal.classList.remove('hidden');

  // Activate prognosis tab in UI
  const progTab = modal.querySelector('#market-tab-prognosis');
  if (progTab) {
    progTab.classList.remove('hidden');
    progTab.textContent = `📈 PROGNOSE: ${symbol}`;
  }

  modal.querySelectorAll('.market-tab-btn').forEach((b) => b.classList.remove('active'));
  progTab?.classList.add('active');

  const body = modal.querySelector('#global-sitrep-body');
  if (!body) return;

  body.innerHTML = `
    <div class="market-loading-state">
      <span class="botnet-pulse-indicator"></span>
      <span>Generiere Abacus In-Depth Prognose &amp; aggregiere Live-Sensor-Ereignisse für <strong>${esc(symbol)}</strong>...</span>
    </div>
  `;

  try {
    const res = await fetch(`/api/finance/prognosis?symbol=${encodeURIComponent(symbol)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Fehler beim Laden der Prognose');

    renderDeepDiveView(data.asset, data.prognosis);
  } catch (err) {
    body.innerHTML = `
      <div class="market-error-state">
        <span class="material-symbols-outlined" style="font-size: 28px; color: #ff5555;">error</span>
        <p>In-Depth Prognose konnte nicht erstellt werden: ${esc(err?.message || 'Verbindungsfehler')}</p>
        <div style="display: flex; gap: 8px; margin-top: 12px;">
          <button class="scene-btn" onclick="window.__godsEyeView?.openAssetDeepDive?.('${esc(symbol)}')">ERNEUT VERSUCHEN</button>
          <button class="scene-btn" id="deepdive-error-back-btn">ZURÜCK ZU DEN MÄRKTEN</button>
        </div>
      </div>
    `;
    body.querySelector('#deepdive-error-back-btn')?.addEventListener('click', () => {
      const marketBtn = modal.querySelector('.market-tab-btn[data-tab="markets"]');
      marketBtn?.click();
    });
  }
}

/**
 * Renders the comprehensive In-Depth Prognosis view.
 */
function renderDeepDiveView(asset, prognosis) {
  if (!_modalElement) return;
  const body = _modalElement.querySelector('#global-sitrep-body');
  if (!body) return;

  const isUp = asset.isPositive;
  const badgeClass = isUp ? 'price-up' : 'price-down';

  // 52-week position calculation (0 to 100%)
  const low52 = asset.low52 || asset.price;
  const high52 = asset.high52 || asset.price;
  const span52 = high52 - low52;
  const currentPosPct = span52 > 0 ? Math.min(100, Math.max(0, ((asset.price - low52) / span52) * 100)) : 50;

  const linked = prognosis.linkedDispatches || [];

  body.innerHTML = `
    <div class="deepdive-container">
      <div class="deepdive-nav-bar">
        <button id="deepdive-back-btn" class="deepdive-back-btn" type="button">
          ⬅ ZURÜCK ZUR MARKTÜBERSICHT
        </button>
        <span class="deepdive-nav-tag">ABACUS GEO-FINANCIAL ENGINE // ASSET DEEP-DIVE</span>
      </div>

      <!-- Hero Header Card -->
      <div class="deepdive-hero">
        <div class="deepdive-hero-main">
          <div class="deepdive-title-wrap">
            <span class="deepdive-symbol">${esc(asset.symbol)}</span>
            <h3 class="deepdive-name">${esc(asset.name)}</h3>
            <div class="deepdive-meta-badges">
              <span class="deepdive-badge">${esc(asset.exchange)}</span>
              <span class="deepdive-badge sector">${esc(asset.sector || asset.category)}</span>
              <span class="deepdive-badge currency">${esc(asset.currency)}</span>
            </div>
          </div>

          <div class="deepdive-price-block">
            <div class="deepdive-price-row">
              <span class="deepdive-current-price">${typeof asset.price === 'number' ? asset.price.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 4 }) : asset.price} <span class="deepdive-unit">${esc(asset.currency)}</span></span>
              <span class="market-card-badge ${badgeClass}">${esc(asset.changePct)}</span>
            </div>
            <div class="deepdive-prevclose">Vortag: ${asset.prevClose ? asset.prevClose.toLocaleString('de-DE') : '—'} ${esc(asset.currency)}</div>
          </div>
        </div>

        <div class="deepdive-ranges-grid">
          <div class="deepdive-range-card">
            <span class="range-label">TAGESSPANNE</span>
            <div class="range-values">
              <span>${asset.dayLow ? asset.dayLow.toLocaleString('de-DE') : '—'}</span>
              <span class="range-sep">↔</span>
              <span>${asset.dayHigh ? asset.dayHigh.toLocaleString('de-DE') : '—'}</span>
            </div>
          </div>

          <div class="deepdive-range-card span-52w">
            <span class="range-label">52-WOCHEN-SPANNE</span>
            <div class="range-bar-track">
              <div class="range-bar-fill" style="width: ${currentPosPct.toFixed(1)}%;"></div>
              <div class="range-bar-thumb" style="left: ${currentPosPct.toFixed(1)}%;"></div>
            </div>
            <div class="range-values range-52w">
              <span>Tief: ${low52.toLocaleString('de-DE')}</span>
              <span class="range-curr">Aktuell: ${asset.price.toLocaleString('de-DE')}</span>
              <span>Hoch: ${high52.toLocaleString('de-DE')}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Abacus Prognosis Card -->
      <div class="deepdive-prognosis-box">
        <div class="prognosis-header">
          <div class="prognosis-title-row">
            <span class="material-symbols-outlined prognosis-icon">psychology</span>
            <div>
              <h4 class="prognosis-title">ABACUS PROGNOSE (HORIZONT: ${esc(prognosis.horizon)})</h4>
              <p class="prognosis-subtitle">Kausalität von Militäroperationen, Sanktionen &amp; Makro-Liquidität</p>
            </div>
          </div>
          <div class="prognosis-trend-badge ${prognosis.sentimentType === 'bullish' ? 'sent-bullish' : (prognosis.sentimentType === 'bearish' ? 'sent-bearish' : 'sent-neutral')}">
            <span class="pulse-indicator"></span>
            ${esc(prognosis.trend)}
          </div>
        </div>

        <div class="prognosis-metrics-grid">
          <div class="prognosis-metric-card highlight">
            <span class="pmetric-label">ZIELKORRIDOR (1–3 MONATE)</span>
            <span class="pmetric-value target-val">${esc(prognosis.targetCorridor)}</span>
          </div>
          <div class="prognosis-metric-card">
            <span class="pmetric-label">MODELL-KONFIDENZ</span>
            <span class="pmetric-value">${prognosis.confidence}%</span>
          </div>
          <div class="prognosis-metric-card">
            <span class="pmetric-label">GEOPOLITISCHER KORRELATIONS-INDEX</span>
            <span class="pmetric-value correlation">${esc(prognosis.correlationIndex)}</span>
          </div>
          <div class="prognosis-metric-card">
            <span class="pmetric-label">STRATEGISCHE ALLOKATION</span>
            <span class="pmetric-value recommendation">${esc(prognosis.recommendation)}</span>
          </div>
        </div>

        <!-- Macro Headline & Thesis -->
        <div class="prognosis-thesis-section">
          <div class="thesis-headline">
            <span class="material-symbols-outlined" style="font-size: 18px; vertical-align: middle; color: #00d4ff;">lightbulb</span>
            <strong>${esc(prognosis.macroHeadline)}</strong>
          </div>
          <p class="thesis-body">${esc(prognosis.thesis)}</p>
        </div>

        <!-- Bull / Bear Scenarios -->
        <div class="prognosis-scenarios-grid">
          <div class="scenario-card bull-case">
            <div class="scenario-header">
              <span class="scenario-icon">🟢</span>
              <strong>BULL-CASE SZENARIO (AUFWÄRTSPOTENZIAL)</strong>
            </div>
            <p class="scenario-text">${esc(prognosis.bullCase)}</p>
          </div>

          <div class="scenario-card bear-case">
            <div class="scenario-header">
              <span class="scenario-icon">🔴</span>
              <strong>BEAR-CASE SZENARIO (ABWÄRTSRISIKEN)</strong>
            </div>
            <p class="scenario-text">${esc(prognosis.bearCase)}</p>
          </div>
        </div>

        <!-- Key Catalysts -->
        <div class="prognosis-catalysts-box">
          <span class="catalysts-title">⚡ SCHLÜSSEL-KATALYSATOREN &amp; RISIKOFAKTOREN:</span>
          <div class="catalysts-pills">
            ${(prognosis.keyCatalysts || []).map((c) => `<span class="catalyst-pill">${esc(c)}</span>`).join('')}
          </div>
        </div>
      </div>

      <!-- Linked Live Sensor Events -->
      <div class="deepdive-linked-events-section">
        <div class="linked-events-header">
          <div class="linked-events-title">
            <span class="material-symbols-outlined" style="color: #00d4ff;">satellite_alt</span>
            <strong>VERKNÜPFTE LIVE-SENSOR-EREIGNISSE (BOTNET &amp; OSINT)</strong>
          </div>
          <span class="linked-events-badge">${linked.length} aktive Meldungen</span>
        </div>

        ${linked.length === 0 ? `
          <div class="linked-events-empty">
            <span class="material-symbols-outlined" style="font-size: 24px; color: rgba(0, 212, 255, 0.6);">verified</span>
            <p>Keine direkten Kampfhandlungen im unmittelbaren physischen Firmenumfeld erfasst. Der Wert wird primär über globale Makro- und Zinsströme gesteuert.</p>
          </div>
        ` : `
          <div class="linked-dispatches-list">
            ${linked.map((d) => `
              <div class="linked-dispatch-card severity-${(d.severity || 'info').toLowerCase()}">
                <div class="ld-top">
                  <div class="ld-title-block">
                    <span class="ld-severity-badge">${esc(d.severity || 'INTEL')}</span>
                    <strong class="ld-title">${esc(d.title)}</strong>
                  </div>
                  <span class="ld-location">📍 ${esc(d.locationName || 'Globaler Sektor')}</span>
                </div>
                <p class="ld-summary">${esc(d.summary)}</p>
                <div class="ld-footer">
                  <span class="ld-relevance-tag">Relevanz: ${esc(d.relevanceTag || 'Geopolitischer Einflussfaktor')}</span>
                  ${(typeof d.lat === 'number' && typeof d.lon === 'number') ? `
                    <button class="scene-btn primary ld-flyto-btn" data-lat="${d.lat}" data-lon="${d.lon}" data-title="${esc(d.title)}" type="button">
                      <span class="material-symbols-outlined" style="font-size: 14px; vertical-align: middle;">my_location</span> HINFLIEGEN (3D)
                    </button>
                  ` : ''}
                </div>
              </div>
            `).join('')}
          </div>
        `}
      </div>
    </div>
  `;

  // Attach event handlers
  body.querySelector('#deepdive-back-btn')?.addEventListener('click', () => {
    const marketBtn = _modalElement.querySelector('.market-tab-btn[data-tab="markets"]');
    marketBtn?.click();
  });

  body.querySelectorAll('.ld-flyto-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const lat = parseFloat(btn.dataset.lat);
      const lon = parseFloat(btn.dataset.lon);
      const title = btn.dataset.title || '';
      if (!isNaN(lat) && !isNaN(lon)) {
        flyToCoordinates(lat, lon, 350000);
        closeGlobalMarketSitrepModal();
      }
    });
  });
}

/**
 * Fly camera smoothly to the given coordinates.
 */
function flyToCoordinates(lat, lon, alt = 350000) {
  const viewer = window.__godsEyeView?.viewer;
  if (!viewer) return;
  if (typeof lat !== 'number' || typeof lon !== 'number') return;

  if (Cesium) {
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(lon, lat, alt),
      orientation: {
        heading: Cesium.Math.toRadians(0),
        pitch: Cesium.Math.toRadians(-45),
        roll: 0.0,
      },
      duration: 2.2,
    });
  }
}

/**
 * Helper to escape HTML safely.
 */
function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Detects ticker symbol from raw text string.
 */
function detectSymbolFromPill(text) {
  const t = String(text || '').toLowerCase();
  if (t.includes('brent')) return 'BZ=F';
  if (t.includes('gold')) return 'GC=F';
  if (t.includes('s&p')) return '^GSPC';
  if (t.includes('vix')) return '^VIX';
  if (t.includes('rheinmetall')) return 'RHM.DE';
  if (t.includes('lockheed')) return 'LMT';
  if (t.includes('bitcoin')) return 'BTC-USD';
  if (t.includes('chf')) return 'USDCHF=X';
  if (t.includes('eur')) return 'EURUSD=X';
  if (t.includes('hensoldt')) return 'HAG.DE';
  if (t.includes('nvidia') || t.includes('nvda')) return 'NVDA';
  return null;
}

/**
 * Renders tab content based on loaded data.
 */
function renderTabContent(tab) {
  if (!_modalElement || !_currentData) return;
  const body = _modalElement.querySelector('#global-sitrep-body');
  if (!body) return;

  if (tab === 'markets') {
    const quotes = _currentData.quotes || [];
    body.innerHTML = `
      <div class="market-grid-container">
        ${quotes.map((q) => {
          const isUp = q.isPositive;
          const badgeClass = isUp ? 'price-up' : 'price-down';
          return `
            <div class="market-card clickable ${badgeClass}" data-symbol="${esc(q.symbol)}" tabindex="0" role="button" aria-label="${esc(q.name)} In-Depth Prognose ansehen">
              <div class="market-card-top">
                <span class="market-card-name">${esc(q.name)}</span>
                <span class="market-card-cat">${esc(q.category)}</span>
              </div>
              <div class="market-card-price-row">
                <span class="market-card-price">${typeof q.price === 'number' ? q.price.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 4 }) : q.price} <span class="market-card-unit">${esc(q.unit)}</span></span>
                <span class="market-card-badge ${badgeClass}">${esc(q.changePct)}</span>
              </div>
              <div class="market-card-meta">
                <span>Vortag: ${q.prevClose ? q.prevClose.toLocaleString('de-DE') : '—'}</span>
                <span>Tag: ${q.low ? q.low.toLocaleString('de-DE') : '—'} - ${q.high ? q.high.toLocaleString('de-DE') : '—'}</span>
              </div>
              <div class="market-card-hint">
                <span class="material-symbols-outlined" style="font-size: 13px; vertical-align: middle;">query_stats</span> In-Depth Prognose &amp; Kausalität ➔
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;

    // Add click listeners to market cards
    body.querySelectorAll('.market-card.clickable').forEach((card) => {
      const handleCardClick = () => {
        const symbol = card.dataset.symbol;
        if (symbol) openAssetDeepDive(symbol);
      };
      card.addEventListener('click', handleCardClick);
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleCardClick();
      });
    });
  } else if (tab === 'causality') {
    const impacts = _currentData.causalImpacts || [];
    body.innerHTML = `
      <div class="causality-container">
        <div class="causality-header-banner">
          <span class="material-symbols-outlined" style="color: #00d4ff;">psychology</span>
          <div>
            <strong>Abacus Kausalitäts-Modell</strong>
            <p>Ermittelt, wie sich aktive Militäroperationen, Sanktionen und maritime Blockaden direkt auf Rohstoff- und Aktienmärkte übertragen. Klicken Sie auf einen Vermögenswert für die In-Depth Prognose.</p>
          </div>
        </div>

        <div class="causality-list">
          ${impacts.map((imp) => {
            const sentimentClass = imp.sentimentType === 'bullish' ? 'sent-bullish' : (imp.sentimentType === 'bearish' ? 'sent-bearish' : 'sent-neutral');
            return `
              <div class="causality-card ${sentimentClass}">
                <div class="causality-card-header">
                  <div class="causality-sector-title">
                    <span class="material-symbols-outlined" style="font-size: 18px; vertical-align: middle;">${esc(imp.icon || 'analytics')}</span>
                    <strong>${esc(imp.sector)}</strong>
                  </div>
                  <span class="causality-sentiment-badge ${sentimentClass}">${esc(imp.sentiment)}</span>
                </div>

                <div class="causality-headline">${esc(imp.headline)}</div>
                <div class="causality-detail">${esc(imp.detail)}</div>

                <div class="causality-footer">
                  <div class="causality-assets">
                    ${(imp.assets || []).map((a) => {
                      const detected = detectSymbolFromPill(a);
                      return `
                        <button class="causality-asset-pill clickable" data-symbol="${esc(detected || '')}" type="button" title="In-Depth Prognose für diesen Wert aufrufen">
                          📊 ${esc(a)} <span style="font-size: 11px;">➔</span>
                        </button>
                      `;
                    }).join('')}
                  </div>
                  ${imp.relevantDispatchesCount ? `<span class="causality-event-count">📡 ${imp.relevantDispatchesCount} verknüpfte Sensor-Meldungen</span>` : ''}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;

    // Add click listeners to causality pills
    body.querySelectorAll('.causality-asset-pill.clickable').forEach((pill) => {
      pill.addEventListener('click', () => {
        const symbol = pill.dataset.symbol;
        if (symbol) {
          openAssetDeepDive(symbol);
        } else {
          // Fallback to markets tab
          const marketBtn = _modalElement.querySelector('.market-tab-btn[data-tab="markets"]');
          marketBtn?.click();
        }
      });
    });
  } else if (tab === 'sitrep') {
    const reg = _currentData.regionalSummary || {};
    const hotspots = reg.hotspots || [];
    body.innerHTML = `
      <div class="sitrep-summary-container">
        <div class="sitrep-kpi-row">
          <div class="sitrep-kpi-card">
            <span class="sitrep-kpi-value">${reg.totalDispatches || 0}</span>
            <span class="sitrep-kpi-label">AKTIVE SENSOR-EREIGNISSE</span>
          </div>
          <div class="sitrep-kpi-card kpi-critical">
            <span class="sitrep-kpi-value">${reg.criticalEvents || 0}</span>
            <span class="sitrep-kpi-label">KRITISCHE EREIGNISSE</span>
          </div>
          <div class="sitrep-kpi-card kpi-severe">
            <span class="sitrep-kpi-value">${reg.severeEvents || 0}</span>
            <span class="sitrep-kpi-label">ERHÖHTE BEDROHUNGEN</span>
          </div>
        </div>

        <div class="sitrep-theaters-block">
          <h3 class="sitrep-section-title">STRATEGISCHE THEATER &amp; LAGEAUFKLÄRUNG</h3>
          <div class="sitrep-theaters-list">
            ${hotspots.map((h) => `
              <div class="sitrep-theater-card ${h.active ? 'active-theater' : ''}">
                <div class="sitrep-theater-header">
                  <span class="theater-dot ${h.active ? 'dot-red' : 'dot-dim'}"></span>
                  <strong>${esc(h.name)}</strong>
                  <span class="theater-status">${h.active ? 'AKTIV' : 'RUHEND'}</span>
                </div>
                <p class="sitrep-theater-desc">${esc(h.description)}</p>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;
  }
}

/**
 * Opens the modal and triggers a data fetch.
 */
export async function openGlobalMarketSitrepModal(targetSymbol = null) {
  initGlobalMarketSitrepModal();
  _modalElement.classList.remove('hidden');
  if (targetSymbol) {
    await openAssetDeepDive(targetSymbol);
  } else {
    await loadMarketSitrepData();
  }
}

/**
 * Closes the modal.
 */
export function closeGlobalMarketSitrepModal() {
  if (_modalElement) {
    _modalElement.classList.add('hidden');
    const dropdown = _modalElement.querySelector('#market-search-dropdown');
    dropdown?.classList.add('hidden');
  }
}

// Expose on window for easy access from chat/voice
if (typeof window !== 'undefined') {
  window.__godsEyeView = window.__godsEyeView || {};
  window.__godsEyeView.openGlobalMarketSitrepModal = openGlobalMarketSitrepModal;
  window.__godsEyeView.openAssetDeepDive = openAssetDeepDive;
}

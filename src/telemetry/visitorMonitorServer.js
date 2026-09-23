/**
 * God's Eye View — Live Visitor Telemetry & Surveillance Radar Server Engine
 *
 * Tracks live incoming visitors, their geolocation, device characteristics,
 * active camera views, layer interactions, and real-time activity stream.
 *
 * Supports:
 * - Cloudflare Tunnel headers (CF-Connecting-IP, CF-IPCountry, CF-IPCity, CF-Region)
 * - Reverse proxy headers (X-Forwarded-For, X-Real-IP)
 * - Real-time heartbeat & camera telemetry
 * - Live Spectator mode coordination
 * - Optional simulated demo visitors for ops-room demonstration
 *
 * @module visitorMonitorServer
 */

/** Country code to flag emoji & name lookup */
export const COUNTRY_NAMES = {
  CH: { flag: '🇨🇭', name: 'Schweiz' },
  DE: { flag: '🇩🇪', name: 'Deutschland' },
  AT: { flag: '🇦🇹', name: 'Österreich' },
  US: { flag: '🇺🇸', name: 'USA' },
  GB: { flag: '🇬🇧', name: 'Großbritannien' },
  FR: { flag: '🇫🇷', name: 'Frankreich' },
  IT: { flag: '🇮🇹', name: 'Italien' },
  ES: { flag: '🇪🇸', name: 'Spanien' },
  NL: { flag: '🇳🇱', name: 'Niederlande' },
  SE: { flag: '🇸🇪', name: 'Schweden' },
  NO: { flag: '🇳🇴', name: 'Norwegen' },
  PL: { flag: '🇵🇱', name: 'Polen' },
  UA: { flag: '🇺🇦', name: 'Ukraine' },
  JP: { flag: '🇯🇵', name: 'Japan' },
  CN: { flag: '🇨🇳', name: 'China' },
  KR: { flag: '🇰🇷', name: 'Südkorea' },
  AU: { flag: '🇦🇺', name: 'Australien' },
  CA: { flag: '🇨🇦', name: 'Kanada' },
  BR: { flag: '🇧🇷', name: 'Brasilien' },
  IN: { flag: '🇮🇳', name: 'Indien' },
  IL: { flag: '🇮🇱', name: 'Israel' },
  AE: { flag: '🇦🇪', name: 'VAE' },
};

/** In-memory sessions store: sessionId -> Session Object */
const _sessions = new Map();

/** Global recent activity stream (capped at 100 entries) */
const _activityStream = [];

/** Flag for demo simulated traffic (false by default for 100% real visitors) */
let _demoSimulated = false;
let _lastDemoTick = 0;

/** Real-time camera spectator subscribers: Map<sessionId, Set<function(camera)>> */
const _spectatorSubscribers = new Map();

/** Demo orbit loop for active spectator on simulated session */
let _demoOrbitInterval = null;

/**
 * Parses user-agent header into clean OS, Browser, and Device category.
 * @param {string} ua
 * @returns {{ os: string, browser: string, device: 'Desktop'|'Mobile'|'Tablet' }}
 */
export function parseUserAgent(ua = '') {
  const s = String(ua || '');
  let os = 'Unbekannt';
  let browser = 'Browser';
  let device = 'Desktop';

  if (/iphone|ipod/i.test(s)) { os = 'iOS'; device = 'Mobile'; }
  else if (/ipad/i.test(s)) { os = 'iPadOS'; device = 'Tablet'; }
  else if (/android/i.test(s)) { os = 'Android'; device = 'Mobile'; }
  else if (/windows/i.test(s)) os = 'Windows';
  else if (/macintosh|mac os x/i.test(s)) os = 'macOS';
  else if (/linux/i.test(s)) os = 'Linux';

  if (/edg\//i.test(s)) browser = 'Edge';
  else if (/chrome|crios/i.test(s)) browser = 'Chrome';
  else if (/firefox|fxios/i.test(s)) browser = 'Firefox';
  else if (/safari/i.test(s) && !/chrome/i.test(s)) browser = 'Safari';

  return { os, browser, device };
}

/**
 * Formats/masks client IP address for privacy while keeping network identity.
 * @param {string} ip
 * @returns {string}
 */
export function maskIp(ip = '') {
  const clean = String(ip || '').replace(/^::ffff:/, '').trim();
  if (!clean || clean === '127.0.0.1' || clean === '::1') return 'Localhost (Operator)';
  const parts = clean.split('.');
  if (parts.length === 4) {
    return `${parts[0]}.${parts[1]}.***.***`;
  }
  const v6 = clean.split(':');
  if (v6.length > 3) {
    return `${v6[0]}:${v6[1]}:****:****`;
  }
  return clean;
}

/**
 * Resolves country & city from request headers.
 * @param {object} req Incoming HTTP request
 * @returns {{ countryCode: string, countryName: string, flag: string, city: string }}
 */
export function resolveGeoFromRequest(req) {
  const headers = req?.headers || {};
  let countryCode = String(headers['cf-ipcountry'] || '').toUpperCase().trim();
  let city = String(headers['cf-ipcity'] || '').trim();

  // Local loopback or intranet detection
  const ip = headers['cf-connecting-ip'] || headers['x-forwarded-for']?.split(',')[0]?.trim() || req?.socket?.remoteAddress || '';
  const isLocal = !ip || ip.includes('127.0.0.1') || ip === '::1' || ip.startsWith('192.168.') || ip.startsWith('10.');

  if (!countryCode && isLocal) {
    countryCode = 'CH';
    city = 'Zürich / Localhost';
  } else if (!countryCode) {
    countryCode = 'CH';
    city = city || 'Schweiz';
  }

  const meta = COUNTRY_NAMES[countryCode] || { flag: '🌐', name: countryCode || 'Global' };
  return {
    countryCode,
    countryName: meta.name,
    flag: meta.flag,
    city: city || meta.name,
  };
}

/**
 * Registers or updates a client ping / heartbeat.
 * @param {object} params
 * @returns {object} updated session
 */
export function recordVisitorPing({
  sessionId,
  ip,
  geo,
  userAgent,
  camera = null,
  viewName = null,
  activeLayers = [],
  action = null,
}) {
  if (!sessionId) return null;
  const now = Date.now();

  let session = _sessions.get(sessionId);
  if (!session) {
    const uaInfo = parseUserAgent(userAgent);
    session = {
      id: sessionId,
      ipMasked: maskIp(ip),
      countryCode: geo?.countryCode || 'CH',
      countryName: geo?.countryName || 'Schweiz',
      flag: geo?.flag || '🇨🇭',
      city: geo?.city || 'Zürich',
      os: uaInfo.os,
      browser: uaInfo.browser,
      device: uaInfo.device,
      firstSeen: now,
      lastSeen: now,
      requestsCount: 0,
      camera: camera || { latitude: 47.3769, longitude: 8.5417, altitude: 2500 },
      viewName: viewName || 'Zürich, Schweiz',
      activeLayers: Array.isArray(activeLayers) ? activeLayers : [],
      recentActions: [],
      isSimulated: false,
    };
    _sessions.set(sessionId, session);

    // Push session start to global stream
    pushActivityEvent({
      sessionId,
      flag: session.flag,
      city: session.city,
      action: 'Website betreten (Neue Sitzung gestartet)',
      category: 'SESSION',
      coords: session.camera,
    });
  }

  session.lastSeen = now;
  session.requestsCount++;
  if (camera) {
    session.camera = camera;
    broadcastCameraUpdate(sessionId, camera);
  }
  if (viewName) session.viewName = viewName;
  if (Array.isArray(activeLayers)) session.activeLayers = activeLayers;

  if (action) {
    session.recentActions.unshift({
      text: action,
      time: new Date(now).toISOString(),
    });
    if (session.recentActions.length > 25) session.recentActions.pop();

    pushActivityEvent({
      sessionId,
      flag: session.flag,
      city: session.city,
      action,
      category: 'ACTION',
      coords: session.camera,
    });
  }

  return session;
}

/**
 * Direct low-latency camera stream update from visitor.
 * @param {{ sessionId: string, camera: object }} params
 * @returns {object|null}
 */
export function recordCameraStream({ sessionId, camera }) {
  if (!sessionId || !camera) return null;
  const now = Date.now();
  let session = _sessions.get(sessionId);
  if (session) {
    session.camera = camera;
    session.lastSeen = now;
  }
  broadcastCameraUpdate(sessionId, camera);
  return session;
}

/**
 * Returns a specific session by ID.
 * @param {string} sessionId
 * @returns {object|null}
 */
export function getSession(sessionId) {
  return _sessions.get(sessionId) || null;
}

/**
 * Broadcasts camera update to all active SSE subscribers for this session.
 * @param {string} sessionId
 * @param {object} camera
 */
export function broadcastCameraUpdate(sessionId, camera) {
  if (!sessionId || !camera) return;
  const subs = _spectatorSubscribers.get(sessionId);
  if (subs && subs.size > 0) {
    const payload = {
      sessionId,
      camera,
      timestamp: Date.now(),
    };
    for (const callback of subs) {
      try {
        callback(payload);
      } catch {}
    }
  }
}

/**
 * Subscribes a listener (e.g. SSE response stream) to a visitor's camera updates.
 * @param {string} sessionId
 * @param {function} callback
 * @returns {function} unsubscribe function
 */
export function subscribeToVisitorCamera(sessionId, callback) {
  if (!sessionId || typeof callback !== 'function') {
    return () => {};
  }
  if (!_spectatorSubscribers.has(sessionId)) {
    _spectatorSubscribers.set(sessionId, new Set());
  }
  const set = _spectatorSubscribers.get(sessionId);
  set.add(callback);

  // If this is a simulated demo session, start active demo camera drift ticks
  const session = _sessions.get(sessionId);
  if (session?.isSimulated && !_demoOrbitInterval) {
    startDemoSpectatorDrift(sessionId);
  }

  return () => {
    const currentSet = _spectatorSubscribers.get(sessionId);
    if (currentSet) {
      currentSet.delete(callback);
      if (currentSet.size === 0) {
        _spectatorSubscribers.delete(sessionId);
      }
    }
    if (_spectatorSubscribers.size === 0 && _demoOrbitInterval) {
      clearInterval(_demoOrbitInterval);
      _demoOrbitInterval = null;
    }
  };
}

/**
 * Generates smooth active orbital camera updates for simulated demo sessions.
 * @param {string} targetSessionId
 */
function startDemoSpectatorDrift(targetSessionId) {
  if (_demoOrbitInterval) clearInterval(_demoOrbitInterval);
  let step = 0;
  _demoOrbitInterval = setInterval(() => {
    if (_spectatorSubscribers.size === 0) {
      clearInterval(_demoOrbitInterval);
      _demoOrbitInterval = null;
      return;
    }
    const session = _sessions.get(targetSessionId);
    if (!session || !session.isSimulated || !session.camera) return;

    step += 0.04;
    const baseLat = session.camera.latitude || 46.0;
    const baseLon = session.camera.longitude || 8.0;
    const baseAlt = session.camera.altitude || 5000;

    const smoothCam = {
      latitude: Number((baseLat + Math.sin(step) * 0.003).toFixed(5)),
      longitude: Number((baseLon + Math.cos(step) * 0.003).toFixed(5)),
      altitude: Math.round(baseAlt + Math.sin(step * 0.5) * 80),
      heading: Math.round((step * 15) % 360),
      pitch: -35 + Math.round(Math.sin(step) * 5),
      roll: 0,
    };
    session.camera = smoothCam;
    broadcastCameraUpdate(targetSessionId, smoothCam);
  }, 160);
}

/**
 * Appends a global activity event to the realtime feed.
 * @param {object} event
 */
export function pushActivityEvent(event) {
  const item = {
    id: `ev-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    time: new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    timestamp: Date.now(),
    ...event,
  };
  _activityStream.unshift(item);
  if (_activityStream.length > 80) _activityStream.pop();
}

/**
 * Generates initial simulated demo visitors so the monitor looks authentic and alive.
 */
function ensureDemoVisitors() {
  if (!_demoSimulated) return;
  const now = Date.now();
  if (now - _lastDemoTick < 6000) return;
  _lastDemoTick = now;

  const DEMO_TEMPLATES = [
    {
      id: 'demo-zurich-ch',
      city: 'Zürich',
      countryCode: 'CH',
      flag: '🇨🇭',
      countryName: 'Schweiz',
      ipMasked: '178.197.***.***',
      os: 'macOS',
      browser: 'Safari',
      device: 'Desktop',
      viewName: 'Matterhorn / Zermatt',
      camera: { latitude: 45.9763, longitude: 7.6586, altitude: 4500 },
      activeLayers: ['cctv', 'radar', 'traffic'],
      possibleActions: [
        'Roundshot-Webcam "Matterhorn" im 360°-Stream geöffnet',
        'Alpenrheintal nach Hoher Kasten navigiert',
        'Gotthard-Verkehrsdaten abgefragt',
        'Abacus Botnet Briefing für Schweizer Knoten aufgerufen',
      ],
    },
    {
      id: 'demo-berlin-de',
      city: 'Berlin',
      countryCode: 'DE',
      flag: '🇩🇪',
      countryName: 'Deutschland',
      ipMasked: '91.64.***.***',
      os: 'Windows',
      browser: 'Chrome',
      device: 'Desktop',
      viewName: 'Ostsee / Kaliningrad EW Sektor',
      camera: { latitude: 54.7104, longitude: 20.5117, altitude: 25000 },
      activeLayers: ['radar', 'flights'],
      possibleActions: [
        'GNSS Jamming-Sektor in der Ostsee inspiziert',
        'Lufthansa Flug LH182 über Polen getrackt',
        'Taktische Warnzone "Suwalki-Korridor" vergrößert',
        'Radar-Schutzradius auf 220 km gemessen',
      ],
    },
    {
      id: 'demo-tokyo-jp',
      city: 'Tokyo',
      countryCode: 'JP',
      flag: '🇯🇵',
      countryName: 'Japan',
      ipMasked: '133.242.***.***',
      os: 'iOS',
      browser: 'Safari',
      device: 'Mobile',
      viewName: 'Pazifischer Feuerring / Taiwan',
      camera: { latitude: 24.5000, longitude: 120.8000, altitude: 35000 },
      activeLayers: ['satellites', 'radar'],
      possibleActions: [
        'Erdbeben M5.8 in Taiwan angeklickt',
        'Starlink-Satelliten-Konstellation über Ostasien visualisiert',
        'Kameraflug nach Tokyo Haneda gestartet',
        'Tsunami-Warnsensorik im Pazifik überwacht',
      ],
    },
    {
      id: 'demo-newyork-us',
      city: 'New York',
      countryCode: 'US',
      flag: '🇺🇸',
      countryName: 'USA',
      ipMasked: '72.229.***.***',
      os: 'Windows',
      browser: 'Chrome',
      device: 'Desktop',
      viewName: 'Shelby County, Tennessee',
      camera: { latitude: 35.1495, longitude: -90.0490, altitude: 18000 },
      activeLayers: ['weather', 'flights'],
      possibleActions: [
        'Tornado-Gefahrenpolygon auf der 3D-Karte markiert',
        'Flug Delta Air Lines DL419 beobachtet',
        'Doppler-Radar Debris Ball telemetrisch erfasst',
        'SITREP "Tornado Lagebeurteilung" kopiert',
      ],
    },
  ];

  for (const t of DEMO_TEMPLATES) {
    let s = _sessions.get(t.id);
    if (!s) {
      s = {
        id: t.id,
        ipMasked: t.ipMasked,
        countryCode: t.countryCode,
        countryName: t.countryName,
        flag: t.flag,
        city: t.city,
        os: t.os,
        browser: t.browser,
        device: t.device,
        firstSeen: now - Math.floor(Math.random() * 600000 + 120000),
        lastSeen: now,
        requestsCount: Math.floor(Math.random() * 20 + 5),
        camera: t.camera,
        viewName: t.viewName,
        activeLayers: t.activeLayers,
        recentActions: [],
        isSimulated: true,
      };
      _sessions.set(t.id, s);
    }

    // Update last seen
    s.lastSeen = now;

    // Random action tick
    if (Math.random() < 0.45) {
      const act = t.possibleActions[Math.floor(Math.random() * t.possibleActions.length)];
      s.recentActions.unshift({ text: act, time: new Date(now).toISOString() });
      if (s.recentActions.length > 20) s.recentActions.pop();

      pushActivityEvent({
        sessionId: s.id,
        flag: s.flag,
        city: s.city,
        action: act,
        category: 'ACTION',
        coords: s.camera,
      });
    }
  }
}

/**
 * Returns full live monitor analytics & surveillance metrics.
 * @returns {object}
 */
export function getLiveMonitorStats() {
  ensureDemoVisitors();
  const now = Date.now();
  const ONLINE_THRESHOLD_MS = 25_000;

  const allSessions = Array.from(_sessions.values());
  const activeSessions = [];
  const historySessions = [];
  const countriesCount = {};

  for (const sess of allSessions) {
    const isOnline = now - sess.lastSeen < ONLINE_THRESHOLD_MS;
    const enriched = {
      ...sess,
      isOnline,
      durationSec: Math.floor((now - sess.firstSeen) / 1000),
      lastSeenSecAgo: Math.floor((now - sess.lastSeen) / 1000),
    };

    if (isOnline) {
      activeSessions.push(enriched);
      countriesCount[sess.countryCode] = (countriesCount[sess.countryCode] || 0) + 1;
    } else {
      historySessions.push(enriched);
    }
  }

  // Sort active sessions: real users first, then by lastSeen desc
  activeSessions.sort((a, b) => {
    if (a.isSimulated !== b.isSimulated) return a.isSimulated ? 1 : -1;
    return b.lastSeen - a.lastSeen;
  });

  return {
    ok: true,
    timestamp: new Date(now).toISOString(),
    activeCount: activeSessions.length,
    totalSessionsToday: allSessions.length,
    totalEventsLogged: _activityStream.length,
    demoSimulated: _demoSimulated,
    countriesBreakdown: countriesCount,
    activeSessions,
    recentEvents: _activityStream.slice(0, 40),
  };
}

/**
 * Toggles or sets demo simulated visitors.
 * @param {boolean} [enable]
 * @returns {boolean} current state
 */
export function setDemoSimulation(enable) {
  _demoSimulated = typeof enable === 'boolean' ? enable : !_demoSimulated;
  if (!_demoSimulated) {
    // Remove simulated sessions
    for (const [id, s] of _sessions.entries()) {
      if (s.isSimulated) _sessions.delete(id);
    }
  }
  return _demoSimulated;
}

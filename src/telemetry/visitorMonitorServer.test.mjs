import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseUserAgent,
  maskIp,
  resolveGeoFromRequest,
  recordVisitorPing,
  recordCameraStream,
  getLiveMonitorStats,
  setDemoSimulation,
  subscribeToVisitorCamera,
  getSession,
} from './visitorMonitorServer.js';

describe('visitorMonitorServer module', () => {
  it('parses user-agent strings properly', () => {
    const uaWin = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';
    const parsedWin = parseUserAgent(uaWin);
    assert.equal(parsedWin.os, 'Windows');
    assert.equal(parsedWin.browser, 'Chrome');
    assert.equal(parsedWin.device, 'Desktop');

    const uaIPhone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';
    const parsedIPhone = parseUserAgent(uaIPhone);
    assert.equal(parsedIPhone.os, 'iOS');
    assert.equal(parsedIPhone.browser, 'Safari');
    assert.equal(parsedIPhone.device, 'Mobile');
  });

  it('masks client IPs correctly', () => {
    assert.equal(maskIp('127.0.0.1'), 'Localhost (Operator)');
    assert.equal(maskIp('::1'), 'Localhost (Operator)');
    assert.equal(maskIp('178.197.12.34'), '178.197.***.***');
    assert.equal(maskIp('::ffff:192.168.1.50'), '192.168.***.***');
  });

  it('resolves Cloudflare headers into country and city', () => {
    const reqCF = {
      headers: {
        'cf-connecting-ip': '82.165.197.1',
        'cf-ipcountry': 'DE',
        'cf-ipcity': 'Frankfurt',
      },
    };
    const geo = resolveGeoFromRequest(reqCF);
    assert.equal(geo.countryCode, 'DE');
    assert.equal(geo.countryName, 'Deutschland');
    assert.equal(geo.flag, '🇩🇪');
    assert.equal(geo.city, 'Frankfurt');

    const reqLocal = {
      headers: {
        'cf-connecting-ip': '127.0.0.1',
      },
    };
    const geoLocal = resolveGeoFromRequest(reqLocal);
    assert.equal(geoLocal.countryCode, 'CH');
    assert.ok(geoLocal.city.includes('Zürich'));
  });

  it('records visitor ping, camera position, and actions', () => {
    const sess = recordVisitorPing({
      sessionId: 'test-session-123',
      ip: '178.197.100.20',
      geo: { countryCode: 'CH', countryName: 'Schweiz', flag: '🇨🇭', city: 'Zürich' },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      camera: { latitude: 47.3769, longitude: 8.5417, altitude: 1200 },
      viewName: 'Zürich Hauptbahnhof',
      activeLayers: ['cctv', 'flights'],
      action: 'Kameraflug nach Zürich Hauptbahnhof gestartet',
    });

    assert.ok(sess);
    assert.equal(sess.id, 'test-session-123');
    assert.equal(sess.flag, '🇨🇭');
    assert.equal(sess.viewName, 'Zürich Hauptbahnhof');
    assert.equal(sess.activeLayers.length, 2);
    assert.equal(sess.recentActions.length, 1);

    const stats = getLiveMonitorStats();
    assert.ok(stats.ok);
    assert.ok(stats.activeCount >= 1);
    const found = stats.activeSessions.find((s) => s.id === 'test-session-123');
    assert.ok(found);
    assert.equal(found.isOnline, true);
    assert.equal(found.isSimulated, false);
  });

  it('streams camera updates to zero-delay subscribers', () => {
    const receivedUpdates = [];
    const unsubscribe = subscribeToVisitorCamera('test-stream-session', (data) => {
      receivedUpdates.push(data);
    });

    // Create session
    recordVisitorPing({
      sessionId: 'test-stream-session',
      ip: '127.0.0.1',
      geo: { countryCode: 'CH', city: 'Bern' },
      camera: { latitude: 46.948, longitude: 7.447, altitude: 1500 },
    });

    // Now push low-latency camera stream
    const updated = recordCameraStream({
      sessionId: 'test-stream-session',
      camera: { latitude: 46.950, longitude: 7.450, altitude: 1200, heading: 45, pitch: -30, roll: 0 },
    });

    assert.ok(updated);
    assert.equal(updated.camera.latitude, 46.950);
    assert.ok(receivedUpdates.length >= 1);
    const last = receivedUpdates[receivedUpdates.length - 1];
    assert.equal(last.sessionId, 'test-stream-session');
    assert.equal(last.camera.latitude, 46.950);
    assert.equal(last.camera.heading, 45);

    unsubscribe();
  });

  it('toggles demo simulation and removes bots when disabled', () => {
    const activeBefore = setDemoSimulation(true);
    assert.equal(activeBefore, true);

    const activeAfter = setDemoSimulation(false);
    assert.equal(activeAfter, false);

    const stats = getLiveMonitorStats();
    assert.equal(stats.demoSimulated, false);
    // All active sessions must be real
    for (const s of stats.activeSessions) {
      assert.equal(s.isSimulated, false);
    }
  });
});

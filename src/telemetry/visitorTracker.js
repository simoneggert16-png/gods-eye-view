/**
 * God's Eye View — Client-side Visitor Telemetry Reporter
 *
 * Automatically reports visitor presence, camera coordinates,
 * layer changes, and interactive actions back to the local telemetry server.
 *
 * @module visitorTracker
 */

class VisitorTracker {
  constructor() {
    this.sessionId = this._getOrCreateSessionId();
    this.viewer = null;
    this.app = null;
    this.currentViewName = 'Schweiz / Europa';
    this.activeLayers = [];
    this._heartbeatTimer = null;
    this._spectatingSessionId = null;
    this._spectatorTimer = null;
    this._lastCameraReportTime = 0;
  }

  _getOrCreateSessionId() {
    let id = null;
    try {
      id = sessionStorage.getItem('gev_visitor_session_id');
      if (!id) {
        id = `usr-${Date.now().toString(36).slice(-4)}-${Math.random().toString(36).slice(2, 6)}`;
        sessionStorage.setItem('gev_visitor_session_id', id);
      }
    } catch {
      id = `usr-${Date.now().toString(36).slice(-4)}-${Math.random().toString(36).slice(2, 6)}`;
    }
    return id;
  }

  init({ viewer, app = null } = {}) {
    this.viewer = viewer;
    this.app = app;

    // Send initial session start
    this.logAction('Website aufgerufen (Sitzung gestartet)');

    // Start 3.5-second heartbeat for general presence and layer updates
    if (this._heartbeatTimer) clearInterval(this._heartbeatTimer);
    this._heartbeatTimer = setInterval(() => {
      this.sendHeartbeat();
    }, 3500);

    // Bind real-time camera movement tracking (150ms throttle for zero-delay spectator)
    this._bindRealtimeCameraEvents();

    // Initial heartbeat
    void this.sendHeartbeat();
  }

  _bindRealtimeCameraEvents() {
    if (!this.viewer?.camera) return;
    const onMove = () => {
      const now = Date.now();
      if (now - this._lastCameraReportTime < 140) return;
      this._lastCameraReportTime = now;
      this.sendCameraStream();
    };

    try {
      if (this.viewer.camera.changed?.addEventListener) {
        this.viewer.camera.changed.addEventListener(onMove);
      }
      if (this.viewer.camera.moveEnd?.addEventListener) {
        this.viewer.camera.moveEnd.addEventListener(onMove);
      }
    } catch {}
  }

  getCameraCoords() {
    if (!this.viewer?.camera) return null;
    try {
      const cart = this.viewer.camera.positionCartographic;
      if (!cart) return null;
      const Cesium = window.Cesium;
      const toDeg = Cesium?.Math?.toDegrees || ((rad) => (rad * 180) / Math.PI);
      const cam = this.viewer.camera;
      return {
        latitude: Number(toDeg(cart.latitude).toFixed(5)),
        longitude: Number(toDeg(cart.longitude).toFixed(5)),
        altitude: Math.round(cart.height || 10000),
        heading: cam.heading != null ? Math.round(toDeg(cam.heading)) : 0,
        pitch: cam.pitch != null ? Math.round(toDeg(cam.pitch)) : -45,
        roll: cam.roll != null ? Math.round(toDeg(cam.roll)) : 0,
      };
    } catch {
      return null;
    }
  }

  async sendCameraStream() {
    const coords = this.getCameraCoords();
    if (!coords) return;
    try {
      await fetch('/api/telemetry/camera-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: this.sessionId,
          camera: coords,
        }),
        keepalive: true,
      });
    } catch {}
  }

  updateActiveLayers(layers = []) {
    if (Array.isArray(layers)) {
      this.activeLayers = layers;
    }
  }

  setViewName(name) {
    if (name && typeof name === 'string') {
      this.currentViewName = name;
    }
  }

  async sendHeartbeat(action = null) {
    const coords = this.getCameraCoords();
    const payload = {
      sessionId: this.sessionId,
      camera: coords,
      viewName: this.currentViewName,
      activeLayers: this.activeLayers,
      action,
    };

    try {
      const res = await fetch('/api/telemetry/ping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const data = await res.json();
        // Update top bar pulse badge
        const badge = document.getElementById('monitor-pulse-badge');
        if (badge && data.activeCount != null) {
          badge.textContent = String(data.activeCount);
        }
      }
    } catch {}
  }

  logAction(actionText, meta = {}) {
    if (meta.viewName) this.currentViewName = meta.viewName;
    if (Array.isArray(meta.activeLayers)) this.activeLayers = meta.activeLayers;
    void this.sendHeartbeat(actionText);
  }
}

export const visitorTracker = new VisitorTracker();

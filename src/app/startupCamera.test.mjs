import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { flyToStartView } from '../camera.js';

const DEG = 180 / Math.PI;

/** lon/lat/height of a cartesian camera destination, in degrees and metres. */
function placeOf(cartesian) {
  const carto = Cesium.Cartographic.fromCartesian(cartesian);
  return {
    lon: carto.longitude * DEG,
    lat: carto.latitude * DEG,
    height: carto.height,
  };
}

function fakeViewer({
  lon = 9.6295451,
  lat = 47.4157283,
  height = 409.8,
} = {}) {
  const calls = { setView: [], flyTo: [], cancelled: 0 };
  return {
    calls,
    viewer: {
      isDestroyed: () => false,
      camera: {
        positionWC: Cesium.Cartesian3.fromDegrees(lon, lat, height),
        setView(options) {
          calls.setView.push(options);
        },
        flyTo(options) {
          calls.flyTo.push(options);
        },
        cancelFlight() {
          calls.cancelled++;
        },
      },
    },
  };
}

test('teardown before the initial camera delay prevents a late flight', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { viewer, calls } = fakeViewer();
  const stop = flyToStartView(viewer);
  stop();
  t.mock.timers.tick(5000);
  assert.equal(calls.flyTo.length, 0);
  assert.equal(calls.cancelled, 1);
});

test('the wall opens on a clean 3D overview above the school forecourt', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { viewer, calls } = fakeViewer();
  flyToStartView(viewer);

  // The load state hovers just above the school, looking down.
  const staged = calls.setView[0];
  const high = placeOf(staged.destination);
  assert.ok(Math.abs(high.lon - 9.6295451) < 1e-5, `staged lon ${high.lon}`);
  assert.ok(Math.abs(high.lat - 47.4157283) < 1e-5, `staged lat ${high.lat}`);
  assert.ok(Math.abs(high.height - 900) < 0.01, `staged height ${high.height}`);
  assert.equal(staged.orientation.pitch * DEG, -90);

  // The approach lands ~95 m above the forecourt: ground 408 m orthometric +
  // 46.6 m EGM96 undulation + 95 m clearance. Eye height in ellipsoidal
  // coordinates would sit ~45 m inside the Google 3D tile mesh.
  t.mock.timers.tick(150);
  assert.equal(calls.flyTo.length, 1);
  const flight = calls.flyTo[0];
  const landing = placeOf(flight.destination);
  assert.ok(
    Math.abs(landing.lon - 9.6295451) < 1e-5,
    `landing lon ${landing.lon}`,
  );
  assert.ok(
    Math.abs(landing.lat - 47.4157283) < 1e-5,
    `landing lat ${landing.lat}`,
  );
  assert.ok(
    Math.abs(landing.height - 549.6) < 0.05,
    `landing height ${landing.height}`,
  );
  assert.ok(
    Math.abs(flight.orientation.heading * DEG - 270.5) < 0.01,
    `heading ${flight.orientation.heading * DEG}`,
  );
  assert.ok(
    Math.abs(flight.orientation.pitch * DEG + 22) < 0.01,
    `pitch ${flight.orientation.pitch * DEG}`,
  );

  // A cancelled, clamped or otherwise deflected approach is snapped back to the
  // exact pose once the flight would have landed.
  t.mock.timers.tick(2750);
  assert.equal(calls.setView.length, 2);
  const settled = calls.setView[1];
  const snap = placeOf(settled.destination);
  assert.ok(Math.abs(snap.lon - 9.6295451) < 1e-5);
  assert.ok(Math.abs(snap.lat - 47.4157283) < 1e-5);
  assert.ok(Math.abs(snap.height - 549.6) < 0.05);
  assert.ok(Math.abs(settled.orientation.heading * DEG - 270.5) < 0.01);
  assert.ok(Math.abs(settled.orientation.pitch * DEG + 22) < 0.01);
});

test('a navigation away before the settle frame is never snapped back', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  // Buchs SG: a voice or pointer navigation already owns the camera.
  const { viewer, calls } = fakeViewer({
    lon: 9.4764,
    lat: 47.1628,
    height: 2000,
  });
  flyToStartView(viewer);
  t.mock.timers.tick(2900);
  assert.equal(calls.setView.length, 1, 'only the staging view is set');
});

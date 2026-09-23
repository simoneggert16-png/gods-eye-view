import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SEED_MISSILE_TESTS,
  SEED_MILITARY_CONVOYS,
  SEED_CAMPAIGN_TRAILS,
  SEED_SECRET_SERVICE_OPS,
  isValidCoordinate,
  computeTrajectoryArc,
} from './specialOpsEngine.js';

test('specialOpsEngine coordinates and trajectories', () => {
  assert.equal(isValidCoordinate([10.5, 45.2]), true);
  assert.equal(isValidCoordinate([-120.5, 34.0]), true);
  assert.equal(isValidCoordinate([200, 45]), false);
  assert.equal(isValidCoordinate([10, 95]), false);
  assert.equal(isValidCoordinate(null), false);

  const arc = computeTrajectoryArc(-120, 34, 167, 8, 1000000, 20);
  assert.equal(arc.length, 21);
  assert.equal(arc[0].alt, 0);
  assert.equal(arc[arc.length - 1].alt, 0);
  assert.ok(arc[10].alt > 800000);
});

test('SEED_MISSILE_TESTS dataset integrity', () => {
  assert.ok(SEED_MISSILE_TESTS.length >= 4);
  for (const mt of SEED_MISSILE_TESTS) {
    assert.ok(mt.id);
    assert.ok(mt.name);
    assert.ok(isValidCoordinate([mt.launchSite.lon, mt.launchSite.lat]));
    assert.ok(isValidCoordinate([mt.targetSite.lon, mt.targetSite.lat]));
    assert.ok(mt.apogeeKm > 0);
    assert.ok(Array.isArray(mt.notamHazardBox));
    for (const pt of mt.notamHazardBox) {
      assert.ok(isValidCoordinate(pt));
    }
  }
});

test('SEED_MILITARY_CONVOYS dataset integrity', () => {
  assert.ok(SEED_MILITARY_CONVOYS.length >= 3);
  for (const cv of SEED_MILITARY_CONVOYS) {
    assert.ok(cv.id);
    assert.ok(cv.name);
    assert.ok(cv.vehicleCount > 0);
    assert.ok(Array.isArray(cv.route) && cv.route.length >= 2);
    for (const pt of cv.route) {
      assert.ok(isValidCoordinate(pt));
    }
    assert.ok(Array.isArray(cv.checkpoints) && cv.checkpoints.length >= 2);
    for (const cp of cv.checkpoints) {
      assert.ok(isValidCoordinate([cp.lon, cp.lat]));
    }
  }
});

test('SEED_CAMPAIGN_TRAILS dataset integrity', () => {
  assert.ok(SEED_CAMPAIGN_TRAILS.length >= 2);
  for (const ct of SEED_CAMPAIGN_TRAILS) {
    assert.ok(ct.id);
    assert.ok(ct.title);
    assert.ok(Array.isArray(ct.legs) && ct.legs.length >= 1);
    for (const leg of ct.legs) {
      assert.ok(Array.isArray(leg.coords) && leg.coords.length >= 2);
      for (const pt of leg.coords) {
        assert.ok(isValidCoordinate(pt));
      }
    }
    assert.ok(Array.isArray(ct.stops) && ct.stops.length >= 1);
    for (const stop of ct.stops) {
      assert.ok(isValidCoordinate([stop.lon, stop.lat]));
    }
  }
});

test('SEED_SECRET_SERVICE_OPS dataset integrity', () => {
  assert.ok(SEED_SECRET_SERVICE_OPS.length >= 2);
  for (const op of SEED_SECRET_SERVICE_OPS) {
    assert.ok(op.id);
    assert.ok(op.operation);
    assert.ok(isValidCoordinate([op.tfr.center.lon, op.tfr.center.lat]));
    assert.ok(op.tfr.innerRadiusM > 0);
    assert.ok(Array.isArray(op.motorcade.primaryRoute));
    for (const pt of op.motorcade.primaryRoute) {
      assert.ok(isValidCoordinate(pt));
    }
    assert.ok(Array.isArray(op.perimeters.inner));
    for (const pt of op.perimeters.inner) {
      assert.ok(isValidCoordinate(pt));
    }
    assert.ok(isValidCoordinate([op.traumaHospital.lon, op.traumaHospital.lat]));
  }
});

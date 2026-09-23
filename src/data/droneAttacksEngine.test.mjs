import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SEED_DRONE_ATTACKS,
  SEED_TERROR_ATTACKS,
} from './droneAttacksEngine.js';
import droneAttacksLayer from './droneAttacksLayer.js';
import terrorAttacksLayer from './terrorAttacksLayer.js';

test('SEED_DRONE_ATTACKS dataset integrity', () => {
  assert.ok(SEED_DRONE_ATTACKS.length >= 8, 'must contain at least 8 drone attacks');
  for (const da of SEED_DRONE_ATTACKS) {
    assert.ok(da.id, `drone attack must have id`);
    assert.ok(da.title, `drone attack ${da.id} must have title`);
    assert.ok(da.droneType, `drone attack ${da.id} must have droneType`);
    assert.ok(da.swarmSize > 0, `drone attack ${da.id} swarmSize must be > 0`);
    assert.ok(Number.isFinite(da.target.lat) && Number.isFinite(da.target.lon), `target coords valid for ${da.id}`);
    assert.ok(Number.isFinite(da.launchOrigin.lat) && Number.isFinite(da.launchOrigin.lon), `launchOrigin coords valid for ${da.id}`);
    assert.ok(da.severity >= 1 && da.severity <= 10, `severity valid for ${da.id}`);
    assert.ok(da.impactRadiusM >= 500 && da.impactRadiusM <= 5000, `impactRadiusM in range for ${da.id}`);
    assert.ok(Array.isArray(da.impactPoints) && da.impactPoints.length >= 1, `impactPoints present for ${da.id}`);
    for (const ip of da.impactPoints) {
      assert.ok(Number.isFinite(ip.lat) && Number.isFinite(ip.lon), `impact point ${ip.id} coords valid`);
      assert.ok(typeof ip.name === 'string' && ip.name.length > 0);
      assert.ok(ip.craterDiameterM >= 0, 'craterDiameterM must be non-negative');
      assert.ok(typeof ip.damageStatus === 'string' && ip.damageStatus.length > 0, 'damageStatus must be detailed');
    }
  }
});

test('SEED_TERROR_ATTACKS dataset integrity', () => {
  assert.ok(SEED_TERROR_ATTACKS.length >= 7, 'must contain at least 7 terror attacks');
  for (const ta of SEED_TERROR_ATTACKS) {
    assert.ok(ta.id, `terror attack must have id`);
    assert.ok(ta.title, `terror attack ${ta.id} must have title`);
    assert.ok(ta.type, `terror attack ${ta.id} must have type`);
    assert.ok(ta.perpetrator, `terror attack ${ta.id} must have perpetrator`);
    assert.ok(Number.isFinite(ta.location.lat) && Number.isFinite(ta.location.lon), `location coords valid for ${ta.id}`);
    assert.ok(ta.casualties.killed >= 0, `casualties.killed valid for ${ta.id}`);
    assert.ok(ta.casualties.wounded >= 0, `casualties.wounded valid for ${ta.id}`);
    assert.ok(ta.severity >= 1 && ta.severity <= 10, `severity valid for ${ta.id}`);
    assert.ok(ta.impactRadiusM >= 500 && ta.impactRadiusM <= 5000, `impactRadiusM in range for ${ta.id}`);
  }
});

test('droneAttacksLayer & terrorAttacksLayer lifecycle contracts', () => {
  const fakeViewer = {
    entities: {
      add: (ent) => ent,
      remove: () => {},
    },
  };

  const layers = [droneAttacksLayer, terrorAttacksLayer];

  for (const layer of layers) {
    assert.ok(typeof layer.id === 'string' && layer.id.length > 0);
    assert.ok(typeof layer.name === 'string');
    assert.ok(typeof layer.icon === 'string');
    assert.equal(layer.showInTogglePanel, true);

    layer.init(fakeViewer);
    assert.equal(layer.isEnabled(), false);

    layer.enable();
    assert.equal(layer.isEnabled(), true);
    const stats = layer.getStats();
    assert.ok(stats.count > 0, `${layer.id} stats count must be > 0`);

    layer.disable();
    assert.equal(layer.isEnabled(), false);
  }
});

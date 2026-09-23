import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SEED_CONFLICT_ZONES,
  SEED_FRONTLINES,
  SEED_MISSILE_STRIKES,
  SEED_BATTLES,
  SEED_BOMBARDMENTS,
  getIntensityColor
} from './militaryConflictEngine.js';
import conflictsLayer from './conflictsLayer.js';
import frontlinesLayer from './frontlinesLayer.js';
import missileStrikesLayer from './missileStrikesLayer.js';
import battlesLayer from './battlesLayer.js';
import bombardmentsLayer from './bombardmentsLayer.js';

test('militaryConflictEngine: verifies seed datasets for all 5 layers', () => {
  assert.ok(SEED_CONFLICT_ZONES.length >= 5, 'must contain major global conflict zones');
  assert.ok(SEED_FRONTLINES.length >= 3, 'must contain major frontlines');
  assert.ok(SEED_MISSILE_STRIKES.length >= 4, 'must contain missile/drone strikes');
  assert.ok(SEED_BATTLES.length >= 4, 'must contain ground battles');
  assert.ok(SEED_BOMBARDMENTS.length >= 4, 'must contain bombardments');

  // Verify coordinates format
  for (const cz of SEED_CONFLICT_ZONES) {
    assert.ok(Number.isFinite(cz.center.lat) && Number.isFinite(cz.center.lon));
    assert.ok(Array.isArray(cz.polygon) && cz.polygon.length >= 3);
  }

  for (const fl of SEED_FRONTLINES) {
    assert.ok(Array.isArray(fl.segments) && fl.segments.length > 0);
    for (const seg of fl.segments) {
      assert.ok(Array.isArray(seg.coords) && seg.coords.length >= 2);
    }
  }

  for (const ms of SEED_MISSILE_STRIKES) {
    assert.ok(Number.isFinite(ms.target.lat) && Number.isFinite(ms.target.lon));
    assert.ok(Array.isArray(ms.impactPoints) && ms.impactPoints.length >= 1, `strike ${ms.id} must have impactPoints`);
    for (const ip of ms.impactPoints) {
      assert.ok(Number.isFinite(ip.lat) && Number.isFinite(ip.lon), `impact point ${ip.id} coordinates valid`);
      assert.ok(typeof ip.name === 'string' && ip.name.length > 0);
      assert.ok(ip.craterDiameterM >= 0, 'craterDiameterM must be non-negative');
      assert.ok(typeof ip.damageStatus === 'string' && ip.damageStatus.length > 0, 'damageStatus must be detailed');
    }
  }

  for (const bt of SEED_BATTLES) {
    assert.ok(Number.isFinite(bt.location.lat) && Number.isFinite(bt.location.lon));
  }

  for (const bm of SEED_BOMBARDMENTS) {
    assert.ok(Number.isFinite(bm.target.lat) && Number.isFinite(bm.target.lon));
    assert.ok(Array.isArray(bm.impactPoints) && bm.impactPoints.length >= 1, `bombardment ${bm.id} must have impactPoints`);
    for (const ip of bm.impactPoints) {
      assert.ok(Number.isFinite(ip.lat) && Number.isFinite(ip.lon), `impact point ${ip.id} coordinates valid`);
      assert.ok(typeof ip.name === 'string' && ip.name.length > 0);
      assert.ok(ip.craterDiameterM >= 0, 'craterDiameterM must be non-negative');
      assert.ok(typeof ip.damageStatus === 'string' && ip.damageStatus.length > 0, 'damageStatus must be detailed');
    }
  }
});

test('militaryConflictEngine: layer lifecycle contracts', () => {
  const fakeViewer = {
    entities: {
      add: (ent) => ent,
      remove: () => {},
    }
  };

  const layers = [
    conflictsLayer,
    frontlinesLayer,
    missileStrikesLayer,
    battlesLayer,
    bombardmentsLayer,
  ];

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

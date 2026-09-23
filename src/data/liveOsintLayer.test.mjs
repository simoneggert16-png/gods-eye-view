import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SEED_OSINT_RECORDS,
  liveOsintLayer,
  fetchLiveOsintData,
} from './liveOsintLayer.js';

test('SEED_OSINT_RECORDS dataset integrity', () => {
  assert.ok(SEED_OSINT_RECORDS.length >= 4, 'must contain at least 4 seed OSINT records');

  for (const rec of SEED_OSINT_RECORDS) {
    assert.ok(rec.id, 'must have id');
    assert.ok(rec.title, 'must have title');
    assert.ok(rec.channel, 'must have channel');
    assert.ok(rec.locationName, 'must have locationName');
    assert.ok(Number.isFinite(rec.latitude) && Number.isFinite(rec.longitude), `coords valid for ${rec.id}`);
    assert.ok(rec.impactRadiusM >= 1000, `impactRadiusM valid for ${rec.id}`);
    assert.ok(rec.summary, `summary present for ${rec.id}`);
    assert.ok(rec.isLiveOsint, 'isLiveOsint flag must be true');
  }
});

test('liveOsintLayer lifecycle contract', () => {
  const addedEntities = [];
  const removedEntities = [];

  const fakeViewer = {
    entities: {
      add: (ent) => {
        addedEntities.push(ent);
        return ent;
      },
      remove: (ent) => {
        removedEntities.push(ent);
      },
    },
  };

  assert.equal(liveOsintLayer.id, 'live-osint');
  assert.equal(liveOsintLayer.name, 'Live OSINT / Telegram');
  assert.equal(liveOsintLayer.icon, '📡');
  assert.equal(liveOsintLayer.showInTogglePanel, true);

  liveOsintLayer.init(fakeViewer);
  assert.equal(liveOsintLayer.isEnabled(), false);

  liveOsintLayer.enable();
  assert.equal(liveOsintLayer.isEnabled(), true);
  assert.ok(addedEntities.length > 0, 'must have created Cesium entities on enable');

  const stats = liveOsintLayer.getStats();
  assert.ok(stats.count >= SEED_OSINT_RECORDS.length);
  assert.equal(stats.status, 'nominal');

  const records = liveOsintLayer.getRecords();
  assert.equal(records.length, stats.count);

  liveOsintLayer.disable();
  assert.equal(liveOsintLayer.isEnabled(), false);
  assert.ok(removedEntities.length >= addedEntities.length);
});

test('fetchLiveOsintData geoparses and merges live messages with mock fetch', async () => {
  const mockFetch = async () => ({
    ok: true,
    json: async () => ({
      ok: true,
      messages: [
        {
          id: 'tg-live-test-1',
          channel: 'kpszsu',
          text: 'Shahed drones flying low over Sumy oblast.',
          timestamp: '2026-09-21T23:00:00Z',
        },
      ],
    }),
  });

  const records = await fetchLiveOsintData({ forceRefresh: true, fetchImpl: mockFetch });
  assert.ok(Array.isArray(records));
  const newRec = records.find((r) => r.id === 'tg-live-test-1');
  assert.ok(newRec, 'new live record must be geoparsed and merged');
  assert.equal(newRec.locationName, 'Sumy, Ukraine');
  assert.equal(newRec.category, 'DROHNENANGRIFF');
});

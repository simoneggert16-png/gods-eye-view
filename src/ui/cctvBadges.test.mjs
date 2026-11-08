import test from 'node:test';
import assert from 'node:assert/strict';
import { presentCctvSourceBadge } from './cctvFrames.js';
import { presentCctvPanel, presentCctvAge } from './cctvPresentation.js';
import { setLocale, t } from '../i18n/index.js';

const IDLE = Object.freeze({ loading: false, error: false, hasFrame: false });

test('source and frame states retain their distinct meanings, including retained pixels', () => {
  const camera = { sourceKind: 'snapshot', sourceStatus: 'degraded' };
  const expect = (label, state, frame, active = camera, enabled = true) =>
    assert.deepEqual(presentCctvSourceBadge(active, enabled, frame), {
      label,
      state,
    });
  expect('SOURCE · UNKNOWN', 'idle', IDLE, camera, false);
  expect('SOURCE · UNKNOWN', 'idle', IDLE, null);
  expect('FRAME · LOADING', 'loading', { ...IDLE, loading: true });
  expect('FRAME · UNAVAILABLE', 'error', { ...IDLE, error: true });
  // A refresh failure keeps the settled pixels and the provider's source status.
  const retained = { ...IDLE, error: true, hasFrame: true };
  expect('SNAPSHOT · DEGRADED', 'ready', retained);
  expect('SNAPSHOT · DEGRADED', 'ready', { ...retained, loading: true });
  for (const status of ['ok', 'error', 'unknown', 'vendor-specific']) {
    expect(`SNAPSHOT · ${status.toUpperCase()}`, 'ready', IDLE, {
      ...camera,
      sourceStatus: status,
    });
  }
  expect('LIVE · OK', 'ready', IDLE, { feedType: 'live', sourceStatus: 'ok' });
});

test('calibration labels follow supplied provenance and dirty/save/reset transitions without writes to the camera', () => {
  const cases = [
    ['raw-prior', false, 'CAL · RAW PRIOR'],
    ['curated', false, 'CAL · CURATED'],
    ['curated', true, 'CAL · EDITED (UNSAVED)'],
    ['calibrated', false, 'CAL · CALIBRATED'],
    ['calibrated', true, 'CAL · EDITED (UNSAVED)'],
    ['raw-prior', false, 'CAL · RAW PRIOR'],
    [null, false, 'CAL · --'],
  ];
  for (const [calBadge, calDirty, label] of cases) {
    const activeCamera = Object.freeze({ id: 'a', calBadge, calDirty });
    const { quality } = presentCctvPanel(
      { enabled: true, activeCameraId: 'a', activeCamera },
      true,
    );
    assert.deepEqual(quality, {
      label,
      calBadge: calDirty ? 'edited' : calBadge || '',
    });
  }
  assert.deepEqual(presentCctvPanel(null, false).quality, {
    label: 'CAL · --',
    calBadge: '',
  });
});

test('localization changes badge copy while preserving machine state ids', (testContext) => {
  testContext.after(() => setLocale('en'));
  setLocale('ru');
  const badge = presentCctvSourceBadge(
    { sourceKind: 'snapshot', sourceStatus: 'degraded' },
    true,
    IDLE,
  );
  assert.equal(badge.label, `${t('SNAPSHOT')} · ${t('DEGRADED')}`);
  assert.notEqual(badge.label, 'SNAPSHOT · DEGRADED');
  assert.equal(badge.state, 'ready');
  const { quality } = presentCctvPanel(
    {
      enabled: true,
      activeCameraId: 'a',
      activeCamera: { id: 'a', calBadge: 'curated', calDirty: true },
    },
    true,
  );
  assert.deepEqual(quality, {
    label: t('CAL · EDITED (UNSAVED)'),
    calBadge: 'edited',
  });
});

test('the age line tells a provider-stated shot age from a fetch-time frame age', () => {
  const now = 1_800_000_000_000;
  // A pack that states when it republished the picture (Windy) gives the shot's
  // age; the panel says SHOT, not FRAME.
  assert.deepEqual(
    presentCctvAge({ capturedAt: now - 3 * 60_000 }, null, now),
    { text: 'SHOT · 3m ago', tone: 'fresh', ageMs: 3 * 60_000 },
  );
  assert.equal(
    presentCctvAge({ capturedAt: now - 45 * 60_000 }, null, now).tone,
    'stale',
  );
  assert.equal(
    presentCctvAge({ capturedAt: now - 30 * 3600_000 }, null, now).tone,
    'old',
  );
  // A clock skew of a few seconds is not a capture in the future.
  assert.equal(
    presentCctvAge(
      { capturedAt: now + 60_000 },
      { loadedAt: now - 20_000 },
      now,
    ).text,
    'FRAME · 20s ago',
  );
  // Silent packs: the age of what we fetched, never a guessed capture time.
  assert.deepEqual(
    presentCctvAge({ capturedAt: 0 }, { loadedAt: now - 3_600_000 }, now),
    {
      text: 'FRAME · 1h ago',
      tone: 'known',
      ageMs: 3_600_000,
    },
  );
  assert.deepEqual(presentCctvAge({}, IDLE, now), {
    text: 'SHOT · --',
    tone: 'unknown',
    ageMs: null,
  });
  // A video feed has no still-shot age at all.
  assert.deepEqual(presentCctvAge({ isVideo: true }, null, now), {
    text: 'LIVE FEED',
    tone: 'live',
    ageMs: 0,
  });
  assert.equal(presentCctvAge(null, null, now), null);
  // The panel carries it, so the view renders it. `presentCctvPanel` reads the
  // real clock, so this camera is stamped against it.
  const real = Date.now();
  const view = presentCctvPanel(
    {
      enabled: true,
      activeCameraId: 'a',
      activeCamera: { id: 'a', capturedAt: real - 60_000 },
    },
    true,
    IDLE,
  );
  assert.equal(view.age.text, 'SHOT · 1m ago');
  assert.equal(view.refreshDisabled, false);
});

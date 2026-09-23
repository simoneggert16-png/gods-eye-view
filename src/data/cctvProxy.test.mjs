import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CCTV_FRAME_FETCH_TIMEOUT_MS,
  fetchCctvImageFromUpstream,
} from '../../vite.config.js';

test('CCTV upstream frame fetch supplies a bounded abort signal', async () => {
  let observedSignal = null;
  const startedAt = Date.now();
  const result = await fetchCctvImageFromUpstream('https://example.com/frame.jpg', {
    timeoutMs: 20,
    fetchImpl: (_url, options) => new Promise((_resolve, reject) => {
      observedSignal = options.signal;
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    }),
  });

  assert.equal(result, null);
  assert.ok(observedSignal instanceof AbortSignal);
  assert.equal(observedSignal.aborted, true);
  assert.ok(Date.now() - startedAt < 500, 'test timeout should settle promptly');
  assert.ok(CCTV_FRAME_FETCH_TIMEOUT_MS < 10_000, 'production timeout must beat the active refresh cadence');
});

test('CCTV upstream frame fetch returns a valid image response', async () => {
  const result = await fetchCctvImageFromUpstream('https://example.com/frame.jpg', {
    timeoutMs: 100,
    fetchImpl: async () => new Response(Uint8Array.from([1, 2, 3]), {
      status: 200,
      headers: { 'Content-Type': 'image/jpeg' },
    }),
  });

  assert.equal(result?.ok, true);
  assert.equal(result?.contentType, 'image/jpeg');
  assert.deepEqual(result?.body, Buffer.from([1, 2, 3]));
});

test('curated CCTV catalog loads with valid locations, headings, and viewshed geometry', async () => {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const raw = await fs.readFile(path.resolve('config/cctv_sources.curated.json'), 'utf8');
  const cameras = JSON.parse(raw);

  assert.ok(Array.isArray(cameras), 'catalog should be a JSON array');
  assert.ok(cameras.length >= 25, `expected at least 25 curated cameras, got ${cameras.length}`);

  const diepoldsauCam = cameras.find((c) => c.id === 'ch-diepoldsau-rheinbruecke');
  assert.ok(diepoldsauCam, 'Diepoldsau Rheinbrücke cam must exist');
  assert.equal(diepoldsauCam.city, 'Diepoldsau');
  assert.equal(diepoldsauCam.headingDeg, 110);
  assert.equal(diepoldsauCam.headingConfidence, 'high');

  const zurichCam = cameras.find((c) => c.id === 'ch-zurich-buerkliplatz');
  assert.ok(zurichCam, 'Zurich Bürkliplatz cam must exist');
  assert.equal(zurichCam.city, 'Zürich');

  const tokyoCam = cameras.find((c) => c.id === 'tokyo-shinjuku-east-1');
  assert.ok(tokyoCam, 'Tokyo Shinjuku cam must exist');
  assert.equal(tokyoCam.feedType, 'mp4');

  for (const cam of cameras) {
    assert.ok(cam.id, 'camera must have an ID');
    assert.ok(cam.name, `camera ${cam.id} must have a name`);
    assert.ok(cam.city, `camera ${cam.id} must have a city`);
    assert.ok(Number.isFinite(cam.lat) && cam.lat >= -90 && cam.lat <= 90, `camera ${cam.id} lat out of bounds`);
    assert.ok(Number.isFinite(cam.lon) && cam.lon >= -180 && cam.lon <= 180, `camera ${cam.id} lon out of bounds`);
    assert.ok(Number.isFinite(cam.headingDeg) && cam.headingDeg >= 0 && cam.headingDeg < 360, `camera ${cam.id} invalid headingDeg`);
    assert.ok(Number.isFinite(cam.pitchDeg) && cam.pitchDeg <= 0 && cam.pitchDeg >= -90, `camera ${cam.id} invalid pitchDeg`);
    assert.ok(Number.isFinite(cam.fovDeg) && cam.fovDeg > 0 && cam.fovDeg < 180, `camera ${cam.id} invalid fovDeg`);
    assert.ok(Number.isFinite(cam.rangeM) && cam.rangeM > 0, `camera ${cam.id} invalid rangeM`);
    assert.ok(Number.isFinite(cam.mountHeightM) && cam.mountHeightM > 0, `camera ${cam.id} invalid mountHeightM`);
    assert.equal(cam.poseSource, 'curated', `camera ${cam.id} should have poseSource curated`);
  }

  const swissCameras = cameras.filter((c) => c.id.startsWith('ch-'));
  assert.ok(swissCameras.length >= 40, `expected at least 40 Swiss cameras, got ${swissCameras.length}`);
  
  // Verify Diepoldsau & Rheintal coverage
  const rheintalIds = [
    'ch-diepoldsau-rheinbruecke',
    'ch-diepoldsau-dorfplatz',
    'ch-diepoldsau-schmitter',
    'ch-widnau-viscose',
    'ch-widnau-zentrum',
    'ch-heerbrugg-bahnhof',
    'ch-stmargrethen-grenze',
    'ch-buchs-bahnhof',
  ];
  for (const id of rheintalIds) {
    assert.ok(swissCameras.some((c) => c.id === id), `Rheintal camera ${id} should exist`);
  }
});


import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cameraViewBox,
  isViewOutlineTarget,
  ringFromViewBox,
} from './resolver.js';

test('only the view token outlines the screen, not a town name', () => {
  assert.equal(isViewOutlineTarget('view'), true);
  assert.equal(isViewOutlineTarget(' Oberriet bei Rüthi '), false);
  assert.equal(isViewOutlineTarget(''), false);
});

test('a usable camera rectangle becomes a closed outline', () => {
  const ring = ringFromViewBox({
    south: 47.2,
    north: 47.28,
    west: 9.52,
    east: 9.6,
  });
  assert.equal(ring.length, 5);
  assert.deepEqual(ring[0], ring[4]);
  assert.deepEqual(ring[0], [9.52, 47.2]);
});

test('a horizon-wide view falls back to a box under the camera', () => {
  const box = cameraViewBox({
    camera: {
      computeViewRectangle: () => ({
        south: 0,
        north: 1.2,
        west: 0,
        east: 1.2,
      }),
      positionCartographic: { latitude: 0.82, longitude: 0.17, height: 10000 },
    },
  });
  assert.ok(box);
  assert.ok(box.north - box.south < 1);
});

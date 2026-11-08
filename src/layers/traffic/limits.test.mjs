import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMaxspeed } from './limits.js';

test('maxspeed tags parse to km/h or stay unknown', () => {
  assert.equal(parseMaxspeed('30'), 30);
  assert.equal(parseMaxspeed('50 km/h'), 50);
  assert.equal(parseMaxspeed(60), 60);
  assert.equal(parseMaxspeed('30 mph'), 48);
  assert.equal(parseMaxspeed('walk'), 7);
  assert.equal(parseMaxspeed('CH:urban'), 50);
  assert.equal(parseMaxspeed('DE:rural'), 100);
  assert.equal(parseMaxspeed('AT:motorway'), 130);
  // Values that name no usable speed keep the road on its class estimate.
  assert.equal(parseMaxspeed('none'), null);
  assert.equal(parseMaxspeed('signals'), null);
  assert.equal(parseMaxspeed('nonsense'), null);
  assert.equal(parseMaxspeed('999'), null);
  assert.equal(parseMaxspeed(''), null);
  assert.equal(parseMaxspeed(null), null);
});

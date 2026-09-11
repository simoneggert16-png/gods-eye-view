import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  findWorldLandmark,
  landmarkTokenSet,
  normalizeLandmarkText,
  stemLandmarkToken,
  WORLD_LANDMARKS,
  worldLandmarkAliasDict,
  worldLandmarkCoordDict,
} from './worldLandmarks.js';

test('registry covers famous buildings on every continent', () => {
  assert.ok(WORLD_LANDMARKS.length >= 60, `want 60+ landmarks, got ${WORLD_LANDMARKS.length}`);
  for (const mark of WORLD_LANDMARKS) {
    assert.ok(mark.name && mark.name.length >= 3, mark.name);
    assert.ok(mark.lat >= -90 && mark.lat <= 90, mark.name);
    assert.ok(mark.lon >= -180 && mark.lon <= 180, mark.name);
  }
});

test('german and english building names resolve worldwide', () => {
  assert.deepEqual(findWorldLandmark('Eiffelturm'), { name: 'Eiffel Tower, Paris', lat: 48.8584, lon: 2.2945, kind: 'building' });
  assert.deepEqual(findWorldLandmark('eiffel tower')?.name, 'Eiffel Tower, Paris');
  assert.deepEqual(findWorldLandmark('Freiheitsstatue')?.name, 'Statue of Liberty, New York');
  assert.deepEqual(findWorldLandmark('Kölner Dom')?.name, 'Cologne Cathedral');
  assert.deepEqual(findWorldLandmark('koelner dom')?.name, 'Cologne Cathedral');
  assert.deepEqual(findWorldLandmark('Brandenburger Tor')?.name, 'Brandenburg Gate, Berlin');
  assert.deepEqual(findWorldLandmark('Taj Mahal')?.name, 'Taj Mahal, Agra');
  assert.deepEqual(findWorldLandmark('Burj Khalifa')?.name, 'Burj Khalifa, Dubai');
  assert.deepEqual(findWorldLandmark('Opernhaus Sydney') || findWorldLandmark('Sydney Oper'), { name: 'Sydney Opera House', lat: -33.8568, lon: 151.2153, kind: 'building' });
  assert.deepEqual(findWorldLandmark('Petra')?.name, 'Petra, Jordan');
  assert.deepEqual(findWorldLandmark('Pyramiden von Gizeh')?.name, 'Pyramids of Giza');
});

test('containment matches inside longer phrases', () => {
  assert.equal(findWorldLandmark('Eiffelturm in Paris')?.name, 'Eiffel Tower, Paris');
  assert.equal(findWorldLandmark('der Kölner Dom bitte')?.name, 'Cologne Cathedral');
});

test('forests resolve for "diesen Wald" fallbacks', () => {
  assert.equal(findWorldLandmark('Schwarzwald')?.name, 'Black Forest (Schwarzwald)');
  assert.equal(findWorldLandmark('Bayerischer Wald')?.name, 'Bavarian Forest (Bayerischer Wald)');
  assert.equal(findWorldLandmark('Harz')?.name, 'Harz (Brocken)');
});

test('unknown places return null, never throw', () => {
  assert.equal(findWorldLandmark(''), null);
  assert.equal(findWorldLandmark('xyznonexistentplace'), null);
  assert.equal(findWorldLandmark(null), null);
  assert.equal(normalizeLandmarkText('  Der Eiffelturm rein '), 'eiffelturm');
});

test('early-warning descriptions resolve to Pine Gap', () => {
  assert.equal(findWorldLandmark('Pine Gap')?.name, 'Joint Defence Facility Pine Gap');
  assert.equal(findWorldLandmark('pine gap alice springs')?.name, 'Joint Defence Facility Pine Gap');
  assert.equal(findWorldLandmark('das Frühwarnsystem in Australien')?.name, 'Joint Defence Facility Pine Gap');
  assert.equal(findWorldLandmark('Frühwarnsystem in Australien mit den großen Kuppeln')?.name, 'Joint Defence Facility Pine Gap');
  assert.equal(findWorldLandmark('Raketenfrühwarnung Australien')?.name, 'Joint Defence Facility Pine Gap');
  const hit = findWorldLandmark('Frühwarnsystem in Australien');
  assert.deepEqual([hit.lat, hit.lon], [-23.8, 133.7375]);
  // Single keywords alone must NOT match (needs the full description).
  assert.equal(findWorldLandmark('Australien'), null);
  assert.equal(findWorldLandmark('Alice Springs'), null);
});

test('declined German forms resolve to the same landmark', () => {
  // The reported failure: "helikopter landeplatz beim weissen haus".
  assert.equal(
    findWorldLandmark('markiere den helikopter landeplatz beim weissen haus')?.name,
    'White House, Washington DC',
  );
  assert.equal(findWorldLandmark('beim weissen haus')?.name, 'White House, Washington DC');
  assert.equal(findWorldLandmark('das weisse haus in washington')?.name, 'White House, Washington DC');
  assert.equal(findWorldLandmark('zum kölner dom')?.name, 'Cologne Cathedral');
  assert.equal(findWorldLandmark('beim eiffelturm in paris')?.name, 'Eiffel Tower, Paris');
  // ...but shared single tokens must not misfire.
  assert.equal(findWorldLandmark('das tor'), null);
  assert.equal(findWorldLandmark('grossen see'), null);
  assert.equal(findWorldLandmark('Australien'), null);
});

test('stemming folds umlauts and adjective endings consistently', () => {
  assert.equal(stemLandmarkToken('weisses'), stemLandmarkToken('weissen'));
  assert.equal(stemLandmarkToken('weißen'), stemLandmarkToken('weisses'));
  assert.equal(stemLandmarkToken('Kölner'), stemLandmarkToken('koelner'));
  assert.equal(stemLandmarkToken('großen'), stemLandmarkToken('grosse'));
  assert.ok(landmarkTokenSet('beim weissen Haus').has('weiss'));
});

test('dict helpers stay consistent with the registry', () => {
  const aliases = worldLandmarkAliasDict();
  assert.equal(aliases['eiffelturm'], 'Eiffel Tower, Paris');
  assert.equal(aliases['freiheitsstatue'], 'Statue of Liberty, New York');
  const coords = worldLandmarkCoordDict();
  assert.deepEqual(coords['eiffel tower, paris'], { lat: 48.8584, lon: 2.2945, label: 'Eiffel Tower, Paris' });
});

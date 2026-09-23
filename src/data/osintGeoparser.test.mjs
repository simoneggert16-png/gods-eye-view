import test from 'node:test';
import assert from 'node:assert/strict';

import {
  OSINT_GAZETTEER,
  WEAPON_PATTERNS,
  matchGazetteerLocation,
  matchWeaponSystem,
  geoparseOsintMessage,
  geoparseOsintBatch,
  translateSlavicOsintText,
} from './osintGeoparser.js';

test('matchGazetteerLocation resolves Ukrainian and Russian conflict hubs', () => {
  const kharkiv = matchGazetteerLocation('Explosions reported in Kharkiv after air raid siren');
  assert.ok(kharkiv);
  assert.equal(kharkiv.name, 'Kharkiv, Ukraine');
  assert.equal(kharkiv.lat, 50.0038);

  const kiewCyrillic = matchGazetteerLocation('Повітряна тривога в м. Київ та області');
  assert.ok(kiewCyrillic);
  assert.equal(kiewCyrillic.name, 'Kyiv, Ukraine');

  const belgorod = matchGazetteerLocation('Gouverneur meldet Drohnenangriff auf Belgorod');
  assert.ok(belgorod);
  assert.equal(belgorod.name, 'Belgorod, Russia');

  const beirut = matchGazetteerLocation('Strikes in southern suburbs of Beirut');
  assert.ok(beirut);
  assert.equal(beirut.name, 'Beirut, Lebanon');
});

test('matchWeaponSystem correctly detects drone, missile, and air defense types', () => {
  const shahed = matchWeaponSystem('Mehrere Shahed-136 Drohnen im Anflug auf Poltava');
  assert.equal(shahed.category, 'DROHNENANGRIFF');
  assert.equal(shahed.severity, 'CRITICAL');
  assert.ok(shahed.weapon.includes('Shahed'));

  const iskander = matchWeaponSystem('Ballistische Rakete Iskander-M auf Charkiw abgefeuert');
  assert.equal(iskander.category, 'RAKETENANGRIFF');
  assert.equal(iskander.severity, 'CRITICAL');
  assert.ok(iskander.weapon.includes('Iskander'));

  const ppo = matchWeaponSystem('Працює ППО, збито ворожий БПЛА');
  assert.equal(ppo.category, 'LUFTABWEHR');
  assert.equal(ppo.severity, 'MODERATE');
});

test('geoparseOsintMessage extracts tactical record from Telegram message', () => {
  const record = geoparseOsintMessage({
    id: 'tg-liveuamap-101',
    channel: 'liveuamap',
    text: 'A group of Shahed strike UAVs observed heading towards Dnipro from the south.',
    timestamp: '2026-09-21T21:00:00Z',
  });

  assert.ok(record);
  assert.equal(record.id, 'tg-liveuamap-101');
  assert.equal(record.locationName, 'Dnipro, Ukraine');
  assert.equal(record.latitude, 48.4647);
  assert.equal(record.longitude, 35.0462);
  assert.equal(record.category, 'DROHNENANGRIFF');
  assert.equal(record.severity, 'CRITICAL');
  assert.ok(record.isLiveOsint);
  assert.ok(record.summary.includes('Shahed'));
});

test('geoparseOsintMessage parses explicit GPS coordinates when present', () => {
  const record = geoparseOsintMessage({
    id: 'tg-custom-1',
    text: 'Impact confirmed at coordinates 50.1234, 36.5678 following glide bomb hit.',
  });

  assert.ok(record);
  assert.equal(record.latitude, 50.1234);
  assert.equal(record.longitude, 36.5678);
  assert.equal(record.category, 'RAKETENANGRIFF');
});

test('geoparseOsintBatch filters non-geographic messages and parses valid items', () => {
  const messages = [
    { id: '1', text: 'Good morning everyone, keep safe!' }, // no location -> skipped
    { id: '2', text: 'Shahed drone intercepted over Odesa port area.' }, // Odesa -> valid
    { id: '3', text: 'Air raid alert declared in Sumy region.' }, // Sumy -> valid
  ];

  const batch = geoparseOsintBatch(messages);
  assert.equal(batch.length, 2);
  assert.equal(batch[0].locationName, 'Odessa Port / Black Sea, Ukraine');
  assert.equal(batch[1].locationName, 'Sumy, Ukraine');
});

test('matchWeaponSystem and geoparse detect naval engagement / military ship strikes', () => {
  const naval = matchWeaponSystem('Military ship hammered by drone strikes near port');
  assert.equal(naval.category, 'SEEGEFECHT');
  assert.equal(naval.severity, 'CRITICAL');
  assert.ok(naval.weapon.includes('Naval'));

  const parsed = geoparseOsintMessage({
    id: 'test-naval-1',
    text: 'Odessa Port, Military Ship Hammered in night operation',
  });
  assert.ok(parsed);
  assert.equal(parsed.locationName, 'Odessa Port / Black Sea, Ukraine');
  assert.equal(parsed.category, 'SEEGEFECHT');
  assert.equal(parsed.isNaval, true);
  assert.equal(parsed.latitude, 46.4950);
  assert.equal(parsed.longitude, 30.7420);
});

test('translateSlavicOsintText translates Ukrainian Telegram messages into German and English', () => {
  const ukr = '🏍 Реактивні БпЛА з Черкащини в бік Київщини (Переяслав).';
  const de = translateSlavicOsintText(ukr, 'de');
  assert.ok(de.includes('Reaktive Drohne') || de.includes('reaktive Drohne'));
  assert.ok(de.includes('Tscherkassy'));
  assert.ok(de.includes('Kiew'));
  assert.ok(de.includes('Perejaslaw'));

  const parsed = geoparseOsintMessage({
    id: 'test-trans-1',
    text: ukr,
  });
  assert.ok(parsed);
  assert.ok(parsed.detailsDe);
  assert.ok(parsed.detailsDe.includes('Tscherkassy'));
});


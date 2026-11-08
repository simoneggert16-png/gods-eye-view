import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickSummaryVoice, summaryVoiceScore } from './summarySpeech.js';

const hedda = { name: 'Microsoft Hedda Desktop', lang: 'de-DE' };
const katja = { name: 'Microsoft Katja Online (Natural)', lang: 'de-DE' };
const google = { name: 'Google Deutsch', lang: 'de-DE' };
const english = { name: 'Google US English', lang: 'en-US' };

test('a German natural voice outranks the desktop synthesizer', () => {
  assert.ok(summaryVoiceScore(katja, 'de') > summaryVoiceScore(hedda, 'de'));
  assert.equal(pickSummaryVoice([hedda, english, katja], 'de'), katja);
});

test('Google Deutsch is used when no neural voice is installed', () => {
  assert.equal(pickSummaryVoice([hedda, google, english], 'de'), google);
});

test('an empty voice list leaves the utterance on the browser default', () => {
  assert.equal(pickSummaryVoice([], 'de'), null);
});

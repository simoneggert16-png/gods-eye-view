/**
 * Voice choice for the person-search summary.
 *
 * `speechSynthesis` with only `lang` set picks the first installed voice.
 * On Windows that is the old desktop voice (Hedda/Stefan), which is what
 * makes the readout sound mechanical. A Google or Natural/Neural voice in
 * the same language is the one to use when the browser has it.
 */

/** @param {SpeechSynthesisVoice|null|undefined} voice */
function voiceName(voice) {
  return String(voice?.name || '');
}

/** @param {SpeechSynthesisVoice|null|undefined} voice */
function voiceLang(voice) {
  return String(voice?.lang || '').toLowerCase();
}

/**
 * Higher is better. Language match dominates; within a language, neural and
 * Google voices outrank the legacy desktop synthesizer.
 * @param {SpeechSynthesisVoice|null|undefined} voice
 * @param {string} lang
 */
export function summaryVoiceScore(voice, lang = 'de') {
  const wanted = String(lang || 'de')
    .toLowerCase()
    .slice(0, 2);
  const name = voiceName(voice);
  const code = voiceLang(voice);
  let score = 0;
  if (wanted && code.startsWith(wanted)) score += 100;
  else if (code) score -= 40;
  if (/natural|neural|premium|wavenet/i.test(name)) score += 50;
  if (/google/i.test(name)) score += 30;
  if (/desktop/i.test(name) && !/natural|neural/i.test(name)) score -= 60;
  return score;
}

/**
 * @param {SpeechSynthesisVoice[]} voices
 * @param {string} lang
 * @returns {SpeechSynthesisVoice|null}
 */
export function pickSummaryVoice(voices, lang = 'de') {
  const list = Array.isArray(voices) ? voices.filter(Boolean) : [];
  if (!list.length) return null;
  return [...list].sort(
    (a, b) => summaryVoiceScore(b, lang) - summaryVoiceScore(a, lang),
  )[0];
}

/**
 * Chrome fills `getVoices()` only after `voiceschanged`. Speaking before
 * that event uses the robotic default.
 * @param {SpeechSynthesis|null|undefined} synth
 * @param {number} [timeoutMs]
 */
export function waitForSpeechVoices(synth, timeoutMs = 700) {
  const current = synth?.getVoices?.() || [];
  if (current.length) return Promise.resolve(current);
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      synth?.removeEventListener?.('voiceschanged', finish);
      resolve(synth?.getVoices?.() || []);
    };
    synth?.addEventListener?.('voiceschanged', finish);
    setTimeout(finish, timeoutMs);
  });
}

/**
 * Free voice — talk to the planet without an OpenAI key.
 *
 * Additive fallback next to the OpenAI Realtime path (`gevRealtime.js`), which
 * stays the default whenever an OpenAI key is configured. Nothing here touches
 * the Realtime session, the cost meter, or the token endpoint.
 *
 * How it works:
 *   1. Speech-to-text through the browser's built-in recognition
 *      (`SpeechRecognition` / `webkitSpeechRecognition` — free, no key; in
 *      Chrome it is cloud-backed by the browser vendor) plus a typed-text
 *      fallback for browsers without it.
 *   2. `parseFreeVoiceCommand()` maps the transcript onto the SAME 28 tool
 *      names the Realtime agent uses (see GEV_REALTIME_TOOLS in
 *      vite.config.js), executed through the same `runGevAction` runner.
 *      Analyst questions ("how many flights over Texas?") become
 *      `analyst_query` calls answered by the local analyst engine — no LLM.
 *   3. Short spoken confirmations through `speechSynthesis` (free, local).
 *
 * Open questions ("what city is this?", "what's this?") go to an OPTIONAL
 * free cloud brain: POST /api/gemini/ask, brokered server-side through a
 * $0 Gemini free-tier key (POWER UP → GEMINI, no billing). Without that key
 * the parser says so instead of hallucinating.
 *
 * @module voice/gevFreeVoice
 */

import { buildPlaceFixMessage, buildRouterMessage, extractDegenerateRouterCall, extractDirectAnswer, extractPlaceFix, extractRouterCall, hasReferenceWords, isCompleteRouterCall, ROUTER_SYSTEM_PROMPT, ROUTER_VISION_ADDENDUM, synthRouterSay } from './gevChatRouter.js';
import { stableActionKey } from './gevGemini.js';
import { SEED_OSINT_RECORDS } from '../data/liveOsintLayer.js';
import { SEED_MARKET_DATA } from '../data/geoMarketEngine.js';

/** Tool-call layer ids, mirroring the set_layer_visibility enum. */
const FREE_VOICE_LAYERS = Object.freeze([
  ['drone-attacks', /\b(drone attacks?|drohnenangriff\w*|drohnenschl\w*|kamikaze[- ]?drohnen?|uav strikes?|drohnen)\b/],
  ['terror-attacks', /\b(terror attacks?|terroranschl\w*|terrorismus|attentat\w*|terror)\b/],
  ['missile-tests', /\b(missile tests?|raketentests?|waffentests?|icbm tests?|testgelände)\b/],
  ['military-convoys', /\b(military convoys?|militärkonvois?|militär konvois?|truppenkonvois?|panzerkolonnen?|convoys?)\b/],
  ['campaign-trails', /\b(campaign trails?|wahlkampf\w*|rallies|rallye?s?|wahlkampftour\w*)\b/],
  ['secret-service', /\b(secret service|vip[- ]?schutz|motorcades?|tfr\b|flugverbotszone vip)\b/],
  ['frontlines', /\b(frontlines?|frontlinien?|front\b|kampflinien?|contact lines?)\b/],
  ['missile-strikes', /\b(missile strikes?|raketenschl\w*|raketenangriff\w*|raketenbeschuss)\b/],
  ['battles', /\b(battles?|schlachten?|gefechte?|bodenk\w*|clashes?)\b/],
  ['bombardments', /\b(bombardments?|bombardierung\w*|artillerie\w*|luftschl\w*|gleitbomben?|airstrikes?)\b/],
  ['conflicts', /\b(conflicts?|konflikte?|krisengebiete?|kriegsgebiete?|crisis zones?)\b/],
  ['flights', /\b(flights?|flüg\w*|fluege|flugzeuge?|aircraft|planes?|flieger)\b/],
  ['military', /\b(military|militär|militar)\b/],
  ['satellites', /\b(satellites?|satelliten?|iss|starlink|orbit\w* objects?)\b/],
  ['earthquakes', /\b(earthquakes?|erdbeben|beben|seismic|quakes?)\b/],
  ['traffic', /\b(traffic|verkehr|stau|congestion)\b/],
  ['cctv', /\b(cctv|cameras?|kameras?|webcam)\b/],
  ['radio', /\b(radio)\b/],
  ['local-firms', /\b(fires?|feuer|waldbr|wildfires?|brände|brand)\b/],
  ['ais-live-vessels', /\b(ships?|schiffe?|vessels?|boats?|hafen|port)\b/],
  ['bikeshare', /\b(bikes?|fahrrad|fahrräder|bikeshare)\b/],
  ['rocket-launches', /\b(launch|launches|starts?|raketen?|space missions?|missionen?)\b/],
  ['local-datacenters', /\b(datacenters?|rechenzentr)\b/],
  ['local-dams', /\b(dams?|dämme|staudamm|staudämme)\b/],
  ['telegeography-submarine-cables', /\b(cables?|kabel|submarine|unterseekabel)\b/],
  ['live-osint', /\b(osint|telegram\s*(?:feed|news)?|live\s*news|nachrichtenfeed)\b/],
]);

/** Visual-style aliases → set_visual_style enum. */
const FREE_VOICE_STYLES = Object.freeze([
  ['surveillance', /\b(night vision|nachtsicht|nvg|night-vision)\b/],
  ['thermal', /\b(thermal|wärmebild|flir|ironbow|infrared|infrarot)\b/],
  ['retro', /\b(crt|retro|röhre)\b/],
  ['noir', /\b(noir|black.?and.?white|schwarzwei)\b/],
  ['snow', /\b(snow|schnee)\b/],
  ['anime', /\banime\b/],
  ['normal', /\b(normal|normale? ansicht|standard look|tageslicht|daylight)\b/],
]);

/** Basemap aliases → set_map_stack enum. */
const FREE_VOICE_STACKS = Object.freeze([
  ['photoreal', /\b(photoreal|3d|fotorealistisch)\b/],
  ['bing-aerial', /\bbing aerial\b/],
  ['esri-imagery', /\besri\b/],
  ['osm', /\b(osm|openstreetmap|karte|mapnik)\b/],
]);

/** Panel aliases → set_panel_open enum. */
const FREE_VOICE_PANELS = Object.freeze([
  ['data-panel', /\b(data[- ]?panel|daten[- ]?panel|layers?[- ]?panel|ebenen[- ]?panel)\b/],
  ['control-panel', /\b(control[- ]?panel|kontroll[- ]?panel|steuerungs[- ]?panel)\b/],
  ['cctv-panel', /\b(cctv[- ]?panel|kamera[- ]?panel|camera[- ]?panel)\b/],
  ['radio-panel', /\b(radio[- ]?panel)\b/],
  ['scene-panel', /\b(scene[- ]?panel|szenen[- ]?panel)\b/],
  ['location-bar', /\b(location[- ]?bar|standort[- ]?leiste|ortsleiste)\b/],
  ['global-context-panel', /\b(context[- ]?panel|kontext[- ]?panel)\b/],
  ['pp-toggles', /\b(pp[- ]?toggles|post[- ]?processing[- ]?panel)\b/],
]);

/** Known city preset ids for fly_to_location. */
const FREE_VOICE_PRESETS = Object.freeze({
  austin: 'austin',
  'san francisco': 'sf', sf: 'sf',
  'new york': 'nyc', nyc: 'nyc',
  tokyo: 'tokyo', tokio: 'tokyo',
  london: 'london',
  paris: 'paris',
  dubai: 'dubai',
  dc: 'dc', washington: 'dc',
});

/** German-only trigger marker: any of these matched → confirm in German. */
const GERMAN_MARKER = /flieg|bring|mich|nach|zeige|mir|schalte|ein|aus|ansicht|über|nächste|stopp|allein|weg|hin|weltkugel|erdbeben|wärmebild|nachtsicht|kamera|flugzeug|schiff|feuer|verkehr|satellit|satelit|globus|öffne|schließe|schliess|kontroll|welche|aktie|aktien|markt|märkte|kurs|kurse|prognose|analyse|lage|krieg|nachrichten|wieso|warum|wann|wo|wer|wie|nicht|heute|morgen/i;

/**
 * Entity-family words: a search verb ("suche", "finde", "find") plus one of
 * these means track_entity (satellite/ship/aircraft), never place geocode.
 * Mirror of TRACK_FAMILY_WORDS in gevActions.js — kept local so the pure
 * parser stays dependency-free.
 */
const ENTITY_FAMILY_WORDS = /\b(satellit\w*|satelit\w*|satellite\w*|sat\s*gus|satgus|norad|tle|orbit\w*|raumstation|space station|iss|hst|jwst|tiangong|hubble|webb|schiff\w*|ship\w*|vessel\w*|boot\w*|boat\w*|tanker|frachter|container\w*|fähre|faehre|ferry|kreuzfahrt|yacht|mmsi|flugzeug\w*|aircraft|plane\w*|flieger|jet\w*|hubschrauber|helicopter|heli|flight\w*|callsign|icao|militär\w*|militaer\w*|military|kampfjet\w*|fighter\w*)\b/;

function resolveLayerId(text) {
  for (const [id, re] of FREE_VOICE_LAYERS) {
    if (re.test(text)) return id;
  }
  return null;
}

function resolveStyle(text) {
  for (const [style, re] of FREE_VOICE_STYLES) {
    if (re.test(text)) return style;
  }
  return null;
}

function resolveStack(text) {
  for (const [stack, re] of FREE_VOICE_STACKS) {
    if (re.test(text)) return stack;
  }
  return null;
}

function resolvePreset(text) {
  for (const [alias, id] of Object.entries(FREE_VOICE_PRESETS)) {
    if (text.includes(alias)) return id;
  }
  return null;
}

const TACTICAL_LAYER_FOCAL_POINTS = Object.freeze({
  'drone-attacks': { latitude: 50.4501, longitude: 30.5234, viewMode: 'overview', labelEn: 'drone attacks, flying to Kyiv sector', labelDe: 'Drohnenangriffe, fliege zum Sektor Kiew' },
  'terror-attacks': { latitude: 55.8207, longitude: 37.3856, viewMode: 'overview', labelEn: 'terror attacks, flying to Moscow sector', labelDe: 'Terroranschläge, fliege zum Schauplatz Moskau' },
  'missile-strikes': { latitude: 32.6546, longitude: 51.6680, viewMode: 'overview', labelEn: 'missile strikes', labelDe: 'Raketenangriffe' },
  'bombardments': { latitude: 50.2892, longitude: 36.9389, viewMode: 'overview', labelEn: 'bombardments and airstrikes', labelDe: 'Bombardements und Luftschläge' },
  'battles': { latitude: 48.1367, longitude: 37.7492, viewMode: 'overview', labelEn: 'ground battle zones', labelDe: 'Bodenkampfzonen' },
  'frontlines': { latitude: 48.0, longitude: 37.5, viewMode: 'overview', labelEn: 'frontlines', labelDe: 'Frontlinien' },
  'conflicts': { latitude: 48.5, longitude: 36.5, viewMode: 'overview', labelEn: 'conflict zones', labelDe: 'Konfliktzonen' },
  'military-convoys': { latitude: 54.0983, longitude: 22.9734, viewMode: 'overview', labelEn: 'military convoys in Suwalki corridor', labelDe: 'Militärkonvois im Suwalki-Korridor' },
  'missile-tests': { latitude: 34.7420, longitude: -120.6107, viewMode: 'overview', labelEn: 'missile tests at Vandenberg test range', labelDe: 'Raketentests auf der Vandenberg Range' },
  'campaign-trails': { latitude: 43.0451, longitude: -87.9172, viewMode: 'overview', labelEn: 'VIP campaign trails', labelDe: 'VIP-Wahlkampfrouten' },
  'secret-service': { latitude: 30.2672, longitude: -97.7431, viewMode: 'overview', labelEn: 'Secret Service VIP security zone', labelDe: 'Secret Service VIP-Sicherheitszone' },
  'live-osint': { latitude: 49.0, longitude: 33.0, viewMode: 'overview', labelEn: 'live OSINT news and dispatches', labelDe: 'Live-Telegram OSINT Meldungen' },
});

/** Trim filler words around a captured place name. */
function cleanPlace(raw) {
  return String(raw || '')
    .trim()
    .replace(/^(to|nach|the|der|die|das|den|zum|zur|in|im|an|ans|on|onto|at|grenzen von|grenze von|area of|region of)\s+/i, '')
    .replace(/\s+(?:ein|ab|an|auf|rein|raus|hinein|herein|hinaus|heraus|dorthin|dahin)$/i, '')
    .replace(/[?.!…,;]+$/, '')
    .trim()
    .slice(0, 160);
}

/**
 * Extract the place from an indefinite entity phrase ("flugzeug über Japan").
 * This is deliberately late in the sentence: entity words stay in the noun and
 * only the trailing place becomes a geocode target.
 */
function extractEntityPhrasePlace(raw) {
  const text = String(raw || '').trim();
  const match = text.match(/(?:\b(?:over|above|near|in|at|bei)\s+|über\s+)(.{2,100})$/i);
  return match ? cleanPlace(match[1]) : null;
}

function wantsDifferentEntity(raw) {
  return /\b(?:anderes?|anderen|another|different|other|next|nächstes?)\b/i.test(String(raw || ''));
}

/**
 * Close the model-argument gap: Ollama may understand "over Japan" or
 * "another one" but still emit only {layerId}. Derive the missing place and
 * different-selection flag from the user's own words before execution.
 */
function normalizeSelectNearestAircraftArgs(args, rawText, rememberedLocation = null) {
  const out = { ...(args && typeof args === 'object' ? args : {}) };
  const hasDestination = Boolean(
    String(out.locationId || '').trim()
    || String(out.locationQuery || '').trim()
    || (Number.isFinite(Number(out.latitude)) && Number.isFinite(Number(out.longitude))),
  );
  const place = extractEntityPhrasePlace(rawText);
  const different = wantsDifferentEntity(rawText);
  if (!hasDestination && place) out.locationQuery = place;
  if (different) out.differentFromSelected = true;
  if (
    different
    && !place
    && !String(out.locationId || '').trim()
    && !String(out.locationQuery || '').trim()
    && rememberedLocation
  ) out.locationQuery = rememberedLocation;
  return out;
}

/**
 * Parse one transcript into tool calls + a short spoken confirmation.
 * Pure — no DOM, no network — so it is unit-testable.
 *
 * Name-bearing results may carry `brainRoute` instead of `calls` when the
 * name is a pronoun/demonstrative only context can resolve ("seine Insel",
 * "dorthin", "track that plane"): the controller sends those straight to
 * the chat brain with history + scene, falling back to `fallbackCalls`.
 *
 * @param {unknown} input - Raw transcript (or typed text).
 * @returns {{ calls: Array<{name:string,args:object}>, speech: string, lang: 'en'|'de', brainRoute?: { text: string, fallbackCalls: Array, fallbackSpeech: string } }}
 */
export function parseFreeVoiceCommand(input) {
  const raw = String(input || '').trim();
  const text = ` ${raw.toLowerCase()} `;
  const de = GERMAN_MARKER.test(raw);
  const lang = de ? 'de' : 'en';
  const say = (en, german) => (de ? german : en);
  // Pronoun-only names skip regex extraction entirely: the controller sends
  // them straight to the chat brain (history + scene), keeping the regex
  // guess as the fallback when no brain answers.
  const toBrain = (fallbackCalls, fallbackSpeech) => ({
    calls: [],
    speech: '',
    lang,
    brainRoute: { text: raw, fallbackCalls, fallbackSpeech },
  });
  const no = (en, german) => ({ calls: [], speech: say(en, german), lang, unknown: true });

  if (!raw) return no('Say a command, for example "take me to Tokyo".', 'Sag einen Befehl, zum Beispiel „Flieg nach Tokio“.');

  // --- Full-globe reset -------------------------------------------------
  if (/\b(globe view|whole earth|entire planet|zoom all the way out|see the planet|zoom out to( a)? globe)\b/.test(text)
    || /weltkugel|globusansicht|gesamte erde|vollständig (raus|heraus)/.test(text)) {
    return {
      calls: [{ name: 'zoom_to_globe', args: {} }],
      speech: say('Zooming out to a globe view.', 'Zoome raus zur Globusansicht.'),
      lang,
    };
  }

  // --- Zoom into a PLACE (flies there — a relative nudge would be invisible)
  // Must run before relative zoom: "zoom into Stanford Bridge" contains
  // "zoom in" but means fly_to_location with close framing.
  // Deictic names ("diesen Wald", "dieses Gebäude", "dorthin") skip regex
  // extraction: the controller sends them straight to the chat brain with
  // history + scene ("diesen Wald" after "Schwarzwald" = Schwarzwald).
  {
    const m = text.match(
      /zoom\s+in(?:to| onto)?\s+(.{2,120})|zoom\s+(?:to|toward(?:s)?)\s+(.{2,120})|(?:heran|ran)?zoomen?\s+(?:an\s+|auf\s+|in\s+|im\s+|nach\s+|zu\s+|zum\s+|zur\s+)(.{2,120})/,
    );
    const place = cleanPlace(m?.[1] || m?.[2] || m?.[3]);
    const filler = /^(here|there|hier|da|dorthin|dahin|it|this|that|das|dies|a bit|a little|bisschen|wenig|closer|näher|bitte|mal)$/;
    if (m && place && !filler.test(place.toLowerCase())) {
      const preset = resolvePreset(` ${place.toLowerCase()} `);
      const args = preset ? { locationId: preset, viewMode: 'close' } : { query: place, viewMode: 'close' };
      if (!preset && hasReferenceWords(place)) {
        return toBrain(
          [{ name: 'fly_to_location', args }],
          say(`Zooming into ${place}.`, `Zoome nach ${place}.`),
        );
      }
      return {
        calls: [{ name: 'fly_to_location', args }],
        speech: say(`Zooming into ${place}.`, `Zoome nach ${place}.`),
        lang,
      };
    }
  }

  // --- Relative zoom ----------------------------------------------------
  {
    const m = text.match(/zoom (in|out)|näher ran|weiter raus|heranzoomen|herauszoomen|vergrößern|verkleinern/);
    if (m) {
      const dirWord = m[1] || '';
      const direction = /out|weiter raus|heraus|verkleinern/.test(m[0]) && !/in|näher|heran|vergrößern/.test(dirWord)
        ? 'out'
        : (/in/.test(dirWord) || /näher|heran|vergrößern/.test(m[0]) ? 'in' : (/out|raus|heraus|weg/.test(m[0]) ? 'out' : 'in'));
      const amount = /\b(a bit|a little|bisschen|wenig)\b/.test(text)
        ? 'little'
        : (/\b(way|weit|viel|ganz)\b/.test(text) ? 'lot' : 'medium');
      return {
        calls: [{ name: 'adjust_camera_zoom', args: { direction, amount } }],
        speech: say(
          direction === 'in' ? 'Zooming in.' : 'Zooming out.',
          direction === 'in' ? 'Zoome ran.' : 'Zoome raus.',
        ),
        lang,
      };
    }
  }

  // --- Orbit / rotate / tilt / pan / stop -------------------------------
  if (/\borbit\b|\bkreisen\b|umkreisen|rotieren um/.test(text)) {
    const speed = /\b(slow|langsam)\b/.test(text) ? 'slow' : (/\b(fast|schnell)\b/.test(text) ? 'fast' : 'slow');
    return {
      calls: [{ name: 'move_camera', args: { motion: 'orbit', speed, mode: 'continuous' } }],
      speech: say('Orbiting slowly.', 'Kreise langsam.'),
      lang,
    };
  }
  if (/\bstop\b.*\b(orbit|rotat|pan|tilt|mov|camera|kamera)\b|\borbit.*\bstop\b|kamera stopp|anhalten|stillstand/.test(text)) {
    return {
      calls: [{ name: 'move_camera', args: { motion: 'stop' } }],
      speech: say('Camera stopped.', 'Kamera gestoppt.'),
      lang,
    };
  }
  {
    const m = text.match(/\b(rotate|tilt|pan|neigen|schwenken|drehen)\b.*?\b(left|right|up|down|links|rechts|hoch|runter|oben|unten)\b|\b(links|rechts)\b.*?\b(drehen|schwenken)/);
    if (m) {
      const motion = /tilt|neigen|hoch|runter|oben|unten|up|down/.test(m[0]) ? 'tilt'
        : (/pan|schwenken/.test(m[0]) ? 'pan' : 'rotate');
      const direction = /left|links/.test(m[0]) ? 'left'
        : (/right|rechts/.test(m[0]) ? 'right' : (/up|hoch|oben/.test(m[0]) ? 'up' : 'down'));
      return {
        calls: [{ name: 'move_camera', args: { motion, direction, speed: 'normal', mode: 'once' } }],
        speech: say('Moving the camera.', 'Bewege die Kamera.'),
        lang,
      };
    }
  }

  // --- Cockpit ----------------------------------------------------------
  if (/\bcockpit\b/.test(text)) {
    if (/\b(exit|leave|raus|verlassen|aussteigen)\b/.test(text)) {
      return { calls: [{ name: 'control_cockpit', args: { action: 'exit' } }], speech: say('Leaving the cockpit.', 'Verlasse das Cockpit.'), lang };
    }
    if (/\bnext\b/.test(text) || /\bnächste/.test(text)) {
      const args = { action: 'next' };
      if (/\bmilitary\b|\bmilitär/.test(text)) args.targetLayer = 'military';
      if (/\bhelicopter|\bhubschrauber|\bheli\b/.test(text)) args.aircraftClass = 'helicopter';
      return { calls: [{ name: 'control_cockpit', args }], speech: say('Next contact.', 'Nächster Kontakt.'), lang };
    }
    if (/\bprevious\b|\bprev\b|vorherige|letzte/.test(text)) {
      return { calls: [{ name: 'control_cockpit', args: { action: 'previous' } }], speech: say('Previous contact.', 'Vorheriger Kontakt.'), lang };
    }
    return { calls: [{ name: 'control_cockpit', args: { action: 'enter' } }], speech: say('Entering the cockpit.', 'Steige ins Cockpit ein.'), lang };
  }

  // --- Nearest aircraft --------------------------------------------------
  if (/nearest.*(aircraft|plane|flight|flugzeug|flieger)|nächst.*flugzeug|(aircraft|plane).*nearest/.test(text)) {
    const layerId = /\bmilitary\b|\bmilitär/.test(text) ? 'military' : 'flights';
    const preset = resolvePreset(text);
    const args = { layerId };
    if (preset) args.locationId = preset;
    return {
      calls: [{ name: 'select_nearest_aircraft', args }],
      speech: say('Selecting the nearest aircraft.', 'Wähle das nächste Flugzeug.'),
      lang,
    };
  }

  // --- Track / stop tracking --------------------------------------------
  // Search verbs ("suche", "finde", "find") route to entity tracking ONLY
  // when the query names a trackable family (satellite/ship/aircraft —
  // "suche den Satelliten von Mark Rober"); plain "suche Berlin" falls
  // through to the fly_to_location place search below.
  {
    const m = text.match(/(track|follow|verfolge|verfolgen|folge|suche|suchen|finde|finden|find|locate)\s+(.{2,80})/);
    if (m && !/track.*history|history/.test(text)) {
      const verb = m[1];
      const rawQuery = cleanPlace(m[2]);
      const verbIsSearch = /\b(suche|suchen|finde|finden|find|locate)\b/.test(verb);
      const namesEntityFamily = ENTITY_FAMILY_WORDS.test(` ${rawQuery.toLowerCase()} `);
      if (!rawQuery) {
        // empty after clean — fall through
      } else if (verbIsSearch && !namesEntityFamily && !hasReferenceWords(rawQuery)) {
        // Place search ("suche Berlin") — handled by the fly block below.
      } else {
        const stripped = rawQuery.replace(/\b(plane|aircraft|flugzeug|ship|schiff)\b/gi, '').trim();
        const query = stripped || rawQuery;
        if (hasReferenceWords(rawQuery)) {
          return toBrain(
            [{ name: 'track_entity', args: { query: rawQuery } }],
            say(`Tracking ${rawQuery}.`, `Verfolge ${rawQuery}.`),
          );
        }
        return {
          calls: [{ name: 'track_entity', args: { query } }],
          speech: say(`Tracking ${query}.`, `Verfolge ${query}.`),
          lang,
        };
      }
    }
  }
  if (/\b(stop tracking|untrack|tracking stoppen|verfolgung stoppen)\b/.test(text)) {
    return { calls: [{ name: 'stop_tracking', args: {} }], speech: say('Stopped tracking.', 'Verfolgung gestoppt.'), lang };
  }

  // --- Fire intent: show/take me to a fire → strongest FIRMS detection -----
  // Must run before fly_to_location ("take me to the biggest fire" is not a
  // geocode query) and before analyst (navigation verbs win over counting).
  // Pure questions ("how many fires…", "what is the biggest fire…") fall
  // through to analyst_query below.
  {
    const fireWord = /\b(fires?|feuer|waldbr|wildfires?|brände|brand)\b/.test(text);
    const navVerb = /\b(take me|fly me|fly to|bring me|go to|navigate|show me|zoom to|bring mich|flieg|bring|nimm mich mit|geh nach|zeige? mir|zeig mir)\b/.test(text);
    if (fireWord && navVerb) {
      return {
        calls: [
          { name: 'set_layer_visibility', args: { layerId: 'local-firms', enabled: true } },
          { name: 'track_entity', args: { query: 'fire' } },
        ],
        speech: say('Flying to the strongest fire.', 'Fliege zum stärksten Feuer.'),
        lang,
      };
    }
  }

  // --- Camera / CCTV place query -------------------------------------------
  // "zeig mir eine kamera in london", "kamera in X", "cameras in X", "cctv in X"
  // enables CCTV and flies to the location so cameras in that area display.
  {
    const camPlaceMatch = text.match(
      /(?:(?:zeig|zeige)\s+mir\s+(?:mal\s+)?(?:eine?n?|irgendeine?n?)?\s*|(?:show|give)\s+me\s+(?:a|an|any|some)?\s*|(?:suche|finde|find)\s+(?:eine?n?\s*)?)?(?:kameras?|cameras?|cctv)\s+(?:in|near|bei|in der nähe von|at|von)\s+(.{2,100})/
    ) || text.match(
      /(?:(?:zeig|zeige)\s+mir\s+(?:mal\s+)?|(?:show|give)\s+me\s+)(?:eine?n?\s+)?(?:kameras?|cameras?|cctv)\s+(.{2,100})/
    );
    if (camPlaceMatch) {
      const rawTarget = cleanPlace(camPlaceMatch[1]);
      if (rawTarget && !/^(viewsheds?|nearest|next|prev|previous|abdeckung|coverage|on|off|an|aus|ein)$/i.test(rawTarget)) {
        const place = rawTarget;
        const preset = resolvePreset(` ${place.toLowerCase()} `);
        const calls = [
          { name: 'set_layer_visibility', args: { layerId: 'cctv', enabled: true } },
          { name: 'fly_to_location', args: preset ? { locationId: preset } : { query: place } },
        ];
        const speech = say(`Opening cameras in ${place}.`, `Öffne Kameras in ${place}.`);
        if (hasReferenceWords(place)) {
          return toBrain(calls, speech);
        }
        return { calls, speech, lang };
      }
    }
  }

  // --- Indefinite show intent: "show me ANY X" is not a place ---------------
  // "Zeige mir irgendein Militärflugzeug" must enable + stage that layer,
  // never geocode the sentence. Runs before fly_to_location.
  {
    const m = text.match(/(?:zeig mir|zeige mir|show me|bring mir|gib mir|give me)\s+(?:mal\s+)?(?:irgendein(?:e|en)?|eine?|einen|a|an|any|some)\s+(.{2,60})/);
    if (m) {
      const noun = ` ${m[1].toLowerCase().trim()} `;
      const place = extractEntityPhrasePlace(m[1]);
      const aircraftArgs = (layerId) => ({
        layerId,
        ...(place ? { locationQuery: place } : {}),
        ...(wantsDifferentEntity(text) ? { differentFromSelected: true } : {}),
      });
      const pick = (layerId, extraCalls, speechEn, speechDe) => ({
        calls: [{ name: 'set_layer_visibility', args: { layerId, enabled: true } }, ...extraCalls],
        speech: say(speechEn, speechDe),
        lang,
      });
      if (/\bmilitär|\bmilitary|\bkampfjet|\bfighter/.test(noun)) {
        return pick('military',
          [{ name: 'select_nearest_aircraft', args: aircraftArgs('military') }],
          'Showing a military aircraft.', 'Zeige ein Militärflugzeug.');
      }
      if (/\bflugzeug|\bflieger|\baircraft|\bplane|\bjet|\bhubschrauber|\bheli\b|\bwas sich bewegt|\bsomething moving\b/.test(noun)) {
        return pick('flights',
          [{ name: 'select_nearest_aircraft', args: aircraftArgs('flights') }],
          'Showing an aircraft.', 'Zeige ein Flugzeug.');
      }
      if (/\bschiff|\bschiffe|\bships?|\bvessels?|\bboats?\b/.test(noun)) {
        return pick('ais-live-vessels',
          [{ name: 'frame_overhead', args: { target: 'vessels' } }],
          'Showing vessels.', 'Zeige Schiffe.');
      }
      if (/\bsatellit|\bsatelit|\bsatellite/.test(noun)) {
        return pick('satellites',
          [{
            name: 'track_entity',
            args: {
              query: 'satellite',
              // "zeige mir einen anderen Satelliten" — a follow-up must skip
              // the currently followed contact, not re-pick it.
              ...(wantsDifferentEntity(text) ? { differentFromSelected: true } : {}),
            },
          }],
          'Showing the nearest satellite.', 'Zeige den nächsten Satelliten.');
      }
      if (/\bkamera|\bcamera/.test(noun)) {
        return {
          calls: [{ name: 'control_cctv', args: { action: 'enable' } }],
          speech: say('Cameras on.', 'Kameras ein.'),
          lang,
        };
      }
      if (/\bradio/.test(noun)) {
        return {
          calls: [{ name: 'control_radio', args: { action: 'play' } }],
          speech: say('Playing the radio.', 'Spiele Radio.'),
          lang,
        };
      }
      if (/\berdbeben|\bearthquake|\bquake|\bbeben/.test(noun)) {
        return pick('earthquakes', [], 'Showing earthquakes.', 'Zeige Erdbeben.');
      }
      if (/\bdrohn\w*|drone\w*|uav\b/.test(noun)) {
        const flyArgs = place ? { query: place } : { latitude: 50.4501, longitude: 30.5234, viewMode: 'overview' };
        return {
          calls: [
            { name: 'set_layer_visibility', args: { layerId: 'drone-attacks', enabled: true } },
            { name: 'fly_to_location', args: flyArgs },
          ],
          speech: say(
            place ? `Showing drone attacks in ${place}.` : 'Showing drone attacks, flying to Kyiv sector.',
            place ? `Zeige Drohnenangriffe in ${place}.` : 'Zeige Drohnenangriffe, fliege zum Sektor Kiew.',
          ),
          lang,
        };
      }
      if (/\bterror\w*|attentat\w*/.test(noun)) {
        const flyArgs = place ? { query: place } : { latitude: 55.8207, longitude: 37.3856, viewMode: 'overview' };
        return {
          calls: [
            { name: 'set_layer_visibility', args: { layerId: 'terror-attacks', enabled: true } },
            { name: 'fly_to_location', args: flyArgs },
          ],
          speech: say(
            place ? `Showing terror attacks in ${place}.` : 'Showing terror attacks, flying to Moscow sector.',
            place ? `Zeige Terroranschläge in ${place}.` : 'Zeige Terroranschläge, fliege zum Schauplatz Moskau.',
          ),
          lang,
        };
      }
      if (/\braketenangriff\w*|raketenschl\w*|missile\s*strike\w*/.test(noun)) {
        const flyArgs = place ? { query: place } : { latitude: 32.6546, longitude: 51.6680, viewMode: 'overview' };
        return {
          calls: [
            { name: 'set_layer_visibility', args: { layerId: 'missile-strikes', enabled: true } },
            { name: 'fly_to_location', args: flyArgs },
          ],
          speech: say(
            place ? `Showing missile strikes in ${place}.` : 'Showing missile strikes.',
            place ? `Zeige Raketenangriffe in ${place}.` : 'Zeige Raketenangriffe.',
          ),
          lang,
        };
      }
      if (/\bbombard\w*|luftschl\w*|gleitbombe\w*|airstrike\w*/.test(noun)) {
        const flyArgs = place ? { query: place } : { latitude: 50.2892, longitude: 36.9389, viewMode: 'overview' };
        return {
          calls: [
            { name: 'set_layer_visibility', args: { layerId: 'bombardments', enabled: true } },
            { name: 'fly_to_location', args: flyArgs },
          ],
          speech: say(
            place ? `Showing bombardments in ${place}.` : 'Showing bombardments and airstrikes.',
            place ? `Zeige Bombardements in ${place}.` : 'Zeige Bombardements und Luftschläge.',
          ),
          lang,
        };
      }
      if (/\bkonvoi\w*|convoys?\b|truppentransport\w*/.test(noun)) {
        const flyArgs = place ? { query: place } : { latitude: 54.0983, longitude: 22.9734, viewMode: 'overview' };
        return {
          calls: [
            { name: 'set_layer_visibility', args: { layerId: 'military-convoys', enabled: true } },
            { name: 'fly_to_location', args: flyArgs },
          ],
          speech: say(
            place ? `Showing military convoys in ${place}.` : 'Showing military convoys.',
            place ? `Zeige Militärkonvois in ${place}.` : 'Zeige Militärkonvois.',
          ),
          lang,
        };
      }
      if (/\braketentest\w*|missile\s*test\w*/.test(noun)) {
        const flyArgs = place ? { query: place } : { latitude: 34.7420, longitude: -120.6107, viewMode: 'overview' };
        return {
          calls: [
            { name: 'set_layer_visibility', args: { layerId: 'missile-tests', enabled: true } },
            { name: 'fly_to_location', args: flyArgs },
          ],
          speech: say('Showing missile tests.', 'Zeige Raketentests.'),
          lang,
        };
      }
      if (/\bsecret\s*service\b|vip[- ]?schutz/.test(noun)) {
        const flyArgs = place ? { query: place } : { latitude: 30.2672, longitude: -97.7431, viewMode: 'overview' };
        return {
          calls: [
            { name: 'set_layer_visibility', args: { layerId: 'secret-service', enabled: true } },
            { name: 'fly_to_location', args: flyArgs },
          ],
          speech: say('Showing Secret Service VIP security detail.', 'Zeige Secret Service VIP-Schutz.'),
          lang,
        };
      }
      if (/\bwahlkampf\w*|campaign\s*trail\w*/.test(noun)) {
        const flyArgs = place ? { query: place } : { latitude: 43.0451, longitude: -87.9172, viewMode: 'overview' };
        return {
          calls: [
            { name: 'set_layer_visibility', args: { layerId: 'campaign-trails', enabled: true } },
            { name: 'fly_to_location', args: flyArgs },
          ],
          speech: say('Showing presidential campaign trails.', 'Zeige VIP-Wahlkampfrouten.'),
          lang,
        };
      }
      if (/\bbodenk\w*|schlacht\w*|gefecht\w*|battle\w*/.test(noun)) {
        const flyArgs = place ? { query: place } : { latitude: 48.1367, longitude: 37.7492, viewMode: 'overview' };
        return {
          calls: [
            { name: 'set_layer_visibility', args: { layerId: 'battles', enabled: true } },
            { name: 'fly_to_location', args: flyArgs },
          ],
          speech: say(
            place ? `Showing ground battles in ${place}.` : 'Showing ground battles.',
            place ? `Zeige Bodenkämpfe in ${place}.` : 'Zeige Bodenkämpfe.',
          ),
          lang,
        };
      }
      if (/\bfront\b|frontlin\w*|kampflin\w*/.test(noun)) {
        const flyArgs = place ? { query: place } : { latitude: 48.0, longitude: 37.5, viewMode: 'overview' };
        return {
          calls: [
            { name: 'set_layer_visibility', args: { layerId: 'frontlines', enabled: true } },
            { name: 'fly_to_location', args: flyArgs },
          ],
          speech: say(
            place ? `Showing frontline in ${place}.` : 'Showing frontlines.',
            place ? `Zeige Frontlinie in ${place}.` : 'Zeige Frontlinien.',
          ),
          lang,
        };
      }
      if (/\bkonflikt\w*|krisengebiet\w*|kriegsgebiet\w*|conflict\w*/.test(noun)) {
        const flyArgs = place ? { query: place } : { latitude: 48.5, longitude: 36.5, viewMode: 'overview' };
        return {
          calls: [
            { name: 'set_layer_visibility', args: { layerId: 'conflicts', enabled: true } },
            { name: 'fly_to_location', args: flyArgs },
          ],
          speech: say('Showing conflict zones.', 'Zeige Konfliktzonen.'),
          lang,
        };
      }
      if (/\bosint\b|telegram\s*(?:feed|news)?|nachrichtenfeed/.test(noun)) {
        const flyArgs = place ? { query: place } : { latitude: 49.0, longitude: 33.0, viewMode: 'overview' };
        return {
          calls: [
            { name: 'set_layer_visibility', args: { layerId: 'live-osint', enabled: true } },
            { name: 'query_osint_news', args: place ? { query: place } : {} },
            { name: 'fly_to_location', args: flyArgs },
          ],
          speech: say(
            place ? `Showing live OSINT dispatches for ${place}.` : 'Showing live Telegram OSINT feed.',
            place ? `Zeige Live-OSINT Meldungen für ${place}.` : 'Zeige Live-Telegram OSINT Meldungen.',
          ),
          lang,
        };
      }
      // Unknown noun: fall through to fly_to_location (geocode attempt) —
      // the AI retry below still gets its chance on a miss.
    }
  }

  // --- Live OSINT & Breaking News ----------------------------------------
  if (/\b(?:gibt es (?:neue|aktuelle) (?:meldungen|news|nachrichten)|was gibt es (?:neues|für news)|aktuelle (?:meldungen|news)|osint (?:news|meldungen)|telegram (?:news|meldungen|feed))\b/i.test(text)) {
    return {
      calls: [
        { name: 'set_layer_visibility', args: { layerId: 'live-osint', enabled: true } },
        { name: 'query_osint_news', args: {} },
      ],
      speech: say('Querying latest Telegram OSINT dispatches.', 'Rufe aktuelle Telegram OSINT-Meldungen ab.'),
      lang,
    };
  }

  // --- Fly to a place ----------------------------------------------------
  // Search verbs ("suche Berlin", "find Tokyo") are place searches — entity
  // descriptions ("suche den Satelliten") were already claimed by the track
  // block above and never reach this branch.
  {
    const m = text.match(/(?:take me to|fly to|go to|navigate to|bring mich nach|bring mich zu|flieg nach|fliege nach|flieg zum|flieg zur|fliege zum|nimm mich mit nach|geh nach|zeige mir|zeig mir|show me)\s+(.{2,120})|(?:suche|suchen|suchst|finde|finden|find|locate)\s+(?:nach\s+|mir\s+)?(.{2,120})/);
    if (m) {
      // Superlative + generic noun ("die Stadt mit den meisten Einwohnern")
      // is a KNOWLEDGE question, not a place — route to the brain, which
      // answers it (and can fly there right after). No tool fallback.
      const superlative = /\b(meisten|meiste|größte|größten|höchste|höchsten|längste|tiefste|kleinste|grösste|biggest|largest|highest|longest|deepest|smallest|tallest|most)\b/.test(text);
      const genericNoun = /\b(stadt|städte|städten|berg|berge|bergen|fluss|flüsse|flüssen|see|seen|meer|meere|ozean|land|länder|ländern|insel|inseln|gebäude|gebäuden|brücke|brücken|turm|türme|stadtteil|vulkan|wüste|city|cities|mountain|mountains|river|rivers|lake|lakes|country|countries|island|islands|building|buildings|bridge|bridges|tower|towers|volcano|desert|ocean)\b/.test(text);
      if (superlative && genericNoun) {
        return toBrain([], '');
      }
      const place = cleanPlace(m[1] || m[2]);
      const tacticalLayerId = resolveLayerId(` ${place.toLowerCase()} `);
      if (tacticalLayerId && TACTICAL_LAYER_FOCAL_POINTS[tacticalLayerId]) {
        const placeIn = extractEntityPhrasePlace(place);
        const focal = TACTICAL_LAYER_FOCAL_POINTS[tacticalLayerId];
        const flyArgs = placeIn ? { query: placeIn } : { latitude: focal.latitude, longitude: focal.longitude, viewMode: focal.viewMode };
        return {
          calls: [
            { name: 'set_layer_visibility', args: { layerId: tacticalLayerId, enabled: true } },
            { name: 'fly_to_location', args: flyArgs },
          ],
          speech: say(
            placeIn ? `Showing ${tacticalLayerId} in ${placeIn}.` : `Showing ${focal.labelEn}.`,
            placeIn ? `Zeige ${tacticalLayerId} in ${placeIn}.` : `Zeige ${focal.labelDe}.`,
          ),
          lang,
        };
      }
      const preset = resolvePreset(` ${place.toLowerCase()} `);
      const args = preset ? { locationId: preset } : { query: place };
      if (place && hasReferenceWords(place)) {
        return toBrain(
          [{ name: 'fly_to_location', args }],
          say(`Flying to ${place}.`, `Fliege nach ${place}.`),
        );
      }
      return {
        calls: [{ name: 'fly_to_location', args }],
        speech: say(`Flying to ${place}.`, `Fliege nach ${place}.`),
        lang,
      };
    }
  }

  // --- Deictic fly fallback: "fliege dorthin/dahin/hierher", "take me there" etc. ---
  // Pure pronoun/deictic destinations skip regex extraction and go straight to the brain.
  // The regex fly handler above needs an explicit "nach/show me" prefix, so "fliege dorthin"
  // would otherwise fall through to unknown. Detect it here.
  {
    const deicticFly = hasReferenceWords(raw)
      && /\b(fliege?|flieg|bring|nimm|geh|zoom|take|fly|go|navigate|show)\b/i.test(raw)
      && /\b(dorthin|dahin|hierher|hierhin|dort|here|there|it|ihn|es|ihm|dies|dieser|dieses|diesem|diesen|diese|das)\b/i.test(raw);
    if (deicticFly) {
      const match = raw.toLowerCase().match(/\b(dorthin|dahin|hierher|hierhin|dort|here|there|it|ihn|es|ihm|dieser|dieses|diesem|diesen|diese|dies|das)\b/);
      const fallbackQuery = cleanPlace(match ? match[0] : 'there') || 'there';
      return toBrain(
        [{ name: 'fly_to_location', args: { query: fallbackQuery, viewMode: 'close' } }],
        say(`Flying to ${fallbackQuery}.`, `Fliege nach ${fallbackQuery}.`),
      );
    }
  }

  // --- Something cool / Exciting live action -------------------------------
  if (/\b(was\s+cooles|etwas\s+cooles|zeig\s+mir\s+was\s+cooles|etwas\s+spannendes|something\s+cool|show\s+me\s+something\s+cool|show\s+something\s+cool)\b/i.test(text)) {
    return {
      calls: [{ name: 'select_nearest_aircraft', args: { layerId: 'military' } }],
      speech: say('Tracking an active military flight in 3D for you.', 'Ich schalte auf einen aktiven Militärflug und verfolge ihn im 3D-Modus.'),
      lang,
    };
  }

  // --- Flight traffic command ---------------------------------------------
  if (/\b(flugverkehr|air\s*traffic|flight\s*traffic)\b/i.test(text)) {
    const locMatch = text.match(/(?:über|in|near|over)\s+([a-zA-ZäöüÄÖÜß\s-]+)/i);
    const loc = locMatch ? locMatch[1].trim() : '';
    return {
      calls: [{ name: 'select_nearest_aircraft', args: { layerId: 'flights', ...(loc ? { locationQuery: loc } : {}) } }],
      speech: loc
        ? say(`Tracking flight traffic over ${loc}.`, `Verfolge den Flugverkehr über ${loc}.`)
        : say('Activating flights and tracking nearest aircraft.', 'Aktiviere Flugverkehr und verfolge das nächste Flugzeug.'),
      lang,
    };
  }

  // --- Frame overhead ----------------------------------------------------
  if (/(planes?|aircraft|flugzeuge?) overhead|planes? above|show me the planes|flugzeuge über mir/.test(text)) {
    return {
      calls: [{ name: 'frame_overhead', args: { target: 'flights' } }],
      speech: say('Framing the planes overhead.', 'Rahme die Flugzeuge über dir.'),
      lang,
    };
  }

  // --- Layers on/off ------------------------------------------------------
  // Camera-specific ops (viewshed / nearest / next) own their verbs — the
  // generic layer switch must not swallow "turn on the camera viewsheds".
  {
    const layerId = resolveLayerId(text);
    const cameraOp = layerId === 'cctv' && /\b(viewsheds?|nearest|nächste|next|sichthal|abdeckung|coverage)\b/.test(text);
    const onOff = cameraOp ? null : (/\b(turn on|switch on|enable|show|activate|einschalten|einschalte|aktiviere|einblenden|anschalten|schalte .* ein| mach .* an)\b/.test(text)
      ? true
      : (/\b(turn off|switch off|disable|hide|deactivate|ausschalten|ausschalte|deaktiviere|ausblenden|schalte .* aus| mach .* aus)\b/.test(text) ? false : null));
    if (layerId && onOff !== null) {
      return {
        calls: [{ name: 'set_layer_visibility', args: { layerId, enabled: onOff } }],
        speech: say(
          onOff ? `Turning ${layerId} on.` : `Turning ${layerId} off.`,
          onOff ? `Schalte ${layerId} ein.` : `Schalte ${layerId} aus.`,
        ),
        lang,
      };
    }
  }

  // --- Visual style -------------------------------------------------------
  {
    const style = resolveStyle(text);
    if (style && /\b(switch|turn|set|wechsel|stelle|aktiviere|style|stil|filter|sensor|vision|sicht)\b/.test(text)) {
      return {
        calls: [{ name: 'set_visual_style', args: { style } }],
        speech: say(`Switching to ${style}.`, `Wechsle zu ${style}.`),
        lang,
      };
    }
  }

  // --- HUD / detection -----------------------------------------------------
  if (/\bhud\b/.test(text)) {
    if (/\btactical\b|\btaktisch/.test(text)) {
      return { calls: [{ name: 'set_hud', args: { layout: 'tactical' } }], speech: say('Tactical layout.', 'Taktisches Layout.'), lang };
    }
    const visible = /\boff\b|\baus\b|verstecken|deaktivieren/.test(text) ? 'off' : 'on';
    return { calls: [{ name: 'set_hud', args: { visible } }], speech: say(`HUD ${visible}.`, `HUD ${visible === 'on' ? 'ein' : 'aus'}.`), lang };
  }
  {
    const m = text.match(/detection.*?\b(\d{1,3})\s*%|erkennungs?rate.*?(\d{1,3})/);
    if (m) {
      return {
        calls: [{ name: 'set_detection', args: { densityPct: Math.min(100, Number(m[1] || m[2])) } }],
        speech: say('Setting detection density.', 'Setze Erkennungsdichte.'),
        lang,
      };
    }
    if (/\bdetection\b|erkennung/.test(text)) {
      const enabled = /\boff\b|\baus\b/.test(text) ? false : true;
      return { calls: [{ name: 'set_detection', args: { enabled } }], speech: say(enabled ? 'Detection on.' : 'Detection off.', enabled ? 'Erkennung ein.' : 'Erkennung aus.'), lang };
    }
  }

  // --- Map stack ------------------------------------------------------------
  {
    const stack = resolveStack(text);
    if (stack && /\b(switch|use|basemap|karte|stack|wechsle|nimm|wechseln)\b/.test(text)) {
      return {
        calls: [{ name: 'set_map_stack', args: { stack } }],
        speech: say(`Switching to ${stack}.`, `Wechsle zu ${stack}.`),
        lang,
      };
    }
  }

  // --- Panels (set_panel_open) ---------------------------------------------
  {
    const hasVerb = /(?:^|\s)(open|show|öffn\w*|oeffn\w*|zeig\w*|close|hide|schlie[ßs]\w*|versteck\w*|ausblenden|einblenden)\s/i.test(text);
    if (hasVerb) {
      let panelId = null;
      for (const [id, re] of FREE_VOICE_PANELS) {
        if (re.test(text)) { panelId = id; break; }
      }
      if (panelId) {
        const open = !/(?:^|\s)(close|hide|schlie[ßs]\w*|versteck\w*|ausblenden|aus|zu)\s/i.test(text);
        return {
          calls: [{ name: 'set_panel_open', args: { panelId, open } }],
          speech: say(
            open ? `Opening ${panelId}.` : `Closing ${panelId}.`,
            open ? `Öffne ${panelId}.` : `Schließe ${panelId}.`,
          ),
          lang,
        };
      }
    }
  }

  // --- Context missions ------------------------------------------------------
  if (/\bspace missions?\b|weltraummission/.test(text)) {
    return { calls: [{ name: 'set_context_mode', args: { mode: 'space-missions' } }], speech: say('Showing space missions.', 'Zeige Weltraummissionen.'), lang };
  }
  if (/\bcontacts?\b|kontakte/.test(text) && /\b(open|show|exit|close|öffne|zeige|schließe)\b/.test(text)) {
    const mode = /\b(exit|close|off|schließe|beenden)\b/.test(text) ? 'off' : 'contacts';
    return { calls: [{ name: 'set_context_mode', args: { mode } }], speech: say(mode === 'off' ? 'Leaving context.' : 'Showing contacts.', mode === 'off' ? 'Verlasse Kontext.' : 'Zeige Kontakte.'), lang };
  }
  if (/global infrastructure|globale infrastruktur/.test(text)) {
    return {
      calls: [
        { name: 'set_layer_visibility', args: { layerId: 'local-datacenters', enabled: true } },
        { name: 'set_layer_visibility', args: { layerId: 'local-dams', enabled: true } },
        { name: 'set_layer_visibility', args: { layerId: 'telegeography-submarine-cables', enabled: true } },
        { name: 'zoom_to_globe', args: {} },
      ],
      speech: say('Staging global infrastructure.', 'Baue globale Infrastruktur auf.'),
      lang,
    };
  }

  // --- Scenes -----------------------------------------------------------------
  // "Play Orbital Watch" names no scene keyword, so it is checked standalone.
  if (/\borbital watch\b/.test(text)) {
    return { calls: [{ name: 'control_scene', args: { action: 'play', sceneId: 'Orbital Watch' } }], speech: say('Playing Orbital Watch.', 'Spiele Orbital Watch.'), lang };
  }
  if (/\bscene\b|szene/.test(text)) {
    if (/\blist\b|liste|auflisten/.test(text)) {
      return { calls: [{ name: 'control_scene', args: { action: 'list' } }], speech: say('Listing scenes.', 'Liste Szenen auf.'), lang };
    }
    if (/\bstop\b|stopp|anhalten/.test(text)) {
      return { calls: [{ name: 'control_scene', args: { action: 'stop' } }], speech: say('Stopping the scene.', 'Stoppe die Szene.'), lang };
    }
    const m = text.match(/(?:play|spiele?|starte)\s+(?:the\s+|die\s+)?(.{2,80}?)(?:\s+scene|\s+szene)?$/);
    const sceneId = m ? cleanPlace(m[1]) : undefined;
    if (sceneId) {
      return { calls: [{ name: 'control_scene', args: { action: 'play', sceneId } }], speech: say(`Playing ${sceneId}.`, `Spiele ${sceneId}.`), lang };
    }
  }

  // --- Radio -------------------------------------------------------------------
  if (/\bradio\b/.test(text)) {
    if (/\bstop\b|\bpause\b|\bstopp|anhalten|pause/.test(text)) {
      return { calls: [{ name: 'control_radio', args: { action: 'stop' } }], speech: say('Stopping the radio.', 'Stoppe das Radio.'), lang };
    }
    if (/\bnext\b|nächste/.test(text)) {
      return { calls: [{ name: 'control_radio', args: { action: 'next' } }], speech: say('Next station.', 'Nächster Sender.'), lang };
    }
    const vol = text.match(/volume.*?(\d{1,3})|lautstärke.*?(\d{1,3})/);
    if (vol) {
      return { calls: [{ name: 'control_radio', args: { action: 'volume', volumePct: Math.min(100, Number(vol[1] || vol[2])) } }], speech: say('Setting the volume.', 'Setze die Lautstärke.'), lang };
    }
    const near = text.match(/near\s+(.{2,80})|in der nähe von\s+(.{2,80})|bei\s+(.{2,80})/);
    if (near) {
      const locationQuery = cleanPlace(near[1] || near[2] || near[3]);
      const args = { action: 'select', locationQuery };
      if (/\b(news|nachrichten)\b/.test(text)) args.category = 'news';
      else if (/\btalk\b/.test(text)) args.category = 'talk';
      else if (/\bweather\b|wetter/.test(text)) args.category = 'weather';
      return { calls: [{ name: 'control_radio', args }], speech: say(`Tuning in near ${locationQuery}.`, `Stelle Sender bei ${locationQuery} ein.`), lang };
    }
    if (/\b(news|nachrichten)\b/.test(text)) {
      return { calls: [{ name: 'control_radio', args: { action: 'select', category: 'news' } }], speech: say('Playing news radio.', 'Spiele Nachrichtenradio.'), lang };
    }
    return { calls: [{ name: 'control_radio', args: { action: 'play' } }], speech: say('Playing the radio.', 'Spiele Radio.'), lang };
  }

  // --- CCTV ---------------------------------------------------------------------
  // Specific camera ops first: "turn on the camera viewsheds" contains both a
  // layer verb and a camera noun, and the viewshed must win over the layer.
  if (/\bviewsheds?\b|sichthal|abdeckung/.test(text)) {
    return { calls: [{ name: 'control_cctv', args: { action: 'viewshed' } }], speech: say('Toggling camera viewsheds.', 'Schalte Kamera-Sichtfelder um.'), lang };
  }
  if (/\b(cctv|camera|kamera|coverage)\b/.test(text)) {
    if (/\bnearest\b|nächste/.test(text)) {
      return { calls: [{ name: 'control_cctv', args: { action: 'nearest' } }], speech: say('Jumping to the nearest camera.', 'Springe zur nächsten Kamera.'), lang };
    }
    if (/\bnext\b|nächste/.test(text)) {
      return { calls: [{ name: 'control_cctv', args: { action: 'next' } }], speech: say('Next camera.', 'Nächste Kamera.'), lang };
    }
    if (/\bprevious\b|\bprev\b|vorherige/.test(text)) {
      return { calls: [{ name: 'control_cctv', args: { action: 'prev' } }], speech: say('Previous camera.', 'Vorherige Kamera.'), lang };
    }
    if (/\b(?:analyze|analysiere|analysier|scanne|scan|was sieht|was ist zu sehen|prüfung|prüfe)\b/i.test(text)) {
      return { calls: [{ name: 'control_cctv', args: { action: 'analyze' } }], speech: say('Analyzing camera view.', 'Analysiere Kamerabild.'), lang };
    }
    const sel = text.match(/(?:select|choose|wähle|aktiviere)\s+(?:camera|kamera|cctv)\s+(.+)/i)
      || text.match(/(?:zeig(?:e)?\s+mir|show\s+me|find(?:e)?|öffne|open)\s+(?:eine\s+|a\s+)?(?:camera|kamera|cctv)\s+(?:bei|in|at|near|around|von)\s+(.+)/i)
      || text.match(/(?:camera|kamera|cctv)\s+(?:bei|in|at|near|around|von)\s+(.+)/i);
    if (sel) {
      const cam = cleanPlace(sel[1]);
      if (cam) {
        return {
          calls: [{ name: 'control_cctv', args: { action: 'select', cameraQuery: cam } }],
          speech: say(`Opening cameras in ${cam}.`, `Öffne Kameras in ${cam}.`),
          lang,
        };
      }
    }
    const layerOn = /\b(turn on|enable|show|einschalten|einblenden)\b/.test(text);
    const layerOff = /\b(turn off|disable|hide|ausschalten|ausblenden)\b/.test(text);
    if (layerOn || layerOff) {
      return { calls: [{ name: 'control_cctv', args: { action: layerOn ? 'enable' : 'disable' } }], speech: say(layerOn ? 'Cameras on.' : 'Cameras off.', layerOn ? 'Kameras ein.' : 'Kameras aus.'), lang };
    }
    return { calls: [{ name: 'control_cctv', args: { action: 'enable' } }], speech: say('Cameras on.', 'Kameras ein.'), lang };
  }

  // --- Clear chat history ---------------------------------------------------------
  if (/\b(clear|reset|delete).*(chat|conversation|history)|(chat|chatverlauf|nachrichten)\s*(löschen|leeren|zurücksetzen)|lösche\s*(den)?\s*(gesamten)?\s*chat/.test(text)) {
    return { calls: [{ name: 'clear_chat_history', args: {} }], speech: say('Chat history cleared.', 'Chatverlauf gelöscht.'), lang };
  }

  // --- Clear annotations ----------------------------------------------------------
  if (/\b(clear|reset).*(map|annotation|karte|markierung)|karte (löschen|zurücksetzen)/.test(text)) {
    return { calls: [{ name: 'clear_annotations', args: {} }], speech: say('Clearing the map.', 'Lösche die Karte.'), lang };
  }

  // --- Distance: how far is A from B -----------------------------------------------
  {
    const m = text.match(/how far is\s+(.+?)\s+from\s+(.+)|wie weit ist\s+(.+?)\s+(?:von|nach)\s+(.+)|entfernung.*?(?:zwischen|von)\s+(.+?)\s+und\s+(.+)/);
    if (m) {
      const a = cleanPlace(m[1] || m[3] || m[5]);
      const b = cleanPlace(m[2] || m[4] || m[6]);
      if (a && b) {
        return {
          calls: [{ name: 'annotate_map', args: { annotations: [{ type: 'arrow', target: a, toTarget: b }], flyTo: false, persist: true } }],
          speech: say(`Measuring from ${a} to ${b}.`, `Messe von ${a} nach ${b}.`),
          lang,
        };
      }
    }
  }

  // --- Routes: draw + fly ------------------------------------------------------------
  {
    const m = text.match(/(?:draw|walking route|driving route|route|zeichnen|route|weg|strecke).*?from\s+(.+?)\s+to\s+(.+)|(?:fußweg|gehweg|fahrstrecke|route).*?von\s+(.+?)\s+nach\s+(.+)/);
    if (m) {
      const a = cleanPlace(m[1] || m[3]);
      const b = cleanPlace(m[2] || m[4]);
      const mode = /\b(driv|fahr|auto)\b/.test(text) ? 'driving' : 'walking';
      if (a && b) {
        return {
          calls: [{ name: 'annotate_map', args: { annotations: [{ type: 'route', points: [{ target: a }, { target: b }], mode }], flyTo: false, persist: true } }],
          speech: say(`Drawing the route from ${a} to ${b}.`, `Zeichne die Route von ${a} nach ${b}.`),
          lang,
        };
      }
    }
  }
  if (/\bfly (the|this|that|die)?\s?route\b|route (abfliegen|fliegen)\b/.test(text)) {
    return { calls: [{ name: 'fly_route', args: {} }], speech: say('Flying the route.', 'Fliege die Route ab.'), lang };
  }

  // --- Tactical: Mark affected / impact zone ("markiere das betroffene Gebiet") ---------
  if (/\b(betroffene[ns]? gebiet|vom angriff betroffene|einschlags?gebiet|einschlags?zone|impact zone|affected area|angriffsgebiet)\b/i.test(text)) {
    const zoomIn = /\b(zoom|näher|ran|rein)\b/i.test(text);
    return {
      calls: [{ name: 'mark_tactical_impact_zone', args: { zoomIn } }],
      speech: say(
        zoomIn ? 'Zooming in and marking the affected strike zone.' : 'Marking the affected strike zone.',
        zoomIn ? 'Zoome heran und markiere das betroffene Angriffsgebiet.' : 'Markiere das betroffene Angriffsgebiet.'
      ),
      lang,
    };
  }

  // --- Tactical: Fly to attack / target ("fliege zu einem hin") --------------------------
  if (/\b(fliege?|bring mich|gehe?|jump|fly|go)\s+(zu\s+einem|zu\s+einer|hin|dort\s+hin|to\s+one|to\s+a\s+strike|to\s+a\s+target)\b/i.test(text)
    || /\b(fliege?\s+zu\s+einem\s+hin)\b/i.test(text)
    || /\b(zeig(e)?\s+mir\s+einen\s+(drohnenangriff|raketenangriff|anschlag))\b/i.test(text)) {
    const isDrone = /\b(drohne|uav|drone)\b/i.test(text);
    const category = isDrone ? 'drone-attacks' : undefined;
    return {
      calls: [{ name: 'fly_to_nearest_tactical_target', args: category ? { category } : {} }],
      speech: say('Flying to tactical target.', 'Fliege zum nächsten Einsatzziel.'),
      lang,
    };
  }

  // --- Tactical: Describe event / intel ("erzähl mir was drüber") -------------------------
  if (/\b(erzähl(e)?\s+mir\s+(was|mehr)\s+drüber|was\s+ist\s+hier\s+passiert|beschreibe?\s+(den|das)?\s*(angriff|ereignis|vorfall)|tell\s+me\s+about\s+(this|the\s+attack)|what\s+happened\s+here)\b/i.test(text)) {
    return {
      calls: [{ name: 'describe_tactical_event', args: {} }],
      speech: say('Querying tactical intelligence for this location.', 'Rufe Lagebericht und Aufklärungsdaten für diesen Sektor ab.'),
      lang,
    };
  }

  // --- Annotate: outline / mark ---------------------------------------------------------
  {
    const m = text.match(/(?:outline|outlines|draw the|draw|annotate|mark|markiere|zeichne|umrande|umranden|umriss|grenze von|grenzen von|highlight)\s+(?:the\s+|der\s+|die\s+|das\s+|state of\s+|bundesstaat\s+)?(.{2,120})/);
    if (m && !/route|arrow|distance|entfernung|betroffene|einschlags?zone|einschlags?gebiet|angriffsgebiet/.test(text)) {
      const target = cleanPlace(m[1]);
      const isBoundary = /\b(state of|bundesstaat|outline|umriss|umrisse|umrande|umranden|grenze|grenzen|boundary|border|einzeichnen)\b/i.test(text)
        || /\bzeichne\b.*\bein\b/i.test(text);
      if (target) {
        // Boundary asks name a PLACE with border words attached ("texas
        // border") — strip them so the resolver geocodes the place itself.
        const resolvedTarget = isBoundary
          ? target.replace(/\b(state of|bundesstaat|borders?|grenzen?( von)?|grenze( von)?|boundary|umrisse?)\b/gi, ' ').replace(/\s+/g, ' ').trim() || target
          : target;
        const args = { annotations: [{ type: isBoundary ? 'area' : 'pin', target: resolvedTarget }], flyTo: true, persist: true };
        if (hasReferenceWords(resolvedTarget)) {
          return toBrain(
            [{ name: 'annotate_map', args }],
            say(`Marking ${resolvedTarget}.`, `Markiere ${resolvedTarget}.`),
          );
        }
        return {
          calls: [{ name: 'annotate_map', args }],
          speech: say(
            isBoundary ? `Drawing outline of ${resolvedTarget}.` : `Marking ${resolvedTarget}.`,
            isBoundary ? `Zeichne ${resolvedTarget} ein.` : `Markiere ${resolvedTarget}.`,
          ),
          lang,
        };
      }
    }
  }

  // --- ISS pass ----------------------------------------------------------------------------
  if (/\biss\b.*\b(pass|over|über|wann)\b|\bpass.*\biss\b|raumstation/.test(text)) {
    return { calls: [{ name: 'next_iss_pass', args: {} }], speech: say('Checking the next ISS pass.', 'Prüfe den nächsten ISS-Überflug.'), lang };
  }

  // --- See intent: look at the screen and describe it + give facts -----------
  // Runs before analyst: "what buildings are those" is visual, "how many
  // planes can you see" stays analytical (counting guard below).
  {
    const counting = /\b(how many|wie viele|count|zähle|number of|anzahl)\b/.test(text);
    const visual = /\b(what do you see|what am i looking at|describe (this|the|my) (view|screen)|what'?s (in front of|on (the|my) screen)|what (building|buildings|place|monument|landmark|statue|bridge|tower|church|stadium) (is|are) (that|this)|which (building|place) (is|are) (that|this)|was siehst du|was du siehst|was sehe ich|beschreibe (die|diese) (ansicht|sicht)|was ist (das|hier) (für ein|vor mir)|erzähl(e)? mir was über (das|dies|hier|den bildschirm|die ansicht))\b/.test(text);
    if (visual && !counting) {
      return { calls: [], see: raw.trim().slice(0, 200), speech: '', lang };
    }
  }

  // --- Analyst questions ----------------------------------------------------------------------
  {
    const isQuestion = /\b(how many|which|what|biggest|largest|fastest|anything|is there|are there|wie viele|welche|größte|größer|schnellste|gibt es)\b/.test(text);
    if (isQuestion) {
      const layers = [];
      if (/\b(flights?|aircraft|planes?|military|helis?|flug|flüg\w*|fluege|flugzeuge?|militär)\b/.test(text)) {
        layers.push(/\bmilitary\b|\bmilitär/.test(text) ? 'military' : 'flights');
      }
      if (/\b(ships?|vessels?|boats?|schiffe?|hafen)\b/.test(text)) layers.push('ais-live-vessels');
      if (/\b(fires?|wildfires?|feuer|waldbr|brände|brand)\b/.test(text)) layers.push('local-firms');
      if (/\b(quakes?|earthquakes?|erdbeben|beben)\b/.test(text)) layers.push('earthquakes');
      if (!layers.length) {
        if (/\b(above|over|über|flying)\b/.test(text)) layers.push('flights');
        else return {
          calls: [],
          geminiQuestion: raw,
          speech: '',
          lang,
        };
      }
      const args = { layers };
      const region = text.match(/over\s+(?:the\s+)?([a-zäöüß .'-]{2,60})|in\s+(?:the\s+)?([a-zäöüß .'-]{2,60})|near\s+(?:the\s+)?([a-zäöüß .'-]{2,60})|über\s+([a-zäöüß .'-]{2,60})|bei\s+([a-zäöüß .'-]{2,60})/);
      const regionName = region ? cleanPlace(region[1] || region[2] || region[3] || region[4] || region[5]) : '';
      if (regionName && !/^(view|sicht|texas|france|los angeles|oakland|alps|london|austin)$/.test(regionName)) {
        // Keep only plausible region names; short view-words fall back to view scope.
        args.scope = /texas|france|los angeles|oakland|alps|california|germany|deutschland|europe|europa/.test(regionName)
          ? { kind: 'region', name: regionName }
          : { kind: 'view' };
      } else if (regionName) {
        args.scope = { kind: /texas|france|los angeles|oakland|alps/.test(regionName) ? 'region' : 'view', ...(regionName && /texas|france|los angeles|oakland|alps/.test(regionName) ? { name: regionName } : {}) };
      }
      const filters = [];
      const alt = text.match(/above\s+(\d[\d,]*)\s*(ft|feet|m|meters?)?|über\s+(\d[\d.]*)\s*(fuß|meter|m)?/);
      if (alt) {
        const rawNum = Number(String(alt[1] || alt[3]).replace(/[.,]/g, ''));
        const unit = (alt[2] || alt[4] || 'ft').toLowerCase();
        const meters = /m\b|meter/.test(unit) && !/ft|feet|fuß/.test(unit) ? rawNum : Math.round(rawNum * 0.3048);
        filters.push({ field: 'altitudeM', op: 'gt', value: meters });
      }
      if (/\b(biggest|largest|größte|stärkste)\b/.test(text)) {
        if (layers.includes('local-firms')) args.sortBy = 'frp';
        else if (layers.includes('earthquakes')) args.sortBy = 'magnitude';
        args.sortDir = 'desc';
        args.limit = 1;
      }
      if (/\b(fastest|schnellste)\b/.test(text)) {
        args.sortBy = layers.includes('ais-live-vessels') ? 'speedKts' : 'speedMps';
        args.sortDir = 'desc';
        args.limit = 3;
      }
      const dest = text.match(/headed to\s+(.{2,60})|heading to\s+(.{2,60})|nach\s+(.{2,60})\s+unterwegs|ziel\s+(.{2,60})/);
      if (dest && layers.includes('ais-live-vessels')) {
        filters.push({ field: 'destination', op: 'contains', value: cleanPlace(dest[1] || dest[2] || dest[3] || dest[4]) });
      }
      if (filters.length) args.filters = filters;
      if (/\b(which of those|closest|nächste davon|davon)\b/.test(text)) args.followUp = true;
      return {
        calls: [{ name: 'analyst_query', args }],
        speech: say('Checking the live layers.', 'Prüfe die Live-Layer.'),
        lang,
      };
    }
  }

  // --- Help --------------------------------------------------------------------------------------
  if (/^(help|hilfe|what can you|was kannst du|commands|befehle)/.test(text)) {
    return {
      calls: [],
      speech: say(
        'Try: take me to Tokyo. Turn flights on. Enter the cockpit. How many flights over Texas? What city is this? Play news radio near Austin. Clear the map.',
        'Versuch: Flieg nach Tokio. Schalte Flüge ein. Steig ins Cockpit ein. Wie viele Flüge über Texas? Welche Stadt ist das? Spiele Nachrichtenradio bei Austin. Lösche die Karte.',
      ),
      lang,
    };
  }

  // --- Selected object questions -------------------------------------------
  // Typo-tolerant German/English forms ("was macht/nacht dieses Flugzeug")
  // must read the live selection before the general chat-brain path.
  if (/\b(?:was\s+(?:ist|macht|nacht)|what\s+(?:is|does))\b.*\b(?:das|dieses?|this|that)\b.*\b(?:flugzeug|aircraft|plane|satellit|satelit|satellite|schiff|ship|vessel)\b/i.test(text)) {
    return {
      calls: [{ name: 'get_entity_context', args: { scope: 'selected' } }],
      speech: say('Reading the selected object.', 'Lese den ausgewählten Kontakt.'),
      lang,
    };
  }

  // --- Open questions → free cloud brain (Gemini free tier, optional) ---------
  // Anything question-shaped that no command or analyst pattern claimed goes
  // to the chat-brain chain. Gibberish without question markers stays unknown
  // so the mic does not spend quota on noise — but explicit tell-me/explain
  // asks are chat, even as statements (the text box is a chat surface).
  // NOTE: `text` is space-padded, so start-anchored (^) patterns never match
  // here — use (?:^|\s) for leading words.
  if (/\?|(?:^|\s)(who|what|when|where|why|how|which|wer|was|wo|wann|warum|wieso|weshalb|weswegen|wozu|worum|woran|worüber|womit|wie|welche[rnsm]?|tell me|erzähle? mir|explain|erkläre?|sag mir|zeig mir|analysiere?|überwache?|beobachte?|beurteile?|untersuche?|prüfe?|analyze|monitor|assess|evaluate)\b/i.test(text)) {
    return { calls: [], geminiQuestion: raw, speech: '', lang };
  }

  return no(
    'I did not understand that. Try "take me to Tokyo", "turn flights on", or ask "what city is this?".',
    'Das habe ich nicht verstanden. Versuch „Flieg nach Tokio“, „Schalte Flüge ein“ oder frag „Welche Stadt ist das?“.',
  );
}

/** True when the browser offers built-in (free, keyless) speech recognition. */
export function isFreeSpeechRecognitionAvailable(browserEnv) {
  const env = browserEnv || (typeof window !== 'undefined' ? window : null);
  if (!env) return false;
  return Boolean(env.SpeechRecognition || env.webkitSpeechRecognition);
}

/** Speak a short confirmation — silent no-op outside browsers. */
export function speakFreeVoiceConfirmation(text, browserEnv, lang = 'en') {
  try {
    const env = browserEnv || (typeof window !== 'undefined' ? window : null);
    const synth = env?.speechSynthesis;
    if (!synth || !text) return false;
    synth.cancel();
    const utter = new env.SpeechSynthesisUtterance(String(text).slice(0, 280));
    utter.rate = 1.05;
    // Never the OS fallback rasp when Chrome ships a Google voice: prefer
    // Google Deutsch for German text, Google US English otherwise.
    try {
      const voices = synth.getVoices?.() || [];
      const german = lang === 'de';
      utter.lang = german ? 'de-DE' : 'en-US';
      const pick = voices.find((v) => german
        ? /(?:natural.*german|online.*german|google.*deutsch|german.*natural)/i.test(v?.name || '')
        : /(?:natural.*english|online.*english|google.*us.*english|english.*natural)/i.test(v?.name || ''))
        || voices.find((v) => german
          ? /google.*deutsch/i.test(v?.name || '')
          : /google.*us.*english/i.test(v?.name || ''))
        || voices.find((v) => german
          ? /^de([-_]|$)/i.test(v?.lang || '') && !/desktop/i.test(v?.name || '')
          : /^en([-_]us|$)/i.test(v?.lang || '') && !/desktop/i.test(v?.name || ''))
        || voices.find((v) => german
          ? /^de([-_]|$)/i.test(v?.lang || '')
          : /^en([-_]us|$)/i.test(v?.lang || ''));
      if (pick) utter.voice = pick;
    } catch { /* voice pick is best effort */ }
    synth.speak(utter);
    return true;
  } catch {
    return false;
  }
}

/**
 * Unlock and resume the WebAudio context during user gestures (click, submit, keydown).
 * Ensures Google TTS PCM audio playback never falls back to the local voice due to suspended AudioContext.
 */
export function resumeGoogleTTSAudio(browserEnv) {
  try {
    const env = browserEnv || (typeof window !== 'undefined' ? window : null);
    const Ctor = env?.AudioContext || env?.webkitAudioContext;
    if (!Ctor) return;
    if (!_googleTtsAudioContext || _googleTtsAudioContextCtor !== Ctor) {
      _googleTtsAudioContext = new Ctor({ sampleRate: GOOGLE_TTS_SAMPLE_RATE });
      _googleTtsAudioContextCtor = Ctor;
    }
    void _googleTtsAudioContext.resume?.().catch(() => {});
  } catch { /* best effort */ }
}

/** Sample rate of Gemini TTS PCM output (matches the upstream mime type). */
export const GOOGLE_TTS_SAMPLE_RATE = 24000;

/**
 * Decode raw 16-bit PCM bytes to float samples. Pure — unit-tested.
 *
 * @param {Uint8Array} bytes - Little-endian signed 16-bit PCM.
 * @returns {Float32Array} Samples in [-1, 1].
 */
export function decodePcm16ToFloat32(bytes) {
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(0);
  const out = new Float32Array(Math.floor(input.length / 2));
  for (let i = 0; i < out.length; i += 1) {
    const lo = input[i * 2];
    const hi = input[i * 2 + 1];
    let sample = (hi << 8) | lo;
    if (sample >= 0x8000) sample -= 0x10000;
    out[i] = sample / 0x8000;
  }
  return out;
}

let _googleTtsAudioContext = null;
let _googleTtsAudioContextCtor = null;
let _googleTtsSource = null;

/** Stop Google TTS playback. Never throws. */
export function stopGoogleTTSPlayback(browserEnv) {
  try { _googleTtsSource?.stop?.(); } catch { /* already stopped */ }
  _googleTtsSource = null;
  try {
    const env = browserEnv || (typeof window !== 'undefined' ? window : null);
    env?.speechSynthesis?.cancel?.();
  } catch { /* noop */ }
}

/**
 * Play base64 PCM audio from /api/gemini/tts through WebAudio.
 *
 * @param {string} base64 - Raw PCM16 base64 (24 kHz mono).
 * @param {object} [browserEnv] - Injectable { AudioContext, atob } (tests).
 * @returns {Promise<boolean>} True when playback started.
 */
export async function playGoogleTTSAudio(base64, browserEnv) {
  try {
    const env = browserEnv || (typeof window !== 'undefined' ? window : null);
    const Ctor = env?.AudioContext || env?.webkitAudioContext;
    const decode = env?.atob || (typeof atob !== 'undefined' ? atob : null);
    if (!Ctor || !decode || !base64) return false;
    const binary = decode(String(base64));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i) & 0xff;
    const samples = decodePcm16ToFloat32(bytes);
    if (!samples.length) return false;
    // The cached context belongs to the constructor that built it (one per
    // page in production; per stub in tests) — never reuse across them.
    if (!_googleTtsAudioContext || _googleTtsAudioContextCtor !== Ctor) {
      _googleTtsAudioContext = new Ctor({ sampleRate: GOOGLE_TTS_SAMPLE_RATE });
      _googleTtsAudioContextCtor = Ctor;
    }
    const ctx = _googleTtsAudioContext;
    try { await ctx.resume?.(); } catch { /* autoplay policy settles on gesture */ }
    // A suspended context would play silence: report failure so the caller
    // falls back to the local voice instead of going quiet.
    try {
      if (typeof ctx.state === 'string' && ctx.state === 'suspended') return false;
    } catch { /* state unreadable — try anyway */ }
    try { _googleTtsSource?.stop?.(); } catch { /* superseded */ }
    const buffer = ctx.createBuffer(1, samples.length, GOOGLE_TTS_SAMPLE_RATE);
    buffer.getChannelData(0).set(samples);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    _googleTtsSource = source;
    source.onended = () => { if (_googleTtsSource === source) _googleTtsSource = null; };
    source.start();
    return true;
  } catch {
    return false;
  }
}

/**
 * Speak through Google TTS (server-brokered Gemini key), falling back to the
 * local system voice when the cloud path is unavailable. Never throws.
 *
 * Preview TTS quota is tight: after a 429 the cloud path cools down for
 * TTS_COOLDOWN_MS so later utterances fall back instantly instead of burning
 * another slow roundtrip per sentence (and letting the quota recover).
 *
 * @param {string} text - Text to speak (capped for TTS).
 * @param {object} [options]
 * @param {(url:string, init:object)=>Promise<{ok:boolean,status:number,json:()=>Promise<unknown>}>} [options.fetchImpl]
 * @param {object} [options.browserEnv] - Injectable browser surface (tests).
 * @param {string} [options.lang] - 'de' or 'en' for the fallback voice.
 * @param {()=>number} [options.now] - Clock (tests).
 * @returns {Promise<'google'|'local'|null>} Which voice spoke, if any.
 */
export const TTS_COOLDOWN_MS = 90_000;
let _ttsCoolUntil = 0;

/** Reset the TTS cooldown (tests). */
export function resetGoogleTTSCooldown() {
  _ttsCoolUntil = 0;
}

/**
 * Truncate long text to a concise 1-2 sentence lead for voice playback (maxChars).
 * Spoken sentences generate in < 3s instead of 45s, while UI still displays the full text.
 */
export function truncateForSpeech(text, maxChars = 260) {
  const str = String(text || '').trim();
  if (str.length <= maxChars) return str;
  const match = str.slice(0, maxChars).match(/^(.*?[.!?])(?:\s+|$)/s);
  if (match && match[1] && match[1].length >= 30) return match[1].trim();
  const wordMatch = str.slice(0, maxChars).match(/^(.*?)\s+\S*$/s);
  return (wordMatch ? wordMatch[1] : str.slice(0, maxChars)).trim();
}

export async function speakWithGoogleTTS(text, { fetchImpl = null, browserEnv = null, lang = 'en', now = null, timeoutMs = 5500 } = {}) {
  const clean = String(text || '').trim().slice(0, 500);
  if (!clean) return null;
  const clock = typeof now === 'function' ? now : Date.now;
  const doFetch = fetchImpl || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
  if (doFetch && clock() >= _ttsCoolUntil) {
    let timer = null;
    try {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      if (controller && Number.isFinite(timeoutMs) && timeoutMs > 0) {
        timer = setTimeout(() => { try { controller.abort(); } catch { /* no-op */ } }, timeoutMs);
      }
      const response = await doFetch('/api/gemini/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: clean }),
        signal: controller?.signal,
      });
      if (timer) { clearTimeout(timer); timer = null; }
      const data = await response?.json?.().catch(() => null);
      if (response?.status === 429 || data?.retryable) {
        try { _ttsCoolUntil = clock() + TTS_COOLDOWN_MS; } catch { /* clock is best effort */ }
      } else if (response?.ok && typeof data?.audio === 'string' && data.audio) {
        stopGoogleTTSPlayback(browserEnv);
        if (await playGoogleTTSAudio(data.audio, browserEnv)) return 'google';
      }
    } catch {
      if (timer) { clearTimeout(timer); timer = null; }
      /* fall through to the local voice immediately */
    }
  }
  return speakFreeVoiceConfirmation(clean, browserEnv, lang) ? 'local' : null;
}

/**
 * Create the free-voice controller. Additive: the Realtime controller keeps
 * owning the mic button; this controller only runs when asked (no OpenAI key).
 *
 * @param {object} options
 * @param {(name:string, args:object)=>Promise<object>} options.runner - Same runGevAction runner.
 * @param {{ detail?: { textContent: string } }} [options.ui] - Optional readout to mirror status into.
 * @param {boolean} [options.announce] - Speak confirmations (default true).
 * @param {(url:string, init:object)=>Promise<{ok:boolean,status:number,json:()=>Promise<unknown>}>} [options.fetchImpl] - Injectable fetch (tests).
 * @param {object} [options.browserEnv] - Injectable audio surface for Google TTS playback (tests).
 * @param {object} [options.log] - Conversation log ({ push(who, text, calls) }).
 * @param {()=>Promise<string|null>} [options.captureViewport] - Screenshot (data URL) or null.
 */
export function createFreeVoiceController({ runner, ui = null, announce = true, fetchImpl = null, browserEnv = null, log = null, captureViewport = null } = {}) {
  if (typeof runner !== 'function') throw new Error('createFreeVoiceController needs a runner function');
  const doFetch = fetchImpl || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
  // Cloud voice first (Google TTS via the server-brokered key), local system
  // voice as fallback. Fire-and-forget at every call site. The readout keeps
  // showing the text, suffixed with which voice actually spoke — so a silent
  // fallback or a missing cloud key is visible, not a mystery.
  const speak = (text, lang = 'en') => {
    if (!announce) return;
    void (async () => {
      const speechText = truncateForSpeech(text, 260);
      const how = await speakWithGoogleTTS(speechText, { fetchImpl: doFetch, browserEnv, lang });
      if (how === 'google') setDetail(`${text} · GOOGLE VOICE`);
      else if (how === 'local') setDetail(`${text} · LOCAL VOICE`);
    })();
  };
  const logTurn = (who, text, calls) => {
    try { log?.push?.(who, text, calls); } catch { /* logging never breaks voice */ }
  };

  /** Best-effort multi-system live snapshot shared by ask/describe/routing flows. */
  async function readContextText() {
    try {
      const [viewState, entity] = await Promise.all([
        Promise.resolve().then(() => runner('get_current_view_state', {})).catch(() => null),
        Promise.resolve().then(() => runner('get_entity_context', { scope: 'auto' })).catch(() => null),
      ]);

      const parts = [];

      // 1. Camera Location & Orientation & Ground Gaze
      if (viewState?.camera) {
        const cam = viewState.camera;
        let camStr = `CAMERA: lat ${cam.latitude}°, lon ${cam.longitude}°, alt ${Math.round(cam.heightM || 0)}m, heading ${cam.headingDeg || 0}°, pitch ${cam.pitchDeg || 0}°`;
        if (cam.lookTarget) {
          camStr += ` | LOOKING AT GROUND: lat ${cam.lookTarget.latitude}°, lon ${cam.lookTarget.longitude}°`;
        }
        parts.push(camStr);
      } else if (viewState) {
        parts.push(`VIEW STATE: ${JSON.stringify(viewState)}`);
      }

      // 2. Active Layers & Loaded Entities
      if (Array.isArray(viewState?.layers)) {
        const active = viewState.layers
          .filter((l) => l.enabled)
          .map((l) => `${l.name || l.id} (${l.count} items)`);
        parts.push(`ACTIVE DATA LAYERS: ${active.length ? active.join(', ') : 'none'}`);
      }

      // 3. Selected or Tracked Entity
      if (Array.isArray(viewState?.tracked) && viewState.tracked.length) {
        const tr = viewState.tracked.map((t) => `${t.kind || 'object'}: ${t.label || t.id}`).join(', ');
        parts.push(`TRACKED ENTITY: ${tr}`);
      } else if (entity?.selected) {
        parts.push(`SELECTED ENTITY: ${JSON.stringify(entity.selected).slice(0, 200)}`);
      }

      // 4. Live Botnet / OSINT Breaking Dispatches
      let osintSummary = '';
      try {
        if (typeof window !== 'undefined' && window.__godsEyeView?.visitorTracker?.getRecentEvents) {
          const events = window.__godsEyeView.visitorTracker.getRecentEvents() || [];
          if (events.length) {
            osintSummary = events.slice(0, 3).map((e) => `[${e.type || 'botnet'}]: ${e.summary || e.title || JSON.stringify(e)}`).join('; ');
          }
        }
      } catch { /* best effort */ }
      if (!osintSummary && typeof SEED_OSINT_RECORDS !== 'undefined' && Array.isArray(SEED_OSINT_RECORDS)) {
        osintSummary = SEED_OSINT_RECORDS.slice(0, 3).map((r) => `[${r.locationName} - ${r.weaponSystem || r.category}]: ${r.summary}`).join('; ');
      }
      if (osintSummary) {
        parts.push(`BREAKING OSINT/BOTNET: ${osintSummary.slice(0, 400)}`);
      }

      // 5. Geopolitical Financial Markets
      if (typeof SEED_MARKET_DATA !== 'undefined' && Array.isArray(SEED_MARKET_DATA)) {
        const brent = SEED_MARKET_DATA.find((q) => q.symbol === 'BZ=F');
        const gold = SEED_MARKET_DATA.find((q) => q.symbol === 'GC=F');
        const sp = SEED_MARKET_DATA.find((q) => q.symbol === '^GSPC');
        const rhm = SEED_MARKET_DATA.find((q) => q.symbol === 'RHM.DE');
        parts.push(`GEOPOLITICAL MARKETS: Brent Oil $${brent?.price || '95.94'} (${brent?.changePct || '0%'}), Gold $${gold?.price || '4388'}, S&P500 ${sp?.price || '7764'}, Rheinmetall €${rhm?.price || '1010'}`);
      }

      // 6. Curated World Wonders / 3D Destinations Catalog (for open / "was cooles" asks)
      parts.push(
        'WORLD WONDERS CATALOG (for spectacular 3D exploration): '
        + 'Mount Everest (lat 27.9881, lon 86.9250, range 7000m, pitch -25°), '
        + 'Grand Canyon (lat 36.0544, lon -112.1401, range 4500m, pitch -35°), '
        + 'Giza Pyramids (lat 29.9792, lon 31.1342, range 2200m, pitch -30°), '
        + 'Matterhorn (lat 45.9765, lon 7.6585, range 4500m, pitch -25°), '
        + 'Mariana Trench (lat 11.3733, lon 142.5917, range 50000m, pitch -45°), '
        + 'Tromsø Aurora (lat 69.6492, lon 18.9553, range 15000m, pitch -30°), '
        + 'Victoria Falls (lat -17.9243, lon 25.8572, range 3000m, pitch -35°), '
        + 'Active Supersonic Military Jet (select_nearest_aircraft military), '
        + 'ISS Space Station (track_entity ISS).'
      );

      if (!parts.length) {
        return JSON.stringify({ view: viewState, entity }).slice(0, 3000);
      }
      return parts.join('\n\n').slice(0, 3500);
    } catch {
      return '';
    }
  }
  const state = {
    active: false,
    recognition: null,
    lastHeard: '',
    lastResult: null,
    lastNearestAircraftLocation: null,
  };

  const setDetail = (text) => {
    try {
      if (ui?.detail) ui.detail.textContent = String(text || '').toUpperCase().slice(0, 120);
    } catch { /* readout is best effort */ }
  };

  /**
   * Answer an open question through the free cloud brain (POST
   * /api/gemini/ask, key stays server-side). Scene context is gathered
   * best-effort through the same action runner so the answer is grounded in
   * what the user is actually looking at.
   */
  async function askGemini(question, lang = 'en', opts = {}) {
    const de = lang === 'de';
    const say = (en, german) => (de ? german : en);
    if (!doFetch) {
      const speech = say(
        'Free answers need network access, which is unavailable here.',
        'Freie Antworten brauchen Netzwerkzugriff, der hier fehlt.',
      );
      state.lastResult = { ok: false, speech };
      setDetail(speech);
      return state.lastResult;
    }
    setDetail(say('ASKING GEMINI (FREE)…', 'FRAGE GEMINI (GRATIS)…'));
    const context = await readContextText();
    let response = null;
    try {
      response = await doFetch('/api/gemini/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: String(question || '').slice(0, 500), context }),
      });
    } catch {
      response = null;
    }
    const data = await response?.json?.().catch(() => null);
    if (response?.status === 503 && data?.code === 'GEMINI_NOT_CONFIGURED') {
      const speech = say(
        'Free answers need the free Gemini key: open POWER UP, add the GEMINI row with a key from AI Studio. It costs nothing and needs no billing.',
        'Freie Antworten brauchen den gratis Gemini-Key: Öffne POWER UP und trage in der GEMINI-Zeile einen Key aus AI Studio ein. Kostet nichts, kein Billing nötig.',
      );
      state.lastResult = { ok: false, speech, needsKey: true };
      setDetail(speech);
      if (!opts?.silent) speak(speech, lang);
      logTurn('app', speech);
      return state.lastResult;
    }
    if (response?.status === 429 || data?.retryable) {
      const speech = say(
        'The free Gemini quota is exhausted — try again in a minute.',
        'Das gratis Gemini-Kontingent ist aufgebraucht — versuch es in einer Minute erneut.',
      );
      state.lastResult = { ok: false, speech, retryable: true };
      setDetail(speech);
      if (!opts?.silent) speak(speech, lang);
      logTurn('app', speech);
      return state.lastResult;
    }
    const answer = typeof data?.answer === 'string' ? data.answer.trim() : '';
    if (response?.ok && answer) {
      state.lastResult = { ok: true, speech: answer, answer };
      setDetail(answer);
      if (!opts?.silent) speak(answer, lang);
      logTurn('gemini', answer);
      return state.lastResult;
    }
    const speech = data?.blocked
      ? say('Gemini gave no answer to that.', 'Darauf gab Gemini keine Antwort.')
      : say('Free answers are unavailable right now.', 'Freie Antworten sind gerade nicht verfügbar.');
    state.lastResult = { ok: false, speech };
    setDetail(speech);
    if (!opts?.silent) speak(speech, lang);
    logTurn('app', speech);
    return state.lastResult;
  }

  /**
   * One typed-chat brain behind /api/<brain>/chat. Speaks + logs the answer.
   * Returns { handled } — a 503 (key missing) or dead network means "next
   * brain in the chain", everything else is handled here, honestly.
   */
  async function askChatBrain({ endpoint, who, lang = 'en', message, context, image = null, opts = {} }) {
    const de = lang === 'de';
    const say = (en, german) => (de ? german : en);
    if (!doFetch) return { handled: false };
    setDetail(say('ASKING THE CHAT BRAIN…', 'FRAGE DIE CHAT-KI…'));
    let response = null;
    try {
      const payload = { message: String(message || '').slice(0, 1000), context: String(context || '').slice(0, 1500) };
      if (image) payload.images = [image];
      response = await doFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload),
      });
    } catch {
      response = null;
    }
    const data = await response?.json?.().catch(() => null);
    if (!response || response.status === 503) return { handled: false };
    const fail = (en, german, extra) => {
      const speech = say(en, german);
      state.lastResult = { ok: false, speech, ...extra };
      setDetail(speech);
      if (!opts?.silent) speak(speech, lang);
      logTurn('app', speech);
      return { handled: true, result: state.lastResult };
    };
    if (response.status === 401) {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('gev:auth-required'));
      }
      return fail(
        'Security PIN required. Please enter 6-digit access code.',
        'Sicherheits-PIN erforderlich. Bitte 6-stelligen Code eingeben.',
        { authRequired: true },
      );
    }
    if (response.status === 429 || data?.retryable) {
      return fail(
        'The chat brain quota is exhausted — try again in a minute.',
        'Das Chat-Kontingent ist aufgebraucht — versuch es in einer Minute erneut.',
        { retryable: true },
      );
    }
    const answer = typeof data?.answer === 'string' ? data.answer.trim() : '';
    if (response.ok && answer) {
      state.lastResult = { ok: true, speech: answer, answer };
      setDetail(answer);
      if (!opts?.silent) speak(answer, lang);
      logTurn(who, answer);
      return { handled: true, result: state.lastResult };
    }
    if (data?.blocked) {
      return fail('The chat brain gave no answer to that.', 'Die Chat-KI gab darauf keine Antwort.');
    }
    return fail('Chat is unreachable right now.', 'Chat ist gerade nicht erreichbar.');
  }

  /**
   * Second hop for knowledge-then-act: a brain-routed web_search returned
   * sourced results — hand them to the SAME brain once so it can make the
   * map call itself. Bounded to exactly one extra hop (the follow-up
   * executes directly, never chains again), so this always terminates.
   * Falls back to speaking the top hit when the brain yields no second call.
   */
  async function chainWebSearchFollowUp(endpoint, brainWho, originalText, searchResult, lang = 'en', opts = {}) {
    const de = lang === 'de';
    const results = Array.isArray(searchResult?.results) ? searchResult.results.slice(0, 3) : [];
    if (!results.length) return null;
    const resultBlock = results
      .map((r, i) => `${i + 1}. ${r.title} — ${r.snippet} (${r.source || 'web'})`)
      .join('\n');
    const message = `The user asked: "${String(originalText || '').slice(0, 300)}"\n\nWeb search results for "${String(searchResult?.query || '').slice(0, 120)}":\n${resultBlock}\n\nNow answer with ONLY the map-tool JSON (same envelope as before) that fulfills the request, or a short direct answer.`;
    let data = null;
    try {
      const response = await doFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, system: ROUTER_SYSTEM_PROMPT }),
      });
      if (response && response.status !== 503) data = await response?.json?.().catch(() => null);
    } catch {
      data = null;
    }
    const follow = (name, args, say) => {
      logTurn(brainWho, say);
      return executeCalls([{ name, args }], say, lang, { routed: true, silent: opts?.silent });
    };
    const routed = extractRouterCall(data?.answer);
    if (routed && routed.name && routed.name !== 'web_search' && isCompleteRouterCall(routed.name, routed.args)) {
      return follow(routed.name, routed.args, routed.say || synthRouterSay(routed.name, routed.args, lang));
    }
    const degenerate = routed?.name ? null : extractDegenerateRouterCall(data?.answer);
    if (degenerate && degenerate.name !== 'web_search' && isCompleteRouterCall(degenerate.name, degenerate.args)) {
      return follow(degenerate.name, degenerate.args, synthRouterSay(degenerate.name, degenerate.args, lang));
    }
    // Honest fallback: speak the top hit instead of silence.
    const top = results[0];
    const speech = top ? `${top.title}: ${top.snippet}`.slice(0, 280)
      : (de ? 'Die Suche brachte keine verwertbaren Fakten.' : 'The search brought no usable facts.');
    state.lastResult = { ok: true, speech, answer: speech };
    setDetail(speech);
    if (!opts?.silent) speak(speech, lang);
    logTurn(brainWho, speech);
    return state.lastResult;
  }

  async function chainDataFollowUp(endpoint, brainWho, originalText, toolName, dataText, lang = 'en', opts = {}) {
    const de = lang === 'de';
    const message = `The user asked: "${String(originalText || '').slice(0, 400)}"\n\nRetrieved Real-Time Data from ${toolName}:\n${String(dataText || '').slice(0, 2200)}\n\nPlease provide a direct, insightful, and comprehensive answer to the user's specific question based on this analytical data.`;
    const system = de
      ? "Du bist der analytische Militär- und Finanz-Supercomputer von God's Eye View. Fasse die bereitgestellten Echtzeit-Modellanalysen und Prognosen (Top-Ausbruchskandidaten, Kursziele, Kausalitäten und Katalysatoren) direkt, präzise und fundiert auf Deutsch für den Nutzer zusammen. Nenne konkret die prognostizierten Spitzenreiter und deren Wachstumstreiber. Gib keine Standard-Haftungsausschlüsse oder Verweigerungen aus."
      : "You are the analytical supercomputer of God's Eye View. Synthesize the provided real-time model forecasts (top breakout stocks, price targets, causalities, and catalysts) directly and concisely for the user. Explicitly name the top candidates and their growth drivers without standard financial disclaimers.";

    let answer = null;
    try {
      const response = await doFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, system }),
        signal: AbortSignal.timeout(12000),
      });
      if (response && response.status !== 503) {
        const data = await response?.json?.().catch(() => null);
        const rawAns = data?.answer || '';
        const cleaned = extractDirectAnswer(rawAns);
        const isRefusal = /(?:tut mir leid|kann leider|kann ich leider nicht|keine anlageberatung|über keine glaskugel|nicht möglich|sorry|cannot predict|unable to predict)/i.test(cleaned || rawAns || '');
        if (!isRefusal && cleaned && !cleaned.startsWith('{') && !cleaned.startsWith('[')) {
          answer = cleaned;
        } else if (!isRefusal && typeof rawAns === 'string' && rawAns.trim().length > 10 && !rawAns.trim().startsWith('{')) {
          answer = rawAns.trim();
        }
      }
    } catch {
      answer = null;
    }

    if (answer) {
      logTurn(brainWho, answer);
      state.lastResult = { ok: true, speech: answer, answer };
      setDetail(answer);
      if (!opts?.silent) speak(answer, lang);
      return state.lastResult;
    }
    return null;
  }

  /**
   * After a brain-routed search or data retrieval tool executed with results,
   * give the same brain a follow-up hop to synthesize the answer for the user.
   * Returns the chained result, or null when no chaining applies.
   */
  async function maybeChainFollowUp(endpoint, brainWho, originalText, routedName, firstResult, lang = 'en', opts = {}) {
    if (!doFetch) return null;
    if (routedName === 'web_search') {
      const wsOutcome = firstResult?.outcomes?.[0];
      if (!wsOutcome?.ok || !Array.isArray(wsOutcome.result?.results) || !wsOutcome.result.results.length) return null;
      return chainWebSearchFollowUp(endpoint, brainWho, originalText, wsOutcome.result, lang, opts);
    }
    if (
      routedName === 'query_financial_market_impact' ||
      routedName === 'search_and_forecast_asset' ||
      routedName === 'query_osint_news' ||
      routedName === 'describe_tactical_event'
    ) {
      const outcome = firstResult?.outcomes?.[0];
      if (!outcome?.ok) return null;
      const res = outcome.result;
      const sitrep = res?.sitrepDe || res?.sitrepEn || res?.summary;
      if (!sitrep) return null;
      return chainDataFollowUp(endpoint, brainWho, originalText, routedName, sitrep, lang, opts);
    }
    return null;
  }

  /**
   * Open typed questions walk the brain chain: Z.AI GLM first (new + cheap),
   * then Ollama Cloud, then Gemini. The first configured brain answers.
   */
  async function chatWithBrain(question, lang = 'en', opts = {}) {
    const context = await readContextText();
    let image = null;
    try {
      image = typeof captureViewport === 'function' ? await captureViewport() : null;
    } catch {
      image = null;
    }
    for (const brain of [
      { endpoint: '/api/zai/chat', who: 'zai' },
      { endpoint: '/api/ollama/chat', who: 'ollama' },
      { endpoint: '/api/abacus/chat', who: 'abacus' },
    ]) {
      const attempt = await askChatBrain({ ...brain, lang, message: question, context, image, opts });
      if (attempt.handled) return attempt.result;
    }
    return askGemini(question, lang, opts);
  }

  /**
   * Typed chat (text box): EVERYTHING goes through the multimodal Ollama
   * brain FIRST — screenshot attached, history + scene included. The model
   * thinks (coreference, typos, visible places like THE harbor on screen)
   * and returns a tool call, or plain text for visible questions. Local
   * parser is only the fallback when no brain answers. Never touches Gemini:
   * typed text belongs to Ollama, voice belongs to mic/Space.
   */
  async function handleChatText(rawText) {
    const text = String(rawText || '').trim().slice(0, 500);
    if (!text) return null;
    const lang = GERMAN_MARKER.test(text) ? 'de' : 'en';

    // Direct Live Monitor command intercept
    const trimmed = text.trim().toLowerCase();
    if (
      /^((\/)?monitor|live\s*monitor|besucher(\s*monitor)?|wer\s+ist\s+online|wer\s+besucht(\s+meine\s+website)?|surveillance|visitor\s*monitor)$/i.test(trimmed) ||
      trimmed.includes('besucher monitor') ||
      trimmed.includes('live monitor')
    ) {
      state.lastHeard = text;
      logTurn('you', text);
      const msg = lang === 'de' ? 'Öffne Live Besucher- & Telemetrie-Monitor.' : 'Opening Live Visitor Surveillance Monitor.';
      setDetail(msg);
      logTurn('app', msg);
      state.lastResult = { ok: true, speech: msg, answer: msg };
      if (typeof window.__godsEyeView?.openLiveMonitor === 'function') {
        window.__godsEyeView.openLiveMonitor();
      }
      return state.lastResult;
    }

    // Direct clear chat command intercept
    if (
      /^((\/)?clear(\s*chat)?|chatverlauf\s*löschen|lösche\s*(den)?\s*(gesamten)?\s*chatverlauf|chat\s*leeren|verlauf\s*löschen|clear)$/i.test(trimmed) ||
      trimmed.includes('chatverlauf löschen') ||
      trimmed.includes('lösche den gesamten chatverlauf') ||
      trimmed.includes('lösche den chatverlauf') ||
      trimmed.includes('chat leeren')
    ) {
      log?.clear?.();
      const msg = lang === 'de' ? 'Chatverlauf gelöscht.' : 'Chat history cleared.';
      setDetail(msg);
      state.lastResult = { ok: true, speech: msg, answer: msg };
      return state.lastResult;
    }

    state.lastHeard = text;
    logTurn('you', text);
    let history = [];
    try {
      history = (log?.list?.() || []).slice(-8).map((e) => ({ who: e.who, text: e.text }));
    } catch { /* route without history */ }
    const scene = await readContextText();
    let image = null;
    try {
      image = typeof captureViewport === 'function' ? await captureViewport() : null;
    } catch {
      image = null;
    }
    const message = buildRouterMessage(text, history, scene);
    const system = `${ROUTER_SYSTEM_PROMPT}\n${ROUTER_VISION_ADDENDUM}`;
    if (doFetch) {
      for (const brain of [
        { endpoint: '/api/ollama/chat', who: 'ollama' },
        { endpoint: '/api/abacus/chat', who: 'abacus' },
        { endpoint: '/api/zai/chat', who: 'zai' },
      ]) {
        let response = null;
        try {
          const payload = { message, system };
          if (image) payload.images = [image];
          response = await doFetch(brain.endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify(payload),
          });
        } catch {
          response = null;
        }
        if (response && response.status === 401) {
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('gev:auth-required'));
          }
          const authMsg = lang === 'de'
            ? 'Sicherheits-PIN erforderlich. Bitte 6-stelligen Code eingeben.'
            : 'Security PIN required. Please enter 6-digit access code.';
          state.lastResult = { ok: false, speech: authMsg, answer: authMsg, authRequired: true };
          setDetail(authMsg);
          logTurn('app', authMsg);
          return state.lastResult;
        }
        if (response && response.ok) {
          const data = await response?.json?.().catch(() => null);
          const routed = extractRouterCall(data?.answer);
          if (routed && routed.name && isCompleteRouterCall(routed.name, routed.args)) {
            if (routed.name === 'select_nearest_aircraft') {
              routed.args = normalizeSelectNearestAircraftArgs(
                routed.args,
                text,
                state.lastNearestAircraftLocation,
              );
            }
            const say = routed.say || synthRouterSay(routed.name, routed.args, lang);
            logTurn(brain.who, say);
            const first = await executeCalls(
              [{ name: routed.name, args: routed.args }],
              say,
              lang,
              { routed: true, silent: true },
            );
            return (await maybeChainFollowUp(brain.endpoint, brain.who, text, routed.name, first, lang, { silent: true })) || first;
          }
          // Degenerate pseudo-format ("fly_to_location {...}", bare tool +
          // JSON): synthesize the call with a clean confirmation instead of
          // leaking raw syntax into the chat.
          const degenerate = routed?.name ? null : extractDegenerateRouterCall(data?.answer);
          if (degenerate && isCompleteRouterCall(degenerate.name, degenerate.args)) {
            const say = synthRouterSay(degenerate.name, degenerate.args, lang);
            logTurn(brain.who, say);
            const first = await executeCalls(
              [{ name: degenerate.name, args: degenerate.args }],
              say,
              lang,
              { routed: true, silent: true },
            );
            return (await maybeChainFollowUp(brain.endpoint, brain.who, text, degenerate.name, first, lang, { silent: true })) || first;
          }
          // Direct answers to questions (visual phenomena, geography, colors, etc.) from the model.
          const direct = extractDirectAnswer(data?.answer);
          const isRefusal = /(?:tut mir leid|kann leider|konnte keine|nicht finden|keine cctv|nicht möglich|sorry|cannot find|could not find|unable to find|no suitable tool|keine passende tool)/i.test(direct || '');
          if (response.ok && direct && !isRefusal) {
            state.lastResult = { ok: true, speech: direct, answer: direct };
            setDetail(direct);
            logTurn(brain.who, direct);
            return state.lastResult;
          }
        }
      }
    }
    // Fallback: local parser, no brain involved.
    const parsed = parseFreeVoiceCommand(text);
    if (parsed.see) {
      // Typed see without a brain vision answer above: still describe via
      // the classic path (currently Gemini-backed) as last resort.
      return describeView(parsed.see, parsed.lang, { silent: true });
    }
    if (parsed.geminiQuestion) {
      return chatWithBrain(parsed.geminiQuestion, parsed.lang, { silent: true });
    }
    if (!parsed.calls.length) {
      return routeUnknown(text, parsed, { silent: true });
    }
    return executeCalls(parsed.calls, parsed.speech, parsed.lang, { rawText: text, silent: true });
  }

  /**
   * Look at the screen: capture the viewport, describe it with the vision
   * model, speak the facts. Honest when capture is impossible or unconfigured.
   */
  async function describeView(question, lang = 'en', opts = {}) {
    const de = lang === 'de';
    const say = (en, german) => (de ? german : en);
    if (!doFetch) {
      const speech = say(
        'Screen descriptions need network access, which is unavailable here.',
        'Bildbeschreibungen brauchen Netzwerkzugriff, der hier fehlt.',
      );
      state.lastResult = { ok: false, speech };
      setDetail(speech);
      return state.lastResult;
    }
    setDetail(say('LOOKING AT THE SCREEN…', 'SCHAUE AUF DEN BILDSCHIRM…'));
    let image = null;
    try {
      image = typeof captureViewport === 'function' ? await captureViewport() : null;
    } catch {
      image = null;
    }
    if (!image) {
      const speech = say(
        'I could not capture the screen right now — try again in a moment.',
        'Ich konnte den Bildschirm gerade nicht erfassen — versuch es gleich nochmal.',
      );
      state.lastResult = { ok: false, speech };
      setDetail(speech);
      if (!opts?.silent) speak(speech, lang);
      logTurn('app', speech);
      return state.lastResult;
    }
    const context = await readContextText();
    let response = null;
    try {
      response = await doFetch('/api/gemini/see', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image, question: String(question || '').slice(0, 300), context }),
      });
    } catch {
      response = null;
    }
    const data = await response?.json?.().catch(() => null);
    if (response?.status === 503 && data?.code === 'GEMINI_NOT_CONFIGURED') {
      const speech = say(
        'Screen descriptions need the free Gemini key: open POWER UP, add the GEMINI row with a key from AI Studio.',
        'Bildbeschreibungen brauchen den gratis Gemini-Key: Öffne POWER UP und trage in der GEMINI-Zeile einen Key aus AI Studio ein.',
      );
      state.lastResult = { ok: false, speech, needsKey: true };
      setDetail(speech);
      if (!opts?.silent) speak(speech, lang);
      logTurn('app', speech);
      return state.lastResult;
    }
    if (response?.status === 429 || data?.retryable) {
      const speech = say(
        'The free Gemini quota is exhausted — try again in a minute.',
        'Das gratis Gemini-Kontingent ist aufgebraucht — versuch es in einer Minute erneut.',
      );
      state.lastResult = { ok: false, speech, retryable: true };
      setDetail(speech);
      if (!opts?.silent) speak(speech, lang);
      logTurn('app', speech);
      return state.lastResult;
    }
    const answer = typeof data?.answer === 'string' ? data.answer.trim() : '';
    if (response?.ok && answer) {
      state.lastResult = { ok: true, speech: answer, answer };
      setDetail(answer);
      if (!opts?.silent) speak(answer, lang);
      logTurn('gemini', answer);
      return state.lastResult;
    }
    const speech = say(
      'I could not make out this view.',
      'Diese Ansicht konnte ich nicht deuten.',
    );
    state.lastResult = { ok: false, speech };
    setDetail(speech);
    if (!opts?.silent) speak(speech, lang);
    logTurn('app', speech);
    return state.lastResult;
  }

  async function handleText(rawText) {
    const text = String(rawText || '').trim();
    const trimmed = text.toLowerCase();
    if (
      /^((\/)?monitor|live\s*monitor|besucher(\s*monitor)?|wer\s+ist\s+online|wer\s+besucht(\s+meine\s+website)?|surveillance|visitor\s*monitor)$/i.test(trimmed) ||
      trimmed.includes('besucher monitor') ||
      trimmed.includes('live monitor')
    ) {
      const lang = GERMAN_MARKER.test(text) ? 'de' : 'en';
      state.lastHeard = text;
      logTurn('you', text);
      const spoken = lang === 'de' ? 'Öffne Live Besucher- und Telemetrie-Monitor.' : 'Opening Live Visitor Surveillance Monitor.';
      state.lastResult = { ok: true, speech: spoken, answer: spoken };
      setDetail(spoken);
      speak(spoken, lang);
      logTurn('app', spoken);
      if (typeof window.__godsEyeView?.openLiveMonitor === 'function') {
        window.__godsEyeView.openLiveMonitor();
      }
      return state.lastResult;
    }

    const parsed = parseFreeVoiceCommand(rawText);
    state.lastHeard = String(rawText || '');
    logTurn('you', state.lastHeard);
    if (parsed.see) {
      return describeView(parsed.see, parsed.lang);
    }
    if (parsed.geminiQuestion) {
      return chatWithBrain(parsed.geminiQuestion, parsed.lang);
    }
    if (!parsed.calls.length) {
      if (parsed.brainRoute) {
        const routed = await routeWithBrain(parsed.brainRoute.text, parsed.lang);
        if (routed) return routed;
        if (!parsed.brainRoute.fallbackCalls.length) {
          // Knowledge question, no tool to fall back to: answer it directly.
          return chatWithBrain(state.lastHeard, parsed.lang);
        }
        return executeCalls(
          parsed.brainRoute.fallbackCalls,
          parsed.brainRoute.fallbackSpeech,
          parsed.lang,
          { rawText: state.lastHeard },
        );
      }
      return routeUnknown(state.lastHeard, parsed);
    }
    return executeCalls(parsed.calls, parsed.speech, parsed.lang, { rawText: state.lastHeard });
  }

  /**
   * Second chance for a failed place flight: ask a chat brain to correct the
   * query (typos, pronouns) and fly once more. Returns the replacement result
   * or null when no brain could help (original failure stands).
   */
  async function retryFlyWithBrain(args, lang = 'en', opts = {}) {
    const de = lang === 'de';
    const originalQuery = String(args?.query || '').trim();
    if (!originalQuery || !doFetch) return null;
    let history = [];
    try {
      history = (log?.list?.() || []).slice(-8).map((e) => ({ who: e.who, text: e.text }));
    } catch { /* route without history */ }
    const scene = await readContextText();
    const message = buildPlaceFixMessage(originalQuery, history, scene);
    for (const endpoint of ['/api/zai/chat', '/api/ollama/chat', '/api/abacus/chat']) {
      let response = null;
      try {
        response = await doFetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message }),
        });
      } catch {
        response = null;
      }
      if (!response || response.status === 503) continue;
      const data = await response?.json?.().catch(() => null);
      const fix = extractPlaceFix(data?.answer);
      if (!fix || fix.unknown || !fix.query) continue;
      if (fix.query.toLowerCase() === originalQuery.toLowerCase()) continue; // no loop on identical
      let outcome;
      try {
        const result = await runner('fly_to_location', { ...args, query: fix.query });
        outcome = { name: 'fly_to_location', ok: result?.ok !== false, result };
      } catch (error) {
        outcome = { name: 'fly_to_location', ok: false, error: error?.message || String(error) };
      }
      const speech = outcome.ok
        ? (de ? `Fliege nach ${fix.query}.` : `Flying to ${fix.query}.`)
        : (de
          ? `Auch „${fix.query}“ habe ich nicht gefunden.`
          : `I could not find "${fix.query}" either.`);
      state.lastResult = { ok: outcome.ok, speech, outcomes: [outcome], retriedFrom: originalQuery };
      setDetail(speech);
      if (!opts?.silent) speak(speech, lang);
      logTurn('app', speech, [{ name: outcome.name, ok: outcome.ok, ...(outcome.ok ? {} : { error: outcome.error }) }]);
      return state.lastResult;
    }
    return null;
  }

  /**
   * Second chance for a failed annotation: ask a chat brain to correct the
   * target (hallucinated phrase → canonical place name) and draw once more.
   * Returns the replacement result or null when no brain could help.
   */
  async function retryAnnotateWithBrain(args, lang = 'en', opts = {}) {
    const de = lang === 'de';
    const list = Array.isArray(args?.annotations) ? args.annotations : [];
    const originalTarget = String(list[0]?.target || args?.target || '').trim();
    if (!originalTarget || !doFetch) return null;
    let history = [];
    try {
      history = (log?.list?.() || []).slice(-8).map((e) => ({ who: e.who, text: e.text }));
    } catch { /* route without history */ }
    const scene = await readContextText();
    const message = buildPlaceFixMessage(originalTarget, history, scene);
    for (const endpoint of ['/api/zai/chat', '/api/ollama/chat', '/api/abacus/chat']) {
      let response = null;
      try {
        response = await doFetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message }),
        });
      } catch {
        response = null;
      }
      if (!response || response.status === 503) continue;
      const data = await response?.json?.().catch(() => null);
      const fix = extractPlaceFix(data?.answer);
      if (!fix || fix.unknown || !fix.query) continue;
      if (fix.query.toLowerCase() === originalTarget.toLowerCase()) continue; // no loop on identical
      const fixedAnnotations = list.length
        ? [{ ...list[0], target: fix.query }]
        : [{ type: 'area', target: fix.query }];
      let outcome;
      try {
        const result = await runner('annotate_map', { ...args, annotations: fixedAnnotations });
        outcome = { name: 'annotate_map', ok: result?.ok !== false, result };
      } catch (error) {
        outcome = { name: 'annotate_map', ok: false, error: error?.message || String(error) };
      }
      const speech = outcome.ok
        ? (de ? `Zeichne ${fix.query} ein.` : `Marking ${fix.query}.`)
        : (de
          ? `Auch „${fix.query}“ konnte ich nicht einzeichnen.`
          : `I could not mark "${fix.query}" either.`);
      state.lastResult = { ok: outcome.ok, speech, outcomes: [outcome], retriedFrom: originalTarget };
      setDetail(speech);
      if (!opts?.silent) speak(speech, lang);
      logTurn('app', speech, [{ name: outcome.name, ok: outcome.ok, ...(outcome.ok ? {} : { error: outcome.error }) }]);
      return state.lastResult;
    }
    return null;
  }

  /** Run tool calls through the runner with speech + log + detail. Shared by
   *  the regex path and the AI router path below. opts.rawText enables the AI
   *  second chance below; opts.routed marks brain-originated calls (no loop). */
  /**
   * Successful APP chat lines should add concrete result truth, not merely
   * repeat the brain's intent. Tracking is the highest-value case because the
   * runner knows the resolved callsign/registration/satellite name.
   */
  function successfulOutcomeSpeech(outcomes, fallback, lang = 'en') {
    if (outcomes.length !== 1 || outcomes[0]?.ok !== true) return fallback;
    const result = outcomes[0]?.result;
    const label = String(result?.label || '').trim();
    if (outcomes[0].name === 'track_entity' && label) {
      return lang === 'de' ? `Verfolge ${label}.` : `Tracking ${label}.`;
    }
    if (outcomes[0].name === 'select_nearest_aircraft' && label) {
      return lang === 'de' ? `Verfolge ${label}.` : `Tracking ${label}.`;
    }
    if (outcomes[0].name === 'get_entity_context') {
      const selected = result?.selected || null;
      if (!selected) {
        return lang === 'de'
          ? 'Aktuell ist kein Objekt ausgewählt.'
          : 'No object is currently selected.';
      }
      const props = selected.properties || {};
      const clean = (value) => String(value ?? '').trim();
      const name = clean(selected.name || props.name || props.callsign) || 'Kontakt';
      const parts = [];
      const operator = clean(props.operator || props.owner);
      const type = clean(props.type || props.aircraftClass || props.model);
      const route = clean(props.route);
      const origin = clean(props.routeOrigin || props.origin);
      const destination = clean(props.routeDestination || props.destination);
      if (operator) parts.push(operator);
      if (type) parts.push(type);
      if (route) parts.push(route);
      else if (origin && destination) parts.push(`${origin}–${destination}`);
      const altitude = Number(props.altitudeM ?? selected.altitudeM);
      if (Number.isFinite(altitude) && altitude > 0) parts.push(`${Math.round(altitude).toLocaleString('de-DE')} m`);
      return lang === 'de'
        ? `Ausgewählt: ${name}${parts.length ? ` — ${parts.join(' · ')}` : ''}.`
        : `Selected: ${name}${parts.length ? ` — ${parts.join(' · ')}` : ''}.`;
    }
    if (
      outcomes[0].name === 'describe_tactical_event' ||
      outcomes[0].name === 'query_financial_market_impact' ||
      outcomes[0].name === 'search_and_forecast_asset' ||
      outcomes[0].name === 'query_osint_news' ||
      result?.sitrepDe ||
      result?.sitrepEn
    ) {
      const text = lang === 'de'
        ? (result?.sitrepDe || result?.sitrepEn || result?.summary)
        : (result?.sitrepEn || result?.sitrepDe || result?.summary);
      if (text) return text;
    }
    if (outcomes[0].name === 'fly_to_nearest_tactical_target' && result?.target) {
      return lang === 'de'
        ? `Fliege zum Einsatzziel: ${result.target}.`
        : `Flying to tactical target: ${result.target}.`;
    }
    if (outcomes[0].name === 'mark_tactical_impact_zone') {
      const markLabel = result?.label || (lang === 'de' ? 'Angriffsgebiet' : 'Impact zone');
      return lang === 'de'
        ? `${result?.zoomedIn ? 'Herangezoomt und ' : ''}${markLabel} auf der Karte markiert.`
        : `${result?.zoomedIn ? 'Zoomed in and marked ' : 'Marked '}${markLabel} on the map.`;
    }
    return fallback;
  }

  async function executeCalls(calls, speech, lang = 'en', opts = {}) {
    const outcomes = [];
    for (const call of calls || []) {
      if (call?.name === 'clear_chat_history') {
        try { log?.clear?.(); } catch { /* best effort */ }
        outcomes.push({ name: call.name, ok: true, result: { ok: true, action: 'clear_chat_history' } });
        continue;
      }
      try {
        const result = await runner(call.name, call.args || {});
        outcomes.push({ name: call.name, ok: result?.ok !== false, result });
      } catch (error) {
        outcomes.push({ name: call.name, ok: false, error: error?.message || String(error) });
      }
    }
    const nearestSuccess = outcomes.find((outcome) => (
      outcome?.name === 'select_nearest_aircraft'
      && outcome?.ok === true
      && outcome?.result?.location
    ));
    if (nearestSuccess) state.lastNearestAircraftLocation = nearestSuccess.result.location;

    // AI second chance: a lone fly_to_location that found nothing gets one
    // brain-corrected retry (typos like "shenzen", pronouns) instead of a
    // dead end. Falls through to the general reinterpretation below when the
    // place cannot be fixed either.
    if (outcomes.length === 1
      && outcomes[0].name === 'fly_to_location'
      && outcomes[0].ok === false
      && /not found|no results|ZERO_RESULTS/i.test(String(outcomes[0].error || outcomes[0].result?.error || ''))) {
      const retried = await retryFlyWithBrain(calls[0].args, lang, opts);
      if (retried) return retried;
    }
    // Local cross-tool fallback: a failed place flight whose query names a
    // trackable family ("SAT GUS", "die ISS") was the WRONG TOOL — a satellite
    // is not a place. Retry as track_entity directly, no brain needed.
    if (outcomes.length === 1
      && outcomes[0].name === 'fly_to_location'
      && outcomes[0].ok === false
      && ENTITY_FAMILY_WORDS.test(` ${String(calls[0].args?.query || '').toLowerCase()} `)) {
      const entityQuery = String(calls[0].args.query).trim();
      try {
        const result = await runner('track_entity', { query: entityQuery });
        if (result?.ok !== false) {
          const resolvedLabel = String(result.label || entityQuery).trim();
          const speech = lang === 'de' ? `Verfolge ${resolvedLabel}.` : `Tracking ${resolvedLabel}.`;
          state.lastResult = { ok: true, speech, outcomes: [{ name: 'track_entity', ok: true, result }], retriedFrom: entityQuery };
          setDetail(speech);
          if (!opts.silent) speak(speech, lang);
          logTurn('app', speech, [{ name: 'track_entity', ok: true }]);
          return state.lastResult;
        }
      } catch {
        /* fall through to the brain paths below */
      }
    }
    // AI second chance: a lone annotate_map that could not place its target
    // gets one brain-corrected retry (hallucinated phrase → canonical name).
    if (outcomes.length === 1
      && outcomes[0].name === 'annotate_map'
      && outcomes[0].ok === false) {
      const retried = await retryAnnotateWithBrain(calls[0].args, lang, opts);
      if (retried) return retried;
    }
    // AI reinterpretation: ANY other lone failure gets one brain attempt at
    // the original words (wrong-tool guesses like geocoding "irgendein
    // Militärflugzeug"). The identical call is excluded, and brain-originated
    // calls never re-enter — so this terminates after exactly one retry.
    if (outcomes.length === 1
      && outcomes[0].ok === false
      && !opts.routed
      && typeof opts.rawText === 'string'
      && opts.rawText.trim()) {
      const reinterpreted = await routeWithBrain(opts.rawText, lang, calls, opts);
      if (reinterpreted) return reinterpreted;
    }
    const failed = outcomes.filter((o) => !o.ok);
    const firstError = failed.length ? (failed[0].error || failed[0].result?.error || 'unknown error') : '';
    const spoken = failed.length && outcomes.length > 1
      ? `${speech} (${failed.length} of ${outcomes.length} failed.)`
      : (failed.length
        ? (lang === 'de' ? 'Das hat leider nicht geklappt.' : `That did not work: ${firstError}.`)
        : successfulOutcomeSpeech(outcomes, speech, lang));
    state.lastResult = { ok: !failed.length, speech: spoken, outcomes };
    setDetail(spoken);
    if (!opts.silent) speak(spoken, lang);
    logTurn('app', spoken, outcomes.map((o) => ({ name: o.name, ok: o.ok, ...(o.ok ? {} : { error: o.error || o.result?.error }) })));
    return state.lastResult;
  }

  /**
   * AI fallback for utterances the regex parser cannot map (pronouns,
   * coreference, free phrasing): a chat brain translates with conversation
   * history, execution stays local. Chain ZAI → Ollama; unparseable answers
   * and missing keys fall back to the honest unknown hint.
   *
   * Also used as the second chance for FAILED regex commands: pass the
   * original calls as excludeCalls and anything identical is skipped, so a
   * retry can never loop onto the same dead call.
   *
   * @returns {object|null} Executed result, or null when no brain mapped it.
   */
  async function routeWithBrain(rawText, lang = 'en', excludeCalls = null, opts = {}) {
    if (!doFetch) return null;
    let history = [];
    try {
      history = (log?.list?.() || []).slice(-8).map((e) => ({ who: e.who, text: e.text }));
    } catch { /* route without history */ }
    const scene = await readContextText();
    const message = buildRouterMessage(rawText, history, scene);
    const excluded = new Set((excludeCalls || []).map((call) => stableActionKey(call?.name, call?.args)));
    for (const endpoint of ['/api/zai/chat', '/api/ollama/chat', '/api/abacus/chat']) {
      let response = null;
      try {
        response = await doFetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, system: ROUTER_SYSTEM_PROMPT }),
        });
      } catch {
        response = null;
      }
      if (!response || response.status === 503) continue; // next brain
      const data = await response?.json?.().catch(() => null);
      const routed = extractRouterCall(data?.answer);
      if (!routed || routed.unknown) continue; // chit-chat stays honest, next brain may still map it
      if (!routed.name || !isCompleteRouterCall(routed.name, routed.args)) continue; // empty-args envelope
      if (routed.name === 'select_nearest_aircraft') {
        routed.args = normalizeSelectNearestAircraftArgs(
          routed.args,
          rawText,
          state.lastNearestAircraftLocation,
        );
      }
      if (excluded.has(stableActionKey(routed.name, routed.args))) continue; // never loop the same dead call
      const say = routed.say || synthRouterSay(routed.name, routed.args, lang);
      const first = await executeCalls([{ name: routed.name, args: routed.args }], say, lang, { routed: true, silent: opts?.silent });
      const brainWho = endpoint.includes('/zai/') ? 'zai' : (endpoint.includes('/abacus/') ? 'abacus' : 'ollama');
      const chained = await maybeChainFollowUp(endpoint, brainWho, rawText, routed.name, first, lang, opts);
      return chained || first;
    }
    return null;
  }

  async function routeUnknown(rawText, parsed, opts = {}) {
    const fallback = () => {
      state.lastResult = { ok: false, speech: parsed.speech };
      setDetail(parsed.speech);
      if (!opts?.silent) speak(parsed.speech, parsed.lang);
      logTurn('app', parsed.speech);
      return state.lastResult;
    };
    const routed = await routeWithBrain(rawText, parsed.lang, null, opts);
    return routed || fallback();
  }

  function stopRecognition(graceful = false) {
    // Graceful (Space released): rec.stop() lets captured audio finish and
    // still delivers final results — abort() would discard the sentence.
    if (graceful) {
      try { state.recognition?.stop?.(); } catch { /* noop */ }
    } else {
      try { state.recognition?.abort?.(); } catch { /* noop */ }
      try { state.recognition?.stop?.(); } catch { /* noop */ }
    }
    state.recognition = null;
  }

  function startRecognition(recognitionCtor = null) {
    const env = typeof window !== 'undefined' ? window : null;
    const Ctor = recognitionCtor || env?.SpeechRecognition || env?.webkitSpeechRecognition;
    if (!Ctor) return false;
    try {
      const rec = new Ctor();
      rec.lang = typeof navigator !== 'undefined' && /de/i.test(String(navigator.language || '')) ? 'de-DE' : 'en-US';
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      rec.continuous = true;
      rec.onresult = (event) => {
        try {
          const last = event?.results?.[event.results.length - 1];
          const transcript = last?.[0]?.transcript || '';
          if (last?.isFinal !== false && transcript.trim()) void handleText(transcript);
        } catch { /* one bad result must not kill the loop */ }
      };
      rec.onend = () => {
        // Hands-free loop: keep listening while the session is active.
        if (state.active && state.recognition === rec) {
          try { rec.start(); } catch { /* mic revoked mid-session */ }
        }
      };
      rec.onerror = () => { /* surfaced on the next onend; keep quiet */ };
      rec.start();
      state.recognition = rec;
      return true;
    } catch {
      return false;
    }
  }

  return {
    state,
    handleText,
    handleChatText,
    askGemini,
    describeView,
    isActive: () => state.active,
    start(options = {}) {
      state.active = true;
      // Space (push-to-talk) passes its recognizer stock down so keyup can
      // end exactly the session Space started; click-toggle uses the browser.
      const listening = startRecognition(options.recognitionCtor || null);
      setDetail(listening ? 'VOICE MODE — LISTENING' : 'VOICE MODE — TYPE A COMMAND');
      speak('Voice mode on.', typeof navigator !== 'undefined' && /de/i.test(String(navigator.language || '')) ? 'de' : 'en');
      return { ok: true, listening };
    },
    stop(options = {}) {
      state.active = false;
      stopRecognition(Boolean(options.graceful));
      stopGoogleTTSPlayback();
      setDetail('VOICE STANDBY');
      return { ok: true };
    },
    toggle() {
      if (state.active) return this.stop();
      return this.start();
    },
  };
}

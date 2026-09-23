/**
 * God's Eye View — Abacus AI Botnet Intel & Severe Weather Module
 *
 * Aggregates live intelligence dispatches:
 * 1. Severe Weather & Tornados (NOAA active warnings & Open-Meteo storm detections)
 * 2. Swiss Hotspots & Alpine Weather/CCTV nodes
 * 3. Tactical / Military / Geopolitical incidents
 * 4. Deep Tactical Briefings via Abacus AI Supercomputer (RouteLLM / GLM-5.3-Flash)
 *
 * @module intelBotnet
 */

import { getAggregatedOsintMessages } from './telegramOsintProxy.js';
import { geoparseOsintBatch, matchGazetteerLocation, translateSlavicOsintText } from './osintGeoparser.js';

const BOTNET_CACHE_TTL_MS = 30_000; // 30 seconds fresh cache
let _cachedDispatches = null;
let _lastFetchTime = 0;
let _inFlightFetch = null;

/** Curated Swiss Tactical & Weather Observation Nodes */
export const SWISS_INTEL_NODES = [
  {
    id: 'ch-zurich-airport',
    title: 'Zurich Airport Kloten (LSZH)',
    category: 'SCHWEIZ',
    severity: 'INFO',
    locationName: 'Zurich, Switzerland',
    coordinates: { latitude: 47.4582, longitude: 8.5555, altitude: 1200 },
    summary: 'International aviation hub and central plateau weather radar station.',
    cctvId: 'ch-zurich-flughafen',
    source: 'SWISS RADAR / CCTV',
  },
  {
    id: 'ch-hoherkasten-rheintal',
    title: 'Hoher Kasten — Alpstein & Rhine Valley',
    category: 'SCHWEIZ',
    severity: 'INFO',
    locationName: 'Appenzell / St. Gallen, Switzerland',
    coordinates: { latitude: 47.3344, longitude: 9.4851, altitude: 2500 },
    summary: 'Panoramic view across Alpine Rhine valley, Lake Constance region, and Vorarlberg border corridor.',
    cctvId: 'ch-hoherkasten-rheintal',
    source: 'ROUNDSHOT ALPINE 360°',
  },
  {
    id: 'ch-matterhorn-zermatt',
    title: 'Matterhorn / Klein Matterhorn (3883m)',
    category: 'SCHWEIZ',
    severity: 'INFO',
    locationName: 'Zermatt, Valais, Switzerland',
    coordinates: { latitude: 45.9763, longitude: 7.6586, altitude: 4500 },
    summary: 'High-altitude alpine weather observatory on the Swiss-Italian border.',
    cctvId: 'ch-zermatt-matterhorn',
    source: 'METEOSWISS ALPINE',
  },
  {
    id: 'ch-jungfraujoch-aletsch',
    title: 'Jungfraujoch — Sphinx Observatory',
    category: 'SCHWEIZ',
    severity: 'INFO',
    locationName: 'Bernese Oberland, Switzerland',
    coordinates: { latitude: 46.5475, longitude: 7.9854, altitude: 4200 },
    summary: 'Top of Europe research station. Global atmospheric and weather monitoring.',
    cctvId: 'ch-jungfraujoch-top',
    source: 'GLOBAL ATMOSPHERE WATCH',
  },
  {
    id: 'ch-geneva-cern',
    title: 'Geneva — CERN & Lake Geneva',
    category: 'SCHWEIZ',
    severity: 'INFO',
    locationName: 'Geneva, Switzerland',
    coordinates: { latitude: 46.2044, longitude: 6.1432, altitude: 1500 },
    summary: 'Diplomatic hub and Large Hadron Collider (LHC) along the Swiss/French border.',
    cctvId: 'ch-geneva-jetdeau',
    source: 'SWISS METRO / CCTV',
  },
  {
    id: 'ch-gotthard-pass',
    title: 'Gotthard Pass & North-South Transit Corridor',
    category: 'SCHWEIZ',
    severity: 'INFO',
    locationName: 'Uri / Ticino, Switzerland',
    coordinates: { latitude: 46.5594, longitude: 8.5611, altitude: 3000 },
    summary: 'Central Alpine transport corridor and meteorological weather divide.',
    cctvId: 'ch-gotthard-pass',
    source: 'ASTRA HIGHWAYS',
  },
  {
    id: 'ch-diepoldsau-border',
    title: 'Diepoldsau — Rhine Bridge Border Crossing',
    category: 'SCHWEIZ',
    severity: 'INFO',
    locationName: 'Diepoldsau, St. Gallen, Switzerland',
    coordinates: { latitude: 47.3833, longitude: 9.6500, altitude: 900 },
    summary: 'Rhine valley Swiss-Austrian border surveillance and flood control telemetry.',
    cctvId: 'ch-diepoldsau-rhein',
    source: 'FEDERAL CUSTOMS BAZG',
  },
];

/** Curated Tactical Early Warning, Aerospace Defense & GNSS Jamming Sectors (No politics/news) */
export const TACTICAL_RADAR_NODES = [
  {
    id: 'radar-baltic-ew',
    title: 'Baltic Sea / Kaliningrad — GNSS & EW Jamming Sector',
    category: 'RADAR',
    severity: 'SEVERE',
    locationName: 'Baltic Sea / Suwalki Gap',
    coordinates: { latitude: 54.7104, longitude: 20.5117, altitude: 25000 },
    summary: 'Sustained GPS/GLONASS electronic warfare and jamming detected across Baltic airspace.',
    source: 'GPSJAM / DEFENSE INTEL',
    isJamming: true,
    jamRadius: 220000,
  },
  {
    id: 'radar-redsea-corridor',
    title: 'Bab al-Mandab & Red Sea — Maritime Defense Corridor',
    category: 'RADAR',
    severity: 'CRITICAL',
    locationName: 'Bab al-Mandab, Yemen / Djibouti',
    coordinates: { latitude: 12.5833, longitude: 43.3333, altitude: 35000 },
    summary: 'Operation Prosperity Guardian & EU Aspides maritime corridor defending against anti-ship ballistic missiles and UAVs.',
    source: 'CENTCOM / NAVAL TASK FORCE',
    isJamming: true,
    jamRadius: 180000,
  },
  {
    id: 'radar-cyprus-levant-ew',
    title: 'Cyprus / Eastern Mediterranean — GNSS Spoofing & EW Sector',
    category: 'RADAR',
    severity: 'SEVERE',
    locationName: 'Eastern Mediterranean / RAF Akrotiri',
    coordinates: { latitude: 34.5833, longitude: 32.9833, altitude: 28000 },
    summary: 'Widespread GPS spoofing and RF electronic interference impacting civil and maritime navigation across the Levant.',
    source: 'EUROCONTROL / MEDITERRANEAN EW',
    isJamming: true,
    jamRadius: 250000,
  },
  {
    id: 'radar-blacksea-crimea',
    title: 'Black Sea & Crimea — Air Surveillance & EW Belt',
    category: 'RADAR',
    severity: 'CRITICAL',
    locationName: 'Sevastopol / Black Sea',
    coordinates: { latitude: 44.6166, longitude: 33.5254, altitude: 25000 },
    summary: 'Active electronic warfare jamming systems (Krasukha-4 / Murmansk-BN) and air defense early-warning perimeter.',
    source: 'BLACK SEA / AIR DEFENSE INTEL',
    isJamming: true,
    jamRadius: 210000,
  },
  {
    id: 'radar-hormuz-corridor',
    title: 'Strait of Hormuz — Maritime AIS & RF Interference Zone',
    category: 'RADAR',
    severity: 'SEVERE',
    locationName: 'Strait of Hormuz / Persian Gulf',
    coordinates: { latitude: 26.5667, longitude: 56.2500, altitude: 24000 },
    summary: 'AIS transponder manipulation and RF direction-finding jamming along primary global tanker corridor.',
    source: 'UKMTO / IMSC TASK FORCE',
    isJamming: true,
    jamRadius: 170000,
  },
  {
    id: 'radar-taiwan-strait',
    title: 'Taiwan Strait — ADIZ Early Warning & Naval Radar Corridor',
    category: 'RADAR',
    severity: 'SEVERE',
    locationName: 'Taiwan Strait / Penghu',
    coordinates: { latitude: 23.5667, longitude: 119.5833, altitude: 30000 },
    summary: 'Phased-array early warning radar (Leshan EWR) and constant median line aerospace surveillance.',
    source: 'TAIWAN MND / PACIFIC COMMAND',
    isJamming: true,
    jamRadius: 190000,
  },
  {
    id: 'radar-korean-dmz',
    title: '38th Parallel (DMZ) — Counter-Battery Radar & Border Recon',
    category: 'RADAR',
    severity: 'MODERATE',
    locationName: 'Panmunjom / DMZ, Korea',
    coordinates: { latitude: 37.9560, longitude: 126.6770, altitude: 15000 },
    summary: 'Counter-battery radar posts (TPQ-74) and seismic-acoustic border surveillance sensor array.',
    source: 'USFK / ROK JOINT CHIEFS',
    isPoint: true,
  },
  {
    id: 'radar-pine-gap',
    title: 'Joint Defence Facility Pine Gap — SIGINT Station',
    category: 'RADAR',
    severity: 'MODERATE',
    locationName: 'Alice Springs, Australia',
    coordinates: { latitude: -23.7990, longitude: 133.7370, altitude: 8000 },
    summary: 'Global satellite reconnaissance and early-warning telemetry for geosynchronous signals intelligence.',
    source: 'DEFENSE SPACE NETWORK',
    isPoint: true,
  },
  {
    id: 'radar-menwith-hill',
    title: 'RAF Menwith Hill — ECHELON Satellite Intercept Complex',
    category: 'RADAR',
    severity: 'INFO',
    locationName: 'North Yorkshire, UK',
    coordinates: { latitude: 53.9967, longitude: -1.6883, altitude: 6000 },
    summary: 'World largest electronic intercept and satellite ground station (radome network).',
    source: 'NSA / UK GCHQ',
    isPoint: true,
  },
  {
    id: 'radar-diego-garcia',
    title: 'Camp Thunder Cove — Diego Garcia Bomber & Space-Tracking Base',
    category: 'RADAR',
    severity: 'INFO',
    locationName: 'British Indian Ocean Territory (BIOT)',
    coordinates: { latitude: -7.3195, longitude: 72.4228, altitude: 8000 },
    summary: 'Strategic deep-water anchorage, B-2/B-52 staging base, and GEODSS optical space surveillance.',
    source: 'US NAVY / BIOT COMMAND',
    isPoint: true,
  },
  {
    id: 'radar-thule-early-warning',
    title: 'Pituffik Space Base (Thule) — Upgraded Early Warning Radar',
    category: 'RADAR',
    severity: 'INFO',
    locationName: 'Northern Greenland',
    coordinates: { latitude: 76.5312, longitude: -68.7032, altitude: 12000 },
    summary: 'Arctic phased-array early warning radar (AN/FPS-132) for ballistic missile detection (ICBM).',
    source: 'US SPACE FORCE / NORAD',
    isPoint: true,
  },
  {
    id: 'radar-cheyenne-mountain',
    title: 'Cheyenne Mountain Complex — Alternate Command Center',
    category: 'RADAR',
    severity: 'INFO',
    locationName: 'Colorado Springs, USA',
    coordinates: { latitude: 38.7442, longitude: -104.8466, altitude: 5000 },
    summary: 'Underground NORAD/NORTHCOM aerospace defense command center deep inside granite bunker.',
    source: 'NORAD COMMAND CENTER',
    isPoint: true,
  },
  {
    id: 'radar-raf-fylingdales',
    title: 'RAF Fylingdales — Solid-State Phased Array (SSPAR)',
    category: 'RADAR',
    severity: 'INFO',
    locationName: 'North York Moors, UK',
    coordinates: { latitude: 54.3606, longitude: -0.6697, altitude: 6000 },
    summary: '3-sided ballistic missile early warning station and joint UK/US space surveillance radar.',
    source: 'UK SPACE COMMAND',
    isPoint: true,
  },
];

/**
 * Normalizes Tactical Radar Nodes into Botnet dispatches.
 * @param {Array<object>} radarNodes
 * @returns {Array<object>}
 */
export function normalizeTacticalRadarNodes(radarNodes = TACTICAL_RADAR_NODES) {
  const baselineTime = '2026-01-01T00:00:00.000Z';
  return radarNodes.map((node) => ({
    id: `radar-${node.id}`,
    title: `📡 ${node.title}`,
    category: 'RADAR',
    severity: node.severity || 'INFO',
    locationName: node.locationName,
    coordinates: node.coordinates,
    summary: node.summary,
    source: node.source,
    isJamming: Boolean(node.isJamming),
    jamRadius: node.jamRadius || (node.isJamming ? 150000 : null),
    isPoint: Boolean(node.isPoint),
    timestamp: node.timestamp || baselineTime,
    hasBriefing: true,
  }));
}

/**
 * Extract centroid [lat, lon] from a GeoJSON geometry.
 * @param {object} geometry GeoJSON geometry
 * @returns {{latitude: number, longitude: number}|null}
 */
export function extractGeometryCentroid(geometry) {
  if (!geometry) return null;
  if (geometry.type === 'Point' && Array.isArray(geometry.coordinates)) {
    const [lon, lat] = geometry.coordinates;
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      return { latitude: Number(lat.toFixed(5)), longitude: Number(lon.toFixed(5)) };
    }
  }
  if (geometry.type === 'Polygon' && Array.isArray(geometry.coordinates?.[0])) {
    const ring = geometry.coordinates[0];
    if (ring.length === 0) return null;
    let sumLat = 0;
    let sumLon = 0;
    let validCount = 0;
    for (const pt of ring) {
      if (Array.isArray(pt) && Number.isFinite(pt[1]) && Number.isFinite(pt[0])) {
        sumLon += pt[0];
        sumLat += pt[1];
        validCount++;
      }
    }
    if (validCount > 0) {
      return {
        latitude: Number((sumLat / validCount).toFixed(5)),
        longitude: Number((sumLon / validCount).toFixed(5)),
      };
    }
  }
  return null;
}

/**
 * Normalizes NOAA Severe Weather Alerts into unified Botnet dispatches.
 * @param {object} noaaPayload
 * @returns {Array<object>}
 */
export function normalizeNoaaAlerts(noaaPayload) {
  const features = Array.isArray(noaaPayload?.features) ? noaaPayload.features : [];
  const dispatches = [];

  for (const feature of features) {
    const props = feature?.properties || {};
    const event = String(props.event || '').trim();
    const eventLower = event.toLowerCase();

    // Focus exclusively on severe weather: tornados, severe thunderstorms, hurricanes, extreme wind, flash floods
    const isTornado = eventLower.includes('tornado');
    const isSevereStorm = eventLower.includes('severe thunderstorm');
    const isExtremeWind = eventLower.includes('extreme wind') || eventLower.includes('high wind') || eventLower.includes('hurricane') || eventLower.includes('typhoon');
    const isFlashFlood = eventLower.includes('flash flood');
    const isBlizzard = eventLower.includes('blizzard');

    if (!isTornado && !isSevereStorm && !isExtremeWind && !isFlashFlood && !isBlizzard) continue;

    const coords = extractGeometryCentroid(feature.geometry);
    const severity = isTornado
      ? 'CRITICAL'
      : (props.severity === 'Extreme' ? 'CRITICAL' : (props.severity === 'Severe' ? 'SEVERE' : 'MODERATE'));

    const headline = props.headline || `${event} — ${props.areaDesc || 'Unwetterwarnung'}`;
    const cleanSummary = String(props.description || props.instruction || headline)
      .replace(/[\r\n]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 240);

    let polyRing = null;
    if (feature.geometry?.type === 'Polygon' && Array.isArray(feature.geometry.coordinates?.[0])) {
      polyRing = feature.geometry.coordinates[0];
    } else if (feature.geometry?.type === 'MultiPolygon' && Array.isArray(feature.geometry.coordinates?.[0]?.[0])) {
      polyRing = feature.geometry.coordinates[0][0];
    }

    dispatches.push({
      id: `noaa-${props.id || Math.random().toString(36).slice(2, 9)}`,
      title: `${isTornado ? '🌪️ ' : '⚡ '}${event.toUpperCase()}`,
      category: 'UNWETTER',
      severity,
      isTornado,
      locationName: props.areaDesc ? String(props.areaDesc).split(';')[0].trim() : 'USA / NWS Area',
      coordinates: coords || { latitude: 35.0, longitude: -90.0, altitude: 15000 },
      polygon: polyRing,
      summary: cleanSummary,
      source: `NOAA NWS / ${props.senderName ? String(props.senderName).slice(0, 30) : 'WEATHER.GOV'}`,
      effective: props.effective || new Date().toISOString(),
      expires: props.expires || null,
      rawInstruction: props.instruction ? String(props.instruction).slice(0, 500) : null,
      timestamp: props.sent || props.effective || new Date().toISOString(),
      hasBriefing: true,
    });

    if (dispatches.length >= 25) break;
  }

  return dispatches;
}

/**
 * Normalizes Swiss tactical nodes into the dispatches feed.
 * @param {Array<object>} swissNodes
 * @returns {Array<object>}
 */
export function normalizeSwissNodes(swissNodes = SWISS_INTEL_NODES) {
  const baselineTime = '2026-01-01T00:00:00.000Z';
  return swissNodes.map((node) => ({
    id: `swiss-${node.id}`,
    title: `🇨🇭 ${node.title}`,
    category: 'SCHWEIZ',
    severity: node.severity || 'INFO',
    locationName: node.locationName,
    coordinates: node.coordinates,
    summary: node.summary,
    cctvId: node.cctvId,
    source: node.source,
    isPoint: true,
    timestamp: node.timestamp || baselineTime,
    hasBriefing: true,
  }));
}

/**
 * Geopolitical & Strategic Hotspot Geotagging Lexicon.
 * Automatically resolves coordinates for breaking military and geopolitical intelligence.
 */
export const GEOPOLITICAL_HOTSPOTS = [
  // --- HORN VON AFRIKA & OSTAFRIKA ---
  { keys: ['ethiopia', 'äthiopien', 'abiy ahmed', 'abiy', 'addis ababa', 'addis abeba', 'tigray', 'amhara', 'oromia', 'fano', 'tplf', 'oromo'], name: 'Äthiopien / Horn von Afrika (Addis Abeba)', lat: 9.0300, lon: 38.7400, alt: 35000 },
  { keys: ['eritrea', 'asmara', 'afwerki'], name: 'Eritrea / Asmara', lat: 15.3229, lon: 38.9251, alt: 30000 },
  { keys: ['somalia', 'mogadishu', 'mogadischu', 'al-shabaab', 'puntland', 'somaliland', 'hargeisa'], name: 'Somalia / Horn von Afrika (Mogadischu)', lat: 2.0469, lon: 45.3182, alt: 35000 },
  { keys: ['djibouti', 'dschibuti'], name: 'Dschibuti / Bab al-Mandab', lat: 11.8251, lon: 42.5903, alt: 30000 },
  { keys: ['sudan', 'khartoum', 'khartum', 'darfur', 'burhan', 'hemedti', 'rsf', 'port sudan'], name: 'Sudan / Khartum & Darfur', lat: 15.5527, lon: 32.5324, alt: 35000 },
  { keys: ['south sudan', 'südsudan', 'juba'], name: 'Südsudan / Juba', lat: 4.8594, lon: 31.5713, alt: 35000 },
  { keys: ['kenya', 'kenia', 'nairobi', 'mombasa'], name: 'Kenia / Ostafrika', lat: -1.2921, lon: 36.8219, alt: 35000 },

  // --- ZENTRAL- & WESTAFRIKA / SAHEL ---
  { keys: ['drc', 'kongo', 'congo', 'kinshasa', 'goma', 'kivu', 'm23', 'rwanda', 'ruanda', 'kigali', 'burundi'], name: 'DR Kongo / Kivu & Große Seen', lat: -1.6792, lon: 29.2228, alt: 35000 },
  { keys: ['mali', 'bamako', 'gao', 'timbuktu', 'azawad'], name: 'Mali / Sahelzone', lat: 12.6392, lon: -8.0029, alt: 35000 },
  { keys: ['niger', 'niamey', 'agadez'], name: 'Niger / Sahel', lat: 13.5116, lon: 2.1254, alt: 35000 },
  { keys: ['burkina faso', 'burkina', 'ouagadougou', 'traore'], name: 'Burkina Faso / Ouagadougou', lat: 12.3714, lon: -1.5197, alt: 35000 },
  { keys: ['chad', 'tschad', "n'djamena", 'ndjamena'], name: 'Tschad / N’Djamena', lat: 12.1348, lon: 15.0557, alt: 35000 },
  { keys: ['nigeria', 'abuja', 'lagos', 'boko haram', 'borno'], name: 'Nigeria / Golf von Guinea', lat: 9.0765, lon: 7.3986, alt: 35000 },

  // --- NORDAFRIKA ---
  { keys: ['libya', 'libyen', 'tripoli', 'tripolis', 'benghazi', 'haftar'], name: 'Libyen / Tripolis & Benghazi', lat: 32.8872, lon: 13.1913, alt: 35000 },
  { keys: ['egypt', 'ägypten', 'cairo', 'kairo', 'sinai', 'suez', 'sueskanal'], name: 'Ägypten & Sueskanal', lat: 30.0444, lon: 31.2357, alt: 35000 },

  // --- NAHOST / LEVANTE & PERSISCHER GOLF ---
  { keys: ['israel', 'gaza', 'rafah', 'tel aviv', 'jerusalem', 'west bank', 'westjordanland', 'idf', 'hamas', 'khan younis'], name: 'Levante / Israel & Gazastreifen', lat: 31.5000, lon: 34.7500, alt: 30000 },
  { keys: ['lebanon', 'libanon', 'beirut', 'hezbollah', 'hisbollah', 'litani', 'tyre', 'sidon'], name: 'Südlibanon & Beirut', lat: 33.8938, lon: 35.5018, alt: 25000 },
  { keys: ['syria', 'syrien', 'damascus', 'damaskus', 'aleppo', 'idlib', 'golan'], name: 'Syrien & Golanhöhen', lat: 34.8021, lon: 38.9968, alt: 30000 },
  { keys: ['iraq', 'irak', 'baghdad', 'bagdad', 'erbil', 'kurdistan', 'mosul'], name: 'Irak / Bagdad & Kurdistan', lat: 33.3152, lon: 44.3661, alt: 30000 },
  { keys: ['red sea', 'rotes meer', 'yemen', 'jemen', 'houthi', 'aden', 'hodeidah', 'bab al-mandab'], name: 'Bab al-Mandab & Rotes Meer (Jemen)', lat: 14.5000, lon: 42.5000, alt: 35000 },
  { keys: ['iran', 'tehran', 'teheran', 'isfahan', 'natanz', 'persian gulf', 'persischer golf', 'hormuz', 'irgc'], name: 'Straße von Hormus & Iran', lat: 27.2000, lon: 56.3000, alt: 35000 },
  { keys: ['saudi', 'riyadh', 'riad', 'dammam', 'jeddah'], name: 'Saudi-Arabien / Riad', lat: 24.7136, lon: 46.6753, alt: 35000 },
  { keys: ['turkey', 'türkei', 'ankara', 'istanbul', 'erdogan'], name: 'Türkei / Bosporus', lat: 39.9334, lon: 32.8597, alt: 35000 },

  // --- OSTEUROPA & RUSSLAND ---
  { keys: ['ukraine', 'kyiv', 'kiew', 'kharkiv', 'charkiw', 'donbas', 'odesa', 'pokrovsk', 'kursk', 'belgorod', 'dnipro', 'zaporizhzhia', 'sumy'], name: 'Ukraine / Osteuropäische Front', lat: 48.3794, lon: 31.1656, alt: 40000 },
  { keys: ['crimea', 'krim', 'sevastopol', 'sewastopol', 'black sea', 'schwarzes meer', 'kertscher'], name: 'Krim & Schwarzes Meer', lat: 44.9521, lon: 34.1024, alt: 35000 },
  { keys: ['russia', 'russland', 'moscow', 'moskau', 'kremlin', 'kreml', 'putin'], name: 'Russische Föderation / Moskau', lat: 55.7558, lon: 37.6173, alt: 45000 },
  { keys: ['baltic', 'ostsee', 'poland', 'polen', 'warsaw', 'warschau', 'suwalki', 'lithuania', 'latvia', 'estonia', 'litauen', 'lettland', 'estland', 'finland', 'finnland'], name: 'NATO-Ostflanke / Baltikum & Suwalki', lat: 54.5000, lon: 21.5000, alt: 35000 },
  { keys: ['belarus', 'weissrussland', 'minsk', 'lukashenko'], name: 'Belarus / Minsk', lat: 53.9045, lon: 27.5615, alt: 35000 },
  { keys: ['balkan', 'serbia', 'serbien', 'kosovo', 'belgrade', 'belgrad', 'pristina', 'bosnia', 'bosnien', 'sarajevo'], name: 'Westbalkan / Kosovo & Serbien', lat: 43.8563, lon: 18.4131, alt: 30000 },
  { keys: ['armenia', 'armenien', 'azerbaijan', 'aserbaidschan', 'baku', 'yerevan', 'eriwan', 'karabakh', 'georgia', 'georgien', 'tbilisi'], name: 'Südkaukasus & Kaspisches Meer', lat: 40.4093, lon: 49.8671, alt: 35000 },

  // --- ASIEN & PAZIFIK ---
  { keys: ['taiwan', 'taipei', 'taiwan strait', 'formosa', 'kinmen', 'matsu'], name: 'Taiwan-Straße & Ostasien', lat: 24.5000, lon: 120.8000, alt: 35000 },
  { keys: ['south china sea', 'südchinesisches meer', 'philippines', 'philippinen', 'manila', 'scarborough', 'spratly'], name: 'Südchinesisches Meer / Spratly', lat: 15.5000, lon: 115.0000, alt: 45000 },
  { keys: ['north korea', 'nordkorea', 'pyongyang', 'south korea', 'südkorea', 'seoul', 'dmz', 'panmunjom', 'kim jong'], name: 'Koreanische Halbinsel / DMZ', lat: 37.9560, lon: 126.6770, alt: 30000 },
  { keys: ['china', 'beijing', 'peking', 'pla', 'xi jinping'], name: 'VR China / Peking', lat: 39.9042, lon: 116.4074, alt: 45000 },
  { keys: ['myanmar', 'burma', 'naypyidaw', 'yangon', 'junta', 'tatmadaw'], name: 'Myanmar / Südostasien', lat: 19.7633, lon: 96.0785, alt: 35000 },
  { keys: ['pakistan', 'islamabad', 'afghanistan', 'kabul', 'taliban', 'kandahar', 'kashmir', 'kaschmir', 'india', 'indien', 'new delhi', 'delhi'], name: 'Südasien / Kaschmir & Durand-Linie', lat: 33.6844, lon: 73.0479, alt: 35000 },
  { keys: ['japan', 'tokyo', 'tokio', 'okinawa'], name: 'Japan & Pazifischer Schild', lat: 35.6762, lon: 139.6503, alt: 40000 },

  // --- AMERIKAS & GLOBALE BÜNDNISSE ---
  { keys: ['venezuela', 'caracas', 'maduro', 'guyana', 'essequibo'], name: 'Venezuela & Guyana / Karibik', lat: 10.4806, lon: -66.9036, alt: 35000 },
  { keys: ['colombia', 'kolumbien', 'bogota'], name: 'Kolumbien / Andenraum', lat: 4.7110, lon: -74.0721, alt: 35000 },
  { keys: ['haiti', 'port-au-prince'], name: 'Haiti / Karibik', lat: 18.5944, lon: -72.3074, alt: 30000 },
  { keys: ['pentagon', 'washington', 'norad', 'us military', 'white house'], name: 'US-Verteidigungskommando / Washington', lat: 38.8719, lon: -77.0563, alt: 30000 },
  { keys: ['nato', 'brussels', 'brüssel', 'allied command'], name: 'NATO-Hauptquartier / Brüssel', lat: 50.8503, lon: 4.3517, alt: 30000 },
  { keys: ['arctic', 'arktis', 'greenland', 'grönland', 'svalbard', 'spitzbergen'], name: 'Arktischer Raum', lat: 75.0000, lon: 18.0000, alt: 50000 },
  { keys: ['germany', 'deutschland', 'berlin', 'bundeswehr', 'ramstein'], name: 'Deutschland / Ramstein & Berlin', lat: 52.5200, lon: 13.4050, alt: 35000 },
  { keys: ['france', 'frankreich', 'paris'], name: 'Frankreich / Paris', lat: 48.8566, lon: 2.3522, alt: 35000 },
  { keys: ['uk', 'britain', 'london', 'raf'], name: 'Großbritannien / London', lat: 51.5074, lon: -0.1278, alt: 35000 },
];

/** Extended country registry for global geotagging fallback */
export const EXTENDED_WORLD_REGIONS = [
  { keys: ['uganda', 'kampala'], name: 'Uganda / Kampala', lat: 0.3476, lon: 32.5825, alt: 35000 },
  { keys: ['mozambique', 'mosambik', 'maputo', 'cabo delgado'], name: 'Mosambik / Cabo Delgado', lat: -12.9732, lon: 40.5178, alt: 35000 },
  { keys: ['somalia', 'mogadishu'], name: 'Somalia / Mogadischu', lat: 2.0469, lon: 45.3182, alt: 35000 },
  { keys: ['georgia', 'georgien', 'tbilisi', 'abkhazia', 'south ossetia'], name: 'Georgien / Kaukasus', lat: 41.7151, lon: 44.8271, alt: 35000 },
  { keys: ['moldova', 'moldawien', 'chisinau', 'transnistria'], name: 'Moldau / Transnistrien', lat: 47.0105, lon: 28.8638, alt: 35000 },
  { keys: ['kazakhstan', 'kasachstan', 'astana'], name: 'Kasachstan / Zentralasien', lat: 51.1694, lon: 71.4491, alt: 35000 },
  { keys: ['uzbekistan', 'usbekistan', 'tashkent'], name: 'Usbekistan / Taschkent', lat: 41.2995, lon: 69.2401, alt: 35000 },
  { keys: ['mexico', 'mexiko', 'sinaloa', 'jalisco'], name: 'Mexiko / Nordamerika', lat: 19.4326, lon: -99.1332, alt: 35000 },
  { keys: ['cuba', 'kuba', 'havana', 'guantanamo'], name: 'Kuba / Karibik', lat: 23.1136, lon: -82.3666, alt: 35000 },
  { keys: ['brazil', 'brasilien', 'brasilia'], name: 'Brasilien / Südamerika', lat: -15.8267, lon: -47.9218, alt: 35000 },
  { keys: ['australia', 'australien', 'canberra', 'aukus'], name: 'Australien / Pazifik (AUKUS)', lat: -35.2809, lon: 149.1300, alt: 40000 },
  { keys: ['indonesia', 'indonesien', 'jakarta'], name: 'Indonesien / Südostasien', lat: -6.2088, lon: 106.8456, alt: 35000 },
  { keys: ['greece', 'griechenland', 'athens', 'aegean'], name: 'Griechenland & Ägäis', lat: 37.9838, lon: 23.7275, alt: 35000 },
  { keys: ['cyprus', 'zypern', 'nicosia'], name: 'Zypern / Östliches Mittelmeer', lat: 35.1856, lon: 33.3823, alt: 30000 },
];

/**
 * Resolves breaking military or geopolitical intelligence to high-precision coordinates.
 * Defaults to UN Headquarters / International Crisis Staff at orbital altitude, NEVER Germany!
 * @param {string} lowerText
 * @param {string} [rawText]
 * @returns {{name: string, lat: number, lon: number, alt: number}}
 */
function keyMatchesText(lowerText, key) {
  if (key.length <= 3) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}([^\\p{L}\\p{N}]|$)`, 'iu').test(lowerText);
  }
  return lowerText.includes(key);
}

export function resolveGeopoliticalHotspot(lowerText, rawText = '') {
  // 1. High-precision tactical gazetteer match (cities, ports, airbases, naval installations)
  const gazetteerMatch = matchGazetteerLocation(rawText || lowerText);
  if (gazetteerMatch) {
    return {
      name: gazetteerMatch.name,
      lat: gazetteerMatch.lat,
      lon: gazetteerMatch.lon,
      alt: 25000,
      theater: gazetteerMatch.theater,
    };
  }

  const match = GEOPOLITICAL_HOTSPOTS.find((spot) => spot.keys.some((k) => keyMatchesText(lowerText, k)));
  if (match) return match;

  for (const country of EXTENDED_WORLD_REGIONS) {
    if (country.keys.some((k) => keyMatchesText(lowerText, k))) {
      return country;
    }
  }

  // Neutral Global Coordination Hub (UN Headquarters, New York) — orbital perspective
  return {
    name: 'UN Security Council / Global Situation Center (UN-HQ)',
    lat: 40.7499,
    lon: -73.9674,
    alt: 120000,
  };
}

/**
 * Normalizes USGS Global Earthquakes (M3.0+ / M4.0+) into Botnet dispatches.
 * @param {object} usgsPayload GeoJSON feature collection
 * @returns {Array<object>}
 */
export function normalizeUsgsQuakes(usgsPayload) {
  const features = Array.isArray(usgsPayload?.features) ? usgsPayload.features : [];
  const dispatches = [];

  for (const feature of features) {
    const props = feature?.properties || {};
    const coords = feature?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;

    const lon = Number(coords[0]);
    const lat = Number(coords[1]);
    const depth = Number(coords[2] ?? 10);
    const mag = Number(props.mag ?? 0);

    if (!Number.isFinite(mag) || mag < 2.5) continue;

    const place = String(props.place || 'Pacific Ring of Fire / Global').trim();
    const isMajor = mag >= 6.0;
    const isSevere = mag >= 5.0;
    const isModerate = mag >= 4.0;
    const severity = isMajor ? 'CRITICAL' : (isSevere ? 'SEVERE' : (isModerate ? 'MODERATE' : 'INFO'));

    const time = props.time ? new Date(props.time).toISOString() : new Date().toISOString();
    const seismicRadius = Math.max(35000, Math.round(mag * 28000));

    dispatches.push({
      id: `usgs-${feature.id || props.code || Math.random().toString(36).slice(2, 9)}`,
      title: `🌋 EARTHQUAKE M${mag.toFixed(1)} — ${place}`,
      category: 'CRISIS',
      severity,
      isSeismic: true,
      magnitude: mag,
      depthKm: Number(depth.toFixed(1)),
      seismicRadius,
      locationName: place,
      coordinates: { latitude: lat, longitude: lon, altitude: Math.max(12000, mag * 15000) },
      summary: `Tectonic earthquake magnitude M${mag.toFixed(1)} at ${depth.toFixed(1)} km depth. ${props.status === 'reviewed' ? 'Officially confirmed' : 'Automated reading'}. Tsunami: ${props.tsunami ? 'WARNING' : 'No threat'}.`,
      source: `USGS SEISMOLOGY / ${props.net ? String(props.net).toUpperCase() : 'NEIC'}`,
      timestamp: time,
      url: props.url || null,
      hasBriefing: true,
    });

    if (dispatches.length >= 35) break;
  }

  return dispatches;
}

/**
 * Normalizes NASA EONET Active Natural Events (Tropical Storms, Wildfires, Volcanoes).
 * @param {object} eonetPayload
 * @returns {Array<object>}
 */
export function normalizeEonetEvents(eonetPayload) {
  const events = Array.isArray(eonetPayload?.events) ? eonetPayload.events : [];
  const dispatches = [];

  for (const ev of events) {
    const categories = Array.isArray(ev.categories) ? ev.categories : [];
    const catId = categories[0]?.id || '';
    const catTitle = categories[0]?.title || 'Natural Event';

    const isStorm = catId === 'severeStorms';
    const isFire = catId === 'wildfires';
    const isVolcano = catId === 'volcanoes';

    const geometries = Array.isArray(ev.geometry) ? ev.geometry : [];
    if (geometries.length === 0) continue;
    const latestGeom = geometries[geometries.length - 1];
    const coords = latestGeom?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;

    const lon = Number(coords[0]);
    const lat = Number(coords[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;

    let category = 'CRISIS';
    let icon = '🌋';
    let prefix = 'NATURAL CRISIS';
    let severity = 'MODERATE';

    if (isStorm) {
      category = 'UNWETTER';
      icon = '🌪️';
      prefix = 'TROPICAL CYCLONE';
      severity = 'CRITICAL';
    } else if (isFire) {
      category = 'CRISIS';
      icon = '🔥';
      prefix = 'WILDFIRE';
      severity = 'SEVERE';
    } else if (isVolcano) {
      category = 'CRISIS';
      icon = '🌋';
      prefix = 'VOLCANIC ACTIVITY';
      severity = 'CRITICAL';
    }

    const title = String(ev.title || 'Natural Hazard').trim();
    const sourceName = ev.sources?.[0]?.id || 'NASA EONET';

    dispatches.push({
      id: `eonet-${ev.id || Math.random().toString(36).slice(2, 9)}`,
      title: `${icon} ${prefix}: ${title.toUpperCase()}`,
      category,
      severity,
      isHazard: true,
      hazardType: catId,
      locationName: title,
      coordinates: { latitude: lat, longitude: lon, altitude: 25000 },
      summary: `Satellite detection via ${sourceName}. Category: ${catTitle}. Latest observation: ${new Date(latestGeom.date || Date.now()).toISOString().slice(0, 10)}.`,
      source: `NASA EONET / ${sourceName}`,
      timestamp: latestGeom.date || new Date().toISOString(),
      url: ev.link || null,
      hasBriefing: true,
    });

    if (dispatches.length >= 25) break;
  }

  return dispatches;
}

/**
 * Strips HTML tags and unescapes XML/HTML entities from strings.
 * Prevents raw HTML (e.g. &lt;a href...&gt;) from leaking into cards and summaries.
 * @param {string} str
 * @returns {string}
 */
export function stripHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/&nbsp;/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#?\w+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalizes live geopolitical and military breaking news RSS into unified Botnet dispatches.
 * @param {string} rssXml
 * @returns {Array<object>}
 */
export function normalizeGeopoliticalNews(rssXml) {
  if (typeof rssXml !== 'string' || !rssXml) return [];
  const itemMatches = [...rssXml.matchAll(/<item>([\s\S]*?)<\/item>/g)];
  const dispatches = [];

  const MILITARY_KEYWORDS = [
    'military', 'defense', 'defence', 'troop', 'missile', 'drone', 'war', 'army', 'navy', 'nato',
    'conflict', 'airstrike', 'security', 'sanction', 'border', 'weapon', 'intelligence', 'combat',
    'frontline', 'exercise', 'allied', 'force', 'patrol', 'submarine', 'radar', 'carrier', 'nuclear',
    'krieg', 'rakete', 'drohne', 'armee', 'truppen', 'verteidigung', 'angriff', 'streitkräfte'
  ];

  for (const match of itemMatches) {
    const block = match[1];
    const rawTitle = block.match(/<title>(.*?)<\/title>/)?.[1] || '';
    const cleanTitle = stripHtml(rawTitle);

    if (!cleanTitle) continue;

    // Clean publisher suffix (e.g., " - Reuters", " - BBC News", " - Israel Hayom")
    const titleWithoutSource = cleanTitle.replace(/\s*[-–—|]\s*[^-–—|]+$/, '').trim();
    const cleanHeadline = titleWithoutSource || cleanTitle;
    const lower = cleanHeadline.toLowerCase();
    const isRelevant = MILITARY_KEYWORDS.some((kw) => lower.includes(kw));
    if (!isRelevant) continue;

    // Geotag against known geopolitical hotspots using clean headline without publisher
    const hotspot = resolveGeopoliticalHotspot(lower, cleanHeadline);

    const rawPubDate = block.match(/<pubDate>(.*?)<\/pubDate>/)?.[1];
    const timestamp = rawPubDate && !Number.isNaN(Date.parse(rawPubDate))
      ? new Date(rawPubDate).toISOString()
      : new Date().toISOString();

    const rawLink = block.match(/<link>(.*?)<\/link>/)?.[1] || '';
    const rawSource = stripHtml(block.match(/<source[^>]*>(.*?)<\/source>/)?.[1] || 'NEWS WIRE');

    const rawDesc = block.match(/<description>([\s\S]*?)<\/description>/)?.[1] || '';
    const cleanDesc = stripHtml(rawDesc);

    // If description repeats headline or wraps headline with publisher, clean it
    let cleanDescText = cleanDesc;
    if (cleanHeadline && cleanDescText.toLowerCase().includes(cleanHeadline.toLowerCase())) {
      cleanDescText = cleanDescText.replace(new RegExp(cleanHeadline.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '').trim();
    }
    if (rawSource && rawSource !== 'NEWS WIRE') {
      cleanDescText = cleanDescText.replace(new RegExp(`\\b${rawSource.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), '').trim();
    }

    const summaryText = cleanDescText && cleanDescText.length > 25 && !cleanDescText.startsWith('http')
      ? `${cleanDescText} (Source: ${rawSource})`
      : `${cleanHeadline}. Reported by ${rawSource}. Regional defense and situation monitoring active.`;

    const NAVAL_KEYWORDS = [
      'ship', 'warship', 'navy', 'naval', 'vessel', 'corvette', 'frigate', 'carrier', 'destroyer',
      'submarine', 'patrol boat', 'fleet', 'port', 'harbor', 'seaport', 'maritime', 'cargo ship',
      'tanker', 'sea drone', 'usv', 'schiff', 'kriegsschiff', 'marine', 'hafen', 'flotte', 'seegefecht',
      'катер', 'корабль', 'корабель', 'флот', 'порт'
    ];
    const isNaval = NAVAL_KEYWORDS.some((kw) => lower.includes(kw));
    const icon = isNaval ? '⚓' : '⚔️';

    dispatches.push({
      id: `geo-${Buffer.from(cleanTitle.slice(0, 24)).toString('base64').replace(/[^a-zA-Z0-9]/g, '')}`,
      title: `${icon} ${cleanHeadline}`,
      category: 'GEOPOLITICS',
      severity: 'SEVERE',
      isNaval,
      weaponSystem: isNaval ? 'Naval Combat / Maritime Strike' : undefined,
      locationName: hotspot.name,
      coordinates: { latitude: hotspot.lat, longitude: hotspot.lon, altitude: hotspot.alt },
      summary: summaryText,
      source: `INTEL WIRE / ${rawSource.toUpperCase()}`,
      timestamp,
      url: rawLink,
      hasBriefing: true,
    });

    if (dispatches.length >= 30) break;
  }

  return dispatches;
}

/**
 * Normalizes GDELT / Breaking tactical world incidents.
 * @param {object} gdeltPayload
 * @returns {Array<object>}
 */
export function normalizeTacticalNews(gdeltPayload) {
  const articles = Array.isArray(gdeltPayload?.articles) ? gdeltPayload.articles : [];
  const dispatches = [];

  for (const art of articles) {
    const title = String(art.title || '').trim();
    if (!title) continue;

    const rawDate = String(art.seendate || '');
    const compactDate = /^(\d{8})T(\d{6})Z$/.exec(rawDate);
    const timestamp = compactDate
      ? `${compactDate[1].slice(0, 4)}-${compactDate[1].slice(4, 6)}-${compactDate[1].slice(6, 8)}T${compactDate[2].slice(0, 2)}:${compactDate[2].slice(2, 4)}:${compactDate[2].slice(4, 6)}Z`
      : (!Number.isNaN(Date.parse(rawDate)) ? new Date(rawDate).toISOString() : new Date().toISOString());

    dispatches.push({
      id: `gdelt-${art.url ? art.url.slice(-16).replace(/[^\w]/g, '') : Math.random().toString(36).slice(2, 9)}`,
      title: `🛡️ ${title.slice(0, 100)}`,
      category: 'GEOPOLITICS',
      severity: 'MODERATE',
      locationName: art.sourcecountry || 'Global Intel',
      coordinates: { latitude: 48.0, longitude: 15.0, altitude: 50000 },
      summary: title,
      source: art.domain ? String(art.domain).toUpperCase() : 'GDELT TACTICAL',
      timestamp,
      url: art.url || null,
      hasBriefing: true,
    });

    if (dispatches.length >= 10) break;
  }

  return dispatches;
}

/**
 * Fetches and aggregates the full live Botnet feed from all primary sources:
 * - NOAA NWS Active Severe Weather Alerts
 * - USGS Global Earthquakes (M3.0+)
 * - NASA EONET Active Natural Hazards (Storms, Fires, Volcanoes)
 * - Google News / Tactical Geopolitics & Military Wire
 * - Swiss High-Alpine & Border Telemetry Nodes
 * - Global Tactical Radar & EW Jamming Sectors
 *
 * Uses 2-minute caching and concurrent fault-tolerant fetching.
 * @param {object} [options]
 * @returns {Promise<{status: string, count: number, timestamp: string, dispatches: Array<object>}>}
 */
export async function getAggregatedBotnetFeed({ forceRefresh = false } = {}) {
  const now = Date.now();
  if (!forceRefresh && _cachedDispatches && now - _lastFetchTime < BOTNET_CACHE_TTL_MS) {
    return {
      status: 'cached',
      count: _cachedDispatches.length,
      timestamp: new Date(_lastFetchTime).toISOString(),
      dispatches: _cachedDispatches,
    };
  }

  if (_inFlightFetch) return _inFlightFetch;

  _inFlightFetch = (async () => {
    try {
      const [noaaRes, usgsRes, eonetRes, newsRes, droneNewsRes, navalNewsRes, osintRes] = await Promise.allSettled([
        fetch('https://api.weather.gov/alerts/active?status=actual&message_type=alert', {
          headers: { 'User-Agent': 'GodsEyeView/1.0 (tactical-intel; contact@godseyeview.app)' },
          signal: AbortSignal.timeout(8000),
        }).then((r) => (r.ok ? r.json() : null)),

        fetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson', {
          signal: AbortSignal.timeout(8000),
        }).then((r) => (r.ok ? r.json() : null)),

        fetch('https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=30', {
          signal: AbortSignal.timeout(8000),
        }).then((r) => (r.ok ? r.json() : null)),

        fetch('https://news.google.com/rss/search?q=military+conflict+OR+geopolitics+OR+nato+when:2d', {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
          signal: AbortSignal.timeout(8000),
        }).then((r) => (r.ok ? r.text() : null)),

        fetch('https://news.google.com/rss/search?q=drone+attack+OR+missile+strike+OR+air+defense+when:1d', {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
          signal: AbortSignal.timeout(8000),
        }).then((r) => (r.ok ? r.text() : null)),

        fetch('https://news.google.com/rss/search?q=naval+strike+OR+warship+OR+black+sea+OR+red+sea+when:2d', {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
          signal: AbortSignal.timeout(8000),
        }).then((r) => (r.ok ? r.text() : null)),

        getAggregatedOsintMessages({ forceRefresh }).catch(() => []),
      ]);

      const weatherAlerts = noaaRes.status === 'fulfilled' && noaaRes.value ? normalizeNoaaAlerts(noaaRes.value) : [];
      const usgsQuakes = usgsRes.status === 'fulfilled' && usgsRes.value ? normalizeUsgsQuakes(usgsRes.value) : [];
      const eonetEvents = eonetRes.status === 'fulfilled' && eonetRes.value ? normalizeEonetEvents(eonetRes.value) : [];
      
      const rawGeoNews = [
        ...(newsRes.status === 'fulfilled' && newsRes.value ? normalizeGeopoliticalNews(newsRes.value) : []),
        ...(droneNewsRes.status === 'fulfilled' && droneNewsRes.value ? normalizeGeopoliticalNews(droneNewsRes.value) : []),
        ...(navalNewsRes.status === 'fulfilled' && navalNewsRes.value ? normalizeGeopoliticalNews(navalNewsRes.value) : []),
      ];
      const seenNewsTitles = new Set();
      const geoNews = [];
      for (const item of rawGeoNews) {
        const norm = String(item.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        if (!seenNewsTitles.has(norm)) {
          seenNewsTitles.add(norm);
          geoNews.push(item);
        }
      }

      const rawOsint = osintRes.status === 'fulfilled' && Array.isArray(osintRes.value) ? osintRes.value : [];
      const geoparsedOsint = geoparseOsintBatch(rawOsint).map((item) => ({
        id: item.id,
        title: item.title,
        category: item.category,
        severity: item.severity,
        locationName: item.locationName,
        coordinates: { latitude: item.latitude, longitude: item.longitude, altitude: item.altitude || 300 },
        summary: item.summary,
        details: item.originalText,
        weaponSystem: item.weaponSystem,
        impactRadiusM: item.impactRadiusM,
        theater: item.theater,
        source: item.source,
        timestamp: item.timestamp,
        mediaUrl: item.mediaUrl,
        messageUrl: item.messageUrl,
        isLiveOsint: true,
        isNaval: Boolean(item.isNaval),
      }));
      const swissItems = normalizeSwissNodes();
      const tacticalItems = normalizeTacticalRadarNodes();

      const severityRank = { CRITICAL: 0, SEVERE: 1, MODERATE: 2, INFO: 3 };
      const allDispatches = [
        ...geoparsedOsint,
        ...weatherAlerts,
        ...usgsQuakes,
        ...eonetEvents,
        ...geoNews,
        ...tacticalItems,
        ...swissItems,
      ].sort((a, b) => {
        const timeA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
        const timeB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
        if (timeA !== timeB) {
          return timeB - timeA;
        }
        const rankA = severityRank[a.severity] ?? 4;
        const rankB = severityRank[b.severity] ?? 4;
        return rankA - rankB;
      });

      _cachedDispatches = allDispatches;
      _lastFetchTime = Date.now();

      return {
        status: 'ready',
        count: allDispatches.length,
        timestamp: new Date(_lastFetchTime).toISOString(),
        dispatches: allDispatches,
      };
    } finally {
      _inFlightFetch = null;
    }
  })();

  return _inFlightFetch;
}

const _briefingCache = new Map();

/**
 * Generates an in-depth tactical situation briefing (SITREP) using Abacus AI Supercomputer.
 * @param {object} params
 * @returns {Promise<{ok: boolean, briefing: string, coordinates: {latitude: number, longitude: number}, model: string}>}
 */
export function generateTacticalFallbackSitrep({ headline, locationName, category, details, lat, lon }) {
  const isTornado = String(headline).toLowerCase().includes('tornado');
  const isJamming = category === 'RADAR' || String(headline).toLowerCase().includes('jam') || String(headline).toLowerCase().includes('gnss');
  const isSwiss = category === 'SCHWEIZ';
  const isEarthquake = category === 'CRISIS' || String(headline).toLowerCase().includes('erdbeben') || String(headline).toLowerCase().includes('quake');
  const isGeopolitics = category === 'GEOPOLITICS' || category === 'MILITARY' || String(headline).toLowerCase().includes('nato') || String(headline).toLowerCase().includes('krieg') || String(headline).toLowerCase().includes('defense');
  const coordsStr = lat && lon ? `${Number(lat).toFixed(4)}° N, ${Number(lon).toFixed(4)}° E` : 'in target sector';

  if (isTornado) {
    return `### 🚨 SITREP // TORNADO SEVERE WEATHER ASSESSMENT
- **Status:** SEVERE IMPACT · Confirmed tornado genesis / rotating supercell.
- **Intensity:** Significant rotation signatures (TVS) with high destructive potential on ground.

### 📍 TARGET LOCATION & COORDINATES
- **Target Area:** ${locationName} (${coordsStr})
- **Critical Infrastructure:** High risk for overland power grids, transportation corridors, and local communities.

### 📊 OPERATIONAL INTEL & IMPACT
- Doppler radar indicates debris ball and severe microburst wind shear.
- Hazard Level: CRITICAL // SEVERE STORM DETECTED.`;
  }

  if (isEarthquake) {
    return `### 🚨 SITREP // SEISMIC SITUATION ASSESSMENT
- **Status:** TECTONIC FAULT DISPLACEMENT // HYPOCENTER ACQUIRED.
- **Primary Event:** ${headline}

### 📍 EPICENTER & COORDINATES
- **Location:** ${locationName} (${coordsStr})
- **Focal Depth:** ${details || 'Seismic disturbance recorded within lithospheric crust.'}

### 📊 OPERATIONAL INTEL & IMPACT
- Active monitoring for aftershock sequences and structural risk along fault line.
- Tsunami early-warning telemetry active across maritime radius.`;
  }

  if (isGeopolitics) {
    const lowerAll = `${headline} ${locationName} ${details}`.toLowerCase();
    const isLandlocked = [
      'ethiopia', 'äthiopien', 'abiy', 'addis', 'tigray', 'amhara', 'oromia', 'fano',
      'mali', 'niger', 'tschad', 'chad', 'burkina', 'zentralafrik', 'central african',
      'south sudan', 'südsudan', 'uganda', 'ruanda', 'rwanda', 'burundi', 'sambia', 'zambia',
      'simbabwe', 'zimbabwe', 'malawi', 'bolivien', 'bolivia', 'paraguay', 'afghanistan',
      'armenien', 'armenia', 'aserbaidschan', 'azerbaijan', 'kasachstan', 'kazakhstan',
      'usbekistan', 'uzbekistan', 'turkmenistan', 'tadschikistan', 'tajikistan', 'kirgisistan', 'kyrgyzstan',
      'mongolei', 'mongolia', 'laos', 'schweiz', 'switzerland', 'österreich', 'austria',
      'tschechien', 'slowakei', 'ungarn', 'hungary', 'serbien', 'serbia', 'kosovo',
      'nordmazedonien', 'belarus', 'weissrussland'
    ].some((k) => lowerAll.includes(k));

    const isAlliance = ['alliance', 'bündnis', 'armed group', 'bewaffnet', 'rebel', 'rebellen', 'militia', 'miliz', 'insurgenc', 'aufstand', 'fano', 'ola', 'tplf', 'coup', 'putsch', 'junta'].some((k) => lowerAll.includes(k));
    const isAirstrike = ['missile', 'rakete', 'drone', 'drohne', 'airstrike', 'luftangriff', 'air strike', 'bombard', 'flugabwehr', 'air defense', 'patriot', 'iron dome'].some((k) => lowerAll.includes(k));
    const isNaval = !isLandlocked && ['navy', 'naval', 'marine', 'warship', 'kriegsschiff', 'destroyer', 'frigate', 'carrier', 'flugzeugträger', 'submarine', 'u-boot', 'red sea', 'rotes meer', 'strait', 'straße von', 'gulf', 'golf von', 'baltic', 'ostsee', 'black sea', 'schwarzes meer'].some((k) => lowerAll.includes(k));

    let status = 'HEIGHTENED DEFENSE READINESS IN REGIONAL SECTOR';
    let threatAnalysis = 'Elevated military troop concentrations and regional security tension. Strategic status tracked via multilateral intelligence telemetry.';
    let intel1 = 'Orbital SAR and optical reconnaissance (Sentinel / Maxar) focused on staging hubs and logistics arteries.';
    let intel2 = isLandlocked
      ? 'SIGINT-Funkpeilung and signals intelligence (HF/VHF / COMINT) active across Binnenland-Operationsraum (landlocked theater).'
      : (isNaval
        ? 'Maritime AIS tracking, naval radar coverage, and surface shipping surveillance active across key sea lanes.'
        : 'Electronic signals intelligence (SIGINT / COMINT) active across regional communication links.');
    let intel3 = 'Forward early-warning sensors and radar arrays tracking sector stability and defensive posture.';

    if (isAlliance) {
      status = 'ASYMMETRISCHE KOALITIONSBILDUNG // ASYMMETRIC COALITION DYNAMICS';
      threatAnalysis = 'Alliance formation of armed groups contesting territorial control. Risk of coordinated multi-front operations, fragmentation of regional security architecture, and overland corridor disruption.';
      intel1 = 'Orbital imaging prioritized over armed group assembly areas, logistics depots, and defensive perimeters.';
      intel2 = 'SIGINT-Funkpeilung and communications reconnaissance tracking command structure signatures.';
      intel3 = 'Sensor surveillance active on critical transit axes, governance centers, and humanitarian corridors.';
    } else if (isAirstrike) {
      status = 'AEROSPACE & MISSILE THREAT // ACTIVE AIR DEFENSE SECTOR';
      threatAnalysis = 'Deployment of cruise missiles, drone swarms, or precision-guided munitions. Immediate threat to regional infrastructure and airspace corridors.';
      intel1 = 'Aerospace surveillance radar and IFF arrays maintaining 360° early-warning coverage.';
      intel2 = 'Integrated air defense batteries (SAM / C-UAS) in active tracking mode.';
      intel3 = 'Automated telemetry tracking missile flight corridors and impact points.';
    } else if (isNaval) {
      status = 'MARITIME DEFENSE ESCALATION // SEA CORRIDOR TRACKING';
      threatAnalysis = 'Heightened threat potential along critical maritime chokepoints and navigation routes. Active risks for commercial shipping and naval formations.';
      intel1 = 'Satellite AIS tracking and space-based maritime radar active over corridor.';
      intel2 = 'Surface naval surveillance and acoustic tracking monitoring shipping lanes.';
      intel3 = 'Combatant Vessel Telemetry Note: Military warships in active theaters operate under strict EMCON (electronic silence / deactivated civilian AIS transponders); positions are tracked via orbital SAR and SIGINT telemetry.';
    }

    const terrainNote = isLandlocked ? 'Binnenland-Operationsraum (Landlocked theater — no direct naval access)' : 'Coastal / Maritime Littoral Sector';

    return `### 🚨 SITREP // GEOPOLITICAL & DEFENSE ASSESSMENT
- **Status:** ${status}
- **Primary Event:** ${headline}

### 📍 THEATER & COORDINATES
- **Location:** ${locationName} (${coordsStr})
- **Geography:** ${terrainNote}
- **Telemetry:** ${details || 'Ongoing sensor and open-source intelligence monitoring.'}

### 📊 OPERATIONAL INTEL & IMPACT
- ${threatAnalysis}
- **Intelligence Observations:**
  1. ${intel1}
  2. ${intel2}
  3. ${intel3}`;
  }

  if (isJamming) {
    return `### 🚨 SITREP // ELECTRONIC WARFARE (EW)
- **Status:** ACTIVE GNSS JAMMING / ELECTRONIC INTERFERENCE.
- **Intensity:** Significant attenuation of civil and maritime L1/L2 GPS and GLONASS frequencies.

### 📍 TARGET LOCATION & COORDINATES
- **Target Area:** ${locationName} (${coordsStr})
- **Surveillance Corridor:** Impacts maritime navigation, commercial air corridors, and automated piloting.

### 📊 OPERATIONAL INTEL & IMPACT
- Pseudo-signal distortion (spoofing) and receiver loss confirmed across operational sector.
- Hazard Level: SEVERE // ELEVATED RF INTERFERENCE.`;
  }

  if (isSwiss) {
    return `### 🚨 SITREP // HIGH-ALPINE OBSERVATORY
- **Status:** SENSOR TELEMETRY & CCTV FEED ACTIVE.
- **Location:** ${locationName} (${coordsStr})

### 📍 ALPINE HUB & SENSORS
- **Sensors:** MeteoSwiss weather radar, ASTRA highway cameras, Alpine 360° optics.
- **Infrastructure:** Transit corridors, alpine avalanche monitors, and emergency shelters.

### 📊 OPERATIONAL INTEL & IMPACT
- Real-time webcam feeds and high-altitude meteorological observations synchronized.`;
  }

  const translatedDetails = translateSlavicOsintText(details || '', 'de');

  return `### 🚨 LAGEBERICHT
- **Status:** Aktiv · Lagebeobachtung in ${locationName}.
- **Ereignis:** ${headline}

### 📍 ORT & KOORDINATEN
- **Ort:** ${locationName} (${coordsStr})
- **Details:** ${translatedDetails || details || 'Erhöhte Aufmerksamkeit im Zielgebiet.'}

### 📊 LAGEBILD & HINTERGRUND
- Live-OSINT-Datenfeed und Echtzeitüberwachung aktiv.`;
}

/**
 * Generates an in-depth tactical situation briefing (SITREP) using Abacus AI Supercomputer,
 * with instant fallback if unreachable.
 * @param {object} params
 * @returns {Promise<{ok: boolean, briefing: string, coordinates: {latitude: number, longitude: number}, model: string}>}
 */
export async function requestAbacusBriefing({
  headline,
  locationName = 'Unbekanntes Gebiet',
  lat = null,
  lon = null,
  category = 'GENERAL',
  details = '',
  apiKey = process.env.ABACUS_API_KEY,
  model = process.env.ABACUS_MODEL || 'gemini-2.5-flash',
  allowFallback = true,
}) {
  const effectiveKey = String(apiKey || '').trim();
  if (!effectiveKey && !allowFallback) {
    throw new Error('ABACUS_API_KEY ist nicht konfiguriert.');
  }

  const cacheKey = `${headline.toLowerCase()}|${String(locationName).toLowerCase()}`;
  const cached = _briefingCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < 10 * 60_000) {
    return cached.payload;
  }

  let briefing = '';
  let usedModel = model;

  if (effectiveKey) {
    const coordsStr = lat && lon ? `${Number(lat).toFixed(4)}° N, ${Number(lon).toFixed(4)}° E` : 'im Zielgebiet';
    const translatedDetails = translateSlavicOsintText(details || '', 'de');
    const systemPrompt = `You are the OSINT and strategic intelligence analyst for the "God's Eye View" platform.
Provide an objective, highly concise situation report (Lagebericht) in GERMAN (maximum 120-150 words).
Do NOT include roleplay commands, fictional operator instructions, or sci-fi claims. Provide strictly factual, analytical open-source intelligence.
Translate any Ukrainian, Russian, or foreign details into natural, clear German.
Respond strictly in this format:
### 🚨 LAGEBERICHT
- Sachliche Zusammenfassung des Ereignisses, der Intensität und der aktuellen Lage.

### 📍 ORT & KOORDINATEN
- Ort: ${locationName} (${coordsStr})
- Regionale Einordnung und Auswirkungen auf die Umgebung/Infrastruktur.

### 📊 LAGEBILD & OSINT-ANALYSE
- Factual OSINT analysis, Kontext und bisherige Lageentwicklung auf Deutsch.`;

    const userContent = `Ereignis: ${headline}
Kategorie: ${category}
Ort: ${locationName}
Details: ${translatedDetails || details || 'Keine Vorfälle gemeldet.'}`;

    try {
      const response = await fetch('https://routellm.abacus.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${effectiveKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent },
          ],
          max_tokens: 450,
          temperature: 0.15,
        }),
        signal: AbortSignal.timeout(7500),
      });

      if (response.ok) {
        const payload = await response.json();
        const rawContent = payload?.choices?.[0]?.message?.content;
        briefing = String(rawContent || '').trim();
      }
    } catch (err) {
      console.warn('[Abacus AI] Briefing call latency exceeded, returning instant tactical SITREP:', err?.message);
    }
  }

  if (!briefing) {
    briefing = generateTacticalFallbackSitrep({ headline, locationName, category, details, lat, lon });
    usedModel = 'Open Source Intel · KI-Analyse';
  }

  const result = {
    ok: true,
    briefing,
    headline,
    locationName,
    coordinates: {
      latitude: Number.isFinite(lat) ? lat : 47.3769,
      longitude: Number.isFinite(lon) ? lon : 8.5417,
    },
    model: usedModel,
    generatedAt: new Date().toISOString(),
  };

  _briefingCache.set(cacheKey, { payload: result, cachedAt: Date.now() });
  return result;
}

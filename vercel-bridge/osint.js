/**
 * Geocoded OSINT headlines (Reddit), for the conflict layer.
 *
 * Reddit itself carries no coordinates. This module takes the relay's newest
 * headlines and matches them against a compact gazetteer of conflict-relevant
 * places (city name → centre). A headline that names one of them becomes a map
 * point; the rest stay in the list without coordinates, so the layer never
 * pretends a vague post is a located event.
 *
 * The gazetteer is deliberately small and hand-kept: an automatic geocoder on
 * free-text headlines invents locations ("Russian losses" → Russia), and a
 * wrong dot on a war map is worse than no dot.
 */

const CACHE_MS = 2 * 60 * 1000;

/** A headline has to read like military operations to enter the layer. */
const MILITARY =
  /airstrike|air strike|drone|missile|shelling|artillery|rocket|attack|explosion|blast|offensive|troops|soldiers|military|air defen[cs]e|fighter jet|bomber|warship|naval|sabotage|refinery|depot|front ?line|invasion|ceasefire|killed|wounded|casualt|evacuat|intercept|غارة|قصف|صاروخ|صواريخ|مسيرة|مسيّرة|طائرة|هجوم|انفجار|شهيد|شهداء|قتلى|جرحى|جيش|جبهة|اشتباك|استهداف|احتلال/i;
/** @type {{at:number, body:object|null}} */
const cache = { at: 0, body: null };

/** City centres used for headline matching. [name, aliases, lat, lon] */
const PLACES = [
  // Ukraine
  ['Kyiv', ['kiev'], 50.4501, 30.5234],
  ['Kharkiv', ['kharkov'], 49.9935, 36.2304],
  ['Odesa', ['odessa'], 46.4825, 30.7233],
  ['Dnipro', ['dnepr'], 48.4647, 35.0462],
  ['Zaporizhzhia', ['zaporizhia', 'zaporozhye'], 47.8388, 35.1396],
  ['Kherson', [], 46.6354, 32.6169],
  ['Mykolaiv', ['nikolaev'], 46.975, 31.9946],
  ['Sumy', [], 50.9077, 34.7981],
  ['Chernihiv', ['chernigov'], 51.4982, 31.2893],
  ['Lviv', ['lwow'], 49.8397, 24.0297],
  ['Donetsk', [], 48.0159, 37.8029],
  ['Luhansk', ['lugansk'], 48.574, 39.3078],
  ['Bakhmut', [], 48.5956, 38.0008],
  ['Avdiivka', ['avdeevka'], 48.1399, 37.7481],
  ['Pokrovsk', [], 48.2815, 37.176],
  ['Kurakhove', [], 47.9852, 37.2777],
  ['Vuhledar', ['ugledar'], 47.7828, 37.2475],
  ['Kupiansk', ['kupyansk'], 49.7103, 37.6156],
  ['Lyman', ['krasny liman'], 48.9861, 37.8053],
  ['Sloviansk', ['slavyansk'], 48.8523, 37.6109],
  ['Kramatorsk', [], 48.7233, 37.5563],
  ['Kostiantynivka', ['kostyantynivka'], 48.5277, 37.7058],
  ['Chasiv Yar', [], 48.5933, 37.8426],
  ['Toretsk', ['dzerzhinsk'], 48.3986, 37.8477],
  ['Siversk', [], 48.8666, 38.0977],
  ['Vovchansk', ['volchansk'], 50.2903, 37.5028],
  ['Izium', ['izyum'], 49.2088, 37.2485],
  ['Nikopol', [], 47.5712, 34.3916],
  ['Marhanets', [], 47.6387, 34.6278],
  ['Kryvyi Rih', ['krivoy rog'], 47.9105, 33.3918],
  ['Poltava', [], 49.5883, 34.5514],
  ['Vinnytsia', [], 49.2331, 28.4682],
  ['Zhytomyr', [], 50.2547, 28.6587],
  ['Rivne', [], 50.6199, 26.2516],
  ['Ternopil', [], 49.5535, 25.5948],
  ['Ivano-Frankivsk', [], 48.9226, 24.7111],
  ['Uzhhorod', [], 48.6208, 22.2879],
  ['Chernivtsi', [], 48.2917, 25.9358],
  ['Kropyvnytskyi', [], 48.5079, 32.2623],
  ['Cherkasy', [], 49.4444, 32.0598],
  ['Melitopol', [], 46.8489, 35.3654],
  ['Mariupol', [], 47.0951, 37.5413],
  ['Berdiansk', ['berdyansk'], 46.7554, 36.7885],
  ['Enerhodar', [], 47.4989, 34.6557],
  ['Nova Kakhovka', [], 46.7562, 33.3486],
  ['Sevastopol', [], 44.6166, 33.5254],
  ['Simferopol', [], 44.9521, 34.1024],
  ['Kerch', [], 45.3531, 36.4747],
  // Russia and the border belt
  ['Moscow', ['moskau'], 55.7558, 37.6173],
  ['Belgorod', [], 50.5977, 36.5853],
  ['Kursk', [], 51.7304, 36.1926],
  ['Bryansk', [], 53.2436, 34.3639],
  ['Rostov-on-Don', ['rostov'], 47.2357, 39.7015],
  ['Voronezh', [], 51.672, 39.1843],
  ['Kaluga', [], 54.5138, 36.2612],
  ['Tula', [], 54.1961, 37.6182],
  ['Oryol', ['orel'], 52.9651, 36.0785],
  ['Lipetsk', [], 52.6031, 39.5708],
  ['Saratov', [], 51.5336, 46.0343],
  ['Engels', [], 51.4839, 46.1053],
  ['Ryazan', [], 54.6269, 39.6916],
  ['Novorossiysk', [], 44.7239, 37.7686],
  ['Sochi', [], 43.6028, 39.7342],
  ['Saint Petersburg', ['st petersburg'], 59.9311, 30.3609],
  ['Murmansk', [], 68.9585, 33.0827],
  ['Pskov', [], 57.8194, 28.3318],
  ['Smolensk', [], 54.7818, 32.0401],
  ['Taganrog', [], 47.2214, 38.909],
  ['Millerovo', [], 48.9226, 40.3967],
  ['Kursk Nuclear', ['kurchatov'], 51.6608, 35.6522],
  // Middle East
  ['Gaza', ['غزة'], 31.5017, 34.4668],
  ['Rafah', ['رفح'], 31.287, 34.245],
  ['Khan Younis', ['خان يونس'], 31.3401, 34.3029],
  ['Jabalia', ['جباليا'], 31.5333, 34.5],
  ['Beirut', ['بيروت'], 33.8938, 35.5018],
  ['Damascus', ['دمشق'], 33.5138, 36.2765],
  ['Aleppo', ['حلب'], 36.2021, 37.1343],
  ['Homs', ['حمص'], 34.7324, 36.7137],
  ['Hama', [], 35.1318, 36.7578],
  ['Latakia', [], 35.5309, 35.7826],
  ['Tehran', ['طهران'], 35.6892, 51.389],
  ['Isfahan', ['أصفهان'], 32.6546, 51.668],
  ['Baghdad', ['بغداد'], 33.3152, 44.3661],
  ['Erbil', ['أربيل'], 36.1911, 44.0092],
  ['Sanaa', ['sana', 'صنعاء'], 15.3694, 44.191],
  ['Hodeidah', ['hudaydah', 'الحديدة'], 14.7978, 42.9545],
  ['Tel Aviv', ['تل أبيب'], 32.0853, 34.7818],
  ['Jerusalem', ['القدس'], 31.7683, 35.2137],
  ['Haifa', ['حيفا'], 32.794, 34.9896],
  ['Eilat', [], 29.5577, 34.9519],
  ['Aden', [], 12.7855, 45.0187],
  ['Riyadh', ['الرياض'], 24.7136, 46.6753],
  // Africa
  ['Khartoum', ['الخرطوم'], 15.5007, 32.5599],
  ['Omdurman', [], 15.6445, 32.4777],
  ['El Fasher', [], 13.6279, 25.3494],
  ['Nyala', [], 12.05, 24.8833],
  ['Tripoli', [], 32.8872, 13.1913],
  ['Benghazi', [], 32.1167, 20.0667],
  ['Bamako', [], 12.6392, -8.0029],
  ['Ouagadougou', [], 12.3714, -1.5197],
  ['Niamey', [], 13.5116, 2.1254],
  ['Mogadishu', [], 2.0469, 45.3182],
  ['Kinshasa', [], -4.4419, 15.2663],
  ['Goma', [], -1.6771, 29.2289],
  ['Addis Ababa', [], 9.0192, 38.7525],
  ['Tigray', ['mekelle'], 13.4967, 39.4753],
  // Asia / other
  ['Taipei', [], 25.033, 121.5654],
  ['Taiwan Strait', [], 24.5, 119.5],
  ['Seoul', [], 37.5665, 126.978],
  ['Pyongyang', [], 39.0392, 125.7625],
  ['Kabul', [], 34.5553, 69.2075],
  ['Islamabad', [], 33.6844, 73.0479],
  ['New Delhi', ['delhi'], 28.6139, 77.209],
  ['Caracas', [], 10.4806, -66.9036],
  ['Bogota', [], 4.711, -74.0721],
  ['Quito', [], -0.1807, -78.4678],
  ['Mexico City', [], 19.4326, -99.1332],
  ['South China Sea', [], 14.0, 114.0],
  ['Spratly Islands', ['Spratly', 'Spratlys'], 10.0, 114.0],
  ['Scarborough Shoal', [], 15.15, 117.75],
  ['Kashmir', [], 34.08, 74.8],
  ['Line of Control', ['LoC'], 34.0, 74.0],

  ['Tbilisi', [], 41.7151, 44.8271],
  ['Yerevan', [], 40.1792, 44.4991],
  ['Baku', [], 40.4093, 49.8671],
  ['Dushanbe', [], 38.5598, 68.787],
  ['Bishkek', [], 42.8746, 74.5698],
  ['Tashkent', [], 41.2995, 69.2401],
  ['Ulaanbaatar', [], 47.8864, 106.9057],
  ['Tokyo', [], 35.6762, 139.6503],
  ['Hong Kong', [], 22.3193, 114.1694],
  ['Guangzhou', [], 23.1291, 113.2644],
  ['Shanghai', [], 31.2304, 121.4737],
  ['Beijing', ['Peking'], 39.9042, 116.4074],
  ['Kolkata', [], 22.5726, 88.3639],
  ['Mumbai', [], 19.076, 72.8777],
  ['Srinagar', [], 34.0837, 74.7973],
  ['Lahore', [], 31.5204, 74.3587],
  ['Karachi', [], 24.8607, 67.0011],
  ['Kathmandu', [], 27.7172, 85.324],
  ['Colombo', [], 6.9271, 79.8612],
  ['Chittagong', [], 22.3569, 91.7832],
  ['Dhaka', [], 23.8103, 90.4125],
  ['Vientiane', [], 17.9757, 102.6331],
  ['Phnom Penh', [], 11.5564, 104.9282],
  ['Ho Chi Minh City', ['Saigon'], 10.8231, 106.6297],
  ['Hanoi', [], 21.0278, 105.8342],
  ['Singapore', [], 1.3521, 103.8198],
  ['Kuala Lumpur', [], 3.139, 101.6869],
  ['Jakarta', [], -6.2088, 106.8456],
  ['Marawi', [], 8.0, 124.29],
  ['Manila', ['مانيلا'], 14.5995, 120.9842],
  ['Chiang Mai', [], 18.7883, 98.9853],
  ['Bangkok', ['بانكوك'], 13.7563, 100.5018],
  ['Loikaw', ['လွိုင်ကော်'], 19.674, 97.209],
  ['Myawaddy', ['မြဝတီ'], 16.689, 98.508],
  ['Lashio', ['လားရှိုး'], 22.9359, 97.7498],
  ['Sittwe', ['စစ်တွေ'], 20.146, 92.898],
  ['Naypyidaw', ['Nay Pyi Taw', 'နေပြည်တော်'], 19.7633, 96.0785],
  ['Mandalay', ['မန္တလေး'], 21.9588, 96.0891],
  ['Yangon', ['Rangoon', 'يانغون', 'ရန်ကုန်'], 16.8409, 96.1735],
  // Middle East — the Iran/Israel/Gulf theatre the OSINT feed covers
  ['Natanz', ['نطنز'], 33.72, 51.73],
  ['Fordow', ['fordow fuel enrichment'], 34.88, 50.99],
  ['Bushehr', [], 28.92, 50.84],
  ['Bandar Abbas', [], 27.19, 56.27],
  ['Kharg Island', ['kharg'], 29.25, 50.32],
  ['Tabriz', [], 38.08, 46.29],
  ['Shiraz', [], 29.59, 52.58],
  ['Mashhad', [], 36.3, 59.61],
  ['Ahvaz', [], 31.32, 48.67],
  ['Kermanshah', [], 34.31, 47.07],
  ['Abadan', [], 30.34, 48.3],
  ['Chabahar', [], 25.29, 60.64],
  ['Qom', [], 34.64, 50.88],
  ['Karaj', [], 35.84, 50.94],
  ['Strait of Hormuz', ['hormuz'], 26.57, 56.25],
  ['Dimona', [], 31.07, 35.03],
  ['Nevatim', [], 31.21, 35.01],
  ['Ashdod', ['أسدود'], 31.8, 34.64],
  ['Ashkelon', ['عسقلان'], 31.67, 34.57],
  ['Sderot', ['سديروت'], 31.52, 34.6],
  ['Beersheba', ['بئر السبع'], 31.25, 34.79],
  ['Ramla', [], 31.93, 34.87],
  ['Jenin', ['جنين'], 32.46, 35.3],
  ['Nablus', ['نابلس'], 32.22, 35.25],
  ['Ramallah', ['رام الله'], 31.9, 35.2],
  ['Hebron', ['الخليل'], 31.53, 35.1],
  ['Tyre', ['صور'], 33.27, 35.2],
  ['Sidon', ['صيدا'], 33.56, 35.37],
  ['Nabatieh', [], 33.38, 35.48],
  ['Baalbek', [], 34.01, 36.21],
  ['Deir ez-Zor', [], 35.33, 40.14],
  ['Tartus', [], 34.89, 35.89],
  ['Saada', [], 16.94, 43.76],
  ['Marib', [], 15.46, 45.33],
  ['Basra', ['البصرة'], 30.51, 47.78],
  ['Ain al-Asad', ['al-asad'], 33.79, 42.44],
  ['Doha', ['الدوحة'], 25.29, 51.53],
  ['Dubai', ['دبي'], 25.2, 55.27],
  ['Abu Dhabi', ['أبوظبي'], 24.45, 54.38],
  ['Manama', [], 26.23, 50.59],
  ['Kuwait City', [], 29.38, 47.99],
  ['Al Udeid', [], 25.12, 51.32],
  ['Dhahran', [], 26.27, 50.15],
  ['Beit Lahia', ['beit lahia', 'بيت لاهيا'], 31.55, 34.5],
  ['Beit Hanoun', ['beit hanoun', 'بيت حانون'], 31.54, 34.54],
  ["Shuja'iyya", ['shujaiyya'], 31.5, 34.47],
  ['Zeitoun', ['zaytoun'], 31.47, 34.4],
  ['Deir al-Balah', ['deir al balah', 'دير البلح'], 31.42, 34.35],
  ['Bureij', ['البريج'], 31.44, 34.4],
  ['Nuseirat', ['النصيرات'], 31.45, 34.39],
  ['Maghazi', ['المغازي'], 31.42, 34.38],
  ['Kerem Shalom', [], 31.22, 34.27],
  ['Erez', ['erez crossing'], 31.56, 34.55],
  ["Re'im", ['reim'], 31.39, 34.44],
  ['Netivot', [], 31.42, 34.59],
  ['Ofakim', [], 31.31, 34.62],
  ['Kiryat Gat', [], 31.61, 34.76],
  ['Kiryat Shmona', [], 33.21, 35.57],
  ['Metula', [], 33.28, 35.58],
  ['Nahariya', [], 33.01, 35.09],
  ['Acre', ['akko'], 32.93, 35.08],
  ['Tiberias', [], 32.79, 35.53],
  ['Tulkarm', ['طولكرم'], 32.31, 35.03],
  ['Qalqilya', ['قلقيلية'], 32.19, 34.97],
  ['Bethlehem', ['بيت لحم'], 31.7, 35.2],
  ['Jericho', ['أريحا'], 31.86, 35.46],
  ['Lod', [], 31.95, 34.89],
  ['Netanya', [], 32.32, 34.85],
  ['Herzliya', [], 32.17, 34.79],
  ['Hadera', [], 32.43, 34.89],
  ['Afula', [], 32.61, 35.29],
  ['Medina', ['المدينة المنورة'], 24.47, 39.61],
  ['Jeddah', ['جدة'], 21.49, 39.19],
  ['Mecca', [], 21.39, 39.83],
  ['Abha', [], 18.22, 42.51],
  ['Riyadh', [], 24.71, 46.68],
];

/** Longest-name-first so "Novorossiysk" wins over a bare "Rostov". */
const MATCHERS = PLACES.flatMap(([name, aliases, lat, lon]) =>
  [name, ...(aliases || [])].map((label) => ({
    label,
    place: name,
    lat,
    lon,
    // Arabic and other non-Latin scripts have no \b semantics in JavaScript:
    // match those labels as plain substrings instead.
    literal: /[^\x00-\x7f]/.test(label),
    pattern: new RegExp(
      `\\b${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`,
      'i',
    ),
  })),
).sort((a, b) => b.label.length - a.label.length);

function locate(title) {
  for (const matcher of MATCHERS) {
    const hit = matcher.literal
      ? title.includes(matcher.label)
      : matcher.pattern.test(title);
    if (hit)
      return { place: matcher.place, lat: matcher.lat, lon: matcher.lon };
  }
  return null;
}

/**
 * Strike targets named in a headline, with the category the map colours by.
 * This is a read of the wording, not a verification: "refinery" says what the
 * post says was hit, nothing more.
 */
const TARGETS = [
  ['oil refinery', 'energy', /refiner(y|ies)/i],
  ['oil depot', 'energy', /oil (depot|terminal|storage)|fuel (depot|storage)/i],
  [
    'power plant',
    'energy',
    /power (plant|station)|substation|electric(al)? grid/i,
  ],
  ['pipeline', 'energy', /pipeline|gas (line|hub)/i],
  ['airbase', 'military', /air ?base|airfield|military airport/i],
  ['radar', 'military', /radar/i],
  [
    'air defence',
    'military',
    /air defen[cs]e|s-?300|s-?400|patriot|iron dome/i,
  ],
  [
    'ammo depot',
    'military',
    /ammo|ammunition|arms (depot|warehouse)|missile (depot|storage)/i,
  ],
  ['command post', 'military', /command (post|centre|center)|headquarters/i],
  ['barracks', 'military', /barracks|garrison/i],
  ['warship', 'military', /warship|destroyer|frigate|submarine|carrier/i],
  ['port', 'infrastructure', /port|harbou?r|dock/i],
  ['bridge', 'infrastructure', /bridge|overpass/i],
  [
    'factory',
    'infrastructure',
    /factory|plant|works|industrial (site|facility)/i,
  ],
  ['warehouse', 'infrastructure', /warehouse|logistics (hub|centre|center)/i],
  ['drone', 'military', /drone|uav/i],
  ['missile', 'military', /missile/i],
];

function locateTarget(title) {
  for (const [label, category, pattern] of TARGETS) {
    if (pattern.test(title)) return { target: label, category };
  }
  return { target: null, category: 'other' };
}

/**
 * Refine a located report with the named target: "oil refinery" near Ryazan
 * should sit on the refinery, not on the city centre. TomTom's POI search
 * answers that with first-class POIs (it is the same key the place search
 * uses), and results are cached per place+target for the instance's lifetime.
 */
const POI_CACHE = new Map();
async function refineWithPoi(report) {
  const key = report.place + '|' + report.target;
  if (POI_CACHE.has(key)) return POI_CACHE.get(key);
  const apiKey = String(process.env.TOMTOM_API_KEY || '').trim();
  if (!apiKey || !report.target || report.lat == null) return null;
  try {
    const url = new URL(
      'https://api.tomtom.com/search/2/poiSearch/' +
        encodeURIComponent(report.target) +
        '.json',
    );
    url.searchParams.set('key', apiKey);
    url.searchParams.set('lat', String(report.lat));
    url.searchParams.set('lon', String(report.lon));
    url.searchParams.set('radius', '30000');
    url.searchParams.set('limit', '1');
    const response = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!response.ok) return null;
    const body = await response.json();
    const position = body?.results?.[0]?.position;
    const result =
      Number.isFinite(position?.lat) && Number.isFinite(position?.lon)
        ? { lat: position.lat, lon: position.lon }
        : null;
    POI_CACHE.set(key, result);
    return result;
  } catch {
    return null;
  }
}

/**
 * Geocoded reports from the relay's Reddit list.
 * @param {{url:string, token:string, fetchImpl?:Function}} relay
 */
export async function osintReports({
  url,
  token,
  fresh = false,
  fetchImpl = fetch,
} = {}) {
  if (!url) return null;
  if (!fresh && cache.body && Date.now() - cache.at < CACHE_MS)
    return cache.body;
  try {
    const response = await fetchImpl(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'gods-eye-view/1.0',
        ...(token
          ? { 'x-relay-token': String(token).replace(/\s+/g, '') }
          : {}),
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return cache.body;
    const body = await response.json();
    const items = Array.isArray(body?.items) ? body.items : [];
    const reports = items
      .filter(
        (item) =>
          // Channel posts are conflict feeds by definition; the keyword filter
          // would drop photo captions and Arabic one-liners.
          String(item?.sub || '').startsWith('tg:') ||
          MILITARY.test(String(item?.title || '')),
      )
      .map((item) => {
        const point = locate(String(item?.title || ''));
        const strike = locateTarget(String(item?.title || ''));
        return {
          title: String(item?.title || '').slice(0, 240),
          url: String(item?.url || ''),
          sub: String(item?.sub || ''),
          updated: String(item?.updated || ''),
          place: point?.place || null,
          lat: point?.lat ?? null,
          lon: point?.lon ?? null,
          target: strike.target,
          category: strike.category,
        };
      });
    // Cross-posted stories arrive once per subreddit; keep the first copy.
    const seen = new Set();
    const unique = reports.filter((report) => {
      const key = String(report.title)
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim()
        .slice(0, 80);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    // Refine up to a dozen located reports per cycle (quota-friendly).
    let budget = 12;
    const refined = [];
    for (const report of unique.slice(0, 200)) {
      if (budget > 0 && report.lat !== null && report.target) {
        budget -= 1;
        const poi = await refineWithPoi(report);
        if (poi) {
          refined.push({
            ...report,
            lat: poi.lat,
            lon: poi.lon,
            refined: true,
          });
          continue;
        }
      }
      refined.push(report);
    }
    const result = {
      reports: refined.slice(0, 200),
      located: refined.filter((report) => report.lat !== null).length,
      fetchedAt: Date.now(),
    };
    cache.at = Date.now();
    cache.body = result;
    return result;
  } catch {
    return cache.body;
  }
}

const WIKI_LANGS = ['en', 'de'];
const WIKI_TTL_MS = 10 * 60 * 1000;
const WIKI_PAGES = 3;
const WIKI_EXTRACT = 600;
/** @type {Map<string, {at:number, pages:object[]}>} */
const wikiCache = new Map();

/** Plain-text intro of the Wikipedia pages a name matches, one request per language. */
async function wikipediaSearch(lang, name, fetchImpl) {
  const params = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: `"${name}"`,
    gsrlimit: String(WIKI_PAGES),
    gsrnamespace: '0',
    prop: 'extracts|description',
    exintro: '1',
    explaintext: '1',
    format: 'json',
    formatversion: '2',
  });
  const response = await fetchImpl(
    `https://${lang}.wikipedia.org/w/api.php?${params}`,
    {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'gods-eye-view/1.0 (public reporting search)',
      },
      signal: AbortSignal.timeout(8_000),
    },
  );
  if (!response.ok) throw new Error(`Wikipedia HTTP ${response.status}`);
  const body = await response.json();
  const pages = Array.isArray(body?.query?.pages)
    ? [...body.query.pages]
    : [];
  pages.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  // Full-text search also matches page internals the intro never shows; keep
  // only pages whose visible text names the person (the surname suffices, so
  // "Kabinett Merkel II" stays for "Angela Merkel").
  const needle = String(name)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .pop();
  if (!needle) return [];
  return pages
    .filter((page) => page?.title && page?.extract)
    .map((page) => ({
      lang,
      title: String(page.title),
      description: String(page.description || ''),
      extract: String(page.extract).replace(/\s+/g, ' ').trim().slice(0, WIKI_EXTRACT),
      url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(String(page.title).replace(/ /g, '_'))}`,
    }))
    .filter((page) =>
      `${page.title} ${page.description} ${page.extract}`
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .includes(needle),
    );
}

async function wikipediaPages(name, fetchImpl) {
  const key = name.toLowerCase();
  const hit = wikiCache.get(key);
  if (hit && Date.now() - hit.at < WIKI_TTL_MS)
    return { ok: true, pages: hit.pages };
  const settled = await Promise.allSettled(
    WIKI_LANGS.map((lang) => wikipediaSearch(lang, name, fetchImpl)),
  );
  let ok = false;
  const pages = [];
  const seen = new Set();
  for (const entry of settled) {
    if (entry.status !== 'fulfilled') continue;
    ok = true;
    for (const page of entry.value) {
      const pageKey = `${page.lang}:${page.title.toLowerCase()}`;
      if (seen.has(pageKey)) continue;
      seen.add(pageKey);
      pages.push(page);
    }
  }
  if (ok) {
    wikiCache.set(key, { at: Date.now(), pages });
    if (wikiCache.size > 100) wikiCache.delete(wikiCache.keys().next().value);
  }
  return { ok, pages };
}

const NEWS_TTL_MS = 10 * 60 * 1000;
const NEWS_EDITIONS = [
  { language: 'de', hl: 'de', gl: 'CH', ceid: 'CH:de' },
  { language: 'de', hl: 'de', gl: 'DE', ceid: 'DE:de' },
  { language: 'en', hl: 'en-US', gl: 'US', ceid: 'US:en' },
];
/** @type {Map<string, {at:number, items:object[]}>} */
const newsCache = new Map();

function decodeEntities(text) {
  return String(text || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCharCode(parseInt(code, 16)),
    )
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/** One Google News edition's items whose headline names the person. */
async function newsEdition(edition, name, needle, fetchImpl) {
  const params = new URLSearchParams({
    q: `"${name}"`,
    hl: edition.hl,
    gl: edition.gl,
    ceid: edition.ceid,
  });
  const response = await fetchImpl(
    `https://news.google.com/rss/search?${params}`,
    {
      headers: {
        Accept: 'application/rss+xml, application/xml;q=0.9',
        'User-Agent': 'gods-eye-view/1.0 (public reporting search)',
      },
      signal: AbortSignal.timeout(8_000),
    },
  );
  if (!response.ok) throw new Error(`Google News HTTP ${response.status}`);
  const xml = await response.text();
  const items = [];
  for (const match of String(xml).matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = match[1];
    const source = decodeEntities(
      /<source[^>]*>([\s\S]*?)<\/source>/.exec(block)?.[1] || '',
    );
    let title = decodeEntities(
      /<title>([\s\S]*?)<\/title>/.exec(block)?.[1] || '',
    );
    if (source && title.endsWith(` - ${source}`))
      title = title.slice(0, -(source.length + 3)).trim();
    // The feed matches loosely; only a headline that names the person counts.
    const normalized = title
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    if (!title || !normalized.includes(needle)) continue;
    items.push({
      title: title.slice(0, 240),
      url: decodeEntities(
        /<link>([\s\S]*?)<\/link>/.exec(block)?.[1] || '',
      ),
      source,
      published: decodeEntities(
        /<pubDate>([\s\S]*?)<\/pubDate>/.exec(block)?.[1] || '',
      ),
      language: edition.language,
    });
  }
  return items;
}

async function googleNews(name, fetchImpl) {
  const key = name.toLowerCase();
  const hit = newsCache.get(key);
  if (hit && Date.now() - hit.at < NEWS_TTL_MS)
    return { ok: true, items: hit.items };
  const needle = String(name)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .pop();
  if (!needle) return { ok: false, items: [] };
  const settled = await Promise.allSettled(
    NEWS_EDITIONS.map((edition) =>
      newsEdition(edition, name, needle, fetchImpl),
    ),
  );
  let ok = false;
  const items = [];
  const seen = new Set();
  for (const entry of settled) {
    if (entry.status !== 'fulfilled') continue;
    ok = true;
    for (const item of entry.value) {
      const dedupe = item.title
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
      if (!dedupe || seen.has(dedupe)) continue;
      seen.add(dedupe);
      items.push(item);
    }
  }
  items.sort(
    (a, b) => (Date.parse(b.published) || 0) - (Date.parse(a.published) || 0),
  );
  const capped = items.slice(0, 24);
  if (ok) {
    newsCache.set(key, { at: Date.now(), items: capped });
    if (newsCache.size > 100)
      newsCache.delete(newsCache.keys().next().value);
  }
  return { ok, items: capped };
}

/** Aggregated headlines whose title mentions the name. */
async function relayMatches(query, { url, token, fetchImpl = fetch } = {}) {
  if (!url) return { ok: false, matches: [], scanned: 0 };
  try {
    const response = await fetchImpl(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'gods-eye-view/1.0',
        ...(token
          ? { 'x-relay-token': String(token).replace(/\s+/g, '') }
          : {}),
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return { ok: false, matches: [], scanned: 0 };
    const body = await response.json();
    const items = Array.isArray(body?.items) ? body.items : [];
    const needle = query.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const matches = items
      .filter((item) => {
        const title = String(item?.title || '')
          .normalize('NFD')
          .replace(/[̀-ͯ]/g, '')
          .toLowerCase();
        return title.includes(needle);
      })
      .map((item) => {
        const point = locate(String(item?.title || ''));
        return {
          title: String(item?.title || '').slice(0, 240),
          url: String(item?.url || ''),
          sub: String(item?.sub || ''),
          updated: String(item?.updated || ''),
          place: point?.place || null,
          lat: point?.lat ?? null,
          lon: point?.lon ?? null,
        };
      });
    return { ok: true, matches, scanned: items.length };
  } catch {
    return { ok: false, matches: [], scanned: 0 };
  }
}

/**
 * Public reporting about a name: headline mentions across the aggregated
 * feeds, a Google News index and Wikipedia intros. Sources that publish
 * publicly only — not a people database, and deliberately without contact
 * data.
 */
export async function searchReports(
  name,
  { url, token, fetchImpl = fetch } = {},
) {
  const query = String(name || '').trim();
  if (query.length < 2 || query.length > 60) return null;
  const [relay, wiki, news] = await Promise.all([
    relayMatches(query, { url, token, fetchImpl }),
    wikipediaPages(query, fetchImpl),
    googleNews(query, fetchImpl),
  ]);
  if (!relay.ok && !wiki.ok && !news.ok) return null;
  return {
    name: query,
    matches: relay.matches,
    pages: wiki.pages,
    news: news.items,
    scanned: relay.scanned,
    relay: relay.ok,
    wikipedia: wiki.ok,
    googleNews: news.ok,
    fetchedAt: Date.now(),
  };
}

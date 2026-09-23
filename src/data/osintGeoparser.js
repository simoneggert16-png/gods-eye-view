/**
 * @module osintGeoparser
 *
 * Automated Geoparsing and NLP extraction for open-source intelligence (OSINT).
 * Converts unstructured text and Telegram dispatches into structured tactical
 * records with coordinates, impact radius, weapon systems, severity, and SITREP summaries.
 */

/**
 * Multilingual conflict & strategic gazetteer mapping location names/aliases
 * to precise coordinates and region metadata.
 */
export const OSINT_GAZETTEER = [
  // --- Ukraine & Crimea ---
  {
    name: 'Odessa Port / Black Sea, Ukraine',
    lat: 46.4950,
    lon: 30.7420,
    theater: 'SÜDUKRAINE / SCHWARZMEER-KÜSTE',
    aliases: ['odessa port', 'odesa port', 'port of odessa', 'hafen odessa', 'одеса порт', 'одесса порт', 'порт одеса', 'порт одесса', 'порт в одесі', 'порт в одессе'],
  },
  {
    name: 'Odesa, Ukraine',
    lat: 46.4825,
    lon: 30.7233,
    theater: 'SÜDUKRAINE / SCHWARZMEER-KÜSTE',
    aliases: ['odesa', 'odessa', 'одеса', 'одесу', 'одеси', 'одесі', 'одесса', 'одессу', 'одессы', 'одессе'],
  },
  {
    name: 'Ochakiv (Black Sea Naval Hub), Ukraine',
    lat: 46.6186,
    lon: 31.5492,
    theater: 'SÜDUKRAINE / SCHWARZMEER-FLOTTE',
    aliases: ['ochakiv', 'ochakov', 'очаків', 'очакова', 'очакову', 'очаков', 'очакова'],
  },
  {
    name: 'Black Sea / Maritime Sector',
    lat: 44.5000,
    lon: 33.0000,
    theater: 'SCHWARZMEER / MARITIMER SEKTOR',
    aliases: ['black sea', 'schwarzes meer', 'чорне море', 'чорного моря', 'чорному морю', 'черное море', 'черного моря', 'акваторія чорного моря', 'акваторії чорного моря'],
  },
  {
    name: 'Sea of Azov / Maritime Sector',
    lat: 46.0000,
    lon: 36.5000,
    theater: 'ASOWSCHES MEER / MARITIMER SEKTOR',
    aliases: ['sea of azov', 'asowsches meer', 'азовське море', 'азовського моря', 'азовское море', 'азовского моря'],
  },
  {
    name: 'Zatoka / Serhiivka (Black Sea Coast), Ukraine',
    lat: 46.0667,
    lon: 30.4667,
    theater: 'SÜDUKRAINE / KÜSTENSEKTOR',
    aliases: ['zatoka', 'serhiivka', 'sergeevka', 'затока', 'затоки', 'сергіївка', 'сергіївки', 'сергеевка'],
  },
  {
    name: 'Kyiv, Ukraine',
    lat: 50.4501,
    lon: 30.5234,
    theater: 'UKRAINE / HAUPTSTADT-SEKTOR',
    aliases: ['kyiv', 'kiew', 'kiev', 'київ', 'києва', 'києві', 'киев', 'киева', 'киеве', 'київщин', 'київщини', 'киевщин', 'киевщины'],
  },
  {
    name: 'Chabany (Kyiv Sector), Ukraine',
    lat: 50.3417,
    lon: 30.4222,
    theater: 'UKRAINE / HAUPTSTADT-SEKTOR',
    aliases: ['chabany', 'чабани', 'чабанів', 'чабанах', 'чабаны'],
  },
  {
    name: 'Kharkiv, Ukraine',
    lat: 50.0038,
    lon: 36.2304,
    theater: 'OSTUKRAINE / CHARKIW',
    aliases: ['kharkiv', 'charkiw', 'kharkov', 'харків', 'харкова', 'харкові', 'харьков', 'харькова', 'харківщин', 'харківщини', 'харьковщин', 'харьковщины'],
  },
  {
    name: 'Myrhorod Air Base, Ukraine',
    lat: 49.9678,
    lon: 33.6069,
    theater: 'ZENTRALUKRAINE / MILITÄRFLUGPLATZ',
    aliases: ['myrhorod', 'mirgorod', 'миргород', 'миргорода', 'миргороду'],
  },
  {
    name: 'Starokostiantyniv Air Base, Ukraine',
    lat: 49.7547,
    lon: 27.2189,
    theater: 'WESTUKRAINE / TAKTISCHE FLOTTE',
    aliases: ['starokostiantyniv', 'starokonstantinov', 'старокостянтинів', 'старокостянтинова', 'староконстантинов', 'старо'],
  },
  {
    name: 'Kremenchuk, Ukraine',
    lat: 49.0630,
    lon: 33.4039,
    theater: 'ZENTRALUKRAINE / KREMENCHUK',
    aliases: ['kremenchuk', 'kremenchug', 'кременчук', 'кременчука', 'кременчугу', 'кременчуг'],
  },
  {
    name: 'Dnipro, Ukraine',
    lat: 48.4647,
    lon: 35.0462,
    theater: 'ZENTRALUKRAINE / DNIPRO',
    aliases: ['dnipro', 'dnepropetrovsk', 'dnepr', 'дніпро', 'дніпра', 'дніпрі', 'днепр', 'днепра', 'днепре', 'дніпропетровськ', 'дніпропетровщин', 'дніпропетровщини'],
  },
  {
    name: 'Zaporizhzhia, Ukraine',
    lat: 47.8388,
    lon: 35.1396,
    theater: 'SÜDUKRAINE / SAPORISCHSCHJA',
    aliases: ['zaporizhzhia', 'saporischschja', 'zaporozhye', 'запоріжжя', 'запоріжжі', 'запорожье', 'запорожья', 'запорізьк'],
  },
  {
    name: 'Poltava, Ukraine',
    lat: 49.5883,
    lon: 34.5514,
    theater: 'ZENTRALUKRAINE / POLTAWA',
    aliases: ['poltava', 'poltawa', 'полтава', 'полтави', 'полтаві', 'полтаву', 'полтавщин', 'полтавщини'],
  },
  {
    name: 'Sumy, Ukraine',
    lat: 50.9077,
    lon: 34.7981,
    theater: 'NORDOSTUKRAINE / SUMY',
    aliases: ['sumy', 'sumi', 'суми', 'сум', 'сумах', 'сумами', 'сумщин', 'сумщини', 'сумская', 'сумской'],
  },
  {
    name: 'Chernihiv, Ukraine',
    lat: 51.4982,
    lon: 31.2893,
    theater: 'NORDUKRAINE / TSCHERNIHIW',
    aliases: ['chernihiv', 'tschernihiw', 'chernigov', 'чернігів', 'чернігова', 'чернігові', 'чернигов', 'чернігівщин', 'чернігівщини'],
  },
  {
    name: 'Mykolaiv, Ukraine',
    lat: 46.9750,
    lon: 31.9946,
    theater: 'SÜDUKRAINE / NIKOLAJEW',
    aliases: ['mykolaiv', 'nikolajew', 'mykolajiw', 'миколаїв', 'миколаєва', 'миколаєві', 'николаев', 'николаева', 'миколаївщин', 'миколаївщини'],
  },
  {
    name: 'Kherson, Ukraine',
    lat: 46.6354,
    lon: 32.6169,
    theater: 'SÜDUKRAINE / CHERSON FRONT',
    aliases: ['kherson', 'cherson', 'херсон', 'херсона', 'херсоні', 'херсонщин', 'херсонщини'],
  },
  {
    name: 'Uman, Ukraine',
    lat: 48.7484,
    lon: 30.2218,
    theater: 'ZENTRALUKRAINE / UMAN',
    aliases: ['uman', 'умань', 'умані'],
  },
  {
    name: 'Izmail Port, Danube / Ukraine',
    lat: 45.3508,
    lon: 28.8358,
    theater: 'DONAU-HAFENKOMPLEX / ISMAIL',
    aliases: ['izmail', 'ismail', 'ізмаїл', 'ізмаїла', 'измаил'],
  },
  {
    name: 'Reni Port, Danube / Ukraine',
    lat: 45.4561,
    lon: 28.2778,
    theater: 'DONAU-HAFENKOMPLEX / RENI',
    aliases: ['reni', 'рені', 'рени'],
  },
  {
    name: 'Chornomorsk Port, Ukraine',
    lat: 46.3012,
    lon: 30.6567,
    theater: 'SCHWARZMEERKÜSTE / TSCHORNOMORSK',
    aliases: ['chornomorsk', 'ilichevsk', 'чорноморськ', 'черноморск'],
  },
  {
    name: 'Pivdennyi Port, Ukraine',
    lat: 46.6219,
    lon: 31.0261,
    theater: 'SCHWARZMEERKÜSTE / PIWDENNYJ',
    aliases: ['pivdennyi', 'yuzhne', 'південний', 'южне', 'южный'],
  },
  {
    name: 'Lviv, Ukraine',
    lat: 49.8397,
    lon: 24.0297,
    theater: 'WESTUKRAINE / LEMBERG',
    aliases: ['lviv', 'lemberg', 'львів', 'львов'],
  },
  {
    name: 'Kryvyi Rih, Ukraine',
    lat: 47.9105,
    lon: 33.3918,
    theater: 'ZENTRALUKRAINE / KRYWYJ RIH',
    aliases: ['kryvyi rih', 'krivoy rog', 'krywyj rih', 'кривий ріг', 'кривой рог'],
  },
  {
    name: 'Pokrovsk, Donbas',
    lat: 48.2825,
    lon: 37.1758,
    theater: 'DONBAS / POKROWSK SEKTOR',
    aliases: ['pokrovsk', 'pokrowsk', 'покровськ', 'покровск'],
  },
  {
    name: 'Kramatorsk, Donbas',
    lat: 48.7390,
    lon: 37.5838,
    theater: 'DONBAS / KRAMATORSK',
    aliases: ['kramatorsk', 'краматорськ', 'краматорск'],
  },
  {
    name: 'Chasiv Yar, Donbas',
    lat: 48.5889,
    lon: 37.8322,
    theater: 'DONBAS / TSCHASSIW JAR',
    aliases: ['chasiv yar', 'tschassiw jar', 'часов яр', 'часів яр'],
  },
  {
    name: 'Toretsk, Donbas',
    lat: 48.3975,
    lon: 37.8767,
    theater: 'DONBAS / TORETSK',
    aliases: ['toretsk', 'торецк', 'торецьк'],
  },
  {
    name: 'Kupiansk, Ukraine',
    lat: 49.7077,
    lon: 37.6169,
    theater: 'OSTUKRAINE / KUPJANSK',
    aliases: ['kupiansk', 'kupjansk', 'купʼянськ', 'купянск'],
  },
  {
    name: 'Vovchansk, Ukraine',
    lat: 50.2878,
    lon: 36.9389,
    theater: 'GRENZRAUM CHARKIW / WOWTSCHANSK',
    aliases: ['vovchansk', 'wowtschansk', 'волчанск', 'вовчанськ'],
  },
  {
    name: 'Sevastopol, Crimea',
    lat: 44.6167,
    lon: 33.5254,
    theater: 'KRIM / MARINESTÜTZPUNKT SEWASTOPOL',
    aliases: ['sevastopol', 'sewastopol', 'севастополь'],
  },
  {
    name: 'Kerch, Crimea',
    lat: 45.3562,
    lon: 36.4674,
    theater: 'KRIM / KERTSCH STRASSE',
    aliases: ['kerch', 'kertsch', 'керч', 'керчь'],
  },
  {
    name: 'Crimea (Krim)',
    lat: 45.3453,
    lon: 34.4997,
    theater: 'KRIM / HALBINSEL SEKTOR',
    aliases: ['crimea', 'krim', 'крим', 'крым'],
  },

  // --- Russian Border & Strategic Bases ---
  {
    name: 'Belgorod, Russia',
    lat: 50.5997,
    lon: 36.5982,
    theater: 'GRENZREGION BELGOROD',
    aliases: ['belgorod', 'бєлгород', 'белгород'],
  },
  {
    name: 'Kursk, Russia',
    lat: 51.7304,
    lon: 36.1927,
    theater: 'GRENZREGION KURSK',
    aliases: ['kursk', 'курськ', 'курск'],
  },
  {
    name: 'Sudzha, Kursk, Russia',
    lat: 51.1925,
    lon: 35.2714,
    theater: 'KURSK / SUDSCHA KNOTENPUNKT',
    aliases: ['sudzha', 'sudscha', 'суджа'],
  },
  {
    name: 'Shebekino, Belgorod, Russia',
    lat: 50.4111,
    lon: 36.8903,
    theater: 'BELGOROD / SCHEBEKINO',
    aliases: ['shebekino', 'schebekino', 'шебекино', 'шебекіно'],
  },
  {
    name: 'Voronezh, Russia',
    lat: 51.6755,
    lon: 39.2089,
    theater: 'WESTRUSSLAND / WORONESCH',
    aliases: ['voronezh', 'woronesch', 'воронеж'],
  },
  {
    name: 'Rostov-on-Don, Russia',
    lat: 47.2357,
    lon: 39.7015,
    theater: 'SÜDRUSSLAND / ROSTOW MILITÄRBEZIRK',
    aliases: ['rostov', 'rostow', 'ростов'],
  },
  {
    name: 'Engels Air Base, Russia',
    lat: 51.4828,
    lon: 46.2139,
    theater: 'STRATEGISCHE LUFTWAFFENBASIS ENGELS',
    aliases: ['engels', 'энгельс'],
  },
  {
    name: 'Moscow, Russia',
    lat: 55.7558,
    lon: 37.6173,
    theater: 'HAUPTSTADT-SEKTOR MOSKAU',
    aliases: ['moscow', 'moskau', 'москва'],
  },

  // --- Middle East / Nahost ---
  {
    name: 'Tel Aviv, Israel',
    lat: 32.0853,
    lon: 34.7818,
    theater: 'NAHOST / TEL AVIV KÜSTENMETROPOLE',
    aliases: ['tel aviv', 'tel-aviv', 'תל אביב', 'تل أبيب'],
  },
  {
    name: 'Jerusalem',
    lat: 31.7683,
    lon: 35.2137,
    theater: 'NAHOST / JERUSALEM',
    aliases: ['jerusalem', 'ירושלים', 'القدس'],
  },
  {
    name: 'Haifa, Israel',
    lat: 32.7940,
    lon: 34.9896,
    theater: 'NORDISRAEL / HAIFA HAFEN',
    aliases: ['haifa', 'חיפה', 'حيفا'],
  },
  {
    name: 'Gaza Strip',
    lat: 31.5017,
    lon: 34.4668,
    theater: 'NAHOST / GAZA-STREIFEN',
    aliases: ['gaza', 'gazastreifen', 'עזה', 'غزة'],
  },
  {
    name: 'Rafah, Gaza',
    lat: 31.2968,
    lon: 34.2435,
    theater: 'SÜD-GAZA / RAFAH GRENZÜBERGANG',
    aliases: ['rafah', 'רפיח', 'رفح'],
  },
  {
    name: 'Beirut, Lebanon',
    lat: 33.8938,
    lon: 35.5018,
    theater: 'LIBANON / BEIRUT METROPOLREGION',
    aliases: ['beirut', 'بيروت', 'ביירות'],
  },
  {
    name: 'Damascus, Syria',
    lat: 33.5138,
    lon: 36.2765,
    theater: 'SYRIEN / DAMASKUS',
    aliases: ['damascus', 'damaskus', 'دمشق'],
  },
  {
    name: 'Tehran, Iran',
    lat: 35.6892,
    lon: 51.3890,
    theater: 'IRAN / TEHERAN HAUPTSTADT',
    aliases: ['tehran', 'teheran', 'تهران'],
  },
  {
    name: 'Isfahan, Iran',
    lat: 32.6546,
    lon: 51.6680,
    theater: 'IRAN / ISFAHAN STRATEGISCHE ANLAGEN',
    aliases: ['isfahan', 'esfahan', 'اصفهان'],
  },
  {
    name: 'Red Sea / Rotes Meer',
    lat: 20.0000,
    lon: 38.5000,
    theater: 'MARITIMER TRANSITKORRIDOR ROTES MEER',
    aliases: ['red sea', 'rotes meer', 'البحر الأحمر'],
  },
  {
    name: 'Bab-el-Mandeb Strait',
    lat: 12.5833,
    lon: 43.3333,
    theater: 'STRATEGISCHE MEERENGE BAB-AL-MANDAB',
    aliases: ['bab el mandeb', 'bab-el-mandeb', 'bab al-mandab'],
  },

  // --- Swiss Reference Nodes ---
  {
    name: 'Diepoldsau, Rheintal, Schweiz',
    lat: 47.3833,
    lon: 9.6500,
    theater: 'ALPENRHEINTAL / GRENZSEKTOR SCHWEIZ-ÖSTERREICH',
    aliases: ['diepoldsau'],
  },
  {
    name: 'Zürich, Schweiz',
    lat: 47.3769,
    lon: 8.5417,
    theater: 'SCHWEIZ / ZÜRICH METROPOLREGION',
    aliases: ['zurich', 'zürich'],
  },
  {
    name: 'Genf, Schweiz',
    lat: 46.2044,
    lon: 6.1432,
    theater: 'SCHWEIZ / GENF INTEL HUB',
    aliases: ['geneva', 'genf', 'genève'],
  },
];

function makePattern(regexStr) {
  return new RegExp(`(^|[^\\p{L}\\p{N}])(?:${regexStr})([^\\p{L}\\p{N}]|$)`, 'iu');
}

/** Weapon system regex patterns and normalized tags */
export const WEAPON_PATTERNS = [
  {
    regex: makePattern('naval strike|military ship|warship|navy|corvette|frigate|carrier|destroyer|patrol boat|sea drone|usv|magura|sea baby|морськ(?:ий|і) дрон|корабл(?:ь|я|і)|катер|военный корабль|морской бой'),
    weapon: 'Naval Combat / Maritime Strike',
    category: 'SEEGEFECHT',
    impactRadiusM: 25000,
    severity: 'CRITICAL',
  },
  {
    regex: makePattern('shahed(?:-?136|-?131)?|geran(?:-?2)?|шахед(?:и|ів)?|герань(?:-?2)?'),
    weapon: 'Shahed-136 / Geran-2 Kamikaze UAV',
    category: 'DROHNENANGRIFF',
    impactRadiusM: 2500,
    severity: 'CRITICAL',
  },
  {
    regex: makePattern('fpv[- ]drone|fpv[- ]drohne|fpv[- ]дрон'),
    weapon: 'FPV Strike Drone',
    category: 'DROHNENANGRIFF',
    impactRadiusM: 1200,
    severity: 'SEVERE',
  },
  {
    regex: makePattern('lancet|ланцет'),
    weapon: 'Lancet Kamikaze Drone',
    category: 'DROHNENANGRIFF',
    impactRadiusM: 1500,
    severity: 'SEVERE',
  },
  {
    regex: makePattern('patriot|nasams|iris-t|gepard|сбито|збито|shot down|intercepted|ппо|air defense|flugabwehr'),
    weapon: 'Integrated Air Defense (SAM Interception)',
    category: 'LUFTABWEHR',
    impactRadiusM: 2000,
    severity: 'MODERATE',
  },
  {
    regex: makePattern('uav|drone|drohne|бпла|bpla'),
    weapon: 'Unmanned Aerial Vehicle (UAV)',
    category: 'DROHNENANGRIFF',
    impactRadiusM: 2000,
    severity: 'SEVERE',
  },
  {
    regex: makePattern('iskander(?:-m|-k)?|искандер(?:-м)?'),
    weapon: 'Iskander-M Quasi-Ballistic Missile',
    category: 'RAKETENANGRIFF',
    impactRadiusM: 4500,
    severity: 'CRITICAL',
  },
  {
    regex: makePattern('kinzhal|кинжал|kh-47m2'),
    weapon: 'Kh-47M2 Kinzhal Hypersonic Missile',
    category: 'RAKETENANGRIFF',
    impactRadiusM: 5000,
    severity: 'CRITICAL',
  },
  {
    regex: makePattern('kalibr|калибр|калібр'),
    weapon: 'Kalibr Submarine/Ship-Launched Cruise Missile',
    category: 'RAKETENANGRIFF',
    impactRadiusM: 3500,
    severity: 'CRITICAL',
  },
  {
    regex: makePattern('kh-101|х-101|kh-555|х-555'),
    weapon: 'Kh-101 Strategic Air-Launched Cruise Missile',
    category: 'RAKETENANGRIFF',
    impactRadiusM: 4000,
    severity: 'CRITICAL',
  },
  {
    regex: makePattern('kab|каб|fab[- ]?\\d+|фаб[- ]?\\d+|glide bomb|gleitbombe'),
    weapon: 'Guided Glide Bomb (KAB/FAB-UMPK)',
    category: 'RAKETENANGRIFF',
    impactRadiusM: 3000,
    severity: 'CRITICAL',
  },
  {
    regex: makePattern('ballistic|баллистик[ае]|балістик[ае]'),
    weapon: 'Tactical Ballistic Missile',
    category: 'RAKETENANGRIFF',
    impactRadiusM: 4000,
    severity: 'CRITICAL',
  },
  {
    regex: makePattern('cruise missile|marschflugkörper|крылат(?:ая|ые) ракет[аы]|крилат(?:а|і) ракет[иа]'),
    weapon: 'Cruise Missile Strike',
    category: 'RAKETENANGRIFF',
    impactRadiusM: 3500,
    severity: 'CRITICAL',
  },
  {
    regex: makePattern('air raid|luftalarm|alarm|тревога|тривога|siren|sirene'),
    weapon: 'Tactical Air Raid Alert',
    category: 'LUFTALARM',
    impactRadiusM: 5000,
    severity: 'SEVERE',
  },
  {
    regex: makePattern('artillery|artillerie|shelling|beschuss|обстрел|обстріл|grad|hIMARS|mlrs'),
    weapon: 'Artillery / MLRS Rocket Fire',
    category: 'GEFECHT',
    impactRadiusM: 2500,
    severity: 'SEVERE',
  },
];

/** Regex to detect explicit coordinates like 50.0038, 36.2304 */
const COORD_REGEX = /\b([+-]?\d{1,2}\.\d{3,7})[,\s/]+([+-]?\d{1,3}\.\d{3,7})\b/;

/**
 * Matches gazetteer location in given text.
 * @param {string} text
 * @returns {object|null}
 */
export function matchGazetteerLocation(text) {
  if (!text || typeof text !== 'string') return null;
  const lower = text.toLowerCase();

  for (const entry of OSINT_GAZETTEER) {
    for (const alias of entry.aliases) {
      // Word boundary check (supports cyrillic boundary or standard \b)
      const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])${alias}([^\\p{L}\\p{N}]|$)`, 'iu');
      if (pattern.test(lower)) {
        return entry;
      }
    }
  }
  return null;
}

/**
 * Matches weapon system and category in given text.
 * @param {string} text
 * @returns {object}
 */
export function matchWeaponSystem(text) {
  if (!text || typeof text !== 'string') {
    return {
      weapon: 'OSINT Dispatch',
      category: 'OSINT_NEWS',
      impactRadiusM: 2000,
      severity: 'INFO',
    };
  }

  for (const pat of WEAPON_PATTERNS) {
    if (pat.regex.test(text)) {
      return {
        weapon: pat.weapon,
        category: pat.category,
        impactRadiusM: pat.impactRadiusM,
        severity: pat.severity,
      };
    }
  }

  return {
    weapon: 'OSINT Dispatch',
    category: 'OSINT_NEWS',
    impactRadiusM: 2000,
    severity: 'INFO',
  };
}

/**
 * Translates military OSINT dispatches (Ukrainian, Russian) into natural German or English.
 * @param {string} text
 * @param {'de'|'en'} [targetLang='de']
 * @returns {string}
 */
export function translateSlavicOsintText(text, targetLang = 'de') {
  if (!text || typeof text !== 'string') return '';
  const isDe = targetLang === 'de';
  let s = text;

  const translations = [
    // Phrases & Multi-word units
    [/по\s*шахедах/gi, isDe ? 'gegen Shahed-Drohnen' : 'against Shahed drones'],
    [/реактивн[іи]й?\s*бпла/gi, isDe ? 'reaktive Drohne(n)' : 'jet-powered UAV(s)'],
    [/реактивний\s*бпла/gi, isDe ? 'reaktive Drohne' : 'jet-powered UAV'],
    [/ударн(?:их|і|ого|ому|им|ими)?\s*бпла/gi, isDe ? 'Angriffsdrohnen' : 'strike UAVs'],
    [/розвідувальн(?:их|і|ого|ому|им|ими)?\s*бпла/gi, isDe ? 'Aufklärungsdrohnen' : 'reconnaissance UAVs'],
    [/бпла\s*типу\s*["“«]?shahed["”»]?/gi, isDe ? 'Shahed-Drohnen' : 'Shahed UAVs'],
    [/бпла\s*типу\s*["“«]?шахед["”»]?/gi, isDe ? 'Shahed-Drohnen' : 'Shahed UAVs'],
    [/шахед(?:ів|и|ами|ам)?/gi, isDe ? 'Shahed-Drohnen' : 'Shahed drones'],
    [/бпла/gi, isDe ? 'Drohnen' : 'UAVs'],

    // Tactical Actions & Alerts
    [/працює\s*ппо/gi, isDe ? 'Flugabwehr im Einsatz' : 'air defense active'],
    [/робота\s*ппо/gi, isDe ? 'Flugabwehreinsatz' : 'air defense engagement'],
    [/повітряна\s*тривога/gi, isDe ? 'Luftalarm' : 'air raid alert'],
    [/відбій\s*тривоги/gi, isDe ? 'Entwarnung' : 'all clear'],
    [/відбій/gi, isDe ? 'Entwarnung' : 'all clear'],
    [/загроза\s*застосування/gi, isDe ? 'Einsatzgefahr' : 'threat of use'],
    [/швидкісна\s*ціль/gi, isDe ? 'Hochgeschwindigkeitsziel' : 'high-speed target'],
    [/балістична\s*загроза/gi, isDe ? 'Ballistische Bedrohung' : 'ballistic missile threat'],
    [/балістика/gi, isDe ? 'Ballistische Rakete' : 'ballistic missile'],
    [/керован[іа]\s*авіабомб[аи]/gi, isDe ? 'Gelenkte Fliegerbombe (KAB)' : 'guided aerial bomb (KAB)'],
    [/каб(?:и|ів)?/gi, isDe ? 'Gleitbomben (KAB)' : 'glide bombs (KAB)'],
    [/крилат[аі]\s*ракет[аи]/gi, isDe ? 'Marschflugkörper' : 'cruise missiles'],
    [/ракетн(?:а|ий|і)\s*удар/gi, isDe ? 'Raketenangriff' : 'missile strike'],
    [/ракета/gi, isDe ? 'Rakete' : 'missile'],
    [/ракети/gi, isDe ? 'Raketen' : 'missiles'],
    [/чутно\s*вибухи/gi, isDe ? 'Explosionen gemeldet' : 'explosions reported'],
    [/вибухи/gi, isDe ? 'Explosionen' : 'explosions'],
    [/повторні\s*пуски/gi, isDe ? 'erneute Starts' : 'repeated launches'],
    [/руйнування/gi, isDe ? 'Zerstörungen' : 'destruction'],
    [/пожежа/gi, isDe ? 'Brand' : 'fire'],
    [/без\s*потерпілих/gi, isDe ? 'keine Verletzten' : 'no casualties'],
    [/наслідки\s*уточнюються/gi, isDe ? 'Folgen werden ermittelt' : 'damage being assessed'],

    // Directions & Movement
    [/на\s*одесу\s*з\s*півночі/gi, isDe ? 'auf Odessa von Norden' : 'towards Odesa from north'],
    [/в\s*напрямку/gi, isDe ? 'in Richtung' : 'towards'],
    [/у\s*напрямку/gi, isDe ? 'in Richtung' : 'towards'],
    [/в\s*бік/gi, isDe ? 'in Richtung' : 'towards'],
    [/у\s*бік/gi, isDe ? 'in Richtung' : 'towards'],
    [/курс\s*на/gi, isDe ? 'Kurs auf' : 'heading to'],
    [/з\s*півночі/gi, isDe ? 'von Norden' : 'from the north'],
    [/з\s*півдня/gi, isDe ? 'von Süden' : 'from the south'],
    [/зі\s*сходу/gi, isDe ? 'von Osten' : 'from the east'],
    [/з\s*заходу/gi, isDe ? 'von Westen' : 'from the west'],
    [/у\s*передмісті/gi, isDe ? 'im Vorort' : 'in the suburbs of'],
    [/група/gi, isDe ? 'Gruppe' : 'group'],
    [/акваторі[яії]\s*чорного\s*моря/gi, isDe ? 'Schwarzmeer-Gewässer' : 'Black Sea waters'],
    [/чорного\s*моря/gi, isDe ? 'des Schwarzen Meeres' : 'the Black Sea'],
    [/з\s*акваторії/gi, isDe ? 'aus dem Seegebiet' : 'from the maritime area'],

    // Strategic Regions & Hubs
    [/з\s*черкащини/gi, isDe ? 'aus der Region Tscherkassy' : 'from Cherkasy region'],
    [/черкащин[иа]/gi, isDe ? 'Region Tscherkassy' : 'Cherkasy region'],
    [/з\s*київщини/gi, isDe ? 'aus der Region Kiew' : 'from Kyiv region'],
    [/київщин[иа]/gi, isDe ? 'Region Kiew' : 'Kyiv region'],
    [/з\s*харківщини/gi, isDe ? 'aus der Region Charkiw' : 'from Kharkiv region'],
    [/харківщин[иа]/gi, isDe ? 'Region Charkiw' : 'Kharkiv region'],
    [/з\s*сумщини/gi, isDe ? 'aus der Region Sumy' : 'from Sumy region'],
    [/сумщин[иа]/gi, isDe ? 'Region Sumy' : 'Sumy region'],
    [/з\s*полтавщини/gi, isDe ? 'aus der Region Poltawa' : 'from Poltava region'],
    [/полтавщин[иа]/gi, isDe ? 'Region Poltawa' : 'Poltava region'],
    [/на\s*одесу/gi, isDe ? 'auf Odessa' : 'towards Odesa'],
    [/на\s*київ/gi, isDe ? 'auf Kiew' : 'towards Kyiv'],
    [/на\s*дніпро/gi, isDe ? 'auf Dnipro' : 'towards Dnipro'],
    [/на\s*харків/gi, isDe ? 'auf Charkiw' : 'towards Kharkiv'],
    [/переяслав/gi, isDe ? 'Perejaslaw' : 'Pereyaslav'],
    [/очаків/gi, isDe ? 'Ochakiv' : 'Ochakiv'],
    [/миргород/gi, isDe ? 'Myrhorod' : 'Myrhorod'],
    [/кременчук/gi, isDe ? 'Kremenchuk' : 'Kremenchuk'],
    [/старокостянтинів/gi, isDe ? 'Starokostiantyniv' : 'Starokostiantyniv'],
    [/чабани/gi, isDe ? 'Chabany' : 'Chabany'],
    [/умань/gi, isDe ? 'Uman' : 'Uman'],
    [/затока/gi, isDe ? 'Zatoka' : 'Zatoka'],
  ];

  for (const [pattern, replacement] of translations) {
    s = s.replace(pattern, replacement);
  }

  return s.replace(/(^|[.!?]\s+)([a-zäöü])/g, (m, p1, p2) => p1 + p2.toUpperCase()).trim();
}

/**
 * Parses raw text or a Telegram post into a structured tactical record.
 * @param {object|string} item - Raw text or message object {id, text, channel, timestamp, mediaUrl, messageUrl}
 * @returns {object|null} Structured tactical intelligence record
 */
export function geoparseOsintMessage(item) {
  if (!item) return null;

  const rawText = typeof item === 'string' ? item : item.text || '';
  if (!rawText || rawText.trim().length < 5) return null;

  const id = item.id || `osint-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const channel = item.channel || 'Telegram OSINT';
  const timestamp = item.timestamp || new Date().toISOString();
  const mediaUrl = item.mediaUrl || null;
  const messageUrl = item.messageUrl || null;

  // 1. Check for explicit coordinates in text
  let lat = null;
  let lon = null;
  const coordMatch = rawText.match(COORD_REGEX);
  if (coordMatch) {
    const parsedLat = Number.parseFloat(coordMatch[1]);
    const parsedLon = Number.parseFloat(coordMatch[2]);
    if (Number.isFinite(parsedLat) && Number.isFinite(parsedLon) &&
        parsedLat >= -90 && parsedLat <= 90 && parsedLon >= -180 && parsedLon <= 180) {
      lat = parsedLat;
      lon = parsedLon;
    }
  }

  // 2. Match location in gazetteer
  const locEntry = matchGazetteerLocation(rawText);

  if (!lat && locEntry) {
    lat = locEntry.lat;
    lon = locEntry.lon;
  }

  // If no location could be determined, we can't place it on the 3D globe
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null;
  }

  const locationName = locEntry ? locEntry.name : `Sektor ${lat.toFixed(4)}°N, ${lon.toFixed(4)}°E`;
  const theater = locEntry ? locEntry.theater : 'OPERATIVER KONFLIKTRAUM';

  // 3. Match weapon system and operational category
  const weaponMatch = matchWeaponSystem(rawText);

  // Extract drone swarm size if present (e.g. "161 ударним БпЛА", "атакував 161", "161 Shahed", "12 drones")
  let swarmCount = null;
  const droneCountMatch = rawText.match(/(?:атакував|запустив|випустив|випущено|атака|attacked with|launched)\s*(\d{1,4})\s*(?:ударн\w*|камікадзе|kamikaze|бпла|bpla|shahed|шахед|dron|drohn)?/i) ||
                          rawText.match(/(\d{1,4})\s*(?:ударними?|kamikaze)?\s*(?:бпла|bpla|shahed|shahed-136|шахед|drones?|drohnen)/i);
  if (droneCountMatch) {
    const parsedCount = parseInt(droneCountMatch[1], 10);
    if (parsedCount > 1 && parsedCount <= 1000) {
      swarmCount = parsedCount;
    }
  }

  // Dynamic tactical impact radius scaling:
  // Large drone swarms (Shahed, kamikaze UAVs) cover wide territorial sectors (35km - 65km), not a tiny 2km dot!
  let impactRadiusM = weaponMatch.impactRadiusM;
  if (weaponMatch.category === 'DROHNENANGRIFF') {
    if (swarmCount && swarmCount >= 10) {
      impactRadiusM = Math.min(65000, 30000 + swarmCount * 220);
    } else if (String(weaponMatch.weapon).toLowerCase().includes('shahed') || rawText.toLowerCase().includes('shahed') || rawText.toLowerCase().includes('шахед')) {
      impactRadiusM = 40000; // 40 km standard Shahed strike operational sector
    } else {
      impactRadiusM = Math.max(20000, impactRadiusM || 20000);
    }
  } else if (weaponMatch.category === 'RAKETENANGRIFF') {
    impactRadiusM = Math.max(30000, impactRadiusM || 30000); // 30 km missile operational sector
  } else if (weaponMatch.category === 'LUFTALARM') {
    impactRadiusM = Math.max(35000, impactRadiusM || 35000);
  } else if (weaponMatch.category === 'SEEGEFECHT') {
    impactRadiusM = Math.max(25000, impactRadiusM || 25000);
  }

  // 4. Generate clean, high-impact English headline & summary
  let title = '';
  if (weaponMatch.category === 'DROHNENANGRIFF') {
    title = swarmCount
      ? `Drone Swarm (${swarmCount} UAVs): ${locationName.split(',')[0]}`
      : `Drone Activity: ${locationName.split(',')[0]}`;
  } else if (weaponMatch.category === 'RAKETENANGRIFF') {
    title = `Missile Strike: ${locationName.split(',')[0]}`;
  } else if (weaponMatch.category === 'SEEGEFECHT') {
    title = `Naval Strike: ${locationName.split(',')[0]}`;
  } else if (weaponMatch.category === 'LUFTALARM') {
    title = `Air Raid Alert: ${locationName.split(',')[0]}`;
  } else if (weaponMatch.category === 'LUFTABWEHR') {
    title = `Air Defense Active: ${locationName.split(',')[0]}`;
  } else {
    title = `OSINT Dispatch: ${locationName.split(',')[0]}`;
  }

  const cleanText = rawText.replace(/\s+/g, ' ').trim();
  const summarySnippet = cleanText.length > 240 ? `${cleanText.slice(0, 237)}...` : cleanText;
  const translatedDe = translateSlavicOsintText(cleanText, 'de');
  const translatedEn = translateSlavicOsintText(cleanText, 'en');
  const summaryDe = translatedDe.length > 240 ? `${translatedDe.slice(0, 237)}...` : translatedDe;
  const summaryEn = translatedEn.length > 240 ? `${translatedEn.slice(0, 237)}...` : translatedEn;

  return {
    id,
    channel,
    title,
    locationName,
    theater,
    latitude: lat,
    longitude: lon,
    altitude: 200,
    impactRadiusM,
    category: weaponMatch.category,
    severity: weaponMatch.severity,
    weaponSystem: weaponMatch.weapon,
    isNaval: weaponMatch.category === 'SEEGEFECHT',
    summary: summarySnippet,
    summaryDe,
    summaryEn,
    detailsDe: translatedDe,
    detailsEn: translatedEn,
    originalText: cleanText,
    timestamp,
    mediaUrl,
    messageUrl,
    source: `OSINT [${channel.toUpperCase()}]`,
    isLiveOsint: true,
  };
}

/**
 * Batch parses an array of OSINT messages. Skips messages that have no geographic match.
 * @param {Array<object>} messages
 * @returns {Array<object>} Geoparsed tactical records
 */
export function geoparseOsintBatch(messages) {
  if (!Array.isArray(messages)) return [];
  const results = [];
  for (const msg of messages) {
    const parsed = geoparseOsintMessage(msg);
    if (parsed) {
      results.push(parsed);
    }
  }
  return results;
}

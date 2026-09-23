/**
 * @module militaryConflictEngine
 *
 * Tactical datasets, vector geometry, and live normalization for 5 dedicated military layers:
 * 1. Active Conflict Zones ('conflicts')
 * 2. Frontlines & Lines of Control ('frontlines')
 * 3. Missile & Drone Strikes ('missile-strikes')
 * 4. Ground Battles & Clashes ('battles')
 * 5. Airstrikes, Glide Bombs & Heavy Bombardments ('bombardments')
 */

import * as Cesium from 'cesium';

// --- 1. ACTIVE CONFLICT ZONES (HIGH-FIDELITY THEATER POLYGONS) ---
export const SEED_CONFLICT_ZONES = [
  {
    id: 'cz-ukraine-war',
    category: 'conflicts',
    name: 'Russisch-Ukrainischer Krieg (Kriegsschauplatz Osteuropa)',
    region: 'Osteuropa / Ukraine',
    status: 'AKTIVER KRIEG // HOHE INTENSITÄT',
    belligerents: 'Ukraine (ZSU) vs. Streitkräfte der Russischen Föderation',
    intensity: 'CRITICAL',
    center: { lat: 48.5, lon: 36.5 },
    polygon: [
      [31.2, 51.9], [33.2, 52.3], [35.1, 51.5], [37.2, 50.8], [38.6, 50.2],
      [39.8, 49.5], [40.2, 48.6], [39.7, 47.4], [38.5, 46.8], [36.8, 46.2],
      [35.1, 45.8], [33.6, 46.1], [32.2, 46.6], [31.5, 47.4], [30.8, 48.5],
      [30.2, 50.1], [31.2, 51.9]
    ],
    summary: 'Großflächiger zwischenstaatlicher Land-, Luft- und Drohnenkrieg entlang einer 1.200 km Frontlinie. Massive Gleitbomben-, Artillerie- und Marschflugkörperangriffe.'
  },
  {
    id: 'cz-middle-east-multifront',
    category: 'conflicts',
    name: 'Nahost-Krieg (Mehrfronten-Konflikt)',
    region: 'Naher Osten (Israel, Libanon, Syrien, Iran, Jemen)',
    status: 'AKTIVER MEHRFRONTENKRIEG // REGIONALE ESKALATION',
    belligerents: 'Israel (IDF) & US-Koalition vs. Iranische Achse des Widerstands (Hisbollah, Hamas, Houthis, IRGC)',
    intensity: 'CRITICAL',
    center: { lat: 33.2, lon: 36.0 },
    polygon: [
      [34.1, 31.0], [35.5, 31.0], [36.5, 32.5], [36.8, 34.2], [36.1, 34.8],
      [35.1, 34.2], [34.8, 33.0], [34.1, 31.0]
    ],
    summary: 'Offensive Boden- und Luftoperationen im Südlibanon, Raketenfeuer auf Zentralisrael, Präzisionsschläge im Iran und Syrien sowie maritime Blockade im Roten Meer.'
  },
  {
    id: 'cz-gaza-strip',
    category: 'conflicts',
    name: 'Gazastreifen Militäroperation',
    region: 'Naher Osten / Gazastreifen',
    status: 'AKTIVER KRIEG // URBANER KAMPF & KORRIDORE',
    belligerents: 'IDF vs. Hamas / Islamischer Dschihad',
    intensity: 'CRITICAL',
    center: { lat: 31.42, lon: 34.38 },
    polygon: [
      [34.22, 31.30], [34.35, 31.22], [34.54, 31.52], [34.58, 31.58],
      [34.45, 31.60], [34.22, 31.30]
    ],
    summary: 'Dicht besiedelter urbaner Einsatzraum mit Korridorkontrolle (Netzarim, Philadelphi), Tunnelsystemen und gezielten Luftschlägen.'
  },
  {
    id: 'cz-red-sea-yemen',
    category: 'conflicts',
    name: 'Rotes Meer & Golf von Aden Seekampagne',
    region: 'Naher Osten / Bab al-Mandab',
    status: 'SEE- & MARITIMER DROHNENKRIEG',
    belligerents: 'Houthi-Miliz vs. US/UK Operation Prosperity Guardian & Handelsschifffahrt',
    intensity: 'SEVERE',
    center: { lat: 14.5, lon: 42.8 },
    polygon: [
      [42.0, 12.5], [44.0, 11.8], [45.5, 12.8], [44.5, 15.2], [42.8, 16.5],
      [41.5, 15.8], [41.2, 14.2], [42.0, 12.5]
    ],
    summary: 'Anti-Schiff-Raketen, Kamikaze-Überwasserdrohnen (USV) und US/UK-Vergeltungsschläge auf Raketenabschussstellungen und Häfen.'
  },
  {
    id: 'cz-sudan-civil-war',
    category: 'conflicts',
    name: 'Sudan Bürgerkrieg (Khartum & Darfur)',
    region: 'Ostafrika / Sahel',
    status: 'BÜRGERKRIEG // BELAGERUNG',
    belligerents: 'SAF (Regierungsarmee) vs. RSF (Rapid Support Forces)',
    intensity: 'SEVERE',
    center: { lat: 14.2, lon: 28.5 },
    polygon: [
      [23.5, 12.0], [28.0, 11.5], [32.5, 12.0], [33.8, 15.8], [32.0, 17.2],
      [26.0, 18.0], [23.5, 12.0]
    ],
    summary: 'Schwere Kämpfe um Provinzhauptstädte (El Fasher, Khartum), Artilleriebeschuss, Hungerblockaden und ethnische Säuberungen.'
  },
  {
    id: 'cz-myanmar-civil-war',
    category: 'conflicts',
    name: 'Myanmar Bürgerkrieg (Operation 1027)',
    region: 'Südostasien / Myanmar',
    status: 'BEWAFFNETER AUFSTAND // REBELLENOFFENSIVE',
    belligerents: 'Militärjunta (Tatmadaw) vs. Drei-Bruderschaften-Allianz & PDF',
    intensity: 'SEVERE',
    center: { lat: 22.0, lon: 96.5 },
    polygon: [
      [94.5, 19.5], [97.5, 19.8], [99.2, 21.5], [99.8, 24.2], [96.5, 24.8],
      [94.8, 23.2], [94.5, 19.5]
    ],
    summary: 'Koalition ethnischer Rebellenarmeen kontrolliert Grenzhandelsrouten nach China und regionale Militärhauptquartiere.'
  },
  {
    id: 'cz-taiwan-strait-tension',
    category: 'conflicts',
    name: 'Taiwanstraße & ADIZ-Militärpräsenz',
    region: 'Ostasien / Pazifik',
    status: 'HOHE MILITÄRISCHE TENSION // BLOCKADESIMULATION',
    belligerents: 'Taiwan (ROK) vs. China (PLA / Ost-Kommando)',
    intensity: 'HIGH',
    center: { lat: 24.0, lon: 120.0 },
    polygon: [
      [118.0, 22.0], [121.5, 21.5], [123.0, 25.0], [120.5, 26.5], [118.5, 24.5], [118.0, 22.0]
    ],
    summary: 'Permanente Überflüge der Medianlinie durch J-20 und J-16 Jets, Marine-Umzingelungsübungen und amphibische Bereitschaft.'
  },
  {
    id: 'cz-korean-dmz',
    category: 'conflicts',
    name: 'Koreanische Demilitarisierte Zone (DMZ)',
    region: 'Ostasien / Koreanische Halbinsel',
    status: 'BEFESTIGTER WAFFENSTILLSTAND // HOHE ALARMBEREITSCHAFT',
    belligerents: 'Südkorea (ROK / USFK) vs. Nordkorea (KPA)',
    intensity: 'HIGH',
    center: { lat: 38.0, lon: 127.0 },
    polygon: [
      [126.0, 37.8], [127.5, 38.1], [128.8, 38.6], [128.5, 38.8], [127.0, 38.3], [125.8, 38.0], [126.0, 37.8]
    ],
    summary: 'Stark verminte Demarkationslinie mit massiver Artillerie- und Raketenkonzentration beiderseits des 38. Breitengrads.'
  }
];

// --- 2. TACTICAL FRONTLINES & CONTACT CORRIDORS ---
export const SEED_FRONTLINES = [
  {
    id: 'fl-ukraine-donbass-pokrovsk',
    category: 'frontlines',
    name: 'Pokrowsk - Torezk - Tschassiw Jar Frontabschnitt',
    theater: 'Ostukraine / Donezk',
    type: 'Befestigte Hauptkampflinie (HKL)',
    status: 'SCHWERE DURCHBRUCHSVERSUCHE // HOCHFREQUENT',
    color: '#ff2222',
    glowColor: '#ff8800',
    segments: [
      {
        name: 'Pokrowsk - Myrnohrad Vorfeld',
        coords: [
          [37.10, 48.20], [37.18, 48.24], [37.28, 48.29], [37.38, 48.33]
        ]
      },
      {
        name: 'Torezk - Niu York Stadtsektor',
        coords: [
          [37.40, 48.34], [37.52, 48.38], [37.65, 48.42], [37.85, 48.40]
        ]
      },
      {
        name: 'Tschassiw Jar Kanalabschnitt',
        coords: [
          [37.85, 48.40], [37.88, 48.52], [37.84, 48.59], [37.82, 48.65]
        ]
      },
      {
        name: 'Siversk Kreminna Waldkorridor',
        coords: [
          [37.82, 48.65], [38.02, 48.85], [38.15, 48.95], [38.25, 49.05]
        ]
      }
    ]
  },
  {
    id: 'fl-ukraine-kursk-salient',
    category: 'frontlines',
    name: 'Kursk Frontbogen (Sudzha - Korenevo)',
    theater: 'Russland / Kursk Oblast',
    type: 'Dynamische Manöver-Frontlinie',
    status: 'GEGENOFFENSIVEN & FLANKENKÄMPFE',
    color: '#00e5ff',
    glowColor: '#ffffff',
    segments: [
      {
        name: 'Korenevo Westflanke',
        coords: [
          [34.80, 51.45], [34.92, 51.41], [35.05, 51.35]
        ]
      },
      {
        name: 'Sudzha Brückenkopf',
        coords: [
          [35.05, 51.35], [35.25, 51.20], [35.40, 51.15], [35.28, 51.05]
        ]
      }
    ]
  },
  {
    id: 'fl-ukraine-southern-axis',
    category: 'frontlines',
    name: 'Südfront Saporischschja & Dnipro',
    theater: 'Südukraine / Saporischschja & Cherson',
    type: 'Tiefgestaffelte Surovikin-Verteidigungslinie',
    status: 'STELLUNGSKRIEG & FLUSSVERTEIDIGUNG',
    color: '#ff9100',
    glowColor: '#ffea00',
    segments: [
      {
        name: 'Robotyne - Verbove Sektor',
        coords: [
          [35.70, 47.42], [35.85, 47.45], [36.00, 47.46], [36.15, 47.48]
        ]
      },
      {
        name: 'Wuhledar - Kurachowe Riegel',
        coords: [
          [36.80, 47.75], [37.05, 47.80], [37.25, 47.85], [37.40, 47.95]
        ]
      },
      {
        name: 'Dnipro Flussbarriere Krynky',
        coords: [
          [32.80, 46.70], [33.10, 46.75], [33.40, 46.85]
        ]
      }
    ]
  },
  {
    id: 'fl-israel-lebanon-blueline',
    category: 'frontlines',
    name: 'Blaue Linie & Litani Pufferzone',
    theater: 'Südlibanon / Galiläa',
    type: 'UN-Demarkationslinie & Vorrückungskorridor',
    status: 'AKTIVE INVASIONS- & VERTEIDIGUNGSZONE',
    color: '#e53935',
    glowColor: '#ff7777',
    segments: [
      {
        name: 'Westsektor Rosh HaNikra - Ayta ash Shab',
        coords: [
          [35.10, 33.09], [35.22, 33.10], [35.33, 33.11]
        ]
      },
      {
        name: 'Zentralsektor Maroun al Ras - Bint Jbeil',
        coords: [
          [35.33, 33.11], [35.45, 33.13], [35.55, 33.15]
        ]
      },
      {
        name: 'Ostsektor Metula - Khiam - Hermon',
        coords: [
          [35.55, 33.15], [35.62, 33.28], [35.75, 33.32]
        ]
      }
    ]
  },
  {
    id: 'fl-gaza-netzarim-philadelphi',
    category: 'frontlines',
    name: 'Gaza Sicherheitskorridore (Netzarim & Philadelphi)',
    theater: 'Gazastreifen',
    type: 'Militärische Trenn- und Grenzkorridore',
    status: 'VERRIEGELT DURCH IDF-POSTEN',
    color: '#ffd600',
    glowColor: '#ff8800',
    segments: [
      {
        name: 'Netzarim-Korridor (Teilung Nord-Süd)',
        coords: [
          [34.40, 31.47], [34.46, 31.47], [34.52, 31.46]
        ]
      },
      {
        name: 'Philadelphi-Korridor (Ägypten-Grenze)',
        coords: [
          [34.22, 31.28], [34.28, 31.24], [34.35, 31.22]
        ]
      }
    ]
  }
];

// --- 3. MISSILE & DRONE STRIKES ---
export const SEED_MISSILE_STRIKES = [
  {
    id: 'ms-kyiv-kinzhal',
    category: 'missile-strikes',
    title: 'Kh-47M2 Kinzhal Aeroballistischer Schlag auf Kiew',
    weaponType: 'Kh-47M2 Kinzhal Hyperschallrakete (MiG-31K)',
    theater: 'Zentralukraine / Kiew',
    launchOrigin: { lat: 55.4, lon: 42.3, name: 'Savasleyka Luftwaffenbasis, RU' },
    target: { lat: 50.4501, lon: 30.5234, name: 'Kiew Energie- und Regierungssektor' },
    status: 'PATRIOT PAC-3 ABFANGMANÖVER // TRÜMMERABSTURZ',
    interceptionReported: true,
    severity: 'CRITICAL',
    blastRadiusM: 1800,
    timestamp: '2026-09-21T05:14:00Z',
    summary: 'Aeroballistische Mach-10 Hyperschallrakete durch MIM-104 Patriot PAC-3 CRI über dem Kiewer Stadtgebiet abgefangen. Sekundärschäden durch Trümmerfall.',
    impactPoints: [
      {
        id: 'crater-kyiv-kinzhal-1',
        name: 'Gefechtskopf-Trümmerkrater (Kiew Schewtschenko-Park)',
        lat: 50.45014,
        lon: 30.52342,
        ordnance: 'Kh-47M2 Kinzhal 500kg Gefechtskopf-Fragment',
        craterDiameterM: 12,
        damageStatus: 'BODENDETONATION // TIEFER KRATER IM PARKPLATZ'
      },
      {
        id: 'crater-kyiv-kinzhal-2',
        name: 'Kinzhal Triebwerks- & Rumpfsegment',
        lat: 50.44850,
        lon: 30.52620,
        ordnance: 'Feststoff-Raketenkörper Kh-47M2',
        craterDiameterM: 6,
        damageStatus: 'DURCHSCHLAG INDUSTRIEDACH'
      },
      {
        id: 'crater-kyiv-kinzhal-3',
        name: 'Patriot PAC-3 Abfanglenkwaffen-Boosterstufe',
        lat: 50.45210,
        lon: 30.52080,
        ordnance: 'MIM-104 PAC-3 CRI Abfangrakete',
        craterDiameterM: 3,
        damageStatus: 'STRASSENKRATER // GELÄNDE DURCH POLIZEI GESICHERT'
      }
    ]
  },
  {
    id: 'ms-dnipro-iskander',
    category: 'missile-strikes',
    title: 'Iskander-M Ballistischer Schlag Dnipro',
    weaponType: '9M723 Iskander-M Ballistische Boden-Boden-Rakete',
    theater: 'Ostukraine / Dnipro',
    launchOrigin: { lat: 50.6, lon: 36.6, name: 'Abschussraum Belgorod' },
    target: { lat: 48.4647, lon: 35.0462, name: 'Yuzhmash Raumfahrt- und Rüstungswerk' },
    status: 'EINSCHLAG IN INDUSTRIEKOMPLEX',
    interceptionReported: false,
    severity: 'CRITICAL',
    blastRadiusM: 2400,
    timestamp: '2026-09-21T06:30:00Z',
    summary: 'Quasiballistische Flugbahn mit Täuschkörper-Ausstoß (Penetration Aids). Detonation in Produktionshalle für Drohnensysteme.',
    impactPoints: [
      {
        id: 'crater-dnipro-isk-1',
        name: 'Yuzhmash Montagehalle 3 (Haupt-Volltreffer)',
        lat: 48.46472,
        lon: 35.04618,
        ordnance: '9N723 HE-Gefechtskopf (480 kg RDX)',
        craterDiameterM: 18,
        damageStatus: 'DIREKTTREFFER // HALLE EINGESTÜRZT'
      },
      {
        id: 'crater-dnipro-isk-2',
        name: 'Iskander Triebwerks- und Rumpfeinschlag',
        lat: 48.46390,
        lon: 35.04750,
        ordnance: '9M723 Feststoff-Stufe',
        craterDiameterM: 8,
        damageStatus: 'BRANDENTWICKLUNG AN LAGERFLÄCHE'
      },
      {
        id: 'crater-dnipro-isk-3',
        name: '9B899 Täuschkörper-Einschlagszone',
        lat: 48.46550,
        lon: 35.04480,
        ordnance: '9B899 Täuschkörper / Radar-Störsystem',
        craterDiameterM: 4,
        damageStatus: 'ASPHALTEINSCHLAG AN WERKSBAHN'
      }
    ]
  },
  {
    id: 'ms-telaviv-ballistic',
    category: 'missile-strikes',
    title: 'Qadr-110 / Fattah Ballistischer Schlag Raum Tel Aviv',
    weaponType: 'Fattah-1 / Qadr-110 Mittelstreckenrakete (MRBM)',
    theater: 'Israel / Küstenebene',
    launchOrigin: { lat: 34.0, lon: 47.0, name: 'IRGC Raketenbasis Kermānschāh, Iran' },
    target: { lat: 32.0853, lon: 34.7818, name: 'Tel Aviv / Glilot Geheimdienstkomplex' },
    status: 'ARROW-3 EXOSPHÄRISCHER ABFANG',
    interceptionReported: true,
    severity: 'CRITICAL',
    blastRadiusM: 2500,
    timestamp: '2026-09-21T03:30:00Z',
    summary: 'Hochatmosphärischer Abfang durch Arrow-3 Waffensystem außerhalb der Atmosphäre. Landung von Raketenteilen im Küstenbereich.',
    impactPoints: [
      {
        id: 'crater-telaviv-arrow3-1',
        name: 'Arrow-3 Exosphärischer Abfangpunkt (85 km Höhe)',
        lat: 32.08530,
        lon: 34.78180,
        ordnance: 'Arrow-3 Kill Vehicle Direkt-Treffer',
        craterDiameterM: 0,
        damageStatus: 'KINETISCHER ABFANG // EXOSPHÄRE'
      },
      {
        id: 'crater-telaviv-arrow3-2',
        name: 'Gefechtskopf-Trümmerkrater Küste Herzliya',
        lat: 32.16200,
        lon: 34.79800,
        ordnance: 'MRBM Gefechtskopf-Splittermasse',
        craterDiameterM: 7,
        damageStatus: 'EINSCHLAG OFFENE STRANDZONE'
      },
      {
        id: 'crater-telaviv-arrow3-3',
        name: 'Raketenkörper-Trümmer Wasseraufschlag',
        lat: 32.11000,
        lon: 34.73000,
        ordnance: 'Qadr-110 Treibstofftank-Rumpf',
        craterDiameterM: 15,
        damageStatus: 'WASSERAUFSCHLAG VOR DER KÜSTE'
      }
    ]
  },
  {
    id: 'ms-nevatim-iran-strike',
    category: 'missile-strikes',
    title: 'Kheibar Shekan Salve auf Luftwaffenbasis Nevatim',
    weaponType: 'Kheibar Shekan Präzisions-Feststoffrakete',
    theater: 'Israel / Negev-Wüste',
    launchOrigin: { lat: 32.5, lon: 51.5, name: 'Abschussraum Isfahan, Iran' },
    target: { lat: 31.2088, lon: 35.0133, name: 'Nevatim Airbase (F-35I Hangare)' },
    status: 'TEILWEISER EINSCHLAG // RUNWAY BESCHÄDIGT',
    interceptionReported: true,
    severity: 'CRITICAL',
    blastRadiusM: 3200,
    timestamp: '2026-09-20T22:15:00Z',
    summary: 'Mehrfachraketen-Salve zur Überlastung der Flugabwehr. Einschlag auf Rollweg; F-35 Hangare blieben intakt.',
    impactPoints: [
      {
        id: 'crater-nevatim-1',
        name: 'Hauptstartbahn 12L / Aufsetzzone',
        lat: 31.20880,
        lon: 35.01330,
        ordnance: 'Kheibar Shekan Präzisions-Gefechtskopf (500 kg)',
        craterDiameterM: 14,
        damageStatus: 'STARTBAHN DURCHLÖCHERT // PIONIERREPARATUR'
      },
      {
        id: 'crater-nevatim-2',
        name: 'Rollweg Taxiway Zulu (Kreuzung F-35 Shelter)',
        lat: 31.20750,
        lon: 35.01520,
        ordnance: 'Kheibar Shekan Manövrierfähiger Sprengkopf (MaRV)',
        craterDiameterM: 11,
        damageStatus: 'ROLLWEG GESPERRT // ASPHALTVERWERFUNG'
      },
      {
        id: 'crater-nevatim-3',
        name: 'Wach- und Sicherungsbereich Südperipherie',
        lat: 31.21010,
        lon: 35.01180,
        ordnance: 'Raketenstufen-Einschlag',
        craterDiameterM: 7,
        damageStatus: 'SCHUTZWALL EINGEDRÜCKT'
      }
    ]
  },
  {
    id: 'ms-odesa-shahed-swarm',
    category: 'missile-strikes',
    title: 'Shahed-136 / Geran-2 Schwarmangriff auf Hafen Odesa',
    weaponType: 'Geran-2 / Shahed-136 Kamikaze-Drohnenschwarm',
    theater: 'Südukraine / Schwarzes Meer',
    launchOrigin: { lat: 45.1, lon: 35.4, name: 'Krim / Kap Tschauda' },
    target: { lat: 46.4825, lon: 30.7233, name: 'Odesa Handelshafen & Treibstoffdepot' },
    status: 'FLUGABWEHR IM DAUEREINSATZ // 18 VON 24 ABGESCHOSSEN',
    interceptionReported: true,
    severity: 'SEVERE',
    blastRadiusM: 1500,
    timestamp: '2026-09-21T01:45:00Z',
    summary: 'Tieffliegender Schwarm von 24 Drohnen. Gepard-Flakpanzer und mobile Luftverteidigungsteams schossen 18 Einheiten ab. Brände in Hafenlagerhalle.',
    impactPoints: [
      {
        id: 'crater-odesa-sh-1',
        name: 'Getreideterminal Silogebäude 7',
        lat: 46.48250,
        lon: 30.72330,
        ordnance: 'Shahed-136 Gefechtskopf (50 kg)',
        craterDiameterM: 8,
        damageStatus: 'SILOWAND PERFORIERT // BRANDENTWICKLUNG'
      },
      {
        id: 'crater-odesa-sh-2',
        name: 'Hafen-Treibstofflager Tank 4',
        lat: 46.48390,
        lon: 30.72580,
        ordnance: 'Shahed-136 Kamikaze-Drohne',
        craterDiameterM: 9,
        damageStatus: 'SCHADEN AN AUSSENHÜLLE // LÖSCHUNG ERFOLGT'
      },
      {
        id: 'crater-odesa-sh-3',
        name: 'Verladekai Pier 3',
        lat: 46.48120,
        lon: 30.72100,
        ordnance: 'Flak-Treffer Trümmerabsturz',
        craterDiameterM: 4,
        damageStatus: 'TRÜMMERSCHLAG AUF KAI'
      }
    ]
  },
  {
    id: 'ms-redsea-houthi-asbm',
    category: 'missile-strikes',
    title: 'Houthi-Anti-Schiff-Raketenangriff im Bab al-Mandab',
    weaponType: 'Asef Anti-Ship Ballistic Missile (ASBM)',
    theater: 'Rotes Meer / Meerenge',
    launchOrigin: { lat: 14.8, lon: 43.0, name: 'Al-Hudaida Küstenzone' },
    target: { lat: 12.9, lon: 43.3, name: 'Containerschiff Südtransit' },
    status: 'SM-2 ABFANG DURCH US-ZERSTÖRER',
    interceptionReported: true,
    severity: 'SEVERE',
    blastRadiusM: 900,
    timestamp: '2026-09-20T18:15:00Z',
    summary: 'USS Gravely (DDG-107) fing die anfliegende ballistische Anti-Schiff-Rakete mit Standard Missile-2 im Endanflug ab.',
    impactPoints: [
      {
        id: 'crater-redsea-asbm-1',
        name: 'SM-2 Luftabfang-Punkt (2.800 m Höhe)',
        lat: 12.90000,
        lon: 43.30000,
        ordnance: 'RIM-66M SM-2MR Block IIIB',
        craterDiameterM: 0,
        damageStatus: 'LUFTABFANG // RAKETENKOPF DETONIERT'
      },
      {
        id: 'crater-redsea-asbm-2',
        name: 'Wrackeinschlag im Wasser (350m vor Bug)',
        lat: 12.90300,
        lon: 43.30500,
        ordnance: 'Asef ASBM Rumpftrümmer',
        craterDiameterM: 18,
        damageStatus: 'WASSERFONTAINE // KEINE SCHIFFSBESCHÄDIGUNG'
      }
    ]
  },
  {
    id: 'ms-sevastopol-atacms',
    category: 'missile-strikes',
    title: 'ATACMS Präzisionsschlag auf Radarkomplex Sewastopol',
    weaponType: 'MGM-140 ATACMS mit Block 1A Cluster',
    theater: 'Krim / Sewastopol',
    launchOrigin: { lat: 46.9, lon: 32.0, name: 'Abschussraum Mykolajiw' },
    target: { lat: 44.6166, lon: 33.5254, name: 'Belbek Flugfeld / S-400 Radar' },
    status: 'VOLLEFFEKT // S-400 RADARKOMPONENTE VERNICHTET',
    interceptionReported: false,
    severity: 'CRITICAL',
    blastRadiusM: 2100,
    timestamp: '2026-09-20T21:00:00Z',
    summary: 'M39A1 Submunitions-Bombardement auf 91N6E Frühwarnradar und Abschussfahrzeuge auf dem Militärflugplatz Belbek.',
    impactPoints: [
      {
        id: 'crater-sevastopol-1',
        name: '91N6E Frühwarnradar (Hauptziel)',
        lat: 44.61660,
        lon: 33.52540,
        ordnance: 'M74 Submunitionsteppich (950 Bomblets)',
        craterDiameterM: 14,
        damageStatus: 'DIREKTTREFFER // RADARANTENNE DURCHSIEBET'
      },
      {
        id: 'crater-sevastopol-2',
        name: '5P85SM2 Startfahrzeug Alpha',
        lat: 44.61580,
        lon: 33.52680,
        ordnance: 'M74 Splitterkörper',
        craterDiameterM: 9,
        damageStatus: 'FAHRZEUG AUSGEBRANNT // RAKETEN EXPLODIERT'
      },
      {
        id: 'crater-sevastopol-3',
        name: 'Betonierter Munitionsbunker West',
        lat: 44.61740,
        lon: 33.52390,
        ordnance: 'M74 Submunitionen',
        craterDiameterM: 6,
        damageStatus: 'SCHUTZWÄNDE SPLITTERBESCHÄDIGT'
      }
    ]
  }
];

// --- 4. GROUND BATTLES & TACTICAL CLASHES ---
export const SEED_BATTLES = [
  {
    id: 'bt-pokrovsk-assault',
    category: 'battles',
    name: 'Schlacht um den Eisenbahnknotenpunkt Pokrowsk',
    theater: 'Ostukraine / Donezk',
    location: { lat: 48.2833, lon: 37.1833, name: 'Pokrowsk / Selydove Sektor' },
    forces: 'Ukrainische 47. Mech. Brigade vs. Russische 2. Gardearmee',
    tactics: 'Zangenangriff mit motorisierten Sturmgruppen und massiver FAB-Unterstützung',
    status: 'HEFTIGE STRASSENKÄMPFE // VERTEIDIGUNGSRIEGEL HÄLT',
    intensity: 'CRITICAL',
    dangerRadiusM: 6000,
    summary: 'Strategischer Hauptlogistikknotenpunkt des gesamten Donbass. Kontinuierliche Vorstöße entlang der Eisenbahntrasse unter FPV-Drohnendauerfeuer.'
  },
  {
    id: 'bt-chasiv-yar-canal',
    category: 'battles',
    name: 'Gefecht am Siverskyi-Donez-Donbass-Kanal (Tschassiw Jar)',
    theater: 'Ostukraine / Bakhmut West',
    location: { lat: 48.5833, lon: 37.8333, name: 'Tschassiw Jar Kanalbrückenkopf' },
    forces: 'Ukrainische 24. Mech. Brigade vs. 98. VDV Luftlandedivision',
    tactics: 'Überquerung der trockenliegenden Betonkanalabschnitte unter Nebelwänden',
    status: 'UMKÄMPFTER BRÜCKENKOPF // HOHE VERLUSTE',
    intensity: 'SEVERE',
    dangerRadiusM: 4500,
    summary: 'Der Kanal dient als zentrale natürliche Verteidigungslinie. Ukrainische Drohnenschwärme verhindern russische Brückenkopfbildung.'
  },
  {
    id: 'bt-toretsk-urban',
    category: 'battles',
    name: 'Häuserkampf in Torezk (Zentralschacht & Hochhäuser)',
    theater: 'Ostukraine / Torezk',
    location: { lat: 48.3911, lon: 37.8655, name: 'Torezk Stadtzentrum & Zechenanlagen' },
    forces: 'Ukrainische Nationalgarde vs. Russische Sturmbataillone',
    tactics: 'Nahbereichs-Sprengungen, Kellerkämpfe und Scharfschützeneinsatz von Abraumhalden',
    status: 'HÄUSERKAMPF // MEHRFACHE GEBIETSWECHSEL',
    intensity: 'CRITICAL',
    dangerRadiusM: 4000,
    summary: 'Zähe Gefechte in den Industrieanlagen und den Terrikons (Abraumhalden), die als dominierende Aussichts- und Feuerpunkte genutzt werden.'
  },
  {
    id: 'bt-kupyansk-industrial',
    category: 'battles',
    name: 'Gefechte um Kupyansk-Vuzlovyi (Oskil-Brückenkopf)',
    theater: 'Nordost-Ukraine / Charkiw',
    location: { lat: 49.7055, lon: 37.6188, name: 'Kupyansk Güterbahnhof & Flussübergang' },
    forces: 'Ukrainische 14. Mech. Brigade vs. 1. Gardepanzerarmee',
    tactics: 'Panzerdurchbrüche und Zerschlagung von Behelfsbrücken über den Oskil',
    status: 'ABWEHR SCHWERER PANZERANGRIFFE',
    intensity: 'SEVERE',
    dangerRadiusM: 5000,
    summary: 'Schlüsselübergang über den Oskil-Fluss. Russische Truppen versuchen die Schienenlogistik nach Charkiw abzuschneiden.'
  },
  {
    id: 'bt-kursk-korenevo',
    category: 'battles',
    name: 'Kursk Gegenoffensive (Korenevo & Gluschkowo)',
    theater: 'Russland / Kursk Oblast',
    location: { lat: 51.4167, lon: 34.9000, name: 'Korenevo Eisenbahnstation' },
    forces: 'Ukrainische 80. Luftsturmbrigade vs. Russische 810. Marineinfanterie & 106. VDV',
    tactics: 'Gepanzerte Hinterhalte, Minenriegel und schwere FPV-Drohnenschläge',
    status: 'GEGENANGRIFFE // ARTILLERIEDUELLE',
    intensity: 'SEVERE',
    dangerRadiusM: 7000,
    summary: 'Russische Verbände versuchen mit amphibischen Panzern über den Seim-Fluss vorzustoßen, um den ukrainischen Frontkeil zu spalten.'
  },
  {
    id: 'bt-vuhledar-kurakhove',
    category: 'battles',
    name: 'Schlacht um Kurachowe & Vuhledar Flanken',
    theater: 'Süd-Donezk / Vuhledar',
    location: { lat: 47.7811, lon: 37.2488, name: 'Vuhledar Bergbauschächte' },
    forces: 'Ukrainische 72. Mech. Brigade vs. Russische 40. Marineinfanteriebrigade',
    tactics: 'Umfassungsangriffe über offene Steppenfelder und Minenräumung unter Beschuss',
    status: 'KRITISCHER FLANKENDRUCK // SCHWERE PANZERKÄMPFE',
    intensity: 'CRITICAL',
    dangerRadiusM: 6500,
    summary: 'Ehemalige ukrainische Festungsstadt auf Höhenplateau. Zangenangriffe von Süd und Ost bedrohen Rückzugswege.'
  },
  {
    id: 'bt-gaza-jabalia',
    category: 'battles',
    name: 'Belagerung & Häuserkampf Flüchtlingslager Jabalia',
    theater: 'Nordgaza / Jabalia',
    location: { lat: 31.5311, lon: 34.4988, name: 'Jabalia Camp Zentrum' },
    forces: 'IDF 162. Division (Givati & 401. Panzer) vs. Hamas Jabalia-Bataillon',
    tactics: 'Umfassende Belagerung, Panzerdurchbrüche und Sprengung von Tunnelschächten',
    status: 'EXTREME URBANER NAHKAMPF',
    intensity: 'CRITICAL',
    dangerRadiusM: 3500,
    summary: 'Dichteste urbane Gefechtszone im Nahen Osten. Panzerfaust-Hinterhalte aus Tunnelsystemen und Ruinen.'
  },
  {
    id: 'bt-lebanon-marounalras',
    category: 'battles',
    name: 'Grenzgefechte um Maroun al-Ras & Odaisseh',
    theater: 'Südlibanon / Grenzkamm',
    location: { lat: 33.0988, lon: 35.4411, name: 'Maroun al-Ras Höhenzug' },
    forces: 'IDF Fallschirmjägerbrigade vs. Hisbollah Radwan-Spezialeinheiten',
    tactics: 'Nahkampf in Macchia-Vegetation, Panzerabwehrraketen (Kornet) und Drohnenangriffe',
    status: 'HÖHENKAMPF // AMBUSH-ZONE',
    intensity: 'CRITICAL',
    dangerRadiusM: 3000,
    summary: 'Strategischer Grenzhügel mit Weitblick über Nordisrael. Schwere Kornet-ATGM-Hinterhalte auf vorrückende Merkava-Panzer.'
  }
];

// --- 5. MASSIVE REAL-WORLD BOMBARDMENTS, GLIDE BOMBS & AIRSTRIKES ---
export const SEED_BOMBARDMENTS = [
  // --- IRAN STRIKES ---
  {
    id: 'bm-iran-isfahan-airbase',
    category: 'bombardments',
    title: 'Präzisionsschlag auf 8. Taktische Luftwaffenbasis Isfahan',
    weaponSystem: 'Luftgestützte Präzisions-Abstandswaffen (Blue Sparrow / Rocks)',
    theater: 'Zentraliran / Isfahan',
    target: { lat: 32.7511, lon: 51.8655, name: 'Isfahan S-300PMU2 Radarkomplex' },
    impactRadiusM: 1800,
    ordnanceCount: '4x Präzisions-Abstandsflugkörper',
    severity: 'CRITICAL',
    status: 'VOLLEFFEKT // FLUGABWEHRRADAR AUSGESCHALTET',
    timestamp: '2026-09-20T02:40:00Z',
    summary: 'Gezielter Präzisionsschlag gegen das 30N6E Frühwarn- und Feuerleitradar des S-300 Raketenkomplexes zum Schutz der Nuklearanlagen von Isfahan.',
    impactPoints: [
      {
        id: 'crater-isfahan-1',
        name: '30N6E Frühwarn- und Feuerleitradar (Hauptfahrzeug)',
        lat: 32.75112,
        lon: 51.86548,
        ordnance: 'Blue Sparrow / Rocks Präzisions-Penetrator',
        craterDiameterM: 14,
        damageStatus: 'DIREKTTREFFER // RADARFAHRZEUG AUSGEBRANNT'
      },
      {
        id: 'crater-isfahan-2',
        name: '5P85SE Tel-Raketenwerfer-Stellung Bravo',
        lat: 32.75085,
        lon: 51.86612,
        ordnance: 'Blue Sparrow Gefechtskopf',
        craterDiameterM: 16,
        damageStatus: 'SEKUNDÄREXPLOSION // SILOS DETONIERT'
      },
      {
        id: 'crater-isfahan-3',
        name: 'Zentrale Generator- und Wandlerstation',
        lat: 32.75140,
        lon: 51.86495,
        ordnance: 'Präzisions-Gefechtskopf',
        craterDiameterM: 10,
        damageStatus: 'ENERGIEVERSORGUNG ZERSTÖRT'
      },
      {
        id: 'crater-isfahan-4',
        name: 'Staffel-Gefechtsstand Hangar 4',
        lat: 32.75220,
        lon: 51.86710,
        ordnance: 'Bunkerpenetrator',
        craterDiameterM: 12,
        damageStatus: 'DURCHSCHLAG BEWEHRTER BETONDECKE'
      }
    ]
  },
  {
    id: 'bm-iran-parchin-missile',
    category: 'bombardments',
    title: 'Airstrike auf Feststoffraketen-Produktionsstätte Parchin',
    weaponSystem: 'Stealth-Standoff Cruise Missiles',
    theater: 'Nordiran / Südost-Teheran',
    target: { lat: 35.5188, lon: 51.7822, name: 'Parchin Militärforschungskomplex' },
    impactRadiusM: 2200,
    ordnanceCount: '8x bunkerbrechende Präzisionsmunition',
    severity: 'CRITICAL',
    status: 'PRODUKTIONSHALLEN ZERSTÖRT',
    timestamp: '2026-09-19T23:15:00Z',
    summary: 'Schlag gegen Planetenmischer für Feststoff-Raketentreibstoff der ballistischen Mittelstreckenraketen Kheibar Shekan und Fattah.',
    impactPoints: [
      {
        id: 'crater-parchin-1',
        name: 'Planetenmischer Gebäude 12 (Raketentreibstoff)',
        lat: 35.51880,
        lon: 51.78220,
        ordnance: 'Standoff Bunkerpenetrator (450 kg)',
        craterDiameterM: 18,
        damageStatus: 'TOTALSCHADEN // PLANETENMISCHER ZERSTÖRT'
      },
      {
        id: 'crater-parchin-2',
        name: 'Gießerei für Feststoffmotoren (Block Süd)',
        lat: 35.51790,
        lon: 51.78310,
        ordnance: 'Stealth-Marschflugkörper Gefechtskopf',
        craterDiameterM: 15,
        damageStatus: 'HALLE EINGESTÜRZT // SEKUNDÄRBRAND'
      },
      {
        id: 'crater-parchin-3',
        name: 'Qualitätsprüffeld & Röntgenlabor',
        lat: 35.51950,
        lon: 51.78150,
        ordnance: 'Präzisionssprengkopf',
        craterDiameterM: 10,
        damageStatus: 'LABOR EINRICHTUNG VERNICHTET'
      },
      {
        id: 'crater-parchin-4',
        name: 'Treibstoff-Rohstofflager Alpha',
        lat: 35.51680,
        lon: 51.78420,
        ordnance: 'HE-Penetrator',
        craterDiameterM: 20,
        damageStatus: 'GROSSKRATER // CHEMIE-BRAND'
      }
    ]
  },
  {
    id: 'bm-iran-natanz-perimeter',
    category: 'bombardments',
    title: 'Schlag gegen äußere Sicherheitsinfrastruktur Natanz',
    weaponSystem: 'Taktische Marschflugkörper & Loitering Munitions',
    theater: 'Zentraliran / Natanz',
    target: { lat: 33.7244, lon: 51.7288, name: 'Urananreicherungsanlage Natanz (Perimeter)' },
    impactRadiusM: 1500,
    ordnanceCount: '6x punktgenaue Wirkmittel',
    severity: 'SEVERE',
    status: 'STROM- UND RADARSTATIONEN BESCHÄDIGT',
    timestamp: '2026-09-18T04:20:00Z',
    summary: 'Schlag gegen Flugabwehr-Batterien und Trafo-Stationen der unterirdischen Zentrifugen-Kaskadenhallen.',
    impactPoints: [
      {
        id: 'crater-natanz-1',
        name: '132-kV-Hauptumspannwerk Zentrifugenhallen',
        lat: 33.72440,
        lon: 51.72880,
        ordnance: 'Marschflugkörper Präzisionstreffer',
        craterDiameterM: 14,
        damageStatus: 'TRANSFORMATOREN VERNICHTET'
      },
      {
        id: 'crater-natanz-2',
        name: 'Pantsir-S1 Flugabwehrstellung Nordring',
        lat: 33.72620,
        lon: 51.73100,
        ordnance: 'Loitering Munition Anti-Radiation',
        craterDiameterM: 8,
        damageStatus: 'RADARFAHRZEUG AUSGESCHALTET'
      },
      {
        id: 'crater-natanz-3',
        name: 'Unterirdischer Zuluftschacht Kaskadenbereich',
        lat: 33.72310,
        lon: 51.72750,
        ordnance: 'Penetrierender Gefechtskopf',
        craterDiameterM: 11,
        damageStatus: 'KÜHLUNG UNTERBROCHEN'
      }
    ]
  },

  // --- LEBANON & SYRIA STRIKES ---
  {
    id: 'bm-beirut-dahiyeh-bunker',
    category: 'bombardments',
    title: 'Schwerer Bunker-Buster Luftschlag Beirut-Dahiyeh',
    weaponSystem: 'BLU-109 2.000 lb / GBU-28 penetrierende Bunkerbomben (F-15I)',
    theater: 'Libanon / Beirut Südliche Vororte',
    target: { lat: 33.8488, lon: 35.5088, name: 'Dahiyeh Hisbollah Zentralkommando' },
    impactRadiusM: 2500,
    ordnanceCount: '16 schwere bunkerbrechende Bomben in Serie',
    severity: 'CRITICAL',
    status: 'UNTERIRDISCHER FÜHRUNGSBUNKER KOLLABIERT',
    timestamp: '2026-09-21T11:30:00Z',
    summary: 'Massiver koordinierter Bombenteppich zur Zerstörung mehrstöckiger unterirdischer Bunkeranlagen der Hisbollah-Militärführung in Dahiyeh.',
    impactPoints: [
      {
        id: 'crater-dahiyeh-1',
        name: 'Zentraler Führungskomplex (Eingangsschacht -4)',
        lat: 33.84880,
        lon: 35.50880,
        ordnance: 'GBU-28 Hard Target Penetrator (2.200 kg)',
        craterDiameterM: 22,
        damageStatus: 'DURCHSCHLAG 14m ERDREICH // BUNKER KOLLABIERT'
      },
      {
        id: 'crater-dahiyeh-2',
        name: 'Sitzungssaal Militärrat (Flügel Ost)',
        lat: 33.84850,
        lon: 35.50920,
        ordnance: 'BLU-109 2.000 lb Bunkerbombe',
        craterDiameterM: 18,
        damageStatus: 'VOLLSTÄNDIGER EINSTURZ'
      },
      {
        id: 'crater-dahiyeh-3',
        name: 'Kommunikations- & Funkzentrale',
        lat: 33.84910,
        lon: 35.50840,
        ordnance: 'BLU-109 / JDAM-Führung',
        craterDiameterM: 16,
        damageStatus: 'FUNKMAST & ANTENNENRAUM ZERSTÖRT'
      },
      {
        id: 'crater-dahiyeh-4',
        name: 'Sicherheitsbunker Unterflur-Garage',
        lat: 33.84820,
        lon: 35.50860,
        ordnance: 'BLU-109 Folgekrater',
        craterDiameterM: 15,
        damageStatus: 'TRÜMMERBLOCKADE FLUCHTWEGE'
      }
    ]
  },
  {
    id: 'bm-lebanon-nabatieh-arty',
    category: 'bombardments',
    title: 'Artillerie- und Luftschlagkonzentration Nabatieh',
    weaponSystem: '155mm M109A7 Paladin & JDAM Präzisionsbomben',
    theater: 'Südlibanon / Nabatieh',
    target: { lat: 33.3788, lon: 35.4855, name: 'Hisbollah Raketenstellungen Nabatieh' },
    impactRadiusM: 3000,
    ordnanceCount: 'Über 140x 155mm Granaten & 10x JDAM',
    severity: 'SEVERE',
    status: 'ABSCHUSSPLATTFORMEN ZERSCHLAGEN',
    timestamp: '2026-09-21T09:00:00Z',
    summary: 'Dauerfeuer zur Vorbereitung von Bodenbewegungen und Eliminierung versteckter Mehrfachraketenwerfer in Tälern.',
    impactPoints: [
      {
        id: 'crater-nabatieh-1',
        name: '220mm Raketenstellung Felsüberhang',
        lat: 33.37880,
        lon: 35.48550,
        ordnance: '155mm M982 Excalibur GPS-Granate',
        craterDiameterM: 8,
        damageStatus: 'WERFER DIREKTTREFFER // MUNITION VERPUFFT'
      },
      {
        id: 'crater-nabatieh-2',
        name: 'Tunnelsilo Wadi al-Hujair',
        lat: 33.38020,
        lon: 35.48780,
        ordnance: 'GBU-31 JDAM (900 kg)',
        craterDiameterM: 16,
        damageStatus: 'STALLTUNNEL-PORTAL VERSCHÜTTET'
      },
      {
        id: 'crater-nabatieh-3',
        name: 'Munitionshöhle Südflanke',
        lat: 33.37750,
        lon: 35.48320,
        ordnance: '155mm Artillerie-Konzentration (8 Schuss)',
        craterDiameterM: 12,
        damageStatus: 'HÖHLENDACH DURCHSCHLAGEN'
      }
    ]
  },
  {
    id: 'bm-syria-damascus-mezzeh',
    category: 'bombardments',
    title: 'Präzisionsschlag auf Militärflugplatz Mezzeh, Damaskus',
    weaponSystem: 'Rampage Überschall-Präzisionsraketen',
    theater: 'Syrien / Damaskus',
    target: { lat: 33.4788, lon: 36.2255, name: 'Mezzeh Airbase / IRGC Waffenlager' },
    impactRadiusM: 1600,
    ordnanceCount: '6x Überschall-Flugkörper',
    severity: 'HIGH',
    status: 'MUNITIONSDEPOT DETONIERT // SEKUNDÄREXPLOSIONEN',
    timestamp: '2026-09-20T20:10:00Z',
    summary: 'Zerstörung einer Waffenlieferung moderner Flugabwehrraketen und Drohnenteile kurz nach Landung iranischer Frachtflugzeuge.',
    impactPoints: [
      {
        id: 'crater-mezzeh-1',
        name: 'Frachtflugzeug-Entladerampe Süd',
        lat: 33.47880,
        lon: 36.22550,
        ordnance: 'Rampage Überschall-Präzisionsrakete',
        craterDiameterM: 12,
        damageStatus: 'FRACHT-CONTAINER EXPLODIERT // BRAND'
      },
      {
        id: 'crater-mezzeh-2',
        name: 'Waffenlagerhalle Hangar 12',
        lat: 33.48010,
        lon: 36.22720,
        ordnance: 'Rampage Überschall-Rakete',
        craterDiameterM: 14,
        damageStatus: 'DURCHSCHLAG DACHTRÄGER // VOLLEFFEKT'
      },
      {
        id: 'crater-mezzeh-3',
        name: 'IRGC Drohnen-Testleitstelle',
        lat: 33.47720,
        lon: 36.22380,
        ordnance: 'Rampage Gefechtskopf',
        craterDiameterM: 10,
        damageStatus: 'ELEKTRONIKZENTRALE ZERSTÖRT'
      }
    ]
  },

  // --- YEMEN STRIKES ---
  {
    id: 'bm-yemen-hodeidah-port',
    category: 'bombardments',
    title: 'Luftbombardement Hafen Al-Hudaida (Treibstofftanks)',
    weaponSystem: 'GBU-31 JDAM (2.000 lb) & lasergestützte Bomben',
    theater: 'Jemen / Rotes Meer Küste',
    target: { lat: 14.8211, lon: 42.9488, name: 'Hafen Hodeidah Tanklager & Kräne' },
    impactRadiusM: 3500,
    ordnanceCount: '24 schwere Fliegerbomben',
    severity: 'CRITICAL',
    status: 'GROSSBRAND // ÖLTANKS IN FLAMMEN',
    timestamp: '2026-09-19T14:45:00Z',
    summary: 'Gezielte Ausschaltung der Houthi-Versorgungsinfrastruktur und Hafenkräne, über die Waffenimporte aus dem Iran abgewickelt wurden.',
    impactPoints: [
      {
        id: 'crater-hodeidah-1',
        name: 'Öltanklager Tankgruppe 4 (Rohöl)',
        lat: 14.82110,
        lon: 42.94880,
        ordnance: 'GBU-31 JDAM (2.000 lb)',
        craterDiameterM: 20,
        damageStatus: 'GROSSBRAND // ÖLTANKS DETONIERT'
      },
      {
        id: 'crater-hodeidah-2',
        name: 'Container-Verladebrücke Kran 2',
        lat: 14.82280,
        lon: 42.95100,
        ordnance: 'GBU-31 Präzisionsbombe',
        craterDiameterM: 15,
        damageStatus: 'KRANGERÜST INS HAFENBECKEN GESTÜRZT'
      },
      {
        id: 'crater-hodeidah-3',
        name: 'Hafenpipeline Pumpstation',
        lat: 14.81950,
        lon: 42.94650,
        ordnance: 'GBU-12 Paveway Laserbombe',
        craterDiameterM: 9,
        damageStatus: 'PUMPENANLAGE LAHMGELEGT'
      }
    ]
  },
  {
    id: 'bm-yemen-sanaa-fajattan',
    category: 'bombardments',
    title: 'Bunker-Buster Schlag auf Berg Faj Attan, Sanaa',
    weaponSystem: 'USAF B-2 Spirit Stealth-Bomber mit GBU-57 MOP / GBU-31',
    theater: 'Jemen / Sanaa',
    target: { lat: 15.3288, lon: 44.1811, name: 'Faj Attan Untergrunddepots' },
    impactRadiusM: 2800,
    ordnanceCount: '4x GBU-57 schwere Bunkerbrecher',
    severity: 'CRITICAL',
    status: 'UNTERIRDISCHES RAKETENLAGER EINGESTÜRZT',
    timestamp: '2026-09-18T22:30:00Z',
    summary: 'Strategischer Schlag gegen tief im Granit eingegrabene Lager für ballistische Anti-Schiff-Raketen der Houthi-Streitkräfte.',
    impactPoints: [
      {
        id: 'crater-fajattan-1',
        name: 'Faj Attan Graniteinfahrt Hauptstollen',
        lat: 15.32880,
        lon: 44.18110,
        ordnance: 'GBU-57 Massive Ordnance Penetrator (MOP)',
        craterDiameterM: 25,
        damageStatus: 'STOLLE EINGESTÜRZT // SEISMISCHE SCHOCKWELLE'
      },
      {
        id: 'crater-fajattan-2',
        name: 'Entlüftungsschacht Raketenwerkstatt',
        lat: 15.33020,
        lon: 44.18350,
        ordnance: 'GBU-57 MOP Folgetreffer',
        craterDiameterM: 22,
        damageStatus: 'DURCHSCHLAG BIS IN 35m TIEFE'
      },
      {
        id: 'crater-fajattan-3',
        name: 'Oberirdische Luftraumüberwachungsstation',
        lat: 15.32720,
        lon: 44.17900,
        ordnance: 'GBU-31 JDAM (900 kg)',
        craterDiameterM: 14,
        damageStatus: 'KASERNE UND RADAR ENTGLEIST'
      }
    ]
  },

  // --- UKRAINE STRIKES ---
  {
    id: 'bm-kharkiv-fab3000-saltivka',
    category: 'bombardments',
    title: 'FAB-3000 / FAB-1500 UMPK Gleitbomben-Schlag Charkiw',
    weaponSystem: 'FAB-3000 & FAB-1500 mit UMPK Flügelmodul (Su-34)',
    theater: 'Nordost-Ukraine / Charkiw Stadtgebiet',
    target: { lat: 50.0155, lon: 36.2388, name: 'Charkiw Nordsektor (Saltivka)' },
    impactRadiusM: 3200,
    ordnanceCount: '8 schwere Gleitbomben (1.500–3.000 kg)',
    severity: 'CRITICAL',
    status: 'MASSIVE KRATERBILDUNG // INFRASTRUKTUR ZERSTÖRT',
    timestamp: '2026-09-21T13:20:00Z',
    summary: 'Einsatz schwerster konventioneller Gleitbomben aus 65 km Distanz außerhalb der ukrainischen Luftverteidigungsreichweite.',
    impactPoints: [
      {
        id: 'crater-kharkiv-1',
        name: 'Industriegelände / Reparaturstützpunkt Saltivka (FAB-3000 Hauptkrater)',
        lat: 50.01552,
        lon: 36.23884,
        ordnance: 'FAB-3000 M-54 mit UMPK Modul (1.400 kg Sprengstoff)',
        craterDiameterM: 26,
        damageStatus: 'EXTREMER BOMBENKRATER // WERKSHALLE PULVERISIERT'
      },
      {
        id: 'crater-kharkiv-2',
        name: 'Materiallagerhalle Werkseinfahrt (FAB-1500 Treffer)',
        lat: 50.01710,
        lon: 36.24150,
        ordnance: 'FAB-1500 UMPK Gleitbombe',
        craterDiameterM: 18,
        damageStatus: 'DIREKTTREFFER // EINSTURZ DER GESAMTHALLE'
      },
      {
        id: 'crater-kharkiv-3',
        name: 'Gleisanschluss & Verladezone Nord',
        lat: 50.01390,
        lon: 36.23620,
        ordnance: 'FAB-1500 UMPK Gleitbombe',
        craterDiameterM: 16,
        damageStatus: 'GLEISBETT TIEF ZERRISSEN'
      },
      {
        id: 'crater-kharkiv-4',
        name: 'Treibstoffumladestation Saltivka',
        lat: 50.01820,
        lon: 36.24400,
        ordnance: 'FAB-1500 UMPK Gleitbombe',
        craterDiameterM: 17,
        damageStatus: 'BRANDENTWICKLUNG // TANKMULDE DETONIERT'
      }
    ]
  },
  {
    id: 'bm-kyiv-grid-strike',
    category: 'bombardments',
    title: 'Kombinierter Raketen- und Bombardement-Schlag Kiew Netz',
    weaponSystem: 'Kh-101 Marschflugkörper & Iskander-M Ballistik',
    theater: 'Zentralukraine / Kiew',
    target: { lat: 50.4501, lon: 30.5234, name: 'Umspannwerk Kiew-Nord (750 kV)' },
    impactRadiusM: 2000,
    ordnanceCount: '14x Marschflugkörper & ballistische Raketen',
    severity: 'CRITICAL',
    status: 'TRANSFORMATOREN VERNICHTET // BLACKOUT',
    timestamp: '2026-09-21T04:10:00Z',
    summary: 'Koordinierte Wellen zur Zerstörung von Hochspannungs-Transformatoren zur Lahmlegung der industriellen Rüstungsproduktion.',
    impactPoints: [
      {
        id: 'crater-kyiv-grid-1',
        name: '750-kV-Autotransformator Gruppe 1',
        lat: 50.45010,
        lon: 30.52340,
        ordnance: 'Kh-101 Marschflugkörper Gefechtskopf (450 kg)',
        craterDiameterM: 16,
        damageStatus: 'TRANSFORMATOR DURCHSCHLAGEN // KERNÖL IN FLAMMEN'
      },
      {
        id: 'crater-kyiv-grid-2',
        name: 'Hochspannungs-Schaltfeld 330 kV',
        lat: 50.45120,
        lon: 30.52580,
        ordnance: 'Iskander-M 9M723 Ballistischer Volltreffer',
        craterDiameterM: 19,
        damageStatus: 'SCHALTANLAGE TOTALSCHADEN'
      },
      {
        id: 'crater-kyiv-grid-3',
        name: 'Leitzentrale & Schutztechnik-Gebäude',
        lat: 50.44890,
        lon: 30.52100,
        ordnance: 'Kh-101 Marschflugkörper Folgeangriff',
        craterDiameterM: 14,
        damageStatus: 'DACH DURCHSCHLAGEN // STEUERUNG AUSGEFALLEN'
      }
    ]
  },
  {
    id: 'bm-zaporizhzhia-kab-cluster',
    category: 'bombardments',
    title: 'KAB-500 Gleitbomben-Bombardement Saporischschja',
    weaponSystem: 'KAB-500Pr / FAB-500 UMPK (Su-35 & Su-34)',
    theater: 'Südukraine / Saporischschja',
    target: { lat: 47.8388, lon: 35.1388, name: 'Industriepark & Brückenköpfe Saporischschja' },
    impactRadiusM: 2600,
    ordnanceCount: '16x geführte Fliegerbomben',
    severity: 'SEVERE',
    status: 'SCHWERE EINSCHLÄGE AN INDUSTRIEANLAGEN',
    timestamp: '2026-09-21T10:45:00Z',
    summary: 'Taktische Bombardierung zur Unterbindung von Truppenrotationen und Nachschublieferungen an die Südfront.',
    impactPoints: [
      {
        id: 'crater-zap-1',
        name: 'Panzerinstandsetzungswerk Halle 8',
        lat: 47.83880,
        lon: 35.13880,
        ordnance: 'KAB-500Pr Penetrierende Präzisionsbombe',
        craterDiameterM: 14,
        damageStatus: 'BETONDECKE DURCHDRUNGEN // KRANBAHN ZERSTÖRT'
      },
      {
        id: 'crater-zap-2',
        name: 'Triebwerks-Prüffeld Motor Sich',
        lat: 47.84020,
        lon: 35.14120,
        ordnance: 'FAB-500 UMPK Gleitbombe',
        craterDiameterM: 12,
        damageStatus: 'DIREKTTREFFER // PRÜFSTAND UNBRAUCHBAR'
      },
      {
        id: 'crater-zap-3',
        name: 'Logistikdepot Ersatzteillager West',
        lat: 47.83750,
        lon: 35.13650,
        ordnance: 'FAB-500 UMPK Gleitbombe',
        craterDiameterM: 11,
        damageStatus: 'HALLE AUSGEBRANNT'
      }
    ]
  },
  {
    id: 'bm-kryvyirih-cluster',
    category: 'bombardments',
    title: 'Iskander Streumunitions-Schlag Krywyj Rih',
    weaponSystem: '9M723 Iskander-M mit Submunitionssplitterkopf',
    theater: 'Zentralukraine / Krywyj Rih',
    target: { lat: 47.9105, lon: 33.3918, name: 'Eisenbahnlogistik & Militärstützpunkt' },
    impactRadiusM: 2400,
    ordnanceCount: '2x 9M723 mit 54 Submunitionen',
    severity: 'CRITICAL',
    status: 'GROSSFLÄCHIGER SPLITTERTEPPICH',
    timestamp: '2026-09-20T16:30:00Z',
    summary: 'Luftdetonation in 20 Meter Höhe erzeugt weiträumigen Splitterradius gegen ungepanzerte Logistikfahrzeuge und Personal.',
    impactPoints: [
      {
        id: 'crater-kryvyirih-1',
        name: 'Rangierbahnhof Weichenkreuz Nord',
        lat: 47.91050,
        lon: 33.39180,
        ordnance: '9M723 Submunitions-Luftdetonation',
        craterDiameterM: 6,
        damageStatus: 'SPLITTERTEPPICH // WEICHEN BLOCKIERT'
      },
      {
        id: 'crater-kryvyirih-2',
        name: 'Lokomotiv-Depot Wartungsstand',
        lat: 47.91220,
        lon: 33.39420,
        ordnance: 'Iskander-M Streusplitter-Wirkung',
        craterDiameterM: 8,
        damageStatus: '3x LOKOMOTIVEN DURCHSIEBET'
      },
      {
        id: 'crater-kryvyirih-3',
        name: 'Militärverladerampe Gleis 11',
        lat: 47.90880,
        lon: 33.38950,
        ordnance: 'Submunitionseinschlag',
        craterDiameterM: 5,
        damageStatus: 'LKW-KOLONNE BESCHÄDIGT'
      }
    ]
  },
  {
    id: 'bm-dnipro-yuzhmash',
    category: 'bombardments',
    title: 'Schwerer Luft- und Marschflugkörperschlag Dnipro',
    weaponSystem: 'Kh-101 Marschflugkörper (Tu-95MS strategische Bomber)',
    theater: 'Zentralukraine / Dnipro',
    target: { lat: 48.4647, lon: 35.0462, name: 'Werkshallen Raketenbau Dnipro' },
    impactRadiusM: 2900,
    ordnanceCount: '8x Kh-101 Stealth-Marschflugkörper',
    severity: 'CRITICAL',
    status: 'SCHWERE BRANDENTWICKLUNG',
    timestamp: '2026-09-20T05:50:00Z',
    summary: 'Präzisionstreffer auf Prüfstände und Fertigungslinien für Raketentriebwerke und Präzisionslenkwaffen.',
    impactPoints: [
      {
        id: 'crater-dnipro-ym-1',
        name: 'Endmontagehalle Trägerraketen / Drohnen (Halle 4)',
        lat: 48.46470,
        lon: 35.04620,
        ordnance: 'Kh-101 Stealth-Marschflugkörper',
        craterDiameterM: 18,
        damageStatus: 'GROSSBRAND // DACHKONSTRUKTION EINGESTÜRZT'
      },
      {
        id: 'crater-dnipro-ym-2',
        name: 'Elektronik- & Leitsystem-Gebäude',
        lat: 48.46600,
        lon: 35.04850,
        ordnance: 'Kh-101 Präzisionsschlag',
        craterDiameterM: 14,
        damageStatus: 'VOLLEFFEKT IM OBERGESCHOSS'
      },
      {
        id: 'crater-dnipro-ym-3',
        name: 'Triebwerksprüffeld & Tanklager',
        lat: 48.46320,
        lon: 35.04400,
        ordnance: 'Kh-101 Folgeflugkörper',
        craterDiameterM: 15,
        damageStatus: 'TANKEXPLOSION // RAUCHSÄULE'
      }
    ]
  },
  {
    id: 'bm-pokrovsk-tos1a-barrage',
    category: 'bombardments',
    title: 'TOS-1A Solntsepyok Thermobarisches Bombardement Pokrowsk',
    weaponSystem: 'TOS-1A 220mm Thermobarische Raketenwerfer',
    theater: 'Ostukraine / Pokrowsk Vorfeld',
    target: { lat: 48.3055, lon: 37.2811, name: 'Ukrainische Bunkerlinie Myrnohrad' },
    impactRadiusM: 2200,
    ordnanceCount: '24x thermobarische 220mm Raketen (Salve)',
    severity: 'CRITICAL',
    status: 'AEROSOL-DRUCKWELLE // UNTERSTÄNDE ZERSTÖRT',
    timestamp: '2026-09-21T08:15:00Z',
    summary: 'Vakuum- und Aerosol-Sprengköpfe entzünden Luft-Brennstoff-Gemische zur Zerstörung von Grabensystemen und verbunkerten Stellungen.',
    impactPoints: [
      {
        id: 'crater-pokrovsk-tos-1',
        name: 'Grabensystem Bahndamm Stützpunkt Alpha',
        lat: 48.30550,
        lon: 37.28110,
        ordnance: 'TOS-1A 220mm Thermobarische Rakete (Salve)',
        craterDiameterM: 12,
        damageStatus: 'AEROSOL-DRUCKWELLE // GRABEN SYSTEM EINGEEBNET'
      },
      {
        id: 'crater-pokrovsk-tos-2',
        name: 'Betonierter Unterstand Waldrand',
        lat: 48.30680,
        lon: 37.28350,
        ordnance: 'TOS-1A Vakuumsprengkopf',
        craterDiameterM: 10,
        damageStatus: 'UNTERSTAND KOLLABIERT'
      },
      {
        id: 'crater-pokrovsk-tos-3',
        name: 'Verbindungstrench & MG-Nest Süd',
        lat: 48.30420,
        lon: 37.27900,
        ordnance: 'TOS-1A Thermobar-Detonation',
        craterDiameterM: 11,
        damageStatus: 'STELLUNG VERNICHTET'
      }
    ]
  },
  {
    id: 'bm-kursk-glushkovo-fab',
    category: 'bombardments',
    title: 'Russisches FAB-3000 Bombardement im Kursk-Brückenkopf',
    weaponSystem: 'FAB-3000 UMPK (Su-34 Frontbomber)',
    theater: 'Russland / Kursk Oblast (Gluschkowo)',
    target: { lat: 51.3411, lon: 34.6388, name: 'Seim-Fluss Pontonübergänge' },
    impactRadiusM: 3000,
    ordnanceCount: '6x 3-Tonnen Gleitbomben',
    severity: 'CRITICAL',
    status: 'PONTONBRÜCKEN ZERSTÖRT',
    timestamp: '2026-09-21T12:00:00Z',
    summary: 'Vernichtung von Pionierbrücken über den Seim-Fluss zur Blockade ukrainischer Nachschubwege im Frontbogen.',
    impactPoints: [
      {
        id: 'crater-glushkovo-1',
        name: 'Seim-Flussbrücke Pfeiler West',
        lat: 51.34110,
        lon: 34.63880,
        ordnance: 'FAB-3000 UMPK (3.000 kg Fliegerbombe)',
        craterDiameterM: 24,
        damageStatus: 'BRÜCKENFELD ABGESTÜRZT // FLUSSSPERRE'
      },
      {
        id: 'crater-glushkovo-2',
        name: 'Pontonübergang Ausweichstelle Nord',
        lat: 51.34250,
        lon: 34.64120,
        ordnance: 'FAB-1500 UMPK Gleitbombe',
        craterDiameterM: 18,
        damageStatus: 'PONTONS ZERRISSEN'
      },
      {
        id: 'crater-glushkovo-3',
        name: 'Brückenrampe & Stauzone Süd',
        lat: 51.33950,
        lon: 34.63650,
        ordnance: 'FAB-1500 UMPK Gleitbombe',
        craterDiameterM: 16,
        damageStatus: 'FAHRBAHN ZERSTÖRT // FAHRZEUGE AUSGEBRANNT'
      }
    ]
  }
];

// Helper: Intensity/Severity color translation
export function getIntensityColor(intensity, alpha = 1.0) {
  switch (String(intensity || '').toUpperCase()) {
    case 'CRITICAL':
      return new Cesium.Color(1.0, 0.1, 0.1, alpha); // Vivid Red
    case 'SEVERE':
      return new Cesium.Color(1.0, 0.45, 0.0, alpha); // Orange/Amber
    case 'HIGH':
      return new Cesium.Color(1.0, 0.8, 0.0, alpha); // Yellow
    case 'MODERATE':
      return new Cesium.Color(0.2, 0.8, 1.0, alpha); // Cyan
    default:
      return new Cesium.Color(0.9, 0.2, 0.2, alpha);
  }
}

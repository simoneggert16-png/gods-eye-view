/**
 * @module specialOpsEngine
 *
 * Seed datasets and tactical calculations for:
 * 1. Missile Tests (ICBM/SLBM/Hypersonic test launches, NOTAM hazard corridors, splashdown sites)
 * 2. Military Convoys (Ground troop & heavy armor movements, rail echelons, checkpoints)
 * 3. Campaign Trails (VIP election campaign tours, rally arenas, motorcades & flight legs)
 * 4. Secret Service (Presidential security details, VIP TFR airspaces, motorcade routes, snipers)
 */

/**
 * Validates [lon, lat] coordinate pair.
 */
export function isValidCoordinate(coord) {
  if (!Array.isArray(coord) || coord.length < 2) return false;
  const [lon, lat] = coord;
  return (
    typeof lon === 'number' &&
    Number.isFinite(lon) &&
    lon >= -180 &&
    lon <= 180 &&
    typeof lat === 'number' &&
    Number.isFinite(lat) &&
    lat >= -90 &&
    lat <= 90
  );
}

/**
 * Computes intermediate parabolic 3D flight trajectory positions.
 */
export function computeTrajectoryArc(startLon, startLat, endLon, endLat, apogeeMeters, steps = 40) {
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const lon = startLon + (endLon - startLon) * t;
    const lat = startLat + (endLat - startLat) * t;
    // Parabolic altitude profile: 4 * apogee * t * (1 - t)
    const alt = Math.max(0, 4 * apogeeMeters * t * (1 - t));
    points.push({ lon, lat, alt });
  }
  return points;
}

// =============================================================================
// 1. MISSILE TESTS SEED DATA
// =============================================================================
export const SEED_MISSILE_TESTS = Object.freeze([
  {
    id: 'test-us-minuteman3-gt251',
    name: 'Glory Trip 251 — Minuteman III ICBM',
    type: 'ICBM Operational Test Launch',
    operator: 'US Air Force Global Strike Command',
    missileType: 'LGM-30G Minuteman III',
    launchSite: {
      name: 'Vandenberg Space Force Base, CA',
      lon: -120.6107,
      lat: 34.7420,
    },
    targetSite: {
      name: 'Ronald Reagan Ballistic Missile Defense Test Site, Kwajalein Atoll',
      lon: 167.7314,
      lat: 8.7166,
    },
    apogeeKm: 1120,
    trajectoryColor: '#00e5ff',
    notamHazardBox: [
      [-122.5, 33.5],
      [-120.0, 33.5],
      [-119.5, 35.5],
      [-122.0, 35.5],
    ],
    status: 'MISSION SUCCESS // REENTRY VEHICLE IMPACT CONFIRMED',
    telemetry: 'Apogee 1,120 km · Velocity Mach 23 · Range 6,750 km · Reentry telemetry nominal',
    date: '2026-06-04',
  },
  {
    id: 'test-ru-yars-plesetsk-kura',
    name: 'RS-24 Yars Solid-Fuel ICBM Test',
    type: 'Road-Mobile ICBM Combat Readiness Test',
    operator: 'Russian Strategic Missile Forces (RVSN)',
    missileType: 'RS-24 Yars (SS-29)',
    launchSite: {
      name: 'Plesetsk Cosmodrome Silo / Mobile Site',
      lon: 40.5772,
      lat: 62.9271,
    },
    targetSite: {
      name: 'Kura Missile Test Range, Kamchatka',
      lon: 161.8333,
      lat: 56.3333,
    },
    apogeeKm: 1280,
    trajectoryColor: '#ff1744',
    notamHazardBox: [
      [39.0, 62.0],
      [42.0, 62.0],
      [42.0, 64.0],
      [39.0, 64.0],
    ],
    status: 'WARHEAD IMPACT IN TARGET QUADRANT',
    telemetry: 'Apogee 1,280 km · MIRV deployment successful · Range 5,800 km',
    date: '2026-03-12',
  },
  {
    id: 'test-dprk-hwasong18-sunan',
    name: 'Hwasong-18 Solid-Fuel ICBM Lofted Test',
    type: 'Solid-Propellant Heavy ICBM Test',
    operator: 'Missile General Bureau (DPRK)',
    missileType: 'Hwasong-18',
    launchSite: {
      name: 'Sunan Airfield / Pyongyang Sector',
      lon: 125.6701,
      lat: 39.2008,
    },
    targetSite: {
      name: 'East Sea / Sea of Japan International Waters (EEZ Margin)',
      lon: 133.5000,
      lat: 41.2000,
    },
    apogeeKm: 6514,
    trajectoryColor: '#ffd600',
    notamHazardBox: [
      [131.0, 40.0],
      [135.0, 40.0],
      [135.0, 42.5],
      [131.0, 42.5],
    ],
    status: 'LOFTED HIGH-ANGLE TRAJECTORY // APOGEE RECORD',
    telemetry: 'Apogee 6,514 km · Flight duration 73 min · Range 1,001 km · Stage separation confirmed',
    date: '2026-07-18',
  },
  {
    id: 'test-in-agni5-abdul-kalam',
    name: 'Mission Divyastra — Agni-V MIRV Test',
    type: 'MIRV-Capable Road-Mobile ICBM',
    operator: 'Strategic Forces Command & DRDO',
    missileType: 'Agni-V',
    launchSite: {
      name: 'Dr. APJ Abdul Kalam Island, Odisha',
      lon: 87.0544,
      lat: 20.7570,
    },
    targetSite: {
      name: 'Southern Indian Ocean Impact Zone',
      lon: 88.5000,
      lat: -12.0000,
    },
    apogeeKm: 980,
    trajectoryColor: '#ff9100',
    notamHazardBox: [
      [86.0, 19.5],
      [88.5, 19.5],
      [88.5, 21.5],
      [86.0, 21.5],
    ],
    status: 'MULTIPLE REENTRY VEHICLE DISPERSION VERIFIED',
    telemetry: 'Range >5,000 km · 3 independent warheads tracked by INS Dhruv radar ship',
    date: '2026-04-22',
  },
  {
    id: 'test-us-trident2-d5-atlantic',
    name: 'Trident II D5 Life Extension Demonstration',
    type: 'Submarine-Launched Ballistic Missile (SLBM)',
    operator: 'US Navy Strategic Systems Programs',
    missileType: 'UGM-133A Trident II D5LE',
    launchSite: {
      name: 'SSBN submerged launch, Eastern Test Range (Cape Canaveral Offshore)',
      lon: -79.8000,
      lat: 28.5000,
    },
    targetSite: {
      name: 'Ascension Island Impact Area / South Atlantic',
      lon: -14.3500,
      lat: -7.9500,
    },
    apogeeKm: 890,
    trajectoryColor: '#00e676',
    notamHazardBox: [
      [-81.0, 27.5],
      [-78.5, 27.5],
      [-78.5, 29.5],
      [-81.0, 29.5],
    ],
    status: '192ND CONSECUTIVE SUCCESSFUL TEST FLIGHT',
    telemetry: 'Submerged ignition nominal · Celestial guidance fix · Range 7,200 km',
    date: '2026-05-30',
  },
]);

// =============================================================================
// 2. MILITARY CONVOYS SEED DATA
// =============================================================================
export const SEED_MILITARY_CONVOYS = Object.freeze([
  {
    id: 'convoy-nato-suwalki-corridor',
    name: 'NATO Forward Land Forces Heavy Armor Column',
    theater: 'Eastern Flank / Suwalki Gap Corridor',
    type: 'Mechanized Brigade Road & Rail Convoy',
    vehicleCount: 78,
    composition: 'M1A2 SEPv3 Abrams MBTs (14x), M2A4 Bradley IFVs (28x), Paladin M109A7 SPGs (8x), Oshkosh HEMTT Refuelers & Heavy Equipment Transporters (28x)',
    escortLevel: 'AIR COVER & MILITARY POLICE ESCORT',
    speedKmh: 45,
    status: 'EN ROUTE // PASSING CHECKPOINT BRAVO',
    cargo: 'Munitions Class V, JP-8 fuel reserves, reactive armor kits',
    route: [
      [22.5034, 53.8211], // Elk, Poland staging
      [22.9734, 54.0983], // Suwalki bypass
      [23.3512, 54.3411], // Budzisko Border Crossing
      [23.8611, 54.5422], // Marijampole transit corridor
      [24.1205, 54.9122], // Kaunas Forward Logistics Base, Lithuania
    ],
    checkpoints: [
      { name: 'Staging Hub Elk', lon: 22.5034, lat: 53.8211, status: 'CLEARED' },
      { name: 'CP Suwalki Bypass', lon: 22.9734, lat: 54.0983, status: 'CLEARED' },
      { name: 'Border Gate Budzisko', lon: 23.3512, lat: 54.3411, status: 'CURRENT POSITION' },
      { name: 'CP Marijampole', lon: 23.8611, lat: 54.5422, status: 'QUEUED' },
      { name: 'Kaunas Depot Gate', lon: 24.1205, lat: 54.9122, status: 'FINAL DESTINATION' },
    ],
  },
  {
    id: 'convoy-ru-donbass-ammo-echelon',
    name: 'Southern Military District Heavy Artillery Echelon',
    theater: 'Donbass Supply Axis / M4 - R260 Corridor',
    type: 'Heavy Logistics & 152mm Munitions Convoy',
    vehicleCount: 94,
    composition: 'Kamaz-63501 heavy trucks (52x), Ural-4320 ammo haulers (30x), BTR-82A escort vehicles (6x), Tor-M2 mobile SHORAD (6x)',
    escortLevel: 'EW JAMMING & MOBILE AIR DEFENSE ESCORT',
    speedKmh: 40,
    status: 'ACTIVE MARCH // DISPERSED COLUMN',
    cargo: '152mm Krasnopol guided shells, 220mm Uragan rockets, field repair spares',
    route: [
      [39.7233, 47.2357], // Rostov-on-Don logistics depot
      [39.8911, 47.8211], // Shakhty junction
      [40.2311, 48.3122], // Kamensk-Shakhtinsky
      [39.8512, 48.5122], // Luhansk border transit
      [39.3122, 48.5711], // Alchevsk forward staging
    ],
    checkpoints: [
      { name: 'Rostov Depot West', lon: 39.7233, lat: 47.2357, status: 'CLEARED' },
      { name: 'Shakhty Checkpoint', lon: 39.8911, lat: 47.8211, status: 'CLEARED' },
      { name: 'Kamensk Border Check', lon: 40.2311, lat: 48.3122, status: 'CURRENT POSITION' },
      { name: 'Luhansk Hub', lon: 39.8512, lat: 48.5122, status: 'QUEUED' },
    ],
  },
  {
    id: 'convoy-idf-northern-armor-galilee',
    name: 'IDF 188th Armored Brigade Reinforcement Column',
    theater: 'Northern Command / Route 90 - Route 91 Corridor',
    type: 'Armored Cavalry Rapid Deployment',
    vehicleCount: 54,
    composition: 'Merkava Mk IVM with Trophy APS (22x), Namer heavy APCs (18x), Heavy Recovery Eitan (4x), Armored Combat Engineering D9 Dozers (10x)',
    escortLevel: 'IDF AIR FORCE DRONE OVERWATCH & IRON DOME UMBRELLA',
    speedKmh: 50,
    status: 'NIGHT MOVEMENT // TACTICAL BLACKOUT',
    cargo: 'Active defense counter-measures, 120mm APFSDS rounds, field fortifications',
    route: [
      [35.0811, 32.7940], // Haifa logistics staging
      [35.3122, 32.8911], // Carmiel bypass
      [35.5412, 32.9811], // Rosh Pina intersection
      [35.6811, 33.0911], // Mahanayim staging base
      [35.7511, 33.1811], // Golan northern sector
    ],
    checkpoints: [
      { name: 'Haifa Base 14', lon: 35.0811, lat: 32.7940, status: 'CLEARED' },
      { name: 'Carmiel Gate', lon: 35.3122, lat: 32.8911, status: 'CLEARED' },
      { name: 'Rosh Pina CP', lon: 35.5412, lat: 32.9811, status: 'CURRENT POSITION' },
      { name: 'Golan Forward FOB', lon: 35.7511, lat: 33.1811, status: 'DESTINATION' },
    ],
  },
  {
    id: 'convoy-us-corps-poland-drawsko',
    name: 'V Corps Rapid Armor Mobility Echelon',
    theater: 'Drawsko Pomorskie Training Area to Powidz Air Base',
    type: 'M1A2 & Stryker Heavy Transporter Road March',
    vehicleCount: 65,
    composition: 'M1A2 SEPv3 (16x), Stryker Dragoon 30mm (24x), M88A2 Hercules Recovery (6x), Heavy Logistics Support Trucks (19x)',
    escortLevel: 'US MILITARY POLICE & POLISH ŻANDARMERIA WOJSKOWA',
    speedKmh: 55,
    status: 'TACTICAL ROAD MARCH COMPLETED // STAGING IN MOTOR POOL',
    cargo: '30mm Bushmaster ammo, thermal sight spare batteries, modular bridging gear',
    route: [
      [15.8111, 53.5322], // Drawsko Pomorskie
      [16.2311, 53.1511], // Miroslawiec Air Base
      [16.7411, 52.8911], // Pila intersection
      [17.3111, 52.4111], // Gniezno transit
      [17.8511, 52.3789], // Powidz US Army Combat Aviation / Prepositioned Stock
    ],
    checkpoints: [
      { name: 'Drawsko Range Gate', lon: 15.8111, lat: 53.5322, status: 'CLEARED' },
      { name: 'Miroslawiec Transit', lon: 16.2311, lat: 53.1511, status: 'CLEARED' },
      { name: 'Pila CP', lon: 16.7411, lat: 52.8911, status: 'CLEARED' },
      { name: 'Powidz ASP Hub', lon: 17.8511, lat: 52.3789, status: 'SECURED' },
    ],
  },
]);

// =============================================================================
// 3. CAMPAIGN TRAILS SEED DATA
// =============================================================================
export const SEED_CAMPAIGN_TRAILS = Object.freeze([
  {
    id: 'campaign-us-rustbelt-swing',
    title: 'Presidential Battleground Rust Belt Tour',
    candidate: 'POTUS / Executive Campaign Team',
    tourType: 'Multi-State Arena Rally Tour & Air Force VIP Transport',
    status: 'ACTIVE CAMPAIGN SWING // DAY 2 OF 4',
    aircraft: 'Air Force VC-25B / Boeing C-32A (Air Force Two Call Signs)',
    legs: [
      {
        from: 'Andrews AFB, MD',
        to: 'Milwaukee, WI',
        mode: 'FLIGHT',
        distanceKm: 1040,
        coords: [[-76.8670, 38.8108], [-87.8966, 42.9472]],
      },
      {
        from: 'Milwaukee, WI',
        to: 'Detroit, MI',
        mode: 'FLIGHT',
        distanceKm: 420,
        coords: [[-87.8966, 42.9472], [-83.3533, 42.2125]],
      },
      {
        from: 'Detroit, MI',
        to: 'Pittsburgh, PA',
        mode: 'FLIGHT',
        distanceKm: 340,
        coords: [[-83.3533, 42.2125], [-80.2328, 40.4915]],
      },
      {
        from: 'Pittsburgh, PA',
        to: 'Charlotte, NC',
        mode: 'FLIGHT',
        distanceKm: 600,
        coords: [[-80.2328, 40.4915], [-80.9431, 35.2140]],
      },
    ],
    stops: [
      {
        name: 'Fiserv Forum Arena Rally',
        city: 'Milwaukee, WI',
        venue: 'Fiserv Forum Arena',
        lon: -87.9172,
        lat: 43.0451,
        capacity: 18500,
        securityPosture: 'SECRET SERVICE DESIGNATED HIGH SECURITY SPECIAL EVENT',
        time: '14:00 CDT',
        status: 'COMPLETED // 18,200 IN ATTENDANCE',
      },
      {
        name: 'Huntington Place Automotive Workers Rally',
        city: 'Detroit, MI',
        venue: 'Huntington Place Grand River Hall',
        lon: -83.0514,
        lat: 42.3264,
        capacity: 15000,
        securityPosture: 'SECRET SERVICE AIR SPACE RESTRICTION & MAGNETOMETER PERIMETER',
        time: '19:30 EDT',
        status: 'LIVE NOW // ADDRESSING PACKED HALL',
      },
      {
        name: 'PPG Paints Arena Keystone Rally',
        city: 'Pittsburgh, PA',
        venue: 'PPG Paints Arena',
        lon: -79.9897,
        lat: 40.4395,
        capacity: 19000,
        securityPosture: 'FULL MOTORCADE SWEEP & COUNTER-SNIPER DEPLOYMENT',
        time: 'Tomorrow 13:00 EDT',
        status: 'SCHEDULED // VENUE PRE-SWEEPS UNDERWAY',
      },
      {
        name: 'Spectrum Center Carolina Rally',
        city: 'Charlotte, NC',
        venue: 'Spectrum Center Arena',
        lon: -80.8394,
        lat: 35.2251,
        capacity: 20000,
        securityPosture: 'JOINT TERRORISM TASK FORCE & LOCAL SWAT INTEGRATION',
        time: 'Tomorrow 18:30 EDT',
        status: 'SCHEDULED // TICKETS CLEARED',
      },
    ],
  },
  {
    id: 'campaign-de-bundestag-express',
    title: 'Kanzlerkandidaten-Deutschlandtour (ICE & Kolonne)',
    candidate: 'Bundeskanzlerkandidat / Sicherheitsstufe 1 (BKA)',
    tourType: 'Bürgerdialog & Großkundgebungen',
    status: 'IN TRANSIT // SÜD-TOURNEE',
    aircraft: 'Luftwaffe Global 6000 VIP Transport (14+05)',
    legs: [
      {
        from: 'Berlin Hbf / Regierungsviertel',
        to: 'Leipzig Markt',
        mode: 'TRAIN_MOTORCADE',
        distanceKm: 180,
        coords: [[13.3695, 52.5255], [12.3731, 51.3402]],
      },
      {
        from: 'Leipzig Markt',
        to: 'München Olympiagrund',
        mode: 'FLIGHT',
        distanceKm: 380,
        coords: [[12.3731, 51.3402], [11.5511, 48.1733]],
      },
      {
        from: 'München',
        to: 'Stuttgart Liederhalle',
        mode: 'MOTORCADE',
        distanceKm: 220,
        coords: [[11.5511, 48.1733], [9.1681, 48.7786]],
      },
    ],
    stops: [
      {
        name: 'Wahlkampf-Kundgebung Leipzig Markt',
        city: 'Leipzig',
        venue: 'Historischer Marktplatz',
        lon: 12.3747,
        lat: 51.3404,
        capacity: 8000,
        securityPosture: 'BKA-SICHERUNGSGRUPPE & POLIZEI SACHSEN SPEZIALKRÄFTE',
        time: '11:00 CEST',
        status: 'ERFOLGREICH BEENDET',
      },
      {
        name: 'Olympiapark München Bayern-Gipfel',
        city: 'München',
        venue: 'Olympiahalle München',
        lon: 11.5522,
        lat: 48.1744,
        capacity: 14000,
        securityPosture: 'STRIKTER PERSONENSCHUTZ // SPRENGSTOFFSPÜRHUNDE & VORFELD-SCAN',
        time: '17:00 CEST',
        status: 'AUFBAU LAUFT // SICHERHEITSZONEN SCHARF',
      },
      {
        name: 'Wirtschaftsforum Stuttgart Liederhalle',
        city: 'Stuttgart',
        venue: 'Kultur- und Kongresszentrum Liederhalle',
        lon: 9.1686,
        lat: 48.7789,
        capacity: 3500,
        securityPosture: 'HOCHSICHERHEITSKONFERENZ // ZUTRITT NUR MIT AKKREDITIERUNG',
        time: 'Morgen 10:30 CEST',
        status: 'GEPLANT // BKA VORORT-SICHERUNG',
      },
    ],
  },
]);

// =============================================================================
// 4. SECRET SERVICE & VIP PROTECTION SEED DATA
// =============================================================================
export const SEED_SECRET_SERVICE_OPS = Object.freeze([
  {
    id: 'usss-potus-austin-summit',
    operation: 'OPERATION CAPITOL SHIELD // POTUS AUSTIN VISIT',
    protectee: 'POTUS / Presidential Protection Division (PPD)',
    threatLevel: 'SEVERE READINESS // MAXIMUM PROTECTIVE POSTURE',
    status: 'ACTIVE MOTORCADE & AIR DEFENSE BUBBLE',
    city: 'Austin, TX',
    tfr: {
      name: 'FAA VIP Temporary Flight Restriction (TFR 4/2189)',
      center: { lon: -97.7431, lat: 30.2672 },
      innerRadiusM: 18520, // 10 nautical miles inner core
      outerRadiusM: 55560, // 30 nautical miles outer ring
      maxAltitudeM: 5486,  // Flight Level 180 (18,000 ft)
      interceptReadiness: '2x F-16C ON COMBAT AIR PATROL (CAP) OVERHEAD',
    },
    motorcade: {
      callsign: 'EXECUTIVE CORTEGE (CADILLAC ONE "THE BEAST")',
      speedKmh: 72,
      vehicleCount: 32,
      primaryRoute: [
        [-97.6698, 30.1975], // Austin-Bergstrom International Airport (KAUS) - Air Force One Ramp
        [-97.6911, 30.2188], // HWY 71 Westbound High-Speed Corridor
        [-97.7211, 30.2455], // I-35 Northbound Rolling Intercept
        [-97.7404, 30.2672], // Congress Avenue Clear Corridor
        [-97.7431, 30.2747], // Texas State Capitol South Steps Staging
      ],
      alternateRoute: [
        [-97.6698, 30.1975], // KAUS
        [-97.6988, 30.2311], // Riverside Drive Alternate
        [-97.7311, 30.2588], // South 1st Street Bridge
        [-97.7445, 30.2701], // Lavaca Street Security Entry
        [-97.7431, 30.2747], // Texas State Capitol
      ],
    },
    perimeters: {
      inner: [
        [-97.7450, 30.2730],
        [-97.7410, 30.2730],
        [-97.7410, 30.2770],
        [-97.7450, 30.2770],
      ],
      outer: [
        [-97.7500, 30.2690],
        [-97.7360, 30.2690],
        [-97.7360, 30.2810],
        [-97.7500, 30.2810],
      ],
    },
    counterSnipers: [
      { name: 'CS-TEAM 1 (Hercules North Tower)', lon: -97.7435, lat: 30.2758, elevationM: 120 },
      { name: 'CS-TEAM 2 (Hercules South Dome Overlook)', lon: -97.7428, lat: 30.2738, elevationM: 95 },
      { name: 'CAT-TEAM 1 (Counter Assault Armored Suburban)', lon: -97.7431, lat: 30.2743, elevationM: 0 },
    ],
    traumaHospital: {
      name: 'Dell Seton Medical Center (Designated Level 1 Trauma Facility)',
      lon: -97.7345,
      lat: 30.2778,
      evacCorridorMinutes: 3.5,
    },
  },
  {
    id: 'usss-un-general-assembly-nyc',
    operation: 'OPERATION MANHATTAN CITADEL // UN GENERAL ASSEMBLY HIGH-LEVEL WEEK',
    protectee: 'POTUS + 140 Foreign Heads of State',
    threatLevel: 'NATIONAL SPECIAL SECURITY EVENT (NSSE) LEVEL 1',
    status: 'MANHATTAN MIDTOWN SECURITY FREEZE ZONE',
    city: 'New York City, NY',
    tfr: {
      name: 'FAA VIP TFR 4/3391 (NYC METROPOLITAN SECURITY AIRSPACE)',
      center: { lon: -73.9680, lat: 40.7489 },
      innerRadiusM: 14816, // 8 nautical miles
      outerRadiusM: 37040, // 20 nautical miles
      maxAltitudeM: 5486,
      interceptReadiness: 'NORAD 24/7 COMBAT AIR PATROL + COAST GUARD DEFENSE BOAT CORDON',
    },
    motorcade: {
      callsign: 'PRESIDENTIAL CAVALCADE NYC (BEAST + CAT ESCORT)',
      speedKmh: 55,
      vehicleCount: 45,
      primaryRoute: [
        [-73.8739, 40.7769], // LaGuardia Airport (KLGA) Marine Air Terminal
        [-73.9211, 40.7655], // Grand Central Parkway Express
        [-73.9555, 40.7588], // Queensboro Bridge Security Level
        [-73.9680, 40.7489], // United Nations Secretariat Plaza
      ],
      alternateRoute: [
        [-73.8739, 40.7769], // KLGA
        [-73.9311, 40.7411], // Midtown Tunnel Emergency Corridor
        [-73.9680, 40.7489], // UN Plaza
      ],
    },
    perimeters: {
      inner: [
        [-73.9720, 40.7460],
        [-73.9640, 40.7460],
        [-73.9640, 40.7520],
        [-73.9720, 40.7520],
      ],
      outer: [
        [-73.9800, 40.7400],
        [-73.9550, 40.7400],
        [-73.9550, 40.7600],
        [-73.9800, 40.7600],
      ],
    },
    counterSnipers: [
      { name: 'CS-TEAM ALPHA (UN Secretariat Roof)', lon: -73.9680, lat: 40.7499, elevationM: 155 },
      { name: 'CS-TEAM BRAVO (Midtown Tower Overlook)', lon: -73.9701, lat: 40.7485, elevationM: 140 },
    ],
    traumaHospital: {
      name: 'NYU Langone Health Level 1 Trauma Center',
      lon: -73.9744,
      lat: 40.7421,
      evacCorridorMinutes: 4.0,
    },
  },
]);

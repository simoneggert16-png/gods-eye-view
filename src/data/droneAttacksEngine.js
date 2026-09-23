/**
 * @module droneAttacksEngine
 *
 * Seed datasets and tactical calculations for:
 * 1. Drone Attacks (Kamikaze swarms, loitering munitions, precision strikes)
 * 2. Terror Attacks (Mass shootings, bombings, vehicle rammings)
 */

// =============================================================================
// 1. DRONE ATTACKS SEED DATA
// =============================================================================
export const SEED_DRONE_ATTACKS = Object.freeze([
  {
    id: 'drone-ua-shahed-kyiv-energy-01',
    title: 'Shahed-136/131 Schwarm auf Kiewer Energieinfrastruktur',
    type: 'Kamikaze-Drohnenschwarm',
    theater: 'Ukraine / Kiew Region',
    operator: 'Russische Streitkräfte',
    droneType: 'Shahed-136/131',
    swarmSize: 30,
    target: { name: 'Energieinfrastruktur Kiew', lat: 50.4501, lon: 30.5234 },
    launchOrigin: { name: 'Krim / Kap Tschauda', lat: 45.0667, lon: 35.8333 },
    weaponSystem: 'Geran-2 (Shahed-136)',
    status: 'TEILWEISE ABGEFANGEN // KRITISCHE INFRASTRUKTUR BESCHÄDIGT',
    timestamp: '2023-11-25T03:15:00Z',
    summary: 'Groß angelegter Drohnenschwarm auf Umspannwerke und Transformatoren in und um Kiew. Luftabwehr konnte Großteil abfangen, dennoch kam es zu massiven Stromausfällen.',
    severity: 8,
    impactRadiusM: 2500,
    impactPoints: [
      { id: 'ip-kyiv-1', name: 'Umspannwerk Kiew-Nord', lat: 50.5122, lon: 30.4811, ordnance: '50kg HE Sprengkopf', craterDiameterM: 12, damageStatus: 'ZERSTÖRT' },
      { id: 'ip-kyiv-2', name: 'Transformatorstation Obolon', lat: 50.4988, lon: 30.5012, ordnance: '50kg HE Sprengkopf', craterDiameterM: 8, damageStatus: 'SCHWER BESCHÄDIGT' },
      { id: 'ip-kyiv-3', name: 'Heizkraftwerk 5', lat: 50.3956, lon: 30.5511, ordnance: '50kg HE Sprengkopf', craterDiameterM: 15, damageStatus: 'BRANDENTWICKLUNG / TEILZERSTÖRT' },
      { id: 'ip-kyiv-4', name: 'Umspannwerk Kiew-West', lat: 50.4411, lon: 30.3812, ordnance: '50kg HE Sprengkopf', craterDiameterM: 10, damageStatus: 'BESCHÄDIGT' }
    ]
  },
  {
    id: 'drone-ua-lancet-bakhmut',
    title: 'Lancet-3 Loitering Munition auf M777 Haubitze',
    type: 'Loitering Munition',
    theater: 'Ukraine / Frontlinie Bakhmut',
    operator: 'Russische Luftlandedivision (VDV)',
    droneType: 'Lancet-3',
    swarmSize: 2,
    target: { name: 'Ukrainische Artilleriestellung', lat: 48.5953, lon: 37.9987 },
    launchOrigin: { name: 'Region Donezk', lat: 47.9811, lon: 37.8922 },
    weaponSystem: 'ZALA Lancet',
    status: 'ZIEL ZERSTÖRT // PRÄZISIONSSCHLAG',
    timestamp: '2023-08-14T14:30:00Z',
    summary: 'Gezielter Angriff mit zwei Lancet-3 Kamikaze-Drohnen auf eine getarnte Stellung amerikanischer M777 Haubitzen nahe Bakhmut.',
    severity: 6,
    impactRadiusM: 500,
    impactPoints: [
      { id: 'ip-bakhmut-1', name: 'M777 Feuerstellung', lat: 48.5953, lon: 37.9987, ordnance: '3kg HEAT Gefechtskopf', craterDiameterM: 3, damageStatus: 'VOLLSTÄNDIG ZERSTÖRT' },
      { id: 'ip-bakhmut-2', name: 'Munitionsdepot (Feld)', lat: 48.5955, lon: 37.9990, ordnance: '3kg HEAT Gefechtskopf', craterDiameterM: 5, damageStatus: 'SEKUNDÄREXPLOSION' }
    ]
  },
  {
    id: 'drone-ua-tb2-melitopol',
    title: 'Bayraktar TB2 Präzisionsschlag auf Munitionslager',
    type: 'Präzisionsschlag (UCAV)',
    theater: 'Ukraine / Region Saporischschja',
    operator: 'Ukrainische Streitkräfte',
    droneType: 'Bayraktar TB2',
    swarmSize: 1,
    target: { name: 'Russisches Munitionsdepot Melitopol', lat: 46.8426, lon: 35.3675 },
    launchOrigin: { name: 'Versteckte Basis Region Saporischschja', lat: 47.8388, lon: 35.1396 },
    weaponSystem: 'MAM-L Lasergesteuerte Bombe',
    status: 'MASSIVE ZERSTÖRUNG // SEKUNDÄREXPLOSIONEN',
    timestamp: '2022-04-12T02:45:00Z',
    summary: 'Erfolgreicher Präzisionsangriff einer TB2 Drohne mit MAM-L Munition auf ein vorgeschobenes Munitionsdepot der russischen Armee.',
    severity: 7,
    impactRadiusM: 1200,
    impactPoints: [
      { id: 'ip-mel-1', name: 'Hauptlagerhalle A', lat: 46.8426, lon: 35.3675, ordnance: 'MAM-L Thermobarisch', craterDiameterM: 18, damageStatus: 'EINGESTÜRZT' },
      { id: 'ip-mel-2', name: 'Freiluft-Munitionslager', lat: 46.8430, lon: 35.3680, ordnance: 'MAM-L HE', craterDiameterM: 12, damageStatus: 'KETTENREAKTION ZERSTÖRT' }
    ]
  },
  {
    id: 'drone-sa-samad3-abqaiq',
    title: 'Huthi Samad-3 Angriff auf Saudi Aramco Abqaiq',
    type: 'Kamikaze-Drohnenschwarm',
    theater: 'Saudi-Arabien / Ostprovinz',
    operator: 'Huthi-Rebellen (Ansar Allah)',
    droneType: 'Samad-3',
    swarmSize: 10,
    target: { name: 'Aramco Ölaufbereitungsanlage Abqaiq', lat: 25.9344, lon: 49.6789 },
    launchOrigin: { name: 'Nordjemen', lat: 16.5112, lon: 44.5211 },
    weaponSystem: 'Samad-3 Suiziddrohne',
    status: 'ANLAGE GETROFFEN // TEILAUSFALL DER PRODUKTION',
    timestamp: '2019-09-14T04:00:00Z',
    summary: 'Koordinierter Schwarmangriff auf die weltgrößte Rohöl-Aufbereitungsanlage. Fünf Drohnen durchbrachen die Luftabwehr und trafen Stabilisierungstürme.',
    severity: 9,
    impactRadiusM: 4500,
    impactPoints: [
      { id: 'ip-abq-1', name: 'Stabilisierungsturm 1', lat: 25.9344, lon: 49.6789, ordnance: 'Sprengkopf 18kg', craterDiameterM: 0, damageStatus: 'PUNKTION / BRAND' },
      { id: 'ip-abq-2', name: 'Stabilisierungsturm 2', lat: 25.9350, lon: 49.6792, ordnance: 'Sprengkopf 18kg', craterDiameterM: 0, damageStatus: 'PUNKTION / BRAND' },
      { id: 'ip-abq-3', name: 'Gas-Separiereinheit', lat: 25.9338, lon: 49.6782, ordnance: 'Sprengkopf 18kg', craterDiameterM: 6, damageStatus: 'SCHWER BESCHÄDIGT' }
    ]
  },
  {
    id: 'drone-sy-shahed-altanf',
    title: 'Shahed-136 Angriff auf US-Basis Al-Tanf',
    type: 'Kamikaze-Drohnenschwarm',
    theater: 'Syrien / Dreiländereck',
    operator: 'Iranische Milizen (Islamischer Widerstand)',
    droneType: 'Shahed-136',
    swarmSize: 5,
    target: { name: 'US-Garnison Al-Tanf', lat: 33.5106, lon: 38.8050 },
    launchOrigin: { name: 'Milizenbasis T4 Airbase Nähe', lat: 34.5233, lon: 37.6255 },
    weaponSystem: 'Shahed-136 / Qasef-2K',
    status: 'ABGEFANGEN / LEICHTE SCHÄDEN',
    timestamp: '2024-01-28T23:30:00Z',
    summary: 'Angriff von fünf Drohnen iranischer Bauart auf die US-Basis Al-Tanf. Drei wurden durch C-RAM abgewehrt, zwei schlugen in Randgebieten ein.',
    severity: 5,
    impactRadiusM: 1500,
    impactPoints: [
      { id: 'ip-tanf-1', name: 'Fahrzeughalle', lat: 33.5112, lon: 38.8045, ordnance: '40kg HE', craterDiameterM: 8, damageStatus: 'DACH EINGESTÜRZT' },
      { id: 'ip-tanf-2', name: 'Perimeter Wall Süd', lat: 33.5098, lon: 38.8060, ordnance: '40kg HE', craterDiameterM: 10, damageStatus: 'MAUER DURCHBROCHEN' }
    ]
  },
  {
    id: 'drone-sy-hermes450-deirez-zor',
    title: 'Hermes 450 Aufklärungs- und Präzisionsschlag',
    type: 'Aufklärungsdrohne / Strike',
    theater: 'Syrien / Deir ez-Zor',
    operator: 'IDF (Israelische Verteidigungsstreitkräfte)',
    droneType: 'Hermes 450',
    swarmSize: 1,
    target: { name: 'Waffentransportkonvoi', lat: 35.3368, lon: 40.1406 },
    launchOrigin: { name: 'Basis Nordisrael', lat: 32.9511, lon: 35.5312 },
    weaponSystem: 'Spike NLOS',
    status: 'KONVOI ZERSTÖRT // ZIEL ELIMINIERT',
    timestamp: '2023-12-15T01:20:00Z',
    summary: 'Israelische Hermes 450 entdeckte und zerstörte einen Konvoi mit fortschrittlichen Waffensystemen auf dem Weg zur libanesischen Grenze.',
    severity: 6,
    impactRadiusM: 800,
    impactPoints: [
      { id: 'ip-dez-1', name: 'Führungsfahrzeug LKW', lat: 35.3368, lon: 40.1406, ordnance: 'Spike Rakete', craterDiameterM: 4, damageStatus: 'VOLLSTÄNDIG ZERSTÖRT' }
    ]
  },
  {
    id: 'drone-ua-geran2-odesa',
    title: 'Geran-2 Schwarm auf Getreideterminal Odessa',
    type: 'Kamikaze-Drohnenschwarm',
    theater: 'Ukraine / Hafen Odessa',
    operator: 'Russische Streitkräfte',
    droneType: 'Geran-2',
    swarmSize: 15,
    target: { name: 'Getreideterminal Hafen Odessa', lat: 46.4877, lon: 30.7487 },
    launchOrigin: { name: 'Krim', lat: 45.3111, lon: 33.6811 },
    weaponSystem: 'Geran-2 (Shahed-136)',
    status: 'SCHWERE SCHÄDEN // SILOS GETROFFEN',
    timestamp: '2023-09-03T02:15:00Z',
    summary: 'Gezielter Angriff auf die zivile Hafeninfrastruktur. Mehrere Geran-2 Drohnen trafen Getreidesilos und Verladeanlagen.',
    severity: 8,
    impactRadiusM: 3000,
    impactPoints: [
      { id: 'ip-od-1', name: 'Getreidesilo Block B', lat: 46.4877, lon: 30.7487, ordnance: '50kg HE', craterDiameterM: 14, damageStatus: 'ZERSTÖRT / BRAND' },
      { id: 'ip-od-2', name: 'Verladekran Nord', lat: 46.4885, lon: 30.7495, ordnance: '50kg HE', craterDiameterM: 8, damageStatus: 'GEKIPPT' },
      { id: 'ip-od-3', name: 'Lagerhalle 4', lat: 46.4865, lon: 30.7470, ordnance: '50kg HE', craterDiameterM: 11, damageStatus: 'DACH ZERSTÖRT' }
    ]
  },
  {
    id: 'drone-ua-naval-sevastopol',
    title: 'Kombinierter See-/Luft-Drohnenangriff auf Schwarzmeerflotte',
    type: 'See- und Luftdrohnen-Schwarm',
    theater: 'Krim / Sewastopol Hafen',
    operator: 'Ukrainischer Militärgeheimdienst (HUR)',
    droneType: 'Magura V5 (See) & Luftdrohnen',
    swarmSize: 9, // 6 sea + 3 air
    target: { name: 'Marinestützpunkt Sewastopol', lat: 44.6169, lon: 33.5254 },
    launchOrigin: { name: 'Schwarzmeerküste Region Odessa', lat: 46.0112, lon: 30.3312 },
    weaponSystem: 'Magura V5 USV',
    status: 'KRIEGSSCHIFFE BESCHÄDIGT // OPERATION ERFOLGREICH',
    timestamp: '2022-10-29T04:20:00Z',
    summary: 'Ein beispielloser, koordinierter Angriff mit unbemannten Überwasserschiffen (USVs) und Luftdrohnen auf Schiffe der russischen Schwarzmeerflotte in ihrem Heimathafen.',
    severity: 9,
    impactRadiusM: 5000,
    impactPoints: [
      { id: 'ip-sev-1', name: 'Fregatte Admiral Makarow', lat: 44.6169, lon: 33.5254, ordnance: '200kg HE (USV)', craterDiameterM: 0, damageStatus: 'WASSEREINBRUCH / RUMPF BESCHÄDIGT' },
      { id: 'ip-sev-2', name: 'Minensuchboot Iwan Golubez', lat: 44.6175, lon: 33.5280, ordnance: '200kg HE (USV)', craterDiameterM: 0, damageStatus: 'SCHWER BESCHÄDIGT' },
      { id: 'ip-sev-3', name: 'Hafenanlagen / Treibstofftank', lat: 44.6150, lon: 33.5220, ordnance: 'Luftdrohne HE', craterDiameterM: 10, damageStatus: 'EXPLOSION / FEUER' }
    ]
  },
  {
    id: 'drone-ru-belgorod-shebekino',
    title: 'Langstrecken-Drohnenangriff auf Treibstoffdepot Belgorod/Schebekino',
    type: 'Präzisions-Drohnenschlag (Langstrecke)',
    theater: 'Russland / Oblast Belgorod (Grenzregion)',
    operator: 'Ukrainische Streitkräfte / HUR',
    droneType: 'UJ-22 Airborne / Lyutyi',
    swarmSize: 8,
    target: { name: 'Militärisches Logistik- und Treibstoffdepot Schebekino/Belgorod', lat: 50.8000, lon: 36.5000 },
    launchOrigin: { name: 'Region Charkiw', lat: 50.0000, lon: 36.2300 },
    weaponSystem: 'Lyutyi Kamikaze-Drohne (75kg HE)',
    status: 'TREFFER BESTÄTIGT // GROSSBRAND IM DEPOT',
    timestamp: '2024-03-12T04:45:00Z',
    summary: 'Koordinierter Anflug von 8 Lyutyi-Drohnen im Tiefflug auf ein Treibstoffdepot und Umspannwerk. Zwei Treffer lösten einen Großbrand mit dichter Rauchentwicklung aus.',
    severity: 8,
    impactRadiusM: 2000,
    impactPoints: [
      { id: 'ip-belgorod-1', name: 'Treibstofftank 4', lat: 50.8010, lon: 36.5015, ordnance: 'Lyutyi 75kg HE', craterDiameterM: 9, damageStatus: 'GROSSBRAND / AUSGEBRANNT' },
      { id: 'ip-belgorod-2', name: 'Umspannwerk Schebekino', lat: 50.7990, lon: 36.4980, ordnance: 'Lyutyi 75kg HE', craterDiameterM: 7, damageStatus: 'TRANSFORMATOREN ZERSTÖRT' }
    ]
  }
]);

// =============================================================================
// 2. TERROR ATTACKS SEED DATA
// =============================================================================
export const SEED_TERROR_ATTACKS = Object.freeze([
  {
    id: 'terror-moscow-crocus-2024',
    title: 'Anschlag auf die Crocus City Hall',
    type: 'Massenangriff',
    theater: 'Russland / Moskau',
    perpetrator: 'ISPK (Islamischer Staat Provinz Khorasan)',
    location: { name: 'Crocus City Hall, Krasnogorsk', lat: 55.8207, lon: 37.3856 },
    weaponUsed: 'Sturmgewehre, Brandbomben',
    casualties: { killed: 145, wounded: 551 },
    status: 'TÄTER IN HAFT // GEBÄUDE AUSGEBRANNT',
    timestamp: '2024-03-22T19:30:00Z',
    summary: 'Schwer bewaffnete Angreifer stürmten eine Konzerthalle in einem Vorort von Moskau, feuerten wahllos auf Besucher und legten Brände. Einer der tödlichsten Anschläge in Russland.',
    severity: 10,
    impactRadiusM: 1000
  },
  {
    id: 'terror-kabul-airport-2021',
    title: 'Bombenanschlag am Flughafen Kabul',
    type: 'Selbstmordattentat',
    theater: 'Afghanistan / Kabul',
    perpetrator: 'ISPK (Islamischer Staat Provinz Khorasan)',
    location: { name: 'Kabul International Airport (Abbey Gate)', lat: 34.5553, lon: 69.2075 },
    weaponUsed: 'Sprengstoffweste',
    casualties: { killed: 183, wounded: 150 },
    status: 'ABGESCHLOSSEN // TÄTER TOT',
    timestamp: '2021-08-26T17:50:00Z',
    summary: 'Während der Evakuierungsmission detonierte ein Selbstmordattentäter seine Sprengstoffweste in einer Menschenmenge vor dem Abbey Gate des Flughafens Kabul. Auch 13 US-Soldaten starben.',
    severity: 9,
    impactRadiusM: 600
  },
  {
    id: 'terror-nice-truck-2016',
    title: 'Anschlag in Nizza am Nationalfeiertag',
    type: 'Fahrzeugramme',
    theater: 'Frankreich / Nizza',
    perpetrator: 'Islamistischer Einzeltäter (IS-inspiriert)',
    location: { name: 'Promenade des Anglais', lat: 43.6947, lon: 7.2651 },
    weaponUsed: '19-Tonnen LKW, Schusswaffen',
    casualties: { killed: 86, wounded: 458 },
    status: 'TÄTER ERSCHOSSEN',
    timestamp: '2016-07-14T22:30:00Z',
    summary: 'Ein Attentäter fuhr mit einem schweren LKW durch eine Menschenmenge, die das Feuerwerk zum französischen Nationalfeiertag auf der Promenade des Anglais beobachtete.',
    severity: 9,
    impactRadiusM: 2000 // Strecke des LKWs
  },
  {
    id: 'terror-istanbul-airport-2016',
    title: 'Angriff auf den Flughafen Istanbul-Atatürk',
    type: 'Massenangriff & Selbstmordattentat',
    theater: 'Türkei / Istanbul',
    perpetrator: 'IS (Islamischer Staat)',
    location: { name: 'Atatürk International Airport', lat: 41.2617, lon: 28.7416 },
    weaponUsed: 'Sturmgewehre, Sprengstoffwesten',
    casualties: { killed: 45, wounded: 230 },
    status: 'TÄTER TOT // ANLAGE GESICHERT',
    timestamp: '2016-06-28T21:22:00Z',
    summary: 'Drei Selbstmordattentäter bewaffnet mit AK-47 stürmten den internationalen Terminal des Flughafens, schossen auf Passagiere und sprengten sich in die Luft.',
    severity: 8,
    impactRadiusM: 800
  },
  {
    id: 'terror-mogadishu-truck-2017',
    title: 'LKW-Bombenanschlag in Mogadischu',
    type: 'VBIED (Fahrzeugbombe)',
    theater: 'Somalia / Mogadischu',
    perpetrator: 'Al-Shabaab',
    location: { name: 'Zoobe-Kreuzung, Mogadischu', lat: 2.0469, lon: 45.3182 },
    weaponUsed: 'Sprengstoffbeladener LKW',
    casualties: { killed: 587, wounded: 316 },
    status: 'MASSIVE ZERSTÖRUNG',
    timestamp: '2017-10-14T15:15:00Z',
    summary: 'Ein massiver mit Sprengstoff beladener LKW explodierte an einer belebten Kreuzung im Zentrum von Mogadischu. Einer der tödlichsten Terroranschläge der Geschichte.',
    severity: 10,
    impactRadiusM: 1500
  },
  {
    id: 'terror-srilanka-easter-2019',
    title: 'Osteranschläge in Sri Lanka',
    type: 'Koordinierte Bombenanschläge',
    theater: 'Sri Lanka / Colombo & Negombo',
    perpetrator: 'National Thowheeth Jama\'ath (IS-Verbindung)',
    location: { name: 'Mehrere Kirchen und Hotels (Zentrum Colombo)', lat: 6.9271, lon: 79.8612 },
    weaponUsed: 'Sprengstoffwesten',
    casualties: { killed: 269, wounded: 500 },
    status: 'TÄTER TOT // NETZWERK ZERSCHLAGEN',
    timestamp: '2019-04-21T08:45:00Z',
    summary: 'Koordinierte Selbstmordanschläge auf drei christliche Kirchen während der Ostermessen und drei Luxushotels in Sri Lanka.',
    severity: 10,
    impactRadiusM: 4000
  },
  {
    id: 'terror-christchurch-mosques-2019',
    title: 'Anschlag auf Moscheen in Christchurch',
    type: 'Massenangriff',
    theater: 'Neuseeland / Christchurch',
    perpetrator: 'Rechtsextremer Einzeltäter',
    location: { name: 'Al Noor Moschee & Linwood Moschee', lat: -43.5321, lon: 172.6362 },
    weaponUsed: 'Halbautomatische Waffen',
    casualties: { killed: 51, wounded: 40 },
    status: 'TÄTER VERURTEILT',
    timestamp: '2019-03-15T13:40:00Z',
    summary: 'Ein rechtsextremer Terrorist griff während des Freitagsgebets zwei Moscheen in Christchurch an und übertrug die Tat live im Internet.',
    severity: 8,
    impactRadiusM: 3000
  }
]);

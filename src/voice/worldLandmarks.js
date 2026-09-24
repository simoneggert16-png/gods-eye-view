/**
 * World-famous landmarks — single source of truth for instant flights.
 *
 * Why this file exists: Nominatim (OSM) knows most famous buildings, but
 * colloquial German names ("Eiffelturm", "Freiheitsstatue", "Kölner Dom")
 * often miss, and every miss costs a seconds-long upstream roundtrip.
 * This registry resolves them instantly with hand-checked coordinates —
 * no network, no quota, no guessing. Contains worldwide landmarks and
 * curated sites including Epstein Island / Little Saint James.
 *
 * Pure: no DOM, no Cesium, no network — importable from both the browser
 * (src/locations.js, src/voice/gevActions.js) and node (vite.config.js).
 *
 * @module voice/worldLandmarks
 */

/**
 * @typedef {{name:string, lat:number, lon:number, kind:string, aliases:string[], keywords?:string[][]}} WorldLandmark
 * kind: 'building' | 'place' | 'forest' | 'mountain' | 'island'
 * keywords: description groups — a group matches when EVERY keyword appears
 *   in the query ("frühwarnsystem" + "australien" → Pine Gap). For
 *   description search ("das mit den Kuppeln in Australien"), not names.
 */

/** Hand-checked coordinates (WGS84). Aliases are matched case-insensitively. */
export const WORLD_LANDMARKS = Object.freeze([
  // ---- Germany -----------------------------------------------------------
  { name: 'Brandenburg Gate, Berlin', lat: 52.5163, lon: 13.3777, kind: 'building', aliases: ['brandenburg gate', 'brandenburger tor', 'brandenburger tor berlin', 'porte de brandebourg'] },
  { name: 'Reichstag Building, Berlin', lat: 52.5186, lon: 13.3762, kind: 'building', aliases: ['reichstag', 'reichstag berlin', 'reichstagsgebäude', 'reichstagsgebaeude', 'bundestag'] },
  { name: 'Berlin TV Tower', lat: 52.5208, lon: 13.4094, kind: 'building', aliases: ['berliner fernsehturm', 'fernsehturm berlin', 'tv tower berlin', 'alexanderplatz tower'] },
  { name: 'Cologne Cathedral', lat: 50.9413, lon: 6.9583, kind: 'building', aliases: ['kölner dom', 'koelner dom', 'cologne cathedral', 'dom köln', 'dom koeln'] },
  { name: 'Neuschwanstein Castle', lat: 47.5576, lon: 10.7498, kind: 'building', aliases: ['neuschwanstein', 'schloss neuschwanstein', 'neuschwanstein castle', 'königsschloss neuschwanstein'] },
  { name: 'Elbphilharmonie, Hamburg', lat: 53.5413, lon: 9.9841, kind: 'building', aliases: ['elbphilharmonie', 'elphi', 'elbphilharmonie hamburg'] },
  { name: 'Frauenkirche, Dresden', lat: 51.0519, lon: 13.7414, kind: 'building', aliases: ['frauenkirche', 'frauenkirche dresden', 'church of our lady dresden'] },
  { name: 'Sanssouci Palace, Potsdam', lat: 52.4009, lon: 13.0378, kind: 'building', aliases: ['sanssouci', 'schloss sanssouci', 'sanssouci palace', 'sanssouci potsdam'] },
  { name: 'Heidelberg Castle', lat: 49.4107, lon: 8.7156, kind: 'building', aliases: ['heidelberger schloss', 'heidelberg castle', 'schloss heidelberg'] },
  { name: 'Marienplatz, Munich', lat: 48.1374, lon: 11.5755, kind: 'place', aliases: ['marienplatz', 'marienplatz münchen', 'marienplatz muenchen'] },
  { name: 'Oktoberfest Theresienwiese, Munich', lat: 48.1315, lon: 11.5496, kind: 'place', aliases: ['theresienwiese', 'oktoberfest', 'wiesn'] },
  // ---- France ------------------------------------------------------------
  { name: 'Eiffel Tower, Paris', lat: 48.8584, lon: 2.2945, kind: 'building', aliases: ['eiffel tower', 'eiffelturm', 'tour eiffel', 'eiffelturm paris', 'la tour eiffel'] },
  { name: 'Louvre, Paris', lat: 48.8606, lon: 2.3376, kind: 'building', aliases: ['louvre', 'louvre paris', 'musée du louvre', 'louvre museum', 'louvre pyramide', 'louvre pyramid'] },
  { name: 'Arc de Triomphe, Paris', lat: 48.8738, lon: 2.295, kind: 'building', aliases: ['arc de triomphe', 'triumphbogen paris', 'triumphbogen'] },
  { name: 'Notre-Dame de Paris', lat: 48.853, lon: 2.3499, kind: 'building', aliases: ['notre dame', 'notre-dame', 'notre dame paris', 'notre dame de paris'] },
  { name: 'Sacré-Cœur, Paris', lat: 48.8867, lon: 2.3431, kind: 'building', aliases: ['sacre coeur', 'sacré-cœur', 'sacre-coeur', 'sacre coeur paris', 'montmartre basilika', 'basilika montmartre'] },
  { name: 'Palace of Versailles', lat: 48.8049, lon: 2.1204, kind: 'building', aliases: ['versailles', 'schloss versailles', 'palace of versailles', 'château de versailles'] },
  { name: 'Mont-Saint-Michel', lat: 48.6361, lon: -1.5115, kind: 'building', aliases: ['mont saint michel', 'mont-saint-michel', 'kloster mont saint michel'] },
  // ---- UK ----------------------------------------------------------------
  { name: 'Big Ben, London', lat: 51.5007, lon: -0.1246, kind: 'building', aliases: ['big ben', 'big ben london', 'elizabeth tower', 'parliament london', 'houses of parliament', 'westminster'] },
  { name: 'Tower Bridge, London', lat: 51.5055, lon: -0.0754, kind: 'building', aliases: ['tower bridge', 'tower bridge london'] },
  { name: 'London Eye', lat: 51.5033, lon: -0.1195, kind: 'building', aliases: ['london eye', 'millennium wheel'] },
  { name: 'Buckingham Palace', lat: 51.5014, lon: -0.1419, kind: 'building', aliases: ['buckingham palace', 'buckingham palast'] },
  { name: "St. Paul's Cathedral, London", lat: 51.5138, lon: -0.0984, kind: 'building', aliases: ["st paul's cathedral", 'st pauls cathedral', 'paulskathedrale london'] },
  { name: 'Stonehenge', lat: 51.1789, lon: -1.8262, kind: 'place', aliases: ['stonehenge', 'steinkreis stonehenge'] },
  // ---- Southern Europe ----------------------------------------------------
  { name: 'Colosseum, Rome', lat: 41.8902, lon: 12.4922, kind: 'building', aliases: ['colosseum', 'kolosseum', 'kolosseum rom', 'colosseo', 'colosseum rome'] },
  { name: "St. Peter's Basilica, Vatican", lat: 41.9022, lon: 12.4539, kind: 'building', aliases: ["st peter's basilica", 'petersdom', 'petersdom rom', 'vatikan', 'vatican', 'saint peter basilica'] },
  { name: 'Leaning Tower of Pisa', lat: 43.723, lon: 10.3966, kind: 'building', aliases: ['leaning tower of pisa', 'schiefer turm von pisa', 'schiefer turm pisa', 'torre di pisa'] },
  { name: 'Florence Cathedral (Duomo)', lat: 43.7731, lon: 11.256, kind: 'building', aliases: ['florence cathedral', 'duomo florenz', 'dom florenz', 'kathedrale florenz'] },
  { name: "St. Mark's Square, Venice", lat: 45.4342, lon: 12.3384, kind: 'place', aliases: ["st mark's square", 'markusplatz', 'markusplatz venedig', 'piazza san marco'] },
  { name: 'Milan Cathedral (Duomo)', lat: 45.4642, lon: 9.1916, kind: 'building', aliases: ['milan cathedral', 'mailänder dom', 'mailaender dom', 'duomo mailand', 'duomo di milano'] },
  { name: 'Sagrada Familia, Barcelona', lat: 41.4036, lon: 2.1744, kind: 'building', aliases: ['sagrada familia', 'sagrada família', 'sagrada familia barcelona'] },
  { name: 'Alhambra, Granada', lat: 37.176, lon: -3.5899, kind: 'building', aliases: ['alhambra', 'alhambra granada'] },
  { name: 'Park Güell, Barcelona', lat: 41.4145, lon: 2.1527, kind: 'place', aliases: ['park güell', 'park guell', 'park guell barcelona'] },
  { name: 'Belém Tower, Lisbon', lat: 38.6916, lon: -9.216, kind: 'building', aliases: ['belem tower', 'belém tower', 'torre de belem', 'turm von belem'] },
  { name: 'Acropolis, Athens', lat: 37.9715, lon: 23.7267, kind: 'place', aliases: ['acropolis', 'akropolis', 'akropolis athen', 'parthenon'] },
  { name: 'Oia, Santorini', lat: 36.4618, lon: 25.3753, kind: 'place', aliases: ['oia', 'oia santorini', 'santorin', 'santorini'] },
  // ---- Central / Northern Europe ------------------------------------------
  { name: "St. Stephen's Cathedral, Vienna", lat: 48.2082, lon: 16.3738, kind: 'building', aliases: ['stephansdom', 'stephansdom wien', "st stephen's cathedral"] },
  { name: 'Schönbrunn Palace, Vienna', lat: 48.1845, lon: 16.3119, kind: 'building', aliases: ['schönbrunn', 'schoenbrunn', 'schloss schönbrunn', 'schoenbrunn palace'] },
  { name: 'Prague Castle', lat: 50.0901, lon: 14.4008, kind: 'building', aliases: ['prague castle', 'prager burg', 'pražský hrad'] },
  { name: 'Charles Bridge, Prague', lat: 50.0865, lon: 14.4114, kind: 'building', aliases: ['charles bridge', 'karlsbrücke', 'karlsbruecke', 'karlsbrücke prag'] },
  { name: 'Atomium, Brussels', lat: 50.8949, lon: 4.3416, kind: 'building', aliases: ['atomium', 'atomium brüssel', 'atomium bruessel'] },
  { name: 'Rijksmuseum, Amsterdam', lat: 52.36, lon: 4.8852, kind: 'building', aliases: ['rijksmuseum', 'rijksmuseum amsterdam'] },
  { name: 'Nyhavn, Copenhagen', lat: 55.6797, lon: 12.5913, kind: 'place', aliases: ['nyhavn', 'nyhavn kopenhagen', 'nyhavn copenhagen'] },
  // ---- Eastern Europe / Istanbul / Moscow ----------------------------------
  { name: 'Hagia Sophia, Istanbul', lat: 41.0086, lon: 28.9802, kind: 'building', aliases: ['hagia sophia', 'hagiasophia', 'ayasofya', 'hagiasophia istanbul'] },
  { name: 'Blue Mosque, Istanbul', lat: 41.0054, lon: 28.9768, kind: 'building', aliases: ['blue mosque', 'blaue moschee', 'blaue moschee istanbul', 'sultanahmet moschee'] },
  { name: 'Red Square, Moscow', lat: 55.7539, lon: 37.6208, kind: 'place', aliases: ['red square', 'roter platz', 'roter platz moskau', 'kreml', 'kremlin'] },
  { name: "Saint Basil's Cathedral, Moscow", lat: 55.7525, lon: 37.6231, kind: 'building', aliases: ["saint basil's cathedral", 'basilius kathedrale', 'basilius-kathedrale', 'pokrowski kathedrale'] },
  // ---- USA -----------------------------------------------------------------
  { name: 'Statue of Liberty, New York', lat: 40.6892, lon: -74.0445, kind: 'building', aliases: ['statue of liberty', 'freiheitsstatue', 'freiheitsstatue new york', 'lady liberty'] },
  { name: 'Empire State Building', lat: 40.7484, lon: -73.9857, kind: 'building', aliases: ['empire state building', 'empire state'] },
  { name: 'One World Trade Center', lat: 40.7127, lon: -74.0134, kind: 'building', aliases: ['one world trade center', 'world trade center', 'wtc', 'ground zero'] },
  { name: 'Brooklyn Bridge', lat: 40.7061, lon: -73.9969, kind: 'building', aliases: ['brooklyn bridge', 'brooklyn brücke', 'brooklyn bruecke'] },
  { name: 'Times Square, New York', lat: 40.758, lon: -73.9855, kind: 'place', aliases: ['times square', 'times square new york'] },
  { name: 'Central Park, New York', lat: 40.7812, lon: -73.9665, kind: 'place', aliases: ['central park', 'central park new york'] },
  { name: 'Golden Gate Bridge', lat: 37.8199, lon: -122.4783, kind: 'building', aliases: ['golden gate bridge', 'golden gate'] },
  { name: 'Hollywood Sign, Los Angeles', lat: 34.1341, lon: -118.3215, kind: 'place', aliases: ['hollywood sign', 'hollywood schriftzug', 'hollywood zeichen'] },
  { name: 'Space Needle, Seattle', lat: 47.6205, lon: -122.3493, kind: 'building', aliases: ['space needle', 'space needle seattle'] },
  { name: 'White House, Washington DC', lat: 38.8977, lon: -77.0365, kind: 'building', aliases: ['white house', 'weißes haus', 'weisses haus', 'weißes haus washington'] },
  { name: 'White House Helipad / Helikopter-Landeplatz', lat: 38.8967, lon: -77.0365, kind: 'place', aliases: ['white house helipad', 'helikopter landeplatz beim weissen haus', 'helikopter landeplatz weisses haus', 'hubschrauberlandeplatz weisses haus', 'white house south lawn helipad'] },
  { name: 'US Capitol, Washington DC', lat: 38.8897, lon: -77.0091, kind: 'building', aliases: ['us capitol', 'kapitol', 'kapitol washington', 'capitol hill'] },
  { name: 'Texas State Capitol, Austin', lat: 30.2747, lon: -97.7404, kind: 'building', aliases: ['texas state capitol', 'texas capitol', 'kapitol austin', 'texas kapitol'] },
  { name: 'Texas Capitol Underground Extension (Open-air Inverted Rotunda)', lat: 30.2755, lon: -97.7404, kind: 'building', aliases: ['texas capitol underground extension', 'capitol extension rotunda', 'loch im boden kapitol', 'loch im boden austin', 'loch am kapitol', 'inverted rotunda austin', 'capitol extension austin', 'unterirdische capitol extension'] },
  { name: 'Grand Canyon', lat: 36.1069, lon: -112.1129, kind: 'place', aliases: ['grand canyon'] },
  { name: 'Yellowstone Old Faithful', lat: 44.4605, lon: -110.8283, kind: 'place', aliases: ['old faithful', 'yellowstone', 'yellowstone nationalpark'] },
  { name: 'Mount Rushmore', lat: 43.8791, lon: -103.4591, kind: 'place', aliases: ['mount rushmore', 'rushmore'] },
  // ---- Caribbean / Little Saint James (Epstein Island) ---------------------
  { name: 'Epstein Main House / Hauptgebäudekomplex', lat: 18.3015, lon: -64.8260, kind: 'building', aliases: ['epstein main house', 'epstein haupthaus', 'hauptgebäudekomplex', 'hauptgebaeude', 'hauptgebäudekomplex epstein', 'epstein anwesen', 'little saint james main house', 'little saint james mansion'] },
  { name: 'Epstein Temple / Tempel', lat: 18.2983, lon: -64.8282, kind: 'building', aliases: ['epstein temple', 'epstein tempel', 'epsteins tempel', 'the temple little saint james', 'little saint james temple', 'seinen tempel', 'tempel auf der insel'] },
  // ---- Famous Estates & Mansions (USA) ---------------------------------------
  {
    name: 'Sean "Diddy" Combs Holmby Hills Mansion, Los Angeles',
    lat: 34.0788,
    lon: -118.4312,
    kind: 'building',
    aliases: [
      'diddys villa', 'diddy villa', 'diddys villa in den usa', 'diddy villa in den usa',
      'diddys villa in los angeles', 'diddy villa in los angeles', 'diddys mansion', 'diddy mansion',
      'diddys anwesen', 'diddy anwesen', 'diddys haus', 'diddy haus', 'diddys haus in los angeles',
      'diddys estate', 'diddy estate', 'sean combs mansion', 'sean combs villa', 'sean combs anwesen',
      '400 south mapleton drive', '400 s mapleton dr', '400 south mapleton dr', '400 s mapleton drive',
      'diddys haus usa', 'diddys villa usa',
    ],
    keywords: [
      ['diddy', 'villa'],
      ['diddys', 'villa'],
      ['diddy', 'mansion'],
      ['diddys', 'mansion'],
      ['diddy', 'haus'],
      ['diddys', 'haus'],
      ['diddy', 'anwesen'],
      ['diddys', 'anwesen'],
      ['combs', 'villa'],
      ['combs', 'mansion'],
    ],
  },
  {
    name: 'Sean "Diddy" Combs Star Island Estate, Miami',
    lat: 25.7781,
    lon: -80.1502,
    kind: 'building',
    aliases: [
      'diddys miami villa', 'diddy miami villa', 'diddys villa in miami', 'diddy villa in miami',
      'diddys miami mansion', 'diddy miami mansion', 'diddys star island', 'diddy star island',
      'diddys star island villa', 'diddys haus in miami', 'diddys anwesen in miami',
    ],
    keywords: [
      ['diddy', 'miami'],
      ['diddys', 'miami'],
      ['diddy', 'star', 'island'],
      ['diddys', 'star', 'island'],
    ],
  },
  {
    name: 'Playboy Mansion, Los Angeles',
    lat: 34.0768,
    lon: -118.4297,
    kind: 'building',
    aliases: ['playboy mansion', 'playboy villa', 'hugh hefner mansion', 'hugh hefner villa', 'playboy anwesen'],
  },
  {
    name: 'Neverland Ranch, California',
    lat: 34.7447,
    lon: -120.0883,
    kind: 'place',
    aliases: ['neverland', 'neverland ranch', 'michael jackson ranch', 'michael jackson anwesen', 'sycamore valley ranch'],
  },
  {
    name: 'Mar-a-Lago, Palm Beach',
    lat: 26.6771,
    lon: -80.0370,
    kind: 'building',
    aliases: ['mar-a-lago', 'mar a lago', 'trumps villa', 'trump villa', 'trump anwesen', 'trump estate'],
  },
  // ---- Latin America --------------------------------------------------------
  { name: 'Christ the Redeemer, Rio', lat: -22.9519, lon: -43.2105, kind: 'building', aliases: ['christ the redeemer', 'cristo redentor', 'christusstatue rio', 'christus rio', 'jesusstatue rio'] },
  { name: 'Machu Picchu', lat: -13.1631, lon: -72.545, kind: 'place', aliases: ['machu picchu'] },
  { name: 'Chichen Itza', lat: 20.6843, lon: -88.5678, kind: 'place', aliases: ['chichen itza', 'chichén itzá', 'kukulkan pyramide'] },
  { name: 'Sugarloaf Mountain, Rio', lat: -22.9486, lon: -43.1576, kind: 'mountain', aliases: ['sugarloaf', 'zuckerhut', 'zuckerhut rio', 'pão de açúcar'] },
  // ---- Middle East / Africa --------------------------------------------------
  { name: 'Pyramids of Giza', lat: 29.9792, lon: 31.1342, kind: 'place', aliases: ['pyramids of giza', 'pyramiden von gizeh', 'pyramiden gizeh', 'cheops pyramide', 'gizeh'] },
  { name: 'Great Sphinx of Giza', lat: 29.9753, lon: 31.1376, kind: 'building', aliases: ['sphinx', 'sphinx gizeh', 'great sphinx'] },
  { name: 'Petra, Jordan', lat: 30.3285, lon: 35.4444, kind: 'place', aliases: ['petra', 'petra jordanien', 'felsentempel petra', 'schatzhaus petra'] },
  { name: 'Burj Khalifa, Dubai', lat: 25.1972, lon: 55.2744, kind: 'building', aliases: ['burj khalifa', 'burj chalifa', 'burj khalifa dubai'] },
  { name: 'Burj Al Arab, Dubai', lat: 25.1412, lon: 55.1853, kind: 'building', aliases: ['burj al arab', 'burj al arab dubai'] },
  { name: 'Sheikh Zayed Mosque, Abu Dhabi', lat: 24.4128, lon: 54.4753, kind: 'building', aliases: ['sheikh zayed mosque', 'scheich zayid moschee', 'große moschee abu dhabi'] },
  // ---- Asia -------------------------------------------------------------------
  { name: 'Taj Mahal, Agra', lat: 27.1751, lon: 78.0421, kind: 'building', aliases: ['taj mahal'] },
  { name: 'Great Wall (Badaling), China', lat: 40.4319, lon: 116.5704, kind: 'place', aliases: ['great wall', 'große mauer', 'grosse mauer', 'chinesische mauer', 'chinesische mauer badaling'] },
  { name: 'Forbidden City, Beijing', lat: 39.9163, lon: 116.3972, kind: 'place', aliases: ['forbidden city', 'verbotene stadt', 'verbotene stadt peking'] },
  { name: 'Tokyo Tower', lat: 35.6586, lon: 139.7454, kind: 'building', aliases: ['tokyo tower', 'tokioter turm'] },
  { name: 'Tokyo Skytree', lat: 35.7101, lon: 139.8107, kind: 'building', aliases: ['tokyo skytree', 'skytree'] },
  { name: 'Senso-ji, Tokyo', lat: 35.7148, lon: 139.7967, kind: 'building', aliases: ['senso-ji', 'sensoji', 'senso ji', 'asakusa tempel'] },
  { name: 'Mount Fuji', lat: 35.3606, lon: 138.7274, kind: 'mountain', aliases: ['mount fuji', 'fuji', 'fujisan', 'berg fuji'] },
  { name: 'Petronas Towers, Kuala Lumpur', lat: 3.1579, lon: 101.7116, kind: 'building', aliases: ['petronas towers', 'petronas türme', 'petronas tuerme'] },
  { name: 'Marina Bay Sands, Singapore', lat: 1.2836, lon: 103.8607, kind: 'building', aliases: ['marina bay sands', 'marina bay'] },
  { name: 'Angkor Wat, Cambodia', lat: 13.4125, lon: 103.867, kind: 'place', aliases: ['angkor wat', 'angkor'] },
  { name: 'Mount Everest, Himalayas', lat: 27.9881, lon: 86.9250, kind: 'mountain', aliases: ['mount everest', 'everest', 'chomolungma', 'sagarmāthā'] },
  { name: 'Matterhorn, Alps', lat: 45.9765, lon: 7.6585, kind: 'mountain', aliases: ['matterhorn', 'mont cervin', 'monte cervino'] },
  { name: 'Victoria Falls', lat: -17.9243, lon: 25.8572, kind: 'place', aliases: ['victoria falls', 'victoriafälle', 'victoriafaelle', 'mosi-oa-tunya'] },
  { name: 'Mariana Trench (Challenger Deep)', lat: 11.3733, lon: 142.5917, kind: 'place', aliases: ['mariana trench', 'marianengraben', 'challenger deep', 'challengertief'] },
  { name: 'Tromsø (Aurora Borealis)', lat: 69.6492, lon: 18.9553, kind: 'place', aliases: ['aurora borealis tromsø', 'polarlichter tromsø', 'tromsø', 'tromsoe'] },
  { name: 'Sydney Opera House', lat: -33.8568, lon: 151.2153, kind: 'building', aliases: ['sydney opera house', 'opernhaus sydney', 'sydney oper', 'opera house sydney'] },
  { name: 'Sydney Harbour Bridge', lat: -33.8523, lon: 151.2108, kind: 'building', aliases: ['sydney harbour bridge', 'hafenbrücke sydney'] },
  // ---- Early-warning / intel sites (domes, radomes) ---------------------------
  // Pine Gap: 38 radomes + DSP/SBIRS relay = the "Frühwarnsystem mit den
  // großen Kuppeln in Australien". Verified: -23.80, 133.7375 (Wikipedia).
  { name: 'Joint Defence Facility Pine Gap', lat: -23.8, lon: 133.7375, kind: 'place',
    aliases: ['pine gap', 'joint defence facility pine gap', 'joint defense facility pine gap', 'pine gap alice springs', 'jdfpg'],
    keywords: [
      ['frühwarnsystem', 'australien'],
      ['fruehwarnsystem', 'australien'],
      ['raketenfrühwarnung', 'australien'],
      ['raketenfruehwarnung', 'australien'],
      ['abhörstation', 'australien'],
      ['abhoerstation', 'australien'],
      ['radom', 'australien'],
      ['kuppeln', 'australien'],
    ] },
  // ---- German forests & nature (for "diesen Wald") ------------------------------
  { name: 'Black Forest (Schwarzwald)', lat: 48.13, lon: 8.23, kind: 'forest', aliases: ['schwarzwald', 'black forest'] },
  { name: 'Bavarian Forest (Bayerischer Wald)', lat: 49.0, lon: 13.2, kind: 'forest', aliases: ['bayerischer wald', 'bayerwald', 'bavarian forest'] },
  { name: 'Harz (Brocken)', lat: 51.8005, lon: 10.6185, kind: 'forest', aliases: ['harz', 'brocken', 'harz brocken'] },
  { name: 'Teutoburg Forest', lat: 51.9, lon: 8.83, kind: 'forest', aliases: ['teutoburger wald', 'teutoburg forest'] },
  { name: 'Spreewald', lat: 51.87, lon: 14.02, kind: 'forest', aliases: ['spreewald'] },
  { name: 'Palatinate Forest (Pfälzerwald)', lat: 49.29, lon: 7.87, kind: 'forest', aliases: ['pfälzerwald', 'pfaelzerwald', 'palatinate forest'] },
  { name: 'Odenwald', lat: 49.55, lon: 9.02, kind: 'forest', aliases: ['odenwald'] },
  { name: 'Eifel (Hohe Acht)', lat: 50.3858, lon: 7.0111, kind: 'forest', aliases: ['eifel', 'hohe acht'] },
  { name: 'Thuringian Forest (Thüringer Wald)', lat: 50.66, lon: 10.74, kind: 'forest', aliases: ['thüringer wald', 'thueringer wald', 'thuringian forest'] },
  { name: 'Saxon Switzerland (Sächsische Schweiz)', lat: 50.9622, lon: 14.0737, kind: 'forest', aliases: ['sächsische schweiz', 'saechsische schweiz', 'bastei', 'saxon switzerland'] },
  { name: 'Zugspitze', lat: 47.4211, lon: 10.9854, kind: 'mountain', aliases: ['zugspitze'] },
  { name: 'Berchtesgaden / Königssee', lat: 47.59, lon: 12.99, kind: 'place', aliases: ['berchtesgaden', 'königssee', 'koenigssee'] },
]);

/** Lowercase alias → landmark index. Built once; longest-alias match wins. */
const ALIAS_INDEX = (() => {
  const entries = [];
  WORLD_LANDMARKS.forEach((mark, index) => {
    const all = [mark.name, ...(mark.aliases || [])];
    for (const alias of all) {
      const key = normalizeLandmarkText(alias);
      if (key && key.length >= 2) entries.push({ key, index });
    }
  });
  // Longest first so "sacre coeur paris" beats "sacre coeur".
  entries.sort((a, b) => b.key.length - a.key.length);
  return entries;
})();

/** Pre-normalized keyword groups → landmark index for description search. */
const KEYWORD_INDEX = (() => {
  const entries = [];
  WORLD_LANDMARKS.forEach((mark, index) => {
    for (const group of mark.keywords || []) {
      const words = group
        .map((w) => String(w || '').toLowerCase().normalize('NFC').trim())
        .filter((w) => w.length >= 3);
      if (words.length) entries.push({ words, index });
    }
  });
  return entries;
})();

/** Glue words ignored by token-set matching (articles, prepositions). */
const LANDMARK_TOKEN_STOPWORDS = new Set([
  'der', 'die', 'das', 'den', 'dem', 'des', 'the', 'a', 'an',
  'beim', 'beim', 'am', 'im', 'in', 'an', 'auf', 'zu', 'zum', 'zur',
  'von', 'vom', 'bei', 'mit', 'und', 'and', 'near', 'at', 'of',
  'le', 'la', 'les', 'de', 'du', 'des', 'el', 'al',
]);

/**
 * Fold + stem one token for fuzzy name matching: umlauts/ß folded
 * (weiß→weiss, kölner→kolner, koelner→kolner) and German adjective endings
 * stripped (weisses/weissen→weiss, grossen→gross). Applied to BOTH alias and
 * query tokens, so declined forms meet ("beim weissen Haus" → "weisses Haus").
 * Pure.
 */
export function stemLandmarkToken(word) {
  let w = String(word || '').toLowerCase().normalize('NFC')
    .replace(/[''´`]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u');
  w = w.replace(/[^a-z0-9]/g, '')
    .replace(/ae/g, 'a').replace(/oe/g, 'o').replace(/ue/g, 'u');
  if (w.length >= 4 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
  if (w.length >= 5) w = w.replace(/(es|en|em|er|e)$/, '');
  return w;
}

/** Stemmed content-token set of a free-form text. Pure. */
export function landmarkTokenSet(text) {
  return new Set(
    String(text || '').toLowerCase().normalize('NFC').split(/[^a-zäöüß0-9]+/i)
      .map(stemLandmarkToken)
      .filter((w) => w.length > 2 && !LANDMARK_TOKEN_STOPWORDS.has(w)),
  );
}

/**
 * Multi-word alias token sets → landmark index, most specific first.
 * Single-word aliases stay on exact/containment (less noise).
 */
const TOKEN_SET_INDEX = (() => {
  const entries = [];
  WORLD_LANDMARKS.forEach((mark, index) => {
    const seen = new Set();
    for (const alias of [mark.name, ...(mark.aliases || [])]) {
      const tokens = landmarkTokenSet(alias);
      if (tokens.size < 2) continue;
      const key = [...tokens].sort().join(' ');
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({ tokens, size: tokens.size, index });
    }
  });
  entries.sort((a, b) => b.size - a.size);
  return entries;
})();

/**
 * Normalize a query for landmark matching: lowercase, trim, collapse
 * whitespace, strip leading articles and trailing direction words.
 * Pure.
 */
export function normalizeLandmarkText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFC')
    .replace(/[''´`]/g, '')
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(der|die|das|den|dem|des|the|le|la|les)\s+/i, '')
    .replace(/\s+(ein|ab|an|auf|rein|raus)$/i, '')
    .trim();
}

/**
 * Find a world-famous landmark by free-form query (German or English).
 * Exact match first, then longest-alias substring containment
 * ("Eiffelturm in Paris" contains "eiffelturm").
 * Possessives ("Epsteins", "Eiffelturms") are tolerated via a de-ß/de-s pass.
 *
 * @param {string} query
 * @returns {{name:string, lat:number, lon:number, kind:string}|null}
 */
export function findWorldLandmark(query) {
  const norm = normalizeLandmarkText(query);
  if (!norm || norm.length < 2) return null;
  // 1. exact alias hit
  for (const { key, index } of ALIAS_INDEX) {
    if (norm === key) return pickLandmark(index);
  }
  // 2. possessive-stripped exact ("eiffelturms" → "eiffelturm")
  const degs = norm.replace(/\b([a-zäöüß]{4,})s\b/gi, '$1');
  if (degs !== norm) {
    for (const { key, index } of ALIAS_INDEX) {
      if (degs === key) return pickLandmark(index);
    }
  }
  // 3. longest-alias containment (alias ≥ 4 chars to avoid "dom" noise)
  for (const { key, index } of ALIAS_INDEX) {
    if (key.length < 4) continue;
    if (norm.includes(key)) return pickLandmark(index);
  }
  // 4. stemmed token-set containment ("helikopter landeplatz beim weissen
  // haus" contains {weiss, haus} → White House). Most specific alias first;
  // multi-word aliases only, so single shared tokens can't misfire.
  const queryTokens = landmarkTokenSet(norm);
  if (queryTokens.size >= 2) {
    for (const { tokens, index } of TOKEN_SET_INDEX) {
      let hit = true;
      for (const token of tokens) {
        if (!queryTokens.has(token)) { hit = false; break; }
      }
      if (hit) return pickLandmark(index);
    }
  }
  // 5. description keywords: EVERY keyword of any group must appear
  // ("das frühwarnsystem in australien mit den kuppeln" → Pine Gap).
  for (const { words, index } of KEYWORD_INDEX) {
    if (words.every((w) => norm.includes(w))) return pickLandmark(index);
  }
  return null;
}

function pickLandmark(index) {
  const mark = WORLD_LANDMARKS[index];
  if (!mark) return null;
  return { name: mark.name, lat: mark.lat, lon: mark.lon, kind: mark.kind };
}

/**
 * Alias → canonical name dict for the backend /api/geocode fallback table.
 * Pure; keys are already normalized lowercase.
 */
export function worldLandmarkAliasDict() {
  const dict = {};
  for (const mark of WORLD_LANDMARKS) {
    for (const alias of [mark.name, ...(mark.aliases || [])]) {
      const key = normalizeLandmarkText(alias);
      if (key && !(key in dict)) dict[key] = mark.name;
    }
  }
  return dict;
}

/**
 * Canonical lowercase name → {lat, lon, label} for direct backend answers
 * without any upstream Nominatim call. Pure.
 */
export function worldLandmarkCoordDict() {
  const dict = {};
  for (const mark of WORLD_LANDMARKS) {
    dict[mark.name.toLowerCase()] = { lat: mark.lat, lon: mark.lon, label: mark.name };
  }
  return dict;
}

async function test() {
  // Check common major Swiss river stations
  // 2018: Aare Bern, 2099: Limmat Zürich, 2152: Reuss Luzern, 2009: Rhein Basel, etc.
  const stations = [
    { id: 2018, name: 'Aare Bern' },
    { id: 2099, name: 'Limmat Zürich' },
    { id: 2152, name: 'Reuss Luzern' },
    { id: 2009, name: 'Rhein Basel' },
    { id: 2160, name: 'Rhône Genève' },
    { id: 2473, name: 'Rhein Diepoldsau' },
    { id: 2016, name: 'Rhein Neuhausen' },
  ];
  for (const s of stations) {
    try {
      const url = `https://www.hydrodaten.admin.ch/documents/Stationsbilder/P${s.id}.png`;
      const res = await fetch(url, { method: 'HEAD' });
      console.log(s.id, s.name, res.status);
    } catch (e) {
      console.log(s.id, s.name, e.message);
    }
  }
}
test();

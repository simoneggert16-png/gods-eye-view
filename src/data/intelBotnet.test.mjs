import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractGeometryCentroid,
  normalizeNoaaAlerts,
  normalizeSwissNodes,
  normalizeTacticalNews,
  SWISS_INTEL_NODES,
} from './intelBotnet.js';

describe('intelBotnet module', () => {
  it('extracts centroid from Point geometry', () => {
    const pt = { type: 'Point', coordinates: [8.5417, 47.3769] };
    const centroid = extractGeometryCentroid(pt);
    assert.deepEqual(centroid, { latitude: 47.3769, longitude: 8.5417 });
  });

  it('extracts centroid from Polygon geometry', () => {
    const poly = {
      type: 'Polygon',
      coordinates: [
        [
          [10.0, 40.0],
          [20.0, 40.0],
          [20.0, 50.0],
          [10.0, 50.0],
          [10.0, 40.0],
        ],
      ],
    };
    const centroid = extractGeometryCentroid(poly);
    assert.ok(centroid);
    assert.equal(typeof centroid.latitude, 'number');
    assert.equal(typeof centroid.longitude, 'number');
    assert.ok(centroid.latitude >= 40 && centroid.latitude <= 50);
    assert.ok(centroid.longitude >= 10 && centroid.longitude <= 20);
  });

  it('returns null for empty or invalid geometry', () => {
    assert.equal(extractGeometryCentroid(null), null);
    assert.equal(extractGeometryCentroid({ type: 'LineString', coordinates: [] }), null);
    assert.equal(extractGeometryCentroid({ type: 'Polygon', coordinates: [[]] }), null);
  });

  it('normalizes NOAA severe alerts correctly', () => {
    const fixture = {
      features: [
        {
          geometry: {
            type: 'Polygon',
            coordinates: [
              [[-90.0, 35.0], [-89.0, 35.0], [-89.0, 36.0], [-90.0, 36.0], [-90.0, 35.0]],
            ],
          },
          properties: {
            id: 'urn:oid:test-tornado-1',
            event: 'Tornado Warning',
            severity: 'Extreme',
            headline: 'Tornado Warning issued for Shelby County',
            areaDesc: 'Shelby, TN',
            description: 'A destructive tornado was confirmed near Memphis.',
            senderName: 'NWS Memphis',
          },
        },
        {
          geometry: null,
          properties: {
            id: 'urn:oid:test-flood-1',
            event: 'Flash Flood Warning',
            severity: 'Severe',
            headline: 'Flash Flood Warning in Utah',
            areaDesc: 'Garfield, UT',
            description: 'Flash flooding occurring or imminent.',
          },
        },
        {
          geometry: null,
          properties: {
            id: 'urn:oid:test-small-craft',
            event: 'Small Craft Advisory',
            severity: 'Minor',
          },
        },
      ],
    };

    const dispatches = normalizeNoaaAlerts(fixture);
    assert.equal(dispatches.length, 2); // Small craft advisory filtered out

    const tornado = dispatches.find((d) => d.isTornado);
    assert.ok(tornado);
    assert.equal(tornado.severity, 'CRITICAL');
    assert.equal(tornado.category, 'UNWETTER');
    assert.ok(tornado.title.includes('TORNADO'));
    assert.equal(tornado.locationName, 'Shelby, TN');
    assert.ok(tornado.coordinates);
    assert.ok(tornado.polygon);

    const flood = dispatches.find((d) => !d.isTornado);
    assert.ok(flood);
    assert.equal(flood.severity, 'SEVERE');
    assert.equal(flood.category, 'UNWETTER');
  });

  it('normalizes Swiss nodes with valid coordinates and CCTV IDs', () => {
    const nodes = normalizeSwissNodes();
    assert.equal(nodes.length, SWISS_INTEL_NODES.length);

    for (const node of nodes) {
      assert.equal(node.category, 'SCHWEIZ');
      assert.ok(node.title.startsWith('🇨🇭'));
      assert.ok(node.coordinates.latitude > 45 && node.coordinates.latitude < 48);
      assert.ok(node.coordinates.longitude > 5 && node.coordinates.longitude < 11);
      assert.ok(node.summary.length > 10);
      assert.ok(node.cctvId);
      assert.equal(node.hasBriefing, true);
    }
  });

  it('normalizes GDELT tactical news', () => {
    const fixture = {
      articles: [
        {
          title: 'Air Defense Systems Deployed in Eastern Flank',
          url: 'https://news.example.com/defense-1',
          domain: 'defensenews.com',
          sourcecountry: 'Poland',
          seendate: '20260916T140000Z',
        },
        {
          title: '',
        },
      ],
    };

    const news = normalizeTacticalNews(fixture);
    assert.equal(news.length, 1);
    assert.equal(news[0].category, 'GEOPOLITICS');
    assert.equal(news[0].source, 'DEFENSENEWS.COM');
    assert.ok(news[0].title.includes('Air Defense'));
  });

  it('normalizes USGS Earthquakes correctly', async () => {
    const { normalizeUsgsQuakes } = await import('./intelBotnet.js');
    const fixture = {
      features: [
        {
          id: 'test-quake-1',
          properties: {
            mag: 5.8,
            place: '14 km SW of Hualien City, Taiwan',
            time: 1789631787140,
            status: 'reviewed',
            tsunami: 0,
            net: 'us',
          },
          geometry: {
            type: 'Point',
            coordinates: [121.5, 23.8, 15.2],
          },
        },
        {
          id: 'test-quake-minor',
          properties: {
            mag: 1.2,
            place: 'Minor tremor',
          },
          geometry: {
            type: 'Point',
            coordinates: [-117.0, 34.0, 5.0],
          },
        },
      ],
    };

    const quakes = normalizeUsgsQuakes(fixture);
    assert.equal(quakes.length, 1); // Minor tremor filtered out (< 2.5)
    assert.equal(quakes[0].category, 'CRISIS');
    assert.equal(quakes[0].severity, 'SEVERE');
    assert.equal(quakes[0].isSeismic, true);
    assert.equal(quakes[0].magnitude, 5.8);
    assert.equal(quakes[0].depthKm, 15.2);
    assert.ok(quakes[0].seismicRadius > 50000);
    assert.equal(quakes[0].coordinates.latitude, 23.8);
    assert.equal(quakes[0].coordinates.longitude, 121.5);
    assert.ok(quakes[0].title.includes('M5.8'));
    assert.ok(quakes[0].title.includes('Taiwan'));
  });

  it('normalizes NASA EONET events for storms and wildfires', async () => {
    const { normalizeEonetEvents } = await import('./intelBotnet.js');
    const fixture = {
      events: [
        {
          id: 'EONET_CYCLONE_1',
          title: 'Tropical Cyclone Storm Test',
          categories: [{ id: 'severeStorms', title: 'Severe Storms' }],
          sources: [{ id: 'JTWC' }],
          geometry: [
            { date: '2026-09-15T00:00:00Z', coordinates: [-130.0, 18.0] },
            { date: '2026-09-16T12:00:00Z', coordinates: [-135.0, 19.5] },
          ],
        },
        {
          id: 'EONET_FIRE_1',
          title: 'Cascades Complex Wildfire',
          categories: [{ id: 'wildfires', title: 'Wildfires' }],
          sources: [{ id: 'InciWeb' }],
          geometry: [
            { date: '2026-09-16T10:00:00Z', coordinates: [-121.5, 44.2] },
          ],
        },
      ],
    };

    const events = normalizeEonetEvents(fixture);
    assert.equal(events.length, 2);

    const cyclone = events.find((e) => e.category === 'UNWETTER');
    assert.ok(cyclone);
    assert.equal(cyclone.severity, 'CRITICAL');
    assert.equal(cyclone.coordinates.latitude, 19.5);
    assert.equal(cyclone.coordinates.longitude, -135.0);

    const fire = events.find((e) => e.category === 'CRISIS');
    assert.ok(fire);
    assert.equal(fire.severity, 'SEVERE');
    assert.equal(fire.coordinates.latitude, 44.2);
    assert.equal(fire.coordinates.longitude, -121.5);
  });

  it('normalizes geopolitical news RSS with military filtering and hotspot geotagging', async () => {
    const { normalizeGeopoliticalNews } = await import('./intelBotnet.js');
    const rss = `
      <rss version="2.0">
        <channel>
          <item>
            <title>NATO conducts joint military air defense patrol near Baltic Sea - Reuters</title>
            <link>https://example.com/nato-1</link>
            <pubDate>Wed, 16 Sep 2026 14:00:00 GMT</pubDate>
            <source>Reuters</source>
          </item>
          <item>
            <title>Taiwan defense ministry detects naval vessel activity in strait - Focus Taiwan</title>
            <link>https://example.com/taiwan-1</link>
            <pubDate>Wed, 16 Sep 2026 15:00:00 GMT</pubDate>
            <source>Focus Taiwan</source>
          </item>
          <item>
            <title>Celebrity cooking show announces new season - Daily Gossip</title>
            <link>https://example.com/cooking-1</link>
            <pubDate>Wed, 16 Sep 2026 12:00:00 GMT</pubDate>
            <source>Daily Gossip</source>
          </item>
        </channel>
      </rss>
    `;

    const news = normalizeGeopoliticalNews(rss);
    assert.equal(news.length, 2); // Cooking show filtered out

    const natoItem = news[0];
    assert.equal(natoItem.category, 'GEOPOLITICS');
    assert.ok(natoItem.locationName.includes('Baltikum') || natoItem.locationName.includes('NATO'));
    assert.ok(natoItem.coordinates.latitude > 50);

    const taiwanItem = news[1];
    assert.equal(taiwanItem.category, 'GEOPOLITICS');
    assert.ok(taiwanItem.locationName.includes('Taiwan'));
    assert.equal(taiwanItem.coordinates.latitude, 24.5);
  });

  it('prevents publisher suffix like - Israel Hayom from mis-geotagging European conflicts to Israel', async () => {
    const { normalizeGeopoliticalNews } = await import('./intelBotnet.js');
    const rss = `
      <rss version="2.0">
        <channel>
          <item>
            <title>Europe braces for war as Russia tests NATO’s red lines - Israel Hayom</title>
            <link>https://example.com/russia-nato</link>
            <pubDate>Mon, 21 Sep 2026 21:45:00 GMT</pubDate>
            <source>Israel Hayom</source>
          </item>
        </channel>
      </rss>
    `;
    const news = normalizeGeopoliticalNews(rss);
    assert.equal(news.length, 1);
    assert.notEqual(news[0].locationName, 'Levante / Israel & Gazastreifen', 'Must not geotag Russia/NATO to Israel');
    assert.ok(news[0].locationName.includes('Russland') || news[0].locationName.includes('NATO') || news[0].locationName.includes('Moskau'));
  });

  it('rejects requestAbacusBriefing when no API key is provided', async () => {
    const { requestAbacusBriefing } = await import('./intelBotnet.js');
    await assert.rejects(
      () => requestAbacusBriefing({ headline: 'Test', apiKey: '', allowFallback: false }),
      /ABACUS_API_KEY ist nicht konfiguriert/
    );
  });

  it('correctly geotags Ethiopia conflict to East Africa and not to Bavaria', async () => {
    const { normalizeGeopoliticalNews } = await import('./intelBotnet.js');
    const rss = `
      <rss version="2.0">
        <channel>
          <item>
            <title>Ethiopia conflict: Seven armed groups form alliance against Abiy Ahmed - BBC News</title>
            <link>https://example.com/ethiopia-1</link>
            <pubDate>Mon, 21 Sep 2026 10:00:00 GMT</pubDate>
            <source>BBC News</source>
          </item>
        </channel>
      </rss>
    `;

    const news = normalizeGeopoliticalNews(rss);
    assert.equal(news.length, 1);
    const item = news[0];
    assert.equal(item.category, 'GEOPOLITICS');
    assert.ok(item.locationName.includes('Äthiopien') || item.locationName.includes('Horn von Afrika'));
    // Must be in Ethiopia (~9° N, ~38° E), NOT Bavaria (48.8566, 12.3522)!
    assert.ok(Math.abs(item.coordinates.latitude - 9.03) < 1.0, `Latitude was ${item.coordinates.latitude}, expected ~9.03`);
    assert.ok(Math.abs(item.coordinates.longitude - 38.74) < 1.0, `Longitude was ${item.coordinates.longitude}, expected ~38.74`);
  });

  it('generates a landlocked-aware, alliance-aware SITREP without maritime tracking for Ethiopia', async () => {
    const { generateTacticalFallbackSitrep } = await import('./intelBotnet.js');
    const sitrep = generateTacticalFallbackSitrep({
      headline: '⚔️ Ethiopia conflict: Seven armed groups form alliance against Abiy Ahmed',
      locationName: 'Äthiopien / Horn von Afrika (Addis Abeba)',
      category: 'GEOPOLITICS',
      details: 'Seven armed groups form alliance against Abiy Ahmed. Gemeldet von BBC.',
      lat: 9.03,
      lon: 38.74,
    });

    assert.ok(sitrep.includes('ASYMMETRISCHE KOALITIONSBILDUNG'), 'Should identify alliance formation');
    assert.ok(sitrep.includes('Binnenland-Operationsraum'), 'Should identify landlocked region');
    assert.ok(sitrep.includes('SIGINT-Funkpeilung') || sitrep.includes('HF/VHF-Funkaufklärung'), 'Should recommend ground/SIGINT measures');
    assert.equal(sitrep.toLowerCase().includes('maritime tracking'), false, 'Must NOT mention maritime tracking for landlocked Ethiopia');
  });

  it('geotags unknown military conflicts to UN-HQ instead of Bavaria', async () => {
    const { normalizeGeopoliticalNews } = await import('./intelBotnet.js');
    const rss = `
      <rss version="2.0">
        <channel>
          <item>
            <title>Global defense intelligence command issues high alert for international military exercise</title>
            <link>https://example.com/global-1</link>
            <pubDate>Mon, 21 Sep 2026 10:00:00 GMT</pubDate>
            <source>Defense Wire</source>
          </item>
        </channel>
      </rss>
    `;

    const news = normalizeGeopoliticalNews(rss);
    assert.equal(news.length, 1);
    const item = news[0];
    assert.ok(item.locationName.includes('UN-HQ') || item.locationName.includes('Sicherheitsrat'));
    // Should NOT be Bavaria (48.8566, 12.3522)
    assert.notEqual(item.coordinates.latitude, 48.8566);
    assert.notEqual(item.coordinates.longitude, 12.3522);
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MARKET_SYMBOLS,
  SEED_MARKET_DATA,
  CURATED_ASSETS_REGISTRY,
  fetchLiveMarketQuotes,
  analyzeGeopoliticalMarketImpact,
  searchFinancialSymbols,
  fetchAssetDeepDive,
  generateAssetPrognosis,
  generateTopBreakoutStocks,
} from './geoMarketEngine.js';

describe('GeoMarketEngine', () => {
  it('defines valid core market symbols', () => {
    assert.ok(MARKET_SYMBOLS.length >= 8);
    const symbols = MARKET_SYMBOLS.map((s) => s.symbol);
    assert.ok(symbols.includes('BZ=F'), 'Brent Crude present');
    assert.ok(symbols.includes('GC=F'), 'Gold present');
    assert.ok(symbols.includes('^GSPC'), 'S&P 500 present');
    assert.ok(symbols.includes('^VIX'), 'VIX present');
    assert.ok(symbols.includes('BTC-USD'), 'Bitcoin present');
  });

  it('provides complete seed market fallback data', () => {
    assert.equal(SEED_MARKET_DATA.length, MARKET_SYMBOLS.length);
    for (const item of SEED_MARKET_DATA) {
      assert.ok(typeof item.price === 'number' && item.price > 0, `Price valid for ${item.symbol}`);
      assert.ok(typeof item.changePct === 'string', `ChangePct valid for ${item.symbol}`);
      assert.ok(typeof item.isPositive === 'boolean', `isPositive boolean for ${item.symbol}`);
    }
  });

  it('contains extensive curated assets registry', () => {
    assert.ok(CURATED_ASSETS_REGISTRY.length >= 15);
    const symbols = CURATED_ASSETS_REGISTRY.map((a) => a.symbol);
    assert.ok(symbols.includes('RHM.DE'), 'Rheinmetall present in registry');
    assert.ok(symbols.includes('LMT'), 'Lockheed present in registry');
    assert.ok(symbols.includes('HAG.DE'), 'Hensoldt present in registry');
    assert.ok(symbols.includes('NVDA'), 'Nvidia present in registry');
  });

  it('searches financial symbols with curated fallback and query matching', async () => {
    const emptyResults = await searchFinancialSymbols('');
    assert.deepEqual(emptyResults, []);

    const rhmResults = await searchFinancialSymbols('Rheinmetall');
    assert.ok(rhmResults.length >= 1);
    const rhm = rhmResults.find((r) => r.symbol === 'RHM.DE');
    assert.ok(rhm, 'Found RHM.DE');
    assert.equal(rhm.name, 'Rheinmetall AG');

    const goldResults = await searchFinancialSymbols('Gold');
    assert.ok(goldResults.length >= 1);
    assert.ok(goldResults.some((g) => g.symbol === 'GC=F'));
  });

  it('fetches deep-dive asset metrics with resilient fallback', async () => {
    const rhmData = await fetchAssetDeepDive('RHM.DE');
    assert.ok(rhmData);
    assert.equal(rhmData.symbol, 'RHM.DE');
    assert.ok(typeof rhmData.price === 'number' && rhmData.price > 0);
    assert.ok(typeof rhmData.changePct === 'string');
    assert.ok(typeof rhmData.high52 === 'number' && rhmData.high52 > 0);
    assert.ok(typeof rhmData.low52 === 'number' && rhmData.low52 > 0);
    assert.ok(Array.isArray(rhmData.history));

    // Fallback for unknown asset
    const fallbackData = await fetchAssetDeepDive('NONEXISTENT_TICKER_XYZ');
    assert.ok(fallbackData);
    assert.equal(fallbackData.symbol, 'NONEXISTENT_TICKER_XYZ');
    assert.ok(fallbackData.isFallback);
  });

  it('generates Abacus in-depth geopolitical prognosis with linked dispatches', () => {
    const asset = {
      symbol: 'RHM.DE',
      name: 'Rheinmetall AG',
      category: 'Verteidigung',
      sector: 'Defense & Munition',
      price: 1010.6,
      currency: 'EUR',
      changePct: '+1.85%',
      isPositive: true,
    };

    const dispatches = [
      {
        id: 'disp-1',
        title: 'Massiver Drohnenangriff auf Industriegebiet Charkiw',
        summary: 'Shahed-Drohnen und Iskander-Raketen abgewehrt. Munitionsverbrauch hoch.',
        locationName: 'Charkiw, Ukraine',
        lat: 49.9935,
        lon: 36.2304,
        severity: 'CRITICAL',
        publishedAt: '2026-09-22T00:15:00Z',
      },
    ];

    const prognosis = generateAssetPrognosis(asset, dispatches);
    assert.equal(prognosis.symbol, 'RHM.DE');
    assert.equal(prognosis.sentimentType, 'bullish');
    assert.ok(prognosis.trend.includes('BULLISH'));
    assert.ok(prognosis.targetCorridor.includes('EUR'));
    assert.ok(prognosis.confidence >= 80);
    assert.ok(prognosis.bullCase && prognosis.bullCase.length > 20);
    assert.ok(prognosis.bearCase && prognosis.bearCase.length > 20);
    assert.ok(prognosis.keyCatalysts && prognosis.keyCatalysts.length >= 2);
    assert.equal(prognosis.linkedDispatches.length, 1);
    assert.equal(prognosis.linkedDispatches[0].id, 'disp-1');
    assert.ok(prognosis.linkedDispatches[0].lat && prognosis.linkedDispatches[0].lon);
  });

  it('analyzes geopolitical causality from mock dispatches', () => {
    const mockDispatches = [
      {
        id: '1',
        title: 'Drohnenangriff auf Treibstoffdepot',
        summary: 'Shahed-136 Drohnen treffen Öl-Raffinerie im Schwarzen Meer.',
        locationName: 'Schwarzes Meer',
        severity: 'CRITICAL',
      },
      {
        id: '2',
        title: 'Huthi-Angriff im Roten Meer gemeldet',
        summary: 'Anti-Schiff-Rakete auf Tanker im Bab al-Mandab abgefangen.',
        locationName: 'Rotes Meer',
        severity: 'SEVERE',
      },
    ];

    const result = analyzeGeopoliticalMarketImpact(mockDispatches, SEED_MARKET_DATA);
    assert.ok(result.quotes && result.quotes.length > 0);
    assert.ok(result.causalImpacts && result.causalImpacts.length >= 4);

    const oilImpact = result.causalImpacts.find((c) => c.sector.includes('Rohöl'));
    assert.ok(oilImpact, 'Oil impact sector exists');
    assert.equal(oilImpact.sentimentType, 'bullish');

    const defenseImpact = result.causalImpacts.find((c) => c.sector.includes('Verteidigung'));
    assert.ok(defenseImpact, 'Defense sector impact exists');

    assert.equal(result.regionalSummary.criticalEvents, 1);
    assert.equal(result.regionalSummary.severeEvents, 1);
    assert.ok(result.regionalSummary.hotspots.length >= 3);
  });

  it('gracefully handles empty dispatches', () => {
    const result = analyzeGeopoliticalMarketImpact([], SEED_MARKET_DATA);
    assert.ok(result.causalImpacts.length >= 4);
    assert.equal(result.regionalSummary.totalDispatches, 0);
  });

  it('generates top breakout stocks with target corridors and catalysts for dates', () => {
    const breakout = generateTopBreakoutStocks('prognostiziere welche aktien am 10.Oktober durch die decke gehen werden', []);
    assert.equal(breakout.focusDate, '10. Oktober');
    assert.ok(breakout.candidates.length >= 3);
    const rhm = breakout.candidates.find((c) => c.symbol === 'RHM.DE');
    assert.ok(rhm, 'Rheinmetall present in breakout candidates');
    assert.match(rhm.upsidePct, /\+18%/);
    assert.match(rhm.catalyst, /Oktober/);
    const pltr = breakout.candidates.find((c) => c.symbol === 'PLTR');
    assert.ok(pltr, 'Palantir present in breakout candidates');
    assert.match(pltr.upsidePct, /\+20%/);
  });
});


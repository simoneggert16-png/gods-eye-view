import puppeteer from 'puppeteer-core';

async function runTacticalVerification() {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1600,1000']
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 1000 });

    console.log('1. Loading application at http://localhost:4173/ ...');
    await page.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded', timeout: 25000 });
    await new Promise(r => setTimeout(r, 4000));
    await page.waitForFunction(() => Boolean(window.__godsEyeView?.viewer), { timeout: 20000 });

    // Measure collapsed dimensions of all panels in the left stack
    const panelMeasurements = await page.evaluate(() => {
      const dataPanel = document.getElementById('data-panel');
      const botnetPanel = document.getElementById('botnet-intel-panel');
      const scenePanel = document.getElementById('scene-panel');
      const cctvPanel = document.getElementById('cctv-panel');

      const getBox = (el) => {
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return {
          id: el.id,
          collapsed: el.classList.contains('collapsed'),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          left: Math.round(rect.left),
        };
      };

      return {
        data: getBox(dataPanel),
        botnet: getBox(botnetPanel),
        scene: getBox(scenePanel),
        cctv: getBox(cctvPanel)
      };
    });

    console.log('Panel measurements in collapsed state:', JSON.stringify(panelMeasurements, null, 2));

    // Verify botnet panel matches data and scene panel widths
    if (panelMeasurements.botnet && panelMeasurements.data) {
      const diff = Math.abs(panelMeasurements.botnet.width - panelMeasurements.data.width);
      console.log(`Width difference between Botnet and Data Layers: ${diff}px`);
      if (diff > 5) {
        throw new Error(`Botnet panel width (${panelMeasurements.botnet.width}px) does not match Data Layers (${panelMeasurements.data.width}px)!`);
      }
    }

    // Take screenshot of collapsed left panel stack
    await page.screenshot({ path: 'C:/workspace/gods-eye-view/scripts/tactical-collapsed-stack.png' });
    console.log('Saved screenshot: scripts/tactical-collapsed-stack.png');

    // Expand Botnet Radar Panel
    console.log('2. Expanding Botnet Radar panel...');
    await page.click('#botnet-panel-header');
    await new Promise(r => setTimeout(r, 1200));

    // Wait for cards
    await page.waitForSelector('.botnet-card', { timeout: 10000 });
    const cardCount = await page.evaluate(() => document.querySelectorAll('.botnet-card').length);
    console.log(`Loaded ${cardCount} botnet cards.`);

    // Take screenshot of opened Botnet panel
    await page.screenshot({ path: 'C:/workspace/gods-eye-view/scripts/tactical-botnet-open.png' });
    console.log('Saved screenshot: scripts/tactical-botnet-open.png');

    // 3. Test Jamming Zone rendering
    console.log('3. Testing Jamming Zone selection...');
    // Switch to RADAR tab
    await page.evaluate(() => {
      const tab = Array.from(document.querySelectorAll('.botnet-tab-btn')).find(b => b.dataset.category === 'RADAR');
      if (tab) tab.click();
    });
    await new Promise(r => setTimeout(r, 600));

    // Click the first radar/jamming card
    await page.evaluate(() => {
      const firstCard = document.querySelector('.botnet-card');
      if (firstCard) firstCard.click();
    });
    await new Promise(r => setTimeout(r, 2500));

    // Verify Cesium entity was created in gev-botnet-tactical data source
    const cesiumEntityCheck = await page.evaluate(() => {
      const viewer = window.__godsEyeView?.viewer || window.__GEV_VIEWER__ || (window.app && window.app.viewer) || (window.ui && window.ui.viewer);
      let ds = null;
      if (viewer && viewer.dataSources) {
        for (let i = 0; i < viewer.dataSources.length; i++) {
          const s = viewer.dataSources.get(i);
          if (s.name === 'gev-botnet-tactical') {
            ds = s;
            break;
          }
        }
      }
      if (!ds) return { foundDs: false, entityCount: 0 };
      const entities = ds.entities.values;
      const types = entities.map(e => ({
        name: e.name,
        hasEllipse: Boolean(e.ellipse),
        hasPolygon: Boolean(e.polygon),
        hasPoint: Boolean(e.point),
        hasLabel: Boolean(e.label),
      }));
      return { foundDs: true, entityCount: entities.length, types };
    });

    console.log('Cesium Entity Check for Jamming:', JSON.stringify(cesiumEntityCheck, null, 2));

    // Take screenshot of Jamming Zone on map
    await page.screenshot({ path: 'C:/workspace/gods-eye-view/scripts/tactical-jamming-map.png' });
    console.log('Saved screenshot: scripts/tactical-jamming-map.png');

    // 4. Test Briefing Modal (Abacus AI / SITREP)
    console.log('4. Testing Abacus AI SITREP briefing...');
    const modalTriggered = await page.evaluate(() => {
      const briefingBtn = document.querySelector('.btn-briefing');
      if (briefingBtn) {
        briefingBtn.click();
        return true;
      }
      return false;
    });

    if (modalTriggered) {
      console.log('Briefing modal clicked. Waiting for response...');
      await page.waitForFunction(() => {
        const modal = document.getElementById('botnet-briefing-modal');
        const content = document.getElementById('botnet-briefing-content');
        if (!modal || modal.hidden) return false;
        return content && !content.querySelector('.botnet-loader-bar');
      }, { timeout: 25000 });

      const briefingTextPreview = await page.evaluate(() => {
        const content = document.getElementById('botnet-briefing-content');
        return content ? content.innerText.slice(0, 300) : '';
      });
      console.log('SITREP Briefing result preview:\n', briefingTextPreview);

      await page.screenshot({ path: 'C:/workspace/gods-eye-view/scripts/tactical-briefing-modal.png' });
      console.log('Saved screenshot: scripts/tactical-briefing-modal.png');
    }

    console.log('Tactical map verification completed successfully!');
  } finally {
    await browser.close();
  }
}

runTacticalVerification().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});

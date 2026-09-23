import puppeteer from 'puppeteer-core';

async function testBotnetLeftPanel() {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1600,1000']
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 1000 });

    console.log('Navigating to app...');
    await page.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded', timeout: 25000 });
    await new Promise(r => setTimeout(r, 4000));

    // 1. Verify Botnet panel is inside #left-panel-stack
    const locationCheck = await page.evaluate(() => {
      const leftStack = document.getElementById('left-panel-stack');
      const botnetPanel = document.getElementById('botnet-intel-panel');
      const isInsideLeft = leftStack && botnetPanel && leftStack.contains(botnetPanel);
      const isCollapsed = botnetPanel?.classList.contains('collapsed');
      return { isInsideLeft, isCollapsed };
    });
    console.log('Botnet panel location check:', locationCheck);
    if (!locationCheck.isInsideLeft) {
      throw new Error('#botnet-intel-panel is not inside #left-panel-stack!');
    }

    // 2. Click the header of the Botnet panel to open it
    console.log('Clicking Botnet panel header to open...');
    await page.click('#botnet-panel-header');
    await new Promise(r => setTimeout(r, 1000));

    // Wait for feed to load cards
    console.log('Waiting for Botnet cards to render...');
    await page.waitForSelector('.botnet-card', { timeout: 15000 });

    const openCheck = await page.evaluate(() => {
      const botnetPanel = document.getElementById('botnet-intel-panel');
      const isCollapsed = botnetPanel?.classList.contains('collapsed');
      const bodyVisible = window.getComputedStyle(botnetPanel.querySelector('.botnet-panel-body')).display !== 'none';
      const cardCount = botnetPanel.querySelectorAll('.botnet-card').length;
      return { isCollapsed, bodyVisible, cardCount };
    });
    console.log('Open state check:', openCheck);
    if (openCheck.isCollapsed || !openCheck.bodyVisible) {
      throw new Error('Botnet panel failed to open when clicking header!');
    }

    // 3. Take screenshot of opened panel
    await page.screenshot({ path: 'scripts/botnet-left-open.png' });
    console.log('Saved screenshot: scripts/botnet-left-open.png');

    // 4. Click a card's briefing button if present
    const briefingClicked = await page.evaluate(() => {
      const btn = document.querySelector('.btn-briefing');
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    });
    console.log('Briefing card action clicked:', briefingClicked);
    await new Promise(r => setTimeout(r, 1200));

    // Verify modal opened if clicked
    if (briefingClicked) {
      const modalOpen = await page.evaluate(() => {
        const modal = document.getElementById('botnet-briefing-modal');
        return modal && !modal.hidden;
      });
      console.log('Briefing modal open check:', modalOpen);
      if (!modalOpen) {
        throw new Error('Briefing modal did not open!');
      }

      await page.screenshot({ path: 'scripts/botnet-briefing-open.png' });
      console.log('Saved screenshot: scripts/botnet-briefing-open.png');

      // Close modal
      await page.click('#botnet-briefing-close-btn');
      await new Promise(r => setTimeout(r, 400));
    }

    // 5. Click the header again to collapse
    console.log('Clicking Botnet panel header to collapse...');
    await page.click('#botnet-panel-header');
    await new Promise(r => setTimeout(r, 600));

    const collapseCheck = await page.evaluate(() => {
      const botnetPanel = document.getElementById('botnet-intel-panel');
      return botnetPanel?.classList.contains('collapsed');
    });
    console.log('Collapse state check:', collapseCheck);
    if (!collapseCheck) {
      throw new Error('Botnet panel failed to collapse when clicking header!');
    }

    console.log('=== ALL BOTNET LEFT-PANEL TESTS PASSED ===');
  } finally {
    await browser.close();
  }
}

testBotnetLeftPanel().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});

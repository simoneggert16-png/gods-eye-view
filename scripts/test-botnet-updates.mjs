import puppeteer from 'puppeteer-core';

async function testBotnetUpdates() {
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

    // Open botnet panel
    console.log('Opening botnet panel...');
    await page.click('#botnet-panel-header');
    await new Promise(r => setTimeout(r, 1200));

    // Wait for cards
    await page.waitForSelector('.botnet-card', { timeout: 15000 });

    // Check panel dimensions and chat buttons
    const metrics = await page.evaluate(() => {
      const panel = document.getElementById('botnet-intel-panel');
      const leftStack = document.getElementById('left-panel-stack');
      const stackRect = leftStack.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const expandBtn = document.getElementById('botnet-expand-toggle-btn');
      const chatBtns = document.querySelectorAll('.botnet-card-btn.btn-chat');
      return {
        stackWidth: stackRect.width,
        panelWidth: panelRect.width,
        expandBtnExists: Boolean(expandBtn),
        chatBtnsCount: chatBtns.length,
        isFullSidebar: panel.classList.contains('botnet-full-sidebar')
      };
    });
    console.log('Metrics before toggle:', metrics);

    // Toggle expand button to full sidebar
    console.log('Clicking expand toggle button...');
    await page.click('#botnet-expand-toggle-btn');
    await new Promise(r => setTimeout(r, 500));

    const metricsAfterExpand = await page.evaluate(() => {
      const panel = document.getElementById('botnet-intel-panel');
      const rect = panel.getBoundingClientRect();
      return {
        panelWidth: rect.width,
        panelHeight: rect.height,
        isFullSidebar: panel.classList.contains('botnet-full-sidebar')
      };
    });
    console.log('Metrics after expand toggle:', metricsAfterExpand);

    // Take screenshot of full sidebar
    await page.screenshot({ path: 'scripts/botnet-sidebar-expanded.png' });
    console.log('Saved screenshot: scripts/botnet-sidebar-expanded.png');

    // Untoggle expand button
    await page.click('#botnet-expand-toggle-btn');
    await new Promise(r => setTimeout(r, 500));

    // Click briefing on first card
    console.log('Opening modal briefing...');
    await page.evaluate(() => {
      const briefingBtn = document.querySelector('.botnet-card-btn.btn-briefing');
      if (briefingBtn) briefingBtn.click();
    });
    await new Promise(r => setTimeout(r, 1000));

    const modalCheck = await page.evaluate(() => {
      const modal = document.getElementById('botnet-briefing-modal');
      const isVisible = modal && !modal.classList.contains('hidden');
      const modalChatBtn = document.getElementById('botnet-briefing-chat-btn');
      const sitrepBody = document.getElementById('botnet-briefing-body')?.innerText;
      const title = document.getElementById('botnet-briefing-title')?.innerText;
      const subtitle = document.getElementById('botnet-briefing-subtitle')?.innerText;
      return {
        isVisible,
        hasChatBtn: Boolean(modalChatBtn),
        title,
        subtitle,
        sitrepSample: sitrepBody ? sitrepBody.slice(0, 150) : ''
      };
    });
    console.log('Modal status:', modalCheck);

    // Take screenshot of briefing modal
    await page.screenshot({ path: 'scripts/botnet-briefing-chat-modal.png' });
    console.log('Saved screenshot: scripts/botnet-briefing-chat-modal.png');

    // Click IM CHAT ÜBERWACHEN button in modal
    console.log('Clicking IM CHAT ÜBERWACHEN...');
    await page.click('#botnet-briefing-chat-btn');
    await new Promise(r => setTimeout(r, 2000));

    // Check if chat drawer is open
    const chatDrawerCheck = await page.evaluate(() => {
      const chatDrawer = document.querySelector('[data-gev-chat-log]');
      const isDrawerOpen = chatDrawer && !chatDrawer.hidden;
      const entries = document.querySelectorAll('.gev-chat-entry');
      const messages = Array.from(entries).map(e => e.innerText).join('\n---\n');
      return {
        isDrawerOpen,
        entryCount: entries.length,
        messagesSample: messages.slice(-300)
      };
    });
    console.log('Chat drawer status after follow-up click:', chatDrawerCheck);

    await page.screenshot({ path: 'scripts/botnet-chat-followup-verified.png' });
    console.log('Saved screenshot: scripts/botnet-chat-followup-verified.png');

  } finally {
    await browser.close();
  }
}

testBotnetUpdates().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTelegramChannelHtml,
  cleanHtmlText,
  getAggregatedOsintMessages,
  handleTelegramOsintRequest,
  DEFAULT_OSINT_CHANNELS,
} from './telegramOsintProxy.js';

const SAMPLE_TELEGRAM_HTML = `
<!DOCTYPE html>
<html>
<body>
  <div class="tgme_widget_message_wrap js-widget_message_wrap">
    <div class="tgme_widget_message js-widget_message" data-post="kpszsu/21450">
      <div class="tgme_widget_message_text js-message_text">
        Увага! Група ворожих ударних БпЛА (Shahed) через Сумщину в напрямку Полтавщини!<br/>
        Залишайтеся в укриттях!
      </div>
      <div class="tgme_widget_message_footer">
        <span class="tgme_widget_message_views">45.2K</span>
        <time datetime="2026-09-21T21:45:00+00:00" class="time">21:45</time>
      </div>
    </div>
  </div>
  <div class="tgme_widget_message_wrap js-widget_message_wrap">
    <div class="tgme_widget_message js-widget_message" data-post="kpszsu/21449">
      <div class="tgme_widget_message_photo_wrap" style="background-image:url('https://cdn.telegram.org/file/sample.jpg')"></div>
      <div class="tgme_widget_message_text js-message_text">
        Збито 18 із 24 ударних дронів типу "Shahed-136/131".
      </div>
      <div class="tgme_widget_message_footer">
        <span class="tgme_widget_message_views">62.1K</span>
        <time datetime="2026-09-21T20:30:00+00:00" class="time">20:30</time>
      </div>
    </div>
  </div>
</body>
</html>
`;

test('cleanHtmlText cleans HTML tags, breaks, and entities', () => {
  const dirty = 'Achtung! &quot;Drohnenangriff&quot;<br/>Richtung <b>Kiew</b> &amp; Odesa.';
  const clean = cleanHtmlText(dirty);
  assert.equal(clean, 'Achtung! "Drohnenangriff"\nRichtung Kiew & Odesa.');
});

test('parseTelegramChannelHtml parses posts, media, timestamps, and views', () => {
  const messages = parseTelegramChannelHtml(SAMPLE_TELEGRAM_HTML, 'kpszsu');
  assert.equal(messages.length, 2);

  // Newest is first
  const newest = messages[0];
  assert.equal(newest.id, 'tg-kpszsu-21449');
  assert.equal(newest.channel, 'kpszsu');
  assert.ok(newest.text.includes('Збито 18 із 24'));
  assert.equal(newest.mediaUrl, 'https://cdn.telegram.org/file/sample.jpg');
  assert.equal(newest.views, '62.1K');
  assert.equal(newest.timestamp, '2026-09-21T20:30:00+00:00');

  const second = messages[1];
  assert.equal(second.id, 'tg-kpszsu-21450');
  assert.ok(second.text.includes('Група ворожих ударних БпЛА'));
  assert.equal(second.views, '45.2K');
});

test('getAggregatedOsintMessages aggregates and deduplicates across mock channels', async () => {
  const mockFetch = async (url) => {
    return {
      ok: true,
      text: async () => SAMPLE_TELEGRAM_HTML,
    };
  };

  const msgs = await getAggregatedOsintMessages({
    channels: ['kpszsu'],
    fetchImpl: mockFetch,
    forceRefresh: true,
  });

  assert.ok(Array.isArray(msgs));
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].id, 'tg-kpszsu-21450');
  assert.equal(msgs[1].id, 'tg-kpszsu-21449');
});

test('handleTelegramOsintRequest writes JSON response with messages', async () => {
  const req = { url: '/api/osint/telegram?channels=kpszsu&refresh=true' };
  let statusCode = 0;
  let headers = {};
  let body = '';
  const res = {
    writeHead(code, h) {
      statusCode = code;
      headers = h;
    },
    end(str) {
      body = str;
    },
  };

  const mockFetch = async () => ({
    ok: true,
    text: async () => SAMPLE_TELEGRAM_HTML,
  });

  await handleTelegramOsintRequest(req, res, { fetchImpl: mockFetch });

  assert.equal(statusCode, 200);
  assert.equal(headers['Content-Type'], 'application/json');
  const data = JSON.parse(body);
  assert.equal(data.ok, true);
  assert.equal(data.count, 2);
  assert.equal(data.messages[0].id, 'tg-kpszsu-21450');
});

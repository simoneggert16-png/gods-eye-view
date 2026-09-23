/**
 * @module telegramOsintProxy
 *
 * Backend proxy and parser for public Telegram OSINT channels.
 * Fetches server-rendered previews from https://t.me/s/<channel>
 * with 0 API keys and zero cost.
 */

export const DEFAULT_OSINT_CHANNELS = Object.freeze([
  'liveuamap',      // Global & Ukraine conflict tracking with precise geo references
  'kpszsu',         // Official Ukrainian Air Force radar/strike warnings
  'DeepStateUA',    // Frontline & military movement updates
]);

export const CHANNEL_METADATA = Object.freeze({
  liveuamap: { name: 'Liveuamap OSINT', category: 'GLOBAL / MULTI-THEATER', trust: 0.92 },
  kpszsu: { name: 'Air Force Command UA', category: 'RADAR / AIR DEFENSE', trust: 0.98 },
  DeepStateUA: { name: 'DeepState Conflict Intel', category: 'FRONTLINES / TACTICAL', trust: 0.95 },
});

const CACHE_TTL_MS = 120_000; // 2 minutes cache
let _cachedMessages = [];
let _lastFetchTime = 0;
let _fetchPromise = null;

/**
 * Strips HTML tags and normalizes whitespace from message text.
 */
export function cleanHtmlText(htmlSnippet) {
  if (!htmlSnippet) return '';
  return htmlSnippet
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<a\b[^>]*>(.*?)<\/a>/gi, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/\r/g, '')
    .trim();
}

/**
 * Parses raw HTML of a https://t.me/s/<channel> page into structured messages.
 */
export function parseTelegramChannelHtml(html, channelName = '') {
  if (typeof html !== 'string' || !html.trim()) return [];

  const messages = [];
  // Split on message containers
  const rawPosts = html.split('<div class="tgme_widget_message_wrap');

  for (let i = 1; i < rawPosts.length; i++) {
    const chunk = rawPosts[i];

    // 1. Post ID / URL
    const postMatch = chunk.match(/data-post="([^"]+)"/);
    const postId = postMatch ? postMatch[1] : `${channelName}-${i}`;
    const postUrl = `https://t.me/${postId}`;

    // 2. Timestamp
    const timeMatch = chunk.match(/<time\s+datetime="([^"]+)"/);
    const timestamp = timeMatch ? timeMatch[1] : new Date().toISOString();

    // 3. Message Text
    let text = '';
    const textMatch = chunk.match(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    if (textMatch) {
      text = cleanHtmlText(textMatch[1]);
    }

    if (!text && !chunk.includes('tgme_widget_message_photo')) {
      continue;
    }

    // 4. Photo / Media Link
    let mediaUrl = null;
    const photoMatch = chunk.match(/background-image:\s*url\('([^']+)'\)/);
    if (photoMatch) {
      mediaUrl = photoMatch[1];
    }

    // 5. Views count
    const viewsMatch = chunk.match(/<span class="tgme_widget_message_views">([^<]+)<\/span>/);
    const views = viewsMatch ? viewsMatch[1].trim() : null;

    const channelInfo = CHANNEL_METADATA[channelName] || {
      name: channelName || 'Telegram OSINT',
      category: 'OSINT DISPATCH',
      trust: 0.85,
    };

    messages.push({
      id: `tg-${postId.replace('/', '-')}`,
      channel: channelName,
      channelTitle: channelInfo.name,
      category: channelInfo.category,
      trustScore: channelInfo.trust,
      text: text || '[Medienmeldung / Lagekarte]',
      timestamp,
      postUrl,
      mediaUrl,
      views,
    });
  }

  // Reverse so newest is first
  return messages.reverse();
}

/**
 * Fetches messages from a single public Telegram channel.
 */
export async function fetchTelegramChannel(channel, { fetchImpl = null, signal = null } = {}) {
  const doFetch = fetchImpl || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
  if (!doFetch) return [];

  const url = `https://t.me/s/${encodeURIComponent(channel)}`;
  try {
    const response = await doFetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7',
      },
      signal,
    });

    if (!response.ok) {
      return [];
    }

    const html = await response.text();
    return parseTelegramChannelHtml(html, channel);
  } catch (err) {
    return [];
  }
}

/**
 * Aggregates messages from multiple channels with caching and deduplication.
 */
export async function getAggregatedOsintMessages({
  channels = DEFAULT_OSINT_CHANNELS,
  fetchImpl = null,
  forceRefresh = false,
  signal = null,
} = {}) {
  const now = Date.now();
  if (!forceRefresh && _cachedMessages.length > 0 && (now - _lastFetchTime < CACHE_TTL_MS)) {
    return _cachedMessages;
  }

  if (_fetchPromise && !forceRefresh) {
    return _fetchPromise;
  }

  _fetchPromise = (async () => {
    try {
      const results = await Promise.allSettled(
        channels.map((ch) => fetchTelegramChannel(ch, { fetchImpl, signal }))
      );

      const all = [];
      for (const res of results) {
        if (res.status === 'fulfilled' && Array.isArray(res.value)) {
          all.push(...res.value);
        }
      }

      // Sort chronologically by timestamp (newest first)
      all.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      // Deduplicate by message ID
      const seen = new Set();
      const deduped = [];
      for (const msg of all) {
        if (!seen.has(msg.id)) {
          seen.add(msg.id);
          deduped.push(msg);
        }
      }

      _cachedMessages = deduped.slice(0, 100);
      _lastFetchTime = Date.now();
      return _cachedMessages;
    } finally {
      _fetchPromise = null;
    }
  })();

  return _fetchPromise;
}

/**
 * Middleware handler for Vite dev/preview server: GET /api/osint/telegram
 */
export async function handleTelegramOsintRequest(req, res, { fetchImpl = null } = {}) {
  try {
    const urlObj = new URL(req.url, 'http://localhost');
    const queryChannels = urlObj.searchParams.get('channels');
    const channels = queryChannels
      ? queryChannels.split(',').map((c) => c.trim()).filter(Boolean)
      : DEFAULT_OSINT_CHANNELS;
    const force = urlObj.searchParams.get('refresh') === 'true';

    const messages = await getAggregatedOsintMessages({
      channels,
      fetchImpl,
      forceRefresh: force,
    });

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=60',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify({
      ok: true,
      count: messages.length,
      channels,
      timestamp: new Date().toISOString(),
      messages,
    }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: false,
      error: err?.message || 'Failed to fetch Telegram OSINT messages',
    }));
  }
}

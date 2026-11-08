/**
 * OSINT headlines for the conflict layer: agencies and Reddit.
 *
 * Agency RSS 2.0 feeds answer reliably from the relay. Reddit's JSON API
 * refuses datacenter clients, its Atom feeds do answer — but only a few times
 * per hour per IP: a burst of five subreddits got the relay blocked, so the
 * crawl now takes one subreddit per tick (oldest first), caches each list for
 * fifteen minutes and benches a blocked sub for half an hour. Only the
 * allowlisted sources are fetched, so the route cannot become an open proxy.
 */

const SUBS = [
  'ukraine',
  'ukrainewarvideoreport',
  'combatfootage',
  'worldnews',
  'credibledefense',
];
const FEEDS = [
  { id: 'aljazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml' },
  { id: 'bbc', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
  { id: 'dw', url: 'https://rss.dw.com/rdf/rss-en-world' },
  { id: 'france24', url: 'https://www.france24.com/en/rss' },
  { id: 'almonitor', url: 'https://www.al-monitor.com/rss' },
  { id: 'defenseone', url: 'https://www.defenseone.com/rss/all/' },
  { id: 'jpost', url: 'https://www.jpost.com/rss/rssfeedsfrontpage.aspx' },
  { id: 'ynet', url: 'https://www.ynetnews.com/Integration/StoryRss2.xml' },
  { id: 'mee', url: 'https://www.middleeasteye.net/rss' },
  {
    id: 'cna',
    url: 'https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml',
  },
  { id: 'diplomat', url: 'https://thediplomat.com/feed/' },
];
/**
 * Public Telegram channels: keyless preview pages (`t.me/s/<channel>`) carry
 * the last messages as plain HTML. For Gaza/Israel this is the fastest
 * open source there is; place names in the text let the bridge geocode them.
 */
const CHANNELS = [
  'idfonline',
  'IsraelMFA',
  'QudsN',
  'almayadeen',
  'AlArabiya',
  'osint613',
  'KhitThitMedia',
];

function parseTelegram(html, channel) {
  const items = [];
  const blocks = String(html || '').split('tgme_widget_message_wrap');
  for (const block of blocks.slice(1)) {
    const textMatch = /tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/.exec(
      block,
    );
    const timeMatch = /<time[^>]*datetime="([^"]+)"/.exec(block);
    const postMatch = /data-post="([^"]+)"/.exec(block);
    if (!textMatch || !postMatch) continue;
    const text = unescape(textMatch[1]).slice(0, 240);
    if (!text) continue;
    items.push({
      title: text,
      url: 'https://t.me/' + postMatch[1],
      sub: 'tg:' + channel,
      updated: timeMatch ? timeMatch[1] : '',
    });
  }
  return items;
}

async function telegramItems() {
  const out = [];
  await Promise.all(
    CHANNELS.map(async (channel) => {
      const held = cache.get('tg:' + channel);
      if (held && Date.now() - held.at < CACHE_MS) {
        out.push(...held.items);
        return;
      }
      try {
        const response = await fetch('https://t.me/s/' + channel, {
          headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'text/html' },
          signal: AbortSignal.timeout(12_000),
        });
        if (!response.ok) return;
        const items = parseTelegram(await response.text(), channel);
        cache.set('tg:' + channel, { at: Date.now(), items });
        out.push(...items);
      } catch {
        /* one dead channel must not drop the others */
      }
    }),
  );
  return out;
}

const CACHE_MS = 2 * 60_000;
const REDDIT_CACHE_MS = 15 * 60_000;
const REDDIT_COOLDOWN_MS = 30 * 60_000;
const cache = new Map(); // source id -> {at, items}
const redditBlockedUntil = new Map();

function unescape(text) {
  return (
    String(text || '')
      // CDATA first: stripping tags first would eat the whole wrapped string.
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

export function parseAtom(xml, sub) {
  const items = [];
  for (const entry of String(xml || '')
    .split('<entry')
    .slice(1)) {
    const title = /<title[^>]*>([\s\S]*?)<\/title>/.exec(entry)?.[1] || '';
    const link = /<link[^>]*href="([^"]+)"/.exec(entry)?.[1] || '';
    const updated = /<updated[^>]*>([^<]+)<\/updated>/.exec(entry)?.[1] || '';
    const clean = unescape(title);
    if (!clean || !link) continue;
    items.push({ title: clean.slice(0, 240), url: link, sub, updated });
  }
  return items;
}

export function parseRss(xml, id) {
  const items = [];
  for (const block of String(xml || '')
    .split('<item')
    .slice(1)) {
    const title = /<title[^>]*>([\s\S]*?)<\/title>/.exec(block)?.[1] || '';
    const link = /<link[^>]*>([^<]+)<\/link>/.exec(block)?.[1] || '';
    const pub = /<pubDate[^>]*>([^<]+)<\/pubDate>/.exec(block)?.[1] || '';
    const clean = unescape(title);
    if (!clean || !link.startsWith('http')) continue;
    const when = Date.parse(pub);
    items.push({
      title: clean.slice(0, 240),
      url: link.trim(),
      sub: id,
      updated: Number.isFinite(when) ? new Date(when).toISOString() : '',
    });
  }
  return items;
}

async function subItems(sub) {
  const held = cache.get(sub);
  if (held && Date.now() - held.at < REDDIT_CACHE_MS) return held.items;
  if (Date.now() < (redditBlockedUntil.get(sub) || 0)) return held?.items || [];
  const response = await fetch(`https://www.reddit.com/r/${sub}/.rss`, {
    headers: {
      Accept: 'application/atom+xml',
      'User-Agent': 'gods-eye-view/1.0 (relay)',
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) {
    // Back off instead of retrying a blocked sub on every tick.
    if (response.status === 403 || response.status === 429)
      redditBlockedUntil.set(sub, Date.now() + REDDIT_COOLDOWN_MS);
    return held?.items || [];
  }
  const items = parseAtom(await response.text(), sub);
  cache.set(sub, { at: Date.now(), items });
  return items;
}

async function feedItems(feed) {
  const held = cache.get(feed.id);
  if (held && Date.now() - held.at < CACHE_MS) return held.items;
  try {
    const response = await fetch(feed.url, {
      headers: { Accept: 'application/rss+xml, application/xml' },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) return held?.items || [];
    const items = parseRss(await response.text(), feed.id);
    cache.set(feed.id, { at: Date.now(), items });
    return items;
  } catch {
    return held?.items || [];
  }
}

/** Merged newest-first headlines from every allowlisted source. */
export async function redditItems() {
  const out = [];
  // One subreddit per tick, oldest first: five bursts at once is what got the
  // relay rate-limited in the first place.
  const queue = [...SUBS].sort(
    (a, b) => (cache.get(a)?.at || 0) - (cache.get(b)?.at || 0),
  );
  for (const sub of queue) {
    const held = cache.get(sub);
    if (held && Date.now() - held.at < REDDIT_CACHE_MS) {
      out.push(...held.items);
      continue;
    }
    try {
      out.push(...(await subItems(sub)));
    } catch {
      /* one dead feed must not drop the others */
    }
    break;
  }
  for (const sub of SUBS) {
    const held = cache.get(sub);
    if (held && !out.some((item) => item.sub === sub)) out.push(...held.items);
  }
  // Feeds in parallel: seven sequential fetches could take a minute on a cold
  // cache, and the bridge gives up after fifteen seconds.
  const feedResults = await Promise.all(
    FEEDS.map((feed) => feedItems(feed).catch(() => [])),
  );
  for (const items of feedResults) out.push(...items);
  out.push(...(await telegramItems().catch(() => [])));
  // Deal the sources round-robin instead of a pure date sort: a feed with a
  // hundred entries would otherwise push Myanmar or CNA out of the window.
  const bySource = new Map();
  for (const item of out) {
    const list = bySource.get(item.sub) || [];
    list.push(item);
    bySource.set(item.sub, list);
  }
  for (const list of bySource.values())
    list.sort((a, b) =>
      a.updated < b.updated ? 1 : a.updated > b.updated ? -1 : 0,
    );
  const mixed = [];
  let index = 0;
  while (mixed.length < 320) {
    let added = 0;
    for (const list of bySource.values()) {
      if (index < list.length) {
        mixed.push(list[index]);
        added += 1;
      }
    }
    if (!added) break;
    index += 1;
  }
  return mixed;
}

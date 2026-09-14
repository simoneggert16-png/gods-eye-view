/**
 * Conversation log — the visible chat history for voice mode.
 *
 * Why this exists: the model says "I'll show you X" and sometimes nothing
 * happens. This log records every turn — what was heard (YOU), what the app
 * executed (APP, with per-tool ok/fail), and what the model said (GEMINI) —
 * so a silent failure is evidence, not a mystery. Entries render through
 * textContent only (transcripts are untrusted input, never HTML).
 *
 * Pure store + tiny DOM renderer. Persisted best-effort (last 50) so a
 * reload keeps the recent history.
 *
 * @module voice/gevConversationLog
 */

/** Max entries kept in memory. */
export const CONVERSATION_LOG_LIMIT = 100;

/** Max entries persisted to localStorage. */
export const CONVERSATION_LOG_PERSIST_LIMIT = 50;

/** Storage key for the persisted tail. */
export const CONVERSATION_LOG_STORAGE_KEY = 'godsEyeView.voice.conversation';

/** Known speakers; anything else normalizes to 'you' (untrusted input). */
const CONVERSATION_KNOWN_WHO = new Set(['you', 'gemini', 'app', 'zai', 'ollama']);

/**
 * Create the conversation store.
 *
 * @param {object} [options]
 * @param {{getItem:(k:string)=>string|null,setItem:(k:string,v:string)=>void}} [options.storage]
 */
export function createConversationLog({ storage = null } = {}) {
  const store = storage || (() => {
    try {
      return typeof localStorage !== 'undefined' ? localStorage : null;
    } catch {
      return null;
    }
  })();
  const entries = [];
  const listeners = new Set();

  function readPersisted() {
    try {
      const raw = store?.getItem?.(CONVERSATION_LOG_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      for (const item of parsed.slice(-CONVERSATION_LOG_PERSIST_LIMIT)) {
        if (item && typeof item === 'object' && typeof item.text === 'string') {
          entries.push({
            at: Number(item.at) || Date.now(),
            who: CONVERSATION_KNOWN_WHO.has(item.who) ? item.who : 'you',
            text: String(item.text).slice(0, 500),
            calls: Array.isArray(item.calls) ? item.calls.slice(0, 12) : undefined,
          });
        }
      }
    } catch { /* corrupt history must not break voice */ }
  }

  function persist() {
    try {
      store?.setItem?.(
        CONVERSATION_LOG_STORAGE_KEY,
        JSON.stringify(entries.slice(-CONVERSATION_LOG_PERSIST_LIMIT).map((e) => ({
          at: e.at,
          who: e.who,
          text: e.text,
          ...(e.calls ? { calls: e.calls } : {}),
        }))),
      );
    } catch { /* private mode etc. — memory log still works */ }
  }

  function notify(entry) {
    for (const listener of [...listeners]) {
      try { listener(entry); } catch { /* one bad view must not break logging */ }
    }
  }

  readPersisted();

  return {
    /** Append an entry. who: 'you' | 'gemini' | 'app'. */
    push(who, text, calls) {
      const entry = {
        at: Date.now(),
        who: CONVERSATION_KNOWN_WHO.has(who) ? who : 'you',
        text: String(text || '').slice(0, 500),
        ...(calls ? { calls } : {}),
      };
      entries.push(entry);
      while (entries.length > CONVERSATION_LOG_LIMIT) entries.shift();
      persist();
      notify(entry);
      return entry;
    },
    /** Snapshot (oldest first). */
    list() {
      return entries.map((e) => ({
        at: e.at,
        who: e.who,
        text: e.text,
        ...(e.calls ? { calls: e.calls.map((c) => ({ ...c })) } : {}),
      }));
    },
    clear() {
      entries.length = 0;
      persist();
    },
    /** Subscribe to new entries. Returns an unsubscribe function. */
    subscribe(listener) {
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * Mirror entries to the dev server (`POST /api/voice/log` → voice log jsonl
 * next to the realtime debug log). Fire-and-forget, localhost only,
 * best-effort: a failed mirror never touches the in-memory history.
 * Returns an unsubscribe function.
 */
export function mirrorToServer(log, { fetchImpl = null, endpoint = '/api/voice/log' } = {}) {
  if (!log || typeof log.subscribe !== 'function') return () => {};
  const doFetch = fetchImpl || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
  if (!doFetch) return () => {};
  return log.subscribe((entry) => {
    try {
      void doFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries: [entry] }),
      })?.catch?.(() => {});
    } catch { /* mirror is best effort */ }
  });
}

/**
 * Copy the history as JSON (for pasting into a chat for analysis).
 * Uses the async clipboard API with a textarea fallback. Returns the JSON.
 */
export async function copyConversationJson(log, browserEnv = null) {
  const text = JSON.stringify(log?.list?.() || [], null, 2);
  try {
    const env = browserEnv || (typeof window !== 'undefined' ? window : null);
    if (env?.navigator?.clipboard?.writeText) {
      await env.navigator.clipboard.writeText(text);
      return text;
    }
    const doc = env?.document || (typeof document !== 'undefined' ? document : null);
    const area = doc?.createElement?.('textarea');
    if (area && doc?.body) {
      area.value = text;
      doc.body.appendChild(area);
      area.select?.();
      doc.execCommand?.('copy');
      area.remove?.();
      return text;
    }
  } catch { /* fall through — caller still gets the JSON */ }
  return text;
}
/**
 * Render the log drawer into the voice root. Additive DOM; all text via
 * textContent. Returns the drawer element (or null outside browsers).
 *
 * @param {{ root?: Element }} ui - Voice control handles.
 * @param {ReturnType<createConversationLog>} log - The store.
 * @param {object} [documentRef] - Injectable document (tests).
 */
export function attachConversationLog(ui, log, documentRef = null) {
  try {
    const doc = documentRef || (typeof document !== 'undefined' ? document : null);
    const root = ui?.root;
    if (!doc || !root || !log) return null;
    if (root.querySelector('[data-gev-chat-log]')) return root.querySelector('[data-gev-chat-log]');
    const doc2 = doc;

    const toggle = doc2.createElement('button');
    toggle.type = 'button';
    toggle.className = 'gev-chat-toggle';
    toggle.dataset.gevChatToggle = 'true';
    toggle.textContent = 'LOG';
    toggle.setAttribute('aria-label', 'Toggle voice chat history');
    toggle.setAttribute('aria-expanded', 'false');

    const drawer = doc2.createElement('div');
    drawer.className = 'gev-chat-log';
    drawer.dataset.gevChatLog = 'true';
    drawer.hidden = true;
    drawer.setAttribute('role', 'log');
    drawer.setAttribute('aria-label', 'Voice chat history');

    const header = doc2.createElement('div');
    header.className = 'gev-chat-header';
    const caption = doc2.createElement('span');
    caption.className = 'gev-chat-caption';
    caption.textContent = 'CHAT HISTORY';
    const copy = doc2.createElement('button');
    copy.type = 'button';
    copy.className = 'gev-chat-copy';
    copy.textContent = 'COPY';
    copy.setAttribute('aria-label', 'Copy chat history as JSON');
    copy.addEventListener('click', () => {
      copyConversationJson(log).then(
        () => {
          copy.textContent = 'COPIED';
          setTimeout(() => { copy.textContent = 'COPY'; }, 1500);
        },
        () => { copy.textContent = 'COPY FAILED'; },
      );
    });
    header.append(caption, copy);
    drawer.append(header);

    const list = doc2.createElement('ol');
    list.className = 'gev-chat-list';
    drawer.append(list);

    const renderEntry = (entry) => {
      const item = doc2.createElement('li');
      item.className = `gev-chat-entry gev-chat-${entry.who}`;
      const when = doc2.createElement('time');
      try {
        when.dateTime = new Date(entry.at).toISOString();
        when.textContent = new Date(entry.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      } catch {
        when.textContent = '';
      }
      const who = doc2.createElement('strong');
      who.textContent = entry.who === 'you' ? 'YOU' : (entry.who === 'gemini' ? 'GEMINI' : (entry.who === 'app' ? 'APP' : String(entry.who).toUpperCase()));
      const text = doc2.createElement('span');
      text.textContent = entry.text;
      item.append(when, who, text);
      if (Array.isArray(entry.calls)) {
        for (const call of entry.calls.slice(0, 12)) {
          const chip = doc2.createElement('code');
          chip.className = call?.ok === false ? 'gev-chat-call gev-chat-fail' : 'gev-chat-call';
          chip.textContent = `${call?.ok === false ? '✖' : '✔'} ${String(call?.name || 'action')}`;
          chip.title = String(call?.error || call?.summary || call?.name || '');
          item.append(chip);
        }
      }
      list.append(item);
      while (list.children.length > CONVERSATION_LOG_LIMIT) list.firstChild?.remove?.();
      try { drawer.scrollTop = drawer.scrollHeight; } catch { /* noop */ }
    };

    for (const entry of log.list()) renderEntry(entry);
    log.subscribe(renderEntry);

    toggle.addEventListener('click', () => {
      drawer.hidden = !drawer.hidden;
      toggle.setAttribute('aria-expanded', String(!drawer.hidden));
    });

    // The toggle lives in the floating chat bar (always visible), not in the
    // crowded mic pill — the drawer itself stays anchored above the pill.
    const chatForm = root.querySelector('[data-gev-free-voice-form]');
    if (chatForm && typeof chatForm.prepend === 'function') chatForm.prepend(toggle);
    else root.append(toggle);
    root.append(drawer);
    return drawer;
  } catch {
    return null;
  }
}

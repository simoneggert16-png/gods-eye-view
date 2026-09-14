import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  attachConversationLog,
  CONVERSATION_LOG_LIMIT,
  CONVERSATION_LOG_STORAGE_KEY,
  copyConversationJson,
  createConversationLog,
  mirrorToServer,
} from './gevConversationLog.js';

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
  };
}

test('log caps memory, persists a tail, restores it', () => {
  const storage = memoryStorage();
  const log = createConversationLog({ storage });
  for (let i = 0; i < CONVERSATION_LOG_LIMIT + 10; i += 1) {
    log.push('you', `message ${i}`);
  }
  assert.equal(log.list().length, CONVERSATION_LOG_LIMIT);
  assert.equal(log.list()[0].text, 'message 10');

  const persisted = JSON.parse(storage.getItem(CONVERSATION_LOG_STORAGE_KEY));
  assert.ok(persisted.length <= 50);

  const revived = createConversationLog({ storage });
  assert.equal(revived.list().length, persisted.length);
  assert.equal(revived.list()[0].who, 'you');
});

test('who normalizes, calls ride along, subscribers hear entries', () => {
  const log = createConversationLog({ storage: memoryStorage() });
  const heard = [];
  const off = log.subscribe((entry) => heard.push(entry));
  log.push('gemini', 'Flying to Tokyo.', [{ name: 'fly_to_location', ok: true }]);
  log.push('hacker', '<img src=x onerror=alert(1)>');
  assert.equal(heard.length, 2);
  assert.equal(heard[0].who, 'gemini');
  assert.deepEqual(heard[0].calls, [{ name: 'fly_to_location', ok: true }]);
  assert.equal(heard[1].who, 'you');
  off();
  log.push('you', 'quiet');
  assert.equal(heard.length, 2);
});

test('corrupt storage never breaks the log', () => {
  const log = createConversationLog({ storage: { getItem: () => '{oops', setItem: () => { throw new Error('locked'); } } });
  log.push('you', 'hi');
  assert.equal(log.list().length, 1);
});

test('mirror posts entries, unsubscribe stops it', async () => {
  const posted = [];
  const log = createConversationLog({ storage: memoryStorage() });
  const off = mirrorToServer(log, {
    fetchImpl: async (url, init) => { posted.push([url, JSON.parse(init.body)]); return { ok: true }; },
  });
  log.push('you', 'take me to tokyo');
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(posted.length, 1);
  assert.equal(posted[0][0], '/api/voice/log');
  assert.equal(posted[0][1].entries[0].text, 'take me to tokyo');
  off();
  log.push('you', 'quiet');
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(posted.length, 1);
  const noop = mirrorToServer(null);
  assert.equal(typeof noop, 'function');
  noop();
});

test('copy returns the history json', async () => {
  const log = createConversationLog({ storage: memoryStorage() });
  log.push('gemini', 'Hi.');
  const json = await copyConversationJson(log, {});
  assert.deepEqual(JSON.parse(json), log.list());
});

function fakeElement(tag) {
  const el = {
    tag,
    children: [],
    dataset: {},
    className: '',
    textContent: '',
    hidden: false,
    scrollTop: 0,
    scrollHeight: 0,
    append(...kids) { kids.forEach((k) => el.children.push(k)); },
    querySelector: () => null,
    setAttribute: () => {},
    addEventListener: () => {},
  };
  Object.defineProperty(el, 'firstChild', {
    get: () => (el.children.length ? { remove: () => el.children.shift() } : null),
  });
  return el;
}

test('drawer renders entries as text, never html', () => {
  const created = [];
  const doc = { createElement: (tag) => { const el = fakeElement(tag); created.push(el); return el; } };
  const appended = [];
  const ui = { root: { querySelector: () => null, append: (...kids) => kids.forEach((k) => appended.push(k)) } };
  const log = createConversationLog({ storage: memoryStorage() });
  const drawer = attachConversationLog(ui, log, doc);
  assert.ok(drawer);
  assert.equal(appended.length, 2, 'toggle + drawer appended');

  log.push('you', '<img src=x onerror=alert(1)>');
  log.push('gemini', 'Flying to Tokyo.', [{ name: 'fly_to_location', ok: true }, { name: 'set_layer_visibility', ok: false, error: 'nope' }]);
  const list = created.find((el) => el.className === 'gev-chat-list');
  assert.equal(list.children.length, 2);
  const texts = [];
  const walk = (el) => {
    assert.ok(!('innerHTML' in el), 'textContent only, never innerHTML');
    if (typeof el.textContent === 'string' && el.textContent) texts.push(el.textContent);
    for (const child of el.children || []) walk(child);
  };
  walk(list);
  assert.ok(texts.some((t) => t.includes('<img src=x onerror=alert(1)>')), 'payload kept as inert text');
  assert.ok(texts.some((t) => t.includes('Flying to Tokyo.')));

  // Second attach reuses the drawer instead of duplicating.
  const existing = fakeElement('div');
  const ui2 = { root: { querySelector: () => existing, append: () => { throw new Error('must not append twice'); } } };
  assert.equal(attachConversationLog(ui2, log, doc), existing);
});

test('log toggle moves into the chat bar when present', () => {
  const doc = {
    createElement: (tag) => fakeElement(tag),
  };
  const formKids = [];
  const rootKids = [];
  const ui = {
    root: {
      querySelector: (sel) => (sel === '[data-gev-free-voice-form]' ? { prepend: (el) => formKids.push(el) } : null),
      append: (...kids) => kids.forEach((k) => rootKids.push(k)),
    },
  };
  const log = createConversationLog({ storage: memoryStorage() });
  attachConversationLog(ui, log, doc);
  assert.equal(formKids.length, 1, 'toggle prepended into the chat bar');
  assert.equal(formKids[0].className, 'gev-chat-toggle');
  assert.equal(rootKids.length, 1, 'only the drawer stays on the pill');
  assert.equal(rootKids[0].dataset.gevChatLog, 'true');
});

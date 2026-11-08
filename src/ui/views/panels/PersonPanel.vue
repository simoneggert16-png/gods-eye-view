<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { formatDate, formatNumber, t, tn } from '../../../i18n/index.js';
import { applicationPinia } from '../../vueRuntime.js';
import { usePanelChromeStore } from '../../stores/panelChrome.js';
import RailPanel from '../../rail/RailPanel.vue';
import { pickSummaryVoice, waitForSpeechVoices } from './summarySpeech.js';

const SHOWN_LIMIT = 40;
const chrome = usePanelChromeStore(applicationPinia());

const query = ref('');
const place = ref('');
const age = ref('');
const busy = ref(false);
const error = ref('');
const result = ref(null);
const web = ref(null);
const summary = ref(null);
const webBusy = ref(false);
const mapStatus = ref('');
const speaking = ref(false);
let controller = null;
let webController = null;
let summaryController = null;
let speakController = null;
let mapStatusTimer = null;

const canSearch = computed(() => query.value.trim().length >= 2);
const shown = computed(() =>
  (result.value?.matches || []).slice(0, SHOWN_LIMIT),
);
const hiddenCount = computed(() =>
  Math.max(0, (result.value?.matches?.length || 0) - SHOWN_LIMIT),
);
const total = computed(
  () =>
    (result.value?.matches?.length || 0) +
    (result.value?.pages?.length || 0) +
    (result.value?.news?.length || 0) +
    (result.value?.businesses?.length || 0) +
    (web.value?.results?.length || 0),
);

function websiteHref(url) {
  const text = String(url || '').trim();
  if (!text) return '';
  return /^https?:\/\//i.test(text) ? text : `https://${text}`;
}

function hostOf(url) {
  try {
    return new URL(websiteHref(url)).hostname.replace(/^www\./i, '');
  } catch {
    return String(url || '');
  }
}

function telHref(phone) {
  return `tel:${String(phone || '')
    .replace(/\(0\)/g, '')
    .replace(/[^+\d]/g, '')}`;
}

function emailOf(text) {
  const match = String(text || '').match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/);
  return match ? match[0] : '';
}

function phoneOf(text) {
  const candidates =
    String(text || '').match(
      /(?:\+\d[\d ()/.-]{6,}\d|\(0\d{1,4}\)[\d /.-]{5,}\d|\b0\d[\d ()/.-]{5,}\d)/g,
    ) || [];
  return (
    candidates
      .find((value) => value.replace(/\D/g, '').length >= 7)
      ?.trim() || ''
  );
}

function rowPhone(row) {
  return String(row?.phone || phoneOf(row?.snippet) || '').trim();
}

function rowEmail(row) {
  return String(row?.email || emailOf(row?.snippet) || '').trim();
}

function rowPhones(row) {
  if (Array.isArray(row?.phones) && row.phones.length) return row.phones;
  const single = rowPhone(row);
  return single ? [single] : [];
}

function rowEmails(row) {
  if (Array.isArray(row?.emails) && row.emails.length) return row.emails;
  const single = rowEmail(row);
  return single ? [single] : [];
}

const socialLinks = computed(() => {
  const name = result.value?.name || query.value.trim();
  if (!name) return [];
  const text = [name, place.value.trim()].filter(Boolean).join(' ');
  const encoded = encodeURIComponent(text);
  return [
    // i18n-ignore: platform brand names
    {
      label: 'LinkedIn',
      href: `https://www.linkedin.com/search/results/people/?keywords=${encoded}`,
    },
    // i18n-ignore: platform brand names
    {
      label: 'Xing',
      href: `https://www.xing.com/search/members?keywords=${encoded}`,
    },
    // i18n-ignore: platform brand names
    {
      label: 'Instagram',
      href: `https://www.instagram.com/explore/search/keyword/?q=${encoded}`,
    },
    // i18n-ignore: platform brand names
    {
      label: 'Facebook',
      href: `https://www.facebook.com/search/top?q=${encoded}`,
    },
    // i18n-ignore: platform brand names
    {
      label: 'X',
      href: `https://x.com/search?q=${encoded}&f=user`,
    },
  ];
});

const canSpeak = true;
let spokenSummary = null;
let spokenAudio = null;
let speechGeneration = 0;

function stopSummarySpeech() {
  speechGeneration += 1;
  speakController?.abort();
  speakController = null;
  if (spokenAudio) {
    try {
      spokenAudio.onended = null;
      spokenAudio.onerror = null;
      spokenAudio.onpause = null;
      spokenAudio.pause();
      spokenAudio.currentTime = 0;
      spokenAudio.removeAttribute?.('src');
      spokenAudio.load?.();
    } catch {
      /* ignore */
    }
    spokenAudio = null;
  }
  try {
    globalThis.speechSynthesis?.cancel();
  } catch {
    /* ignore */
  }
  spokenSummary = null;
  speaking.value = false;
}

async function speakWithBrowser(text, generation) {
  const synth = globalThis.speechSynthesis;
  if (!synth || !globalThis.SpeechSynthesisUtterance) {
    if (generation === speechGeneration) speaking.value = false;
    return;
  }
  const lang = document.documentElement.lang || 'de';
  const voices = await waitForSpeechVoices(synth);
  if (generation !== speechGeneration || summary.value?.text !== text) {
    if (generation === speechGeneration) speaking.value = false;
    return;
  }
  try {
    synth.cancel();
  } catch {
    /* ignore */
  }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  utterance.rate = 1;
  const voice = pickSummaryVoice(voices, lang);
  if (voice) utterance.voice = voice;
  utterance.onend = utterance.onerror = () => {
    if (spokenSummary === utterance) spokenSummary = null;
    if (generation === speechGeneration) speaking.value = false;
  };
  spokenSummary = utterance;
  speaking.value = true;
  synth.speak(utterance);
}

async function speakSummary() {
  const text = summary.value?.text;
  if (!text) return;
  stopSummarySpeech();
  const generation = ++speechGeneration;
  const request = new AbortController();
  speakController = request;
  speaking.value = true;
  try {
    const response = await fetch('/api/person/speak', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        lang: document.documentElement.lang || 'de',
      }),
      signal: request.signal,
    });
    if (
      request.signal.aborted ||
      generation !== speechGeneration ||
      summary.value?.text !== text
    ) {
      if (generation === speechGeneration) speaking.value = false;
      return;
    }
    if (response.ok) {
      const blob = await response.blob();
      if (request.signal.aborted || generation !== speechGeneration) {
        if (generation === speechGeneration) speaking.value = false;
        return;
      }
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      const release = () => {
        URL.revokeObjectURL(url);
        if (spokenAudio === audio) spokenAudio = null;
        if (generation === speechGeneration) speaking.value = false;
      };
      audio.onended = release;
      audio.onpause = () => {
        if (audio.ended) return;
        if (spokenAudio === audio) spokenAudio = null;
        if (generation === speechGeneration) speaking.value = false;
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        if (spokenAudio === audio) spokenAudio = null;
        if (generation === speechGeneration) {
          void speakWithBrowser(text, generation);
        }
      };
      spokenAudio = audio;
      await audio.play();
      return;
    }
  } catch {
    if (request.signal.aborted || generation !== speechGeneration) {
      if (generation === speechGeneration) speaking.value = false;
      return;
    }
    /* The free voice is unreachable; the browser voice still reads it. */
  } finally {
    if (speakController === request) speakController = null;
  }
  if (generation !== speechGeneration) return;
  await speakWithBrowser(text, generation);
}

function toggleSummarySpeech() {
  if (speaking.value) {
    stopSummarySpeech();
  } else {
    void speakSummary();
  }
}

function onKeyDown(event) {
  if (event.key === 'Escape' && speaking.value) {
    stopSummarySpeech();
  }
}

watch(
  () => chrome.panels?.['person-panel']?.collapsed,
  (collapsed) => {
    if (collapsed) stopSummarySpeech();
  },
);

function showAddress(address, label) {
  const text = String(address || '').trim();
  if (!text) return;
  window.dispatchEvent(
    new CustomEvent('gev:map-focus', {
      detail: { address: text, label: label || text },
    }),
  );
}

function showOnMap(row) {
  const lat = Number(row?.lat);
  const lon = Number(row?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
  window.dispatchEvent(
    new CustomEvent('gev:map-focus', {
      detail: {
        lat,
        lon,
        label: row.name || row.title || row.place,
        address: row.address || row.place,
      },
    }),
  );
}

function showAddressOnMap() {
  const address = place.value.trim();
  if (!address) return;
  window.dispatchEvent(
    new CustomEvent('gev:map-focus', {
      detail: { address, label: address },
    }),
  );
}

function onMapFocusResult(event) {
  const label = String(event.detail?.label || '').trim();
  const status = event.detail?.ok
    ? event.detail?.parcel
      ? t('Parcel marked (official cadastre).')
      : t('Estimated area — not a cadastral parcel.')
    : t('Location not found');
  mapStatus.value = label ? `${label} · ${status}` : status;
  clearTimeout(mapStatusTimer);
  mapStatusTimer = setTimeout(() => {
    mapStatus.value = '';
  }, 4500);
}

function onPersonSearch(event) {
  const detail = event.detail || {};
  const name = String(detail.name || '').trim();
  if (name.length < 2) return;
  stopSummarySpeech();
  controller?.abort();
  webController?.abort();
  summaryController?.abort();
  busy.value = false;
  webBusy.value = false;
  query.value = name;
  place.value = String(detail.place || '').trim();
  age.value = String(detail.age || '').trim();
  if (chrome.panels?.['person-panel']?.collapsed !== false) {
    chrome.act?.('toggle', 'person-panel');
  }
  void search();
}

const webLinks = computed(() => {
  const name = result.value?.name || query.value.trim();
  if (!name) return [];
  const area = place.value.trim();
  const text = [name, area].filter(Boolean).join(' ');
  const encoded = encodeURIComponent(text);
  const encodedName = encodeURIComponent(name);
  const encodedArea = encodeURIComponent(area);
  return [
    // i18n-ignore: search-engine brand names
    { label: 'Google', href: `https://www.google.com/search?q=${encoded}` },
    // i18n-ignore: search-engine brand names
    {
      label: 'search.ch',
      href: `https://tel.search.ch/?was=${encodedName}${area ? `&wo=${encodedArea}` : ''}`,
    },
    // i18n-ignore: search-engine brand names
    {
      label: 'local.ch',
      href: `https://www.local.ch/de/q?what=${encodedName}${area ? `&where=${encodedArea}` : ''}`,
    },
    // i18n-ignore: search-engine brand names
    {
      label: 'Zefix',
      href: `https://www.zefix.ch/de/search/entity/list?name=${encodedName}`,
    },
    // i18n-ignore: search-engine brand names
    {
      label: 'Moneyhouse',
      href: `https://www.moneyhouse.ch/de/search?q=${encoded}`,
    },
    // i18n-ignore: search-engine brand names
    { label: 'DuckDuckGo', href: `https://duckduckgo.com/?q=${encoded}` },
    // i18n-ignore: search-engine brand names
    { label: 'Bing', href: `https://www.bing.com/search?q=${encoded}` },
  ];
});

/** Consolidated phone numbers and email addresses across web hits & businesses. */
const contactRows = computed(() => {
  const rows = [];
  const seenPhones = new Set();
  const seenEmails = new Set();
  const sources = [
    ...(web.value?.results || []),
    ...(result.value?.businesses || []).map((b) => ({
      title: b.name,
      url: b.website ? websiteHref(b.website) : b.sourceUrl,
      phone: b.phone,
      email: b.email,
      address: b.address,
      source: b.source,
    })),
  ];
  for (const row of sources) {
    const phones = rowPhones(row).filter((p) => {
      const key = p.replace(/\(0\)/g, '').replace(/\D/g, '').slice(-8);
      if (!key || seenPhones.has(key)) return false;
      seenPhones.add(key);
      return true;
    });
    const emails = rowEmails(row).filter((e) => {
      const key = e.toLowerCase();
      if (!key || seenEmails.has(key)) return false;
      seenEmails.add(key);
      return true;
    });
    if (!phones.length && !emails.length) continue;
    rows.push({
      title: row.title,
      url: row.url,
      phones,
      emails,
      address: row.address || '',
      source: row.source || '',
    });
  }
  return rows.slice(0, 8);
});

/** Rows whose own page or business listing printed a street address for this name. */
const addressRows = computed(() => {
  const seen = new Set();
  const rows = [];
  const sources = [
    ...(web.value?.results || []),
    ...(result.value?.businesses || []).map((b) => ({
      title: b.name,
      url: b.website ? websiteHref(b.website) : b.sourceUrl,
      phone: b.phone,
      email: b.email,
      address: b.address,
      snippet: b.category || '',
      lat: b.lat,
      lon: b.lon,
    })),
  ];
  for (const row of sources) {
    const text = String(row.address || '').trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ ...row, address: text });
  }
  return rows.slice(0, 8);
});

const webRows = computed(() =>
  (web.value?.results || []).filter((row) => !row.address),
);

function when(value) {
  const time = new Date(value);
  return Number.isFinite(time.getTime())
    ? formatDate(time, { dateStyle: 'medium', timeStyle: 'short' })
    : '';
}

function detail(row) {
  return [row.sub, row.place, when(row.updated)].filter(Boolean).join(' · ');
}

function newsDetail(row) {
  return [
    row.source,
    row.language ? String(row.language).toUpperCase() : '',
    when(row.published),
  ]
    .filter(Boolean)
    .join(' · ');
}

async function loadWeb(name, area, ageHint, request) {
  web.value = null;
  webBusy.value = true;
  try {
    const params = new URLSearchParams({ name });
    if (area) params.set('place', area);
    if (ageHint) params.set('age', ageHint);
    const lang = String(document.documentElement.lang || '')
      .toLowerCase()
      .split('-')[0];
    if (lang) params.set('lang', lang);
    const response = await fetch(`/api/person/web?${params.toString()}`, {
      cache: 'no-store',
      signal: request.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    if (request.signal.aborted) return;
    web.value = {
      configured: Boolean(body?.configured),
      results: Array.isArray(body?.results) ? body.results : [],
      contacts: body?.contacts || { phones: [], emails: [], addresses: [] },
      source: String(body?.source || ''),
    };
  } catch {
    if (request.signal.aborted) return;
    web.value = {
      configured: true,
      results: [],
      contacts: { phones: [], emails: [], addresses: [] },
      source: '',
    };
  } finally {
    if (webController === request) {
      webController = null;
      webBusy.value = false;
    }
  }
}

async function loadSummary(name, area, ageHint, request, readAloud) {
  summary.value = null;
  try {
    const params = new URLSearchParams({ name });
    if (area) params.set('place', area);
    if (ageHint) params.set('age', ageHint);
    const lang = String(document.documentElement.lang || '')
      .toLowerCase()
      .split('-')[0];
    if (lang) params.set('lang', lang);
    const response = await fetch(`/api/person/summary?${params.toString()}`, {
      cache: 'no-store',
      signal: request.signal,
    });
    if (!response.ok) return;
    const body = await response.json();
    if (request.signal.aborted) return;
    summary.value = body?.summary
      ? {
          text: String(body.summary),
          model: String(body.model || ''),
          fallback: Boolean(body.fallback),
        }
      : null;
    if (readAloud) void speakSummary();
  } catch {
    if (!request.signal.aborted) summary.value = null;
  } finally {
    if (summaryController === request) summaryController = null;
  }
}

async function search() {
  const name = query.value.trim().replace(/\s+/g, ' ');
  if (name.length < 2) return;
  stopSummarySpeech();
  const area = place.value.trim().replace(/\s+/g, ' ');
  const ageHint = age.value.trim().replace(/\s+/g, ' ');
  controller?.abort();
  webController?.abort();
  summaryController?.abort();
  const request = new AbortController();
  const webRequest = new AbortController();
  const summaryRequest = new AbortController();
  controller = request;
  webController = webRequest;
  summaryController = summaryRequest;
  busy.value = true;
  error.value = '';
  result.value = null;
  summary.value = null;
  void loadWeb(name, area, ageHint, webRequest);
  void loadSummary(name, area, ageHint, summaryRequest, true);
  try {
    const params = new URLSearchParams({ name });
    if (area) params.set('place', area);
    const response = await fetch(`/api/person/reports?${params.toString()}`, {
      cache: 'no-store',
      signal: request.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    if (request.signal.aborted) return;
    result.value = {
      name: String(body?.name || name),
      matches: Array.isArray(body?.matches) ? body.matches : [],
      pages: Array.isArray(body?.pages) ? body.pages : [],
      news: Array.isArray(body?.news) ? body.news : [],
      businesses: Array.isArray(body?.businesses) ? body.businesses : [],
      businessQuery: String(body?.businessQuery || ''),
      scanned: Number(body?.scanned) || 0,
    };
  } catch {
    if (request.signal.aborted) return;
    error.value = t('Search is unavailable right now.');
  } finally {
    if (controller === request) {
      controller = null;
      busy.value = false;
    }
  }
}

function clearSearch() {
  stopSummarySpeech();
  controller?.abort();
  webController?.abort();
  summaryController?.abort();
  controller = null;
  webController = null;
  summaryController = null;
  query.value = '';
  place.value = '';
  age.value = '';
  busy.value = false;
  webBusy.value = false;
  error.value = '';
  result.value = null;
  web.value = null;
  summary.value = null;
  mapStatus.value = '';
}

onMounted(() => {
  window.addEventListener('gev:map-focus-result', onMapFocusResult);
  window.addEventListener('gev:person-search', onPersonSearch);
  window.addEventListener('keydown', onKeyDown);
});

onBeforeUnmount(() => {
  stopSummarySpeech();
  controller?.abort();
  webController?.abort();
  summaryController?.abort();
  clearTimeout(mapStatusTimer);
  window.removeEventListener('gev:map-focus-result', onMapFocusResult);
  window.removeEventListener('gev:person-search', onPersonSearch);
  window.removeEventListener('keydown', onKeyDown);
});
</script>

<template>
  <RailPanel
    id="person-panel"
    start-collapsed
    sideways
    scroll
    :title="t('PERSON SEARCH')"
  >
    <template #badge>
      <span id="person-panel-count" :aria-label="t('Matches found')">{{
        result || web ? formatNumber(total) : '0'
      }}</span>
    </template>
    <div class="cyber-panel-body ui-scroll person-body" data-rail-scroller>
      <p class="person-note">
        {{
          t(
            'Searches public reporting, news, encyclopedias, business directories and the web.',
          )
        }}
      </p>
      <form class="person-form" @submit.prevent="search">
        <div class="person-row">
          <input
            v-model="query"
            class="person-input"
            type="search"
            maxlength="60"
            autocomplete="off"
            spellcheck="false"
            :placeholder="t('Name or part of a name')"
            :aria-label="t('Name or part of a name')"
          />
          <button
            class="person-submit"
            type="submit"
            :disabled="!canSearch"
            :aria-busy="String(busy)"
          >
            <span class="material-symbols-outlined" aria-hidden="true"
              >search</span
            >
            <span>{{ t('SEARCH') }}</span>
          </button>
        </div>
        <div class="person-row">
          <input
            v-model="place"
            class="person-input"
            type="search"
            maxlength="60"
            autocomplete="off"
            spellcheck="false"
            :placeholder="t('Place (optional)')"
            :aria-label="t('Place (optional)')"
          />
          <input
            v-model="age"
            class="person-input person-age"
            type="text"
            maxlength="12"
            autocomplete="off"
            spellcheck="false"
            :placeholder="t('Age (optional)')"
            :aria-label="t('Age (optional)')"
          />
          <button
            class="person-map"
            type="button"
            :title="t('Show on map')"
            :aria-label="t('Show on map')"
            :disabled="!place.trim()"
            @click="showAddressOnMap"
          >
            <span class="material-symbols-outlined" aria-hidden="true"
              >my_location</span
            >
          </button>
        </div>
      </form>
      <p v-if="mapStatus" class="person-meta" role="status">{{ mapStatus }}</p>

      <p
        v-if="error && !web?.results?.length && !summary?.text"
        class="person-error"
        role="status"
      >
        {{ error }}
      </p>
      <p v-else-if="busy" class="person-status" role="status">
        {{ t('Searching…') }}
      </p>

      <template v-if="summary?.text">
        <div class="person-section">{{ t('SHORT SUMMARY') }}</div>
        <p class="person-summary">{{ summary.text }}</p>
        <div v-if="canSpeak" class="person-summary-actions">
          <button
            class="person-speak"
            :class="{ 'is-speaking': speaking }"
            type="button"
            :title="speaking ? t('Stop playback (Esc)') : t('Read aloud')"
            :aria-label="speaking ? t('Stop playback (Esc)') : t('Read aloud')"
            @click="toggleSummarySpeech"
          >
            <span class="material-symbols-outlined" aria-hidden="true">{{
              speaking ? 'stop_circle' : 'volume_up'
            }}</span>
            <span>{{
              speaking ? t('Stop playback (Esc)') : t('Read aloud')
            }}</span>
          </button>
        </div>
        <p class="person-meta">
          {{
            summary.fallback
              ? t(
                  'Automatic summary unavailable — showing the top public hits instead.',
                )
              : t('AI summary based only on the linked public results.')
          }}
        </p>
      </template>

      <template v-if="contactRows.length">
        <div class="person-section">{{ t('CONTACTS') }}</div>
        <ul class="person-list">
          <li
            v-for="(row, index) in contactRows"
            :key="(row.url || row.title) + index"
          >
            <span class="person-contact">
              <a
                v-for="phone in row.phones"
                :key="phone"
                class="person-chip"
                :href="telHref(phone)"
                >{{ phone }}</a
              >
              <a
                v-for="email in row.emails"
                :key="email"
                class="person-chip"
                :href="`mailto:${email}`"
                >{{ email }}</a
              >
            </span>
            <a
              v-if="row.url"
              :href="row.url"
              target="_blank"
              rel="noopener noreferrer"
              >{{ row.title }}</a
            >
            <span v-else class="person-title">{{ row.title }}</span>
            <span class="person-meta">{{
              [row.address, hostOf(row.url), row.source]
                .filter(Boolean)
                .join(' · ')
            }}</span>
          </li>
        </ul>
      </template>

      <template v-if="addressRows.length">
        <div class="person-section">{{ t('PUBLISHED ADDRESSES') }}</div>
        <ul class="person-list">
          <li v-for="row in addressRows" :key="row.url">
            <span class="person-contact">
              <span class="person-address">{{ row.address }}</span>
              <button
                class="person-map"
                type="button"
                :title="t('Show on map')"
                :aria-label="t('Show on map')"
                @click="showAddress(row.address, row.title)"
              >
                <span class="material-symbols-outlined" aria-hidden="true"
                  >my_location</span
                >
              </button>
            </span>
            <a :href="row.url" target="_blank" rel="noopener noreferrer">{{
              row.title
            }}</a>
            <span
              v-if="rowPhones(row).length || rowEmails(row).length"
              class="person-contact"
            >
              <a
                v-for="phone in rowPhones(row)"
                :key="phone"
                :href="telHref(phone)"
                >{{ phone }}</a
              >
              <a
                v-for="email in rowEmails(row)"
                :key="email"
                :href="`mailto:${email}`"
                >{{ email }}</a
              >
            </span>
            <span class="person-meta">{{
              [hostOf(row.url), row.source].filter(Boolean).join(' · ')
            }}</span>
          </li>
        </ul>
        <p class="person-meta">
          {{ t('Extracted from the linked source; verify there.') }}
        </p>
      </template>

      <template v-if="webRows.length">
        <div class="person-section">{{ t('WEB RESULTS') }}</div>
        <ul class="person-list">
          <li
            v-for="(row, index) in webRows"
            :key="row.url || row.title + index"
          >
            <a :href="row.url" target="_blank" rel="noopener noreferrer">{{
              row.title
            }}</a>
            <span v-if="row.snippet" class="person-extract">{{
              row.snippet
            }}</span>
            <span
              v-if="rowPhones(row).length || rowEmails(row).length"
              class="person-contact"
            >
              <a
                v-for="phone in rowPhones(row)"
                :key="phone"
                :href="telHref(phone)"
                >{{ phone }}</a
              >
              <a
                v-for="email in rowEmails(row)"
                :key="email"
                :href="`mailto:${email}`"
                >{{ email }}</a
              >
            </span>
            <span class="person-meta">{{
              [hostOf(row.url), row.source].filter(Boolean).join(' · ')
            }}</span>
          </li>
        </ul>
      </template>

      <template v-if="webLinks.length && (result || web)">
        <div class="person-section person-section--spaced">
          {{ t('WEB SEARCH') }}
        </div>
        <div class="person-web">
          <a
            v-for="engine in webLinks"
            :key="engine.label"
            :href="engine.href"
            target="_blank"
            rel="noopener noreferrer"
            >{{ engine.label }}</a
          >
        </div>
      </template>

      <template v-if="socialLinks.length && (result || web)">
        <div class="person-section person-section--spaced">
          {{ t('SOCIAL MEDIA') }}
        </div>
        <div class="person-web">
          <a
            v-for="social in socialLinks"
            :key="social.label"
            :href="social.href"
            target="_blank"
            rel="noopener noreferrer"
            >{{ social.label }}</a
          >
        </div>
        <p class="person-meta">
          {{ t('Opens the platform search — no automatic identity check.') }}
        </p>
      </template>

      <template v-if="result">
        <p
          v-if="!total && !webBusy && !web?.results?.length"
          class="person-status"
        >
          {{ t('No public reporting or business listing found for this name.') }}
        </p>
        <template v-else-if="total">
          <template v-if="result.businesses.length">
            <div class="person-section">{{ t('COMPANIES & PRACTICES') }}</div>
            <ul class="person-list">
              <li
                v-for="(row, index) in result.businesses"
                :key="row.name + (row.phone || row.address) + index"
              >
                <a
                  v-if="row.website || row.sourceUrl"
                  class="person-title"
                  :href="
                    row.website ? websiteHref(row.website) : row.sourceUrl
                  "
                  target="_blank"
                  rel="noopener noreferrer"
                  >{{ row.name }}</a
                >
                <span v-else class="person-title">{{ row.name }}</span>
                <span class="person-meta">{{
                  [row.category, row.address].filter(Boolean).join(' · ')
                }}</span>
                <span class="person-contact">
                  <a v-if="row.phone" :href="telHref(row.phone)">{{
                    row.phone
                  }}</a>
                  <a v-if="row.email" :href="`mailto:${row.email}`">{{
                    row.email
                  }}</a>
                  <a
                    v-if="row.website"
                    :href="websiteHref(row.website)"
                    target="_blank"
                    rel="noopener noreferrer"
                    >{{ hostOf(row.website) }}</a
                  >
                  <a
                    v-if="row.sourceUrl"
                    :href="row.sourceUrl"
                    target="_blank"
                    rel="noopener noreferrer"
                    >{{ row.source }}</a
                  >
                  <span v-else-if="row.source" class="person-meta">{{
                    row.source
                  }}</span>
                  <button
                    v-if="
                      Number.isFinite(Number(row.lat)) &&
                      Number.isFinite(Number(row.lon))
                    "
                    class="person-map"
                    type="button"
                    :title="t('Show on map')"
                    :aria-label="t('Show on map')"
                    @click="showOnMap(row)"
                  >
                    <span class="material-symbols-outlined" aria-hidden="true"
                      >my_location</span
                    >
                  </button>
                </span>
              </li>
            </ul>
            <p class="person-meta">
              {{
                t(
                  'Name match only — no statement about owners, staff or family. Verify on the official page.',
                )
              }}
            </p>
          </template>
          <p v-else-if="result.businessQuery" class="person-status">
            {{ t('No business or practice listings found for this name.') }}
          </p>

          <template v-if="result.pages.length">
            <div class="person-section">{{ t('ENCYCLOPEDIA') }}</div>
            <article
              v-for="page in result.pages"
              :key="`${page.lang}:${page.title}`"
              class="person-page"
            >
              <a :href="page.url" target="_blank" rel="noopener noreferrer">
                {{ page.title
                }}<span class="person-lang">{{
                  page.lang.toUpperCase()
                }}</span>
              </a>
              <span v-if="page.description" class="person-meta">{{
                page.description
              }}</span>
              <p class="person-extract">{{ page.extract }}</p>
            </article>
          </template>

          <template v-if="result.news.length">
            <div class="person-section person-section--spaced">
              {{ t('NEWS') }}
            </div>
            <ul class="person-list">
              <li
                v-for="(row, index) in result.news"
                :key="row.url || row.title + index"
              >
                <a
                  v-if="row.url"
                  :href="row.url"
                  target="_blank"
                  rel="noopener noreferrer"
                  >{{ row.title }}</a
                >
                <span v-else class="person-title">{{ row.title }}</span>
                <span class="person-meta">{{ newsDetail(row) }}</span>
              </li>
            </ul>
          </template>

          <div class="person-section person-section--spaced">
            {{ t('HEADLINES') }}
            <span v-if="result.matches.length" class="person-count">{{
              tn(result.matches.length, '{count} match', '{count} matches')
            }}</span>
          </div>
          <p v-if="!result.matches.length" class="person-status">
            {{ t('No headline mentions in the current feed.') }}
          </p>
          <ul v-else class="person-list">
            <li
              v-for="(row, index) in shown"
              :key="row.url || row.title + index"
            >
              <a
                v-if="row.url"
                :href="row.url"
                target="_blank"
                rel="noopener noreferrer"
                >{{ row.title }}</a
              >
              <span v-else class="person-title">{{ row.title }}</span>
              <span class="person-contact">
                <span class="person-meta">{{ detail(row) }}</span>
                <button
                  v-if="
                    Number.isFinite(Number(row.lat)) &&
                    Number.isFinite(Number(row.lon))
                  "
                  class="person-map"
                  type="button"
                  :title="t('Show on map')"
                  :aria-label="t('Show on map')"
                  @click="showOnMap(row)"
                >
                  <span class="material-symbols-outlined" aria-hidden="true"
                    >my_location</span
                  >
                </button>
              </span>
            </li>
          </ul>
          <p v-if="hiddenCount" class="person-status">
            {{ t('Showing the newest matches only.') }}
          </p>
        </template>
        <p v-if="result.scanned" class="person-meta">
          {{
            t('Scanned {count} aggregated headlines.', {
              count: formatNumber(result.scanned),
            })
          }}
        </p>
      </template>
      <p
        v-if="
          !busy &&
          !webBusy &&
          !summaryBusy &&
          !error &&
          !result &&
          !web &&
          !summary
        "
        class="person-status"
      >
        {{ t('Enter a name to search the aggregated feeds.') }}
      </p>

      <p class="person-privacy">
        {{
          t('Contact details appear only when the linked source publishes them.')
        }}
      </p>
      <button
        v-if="result || web || summary || error"
        class="person-clear"
        type="button"
        @click="clearSearch"
      >
        {{ t('CLEAR') }}
      </button>
    </div>
  </RailPanel>
</template>

<style scoped>
.person-body {
  display: grid;
  gap: 8px;
  padding: 8px 10px 12px;
}

.person-note,
.person-privacy {
  margin: 0;
  font-size: 10px;
  line-height: 1.4;
  color: var(--text-secondary, #8fb3bf);
}

.person-privacy {
  margin-top: 4px;
  padding-top: 6px;
  border-top: 1px solid rgba(120, 200, 220, 0.18);
  color: var(--text-dim, #6f8b97);
}

.person-form {
  display: grid;
  gap: 6px;
}

.person-row {
  display: flex;
  gap: 6px;
}

.person-input {
  flex: 1 1 auto;
  min-width: 0;
  padding: 5px 7px;
  border: 1px solid rgba(120, 200, 220, 0.35);
  background: rgba(4, 14, 20, 0.65);
  color: var(--text-primary, #d7f6ff);
  font-family: var(--font-mono, monospace);
  font-size: 11px;
}

.person-input::placeholder {
  color: var(--text-dim, #6f8b97);
}

.person-submit {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  padding: 5px 8px;
  border: 1px solid rgba(120, 200, 220, 0.35);
  background: rgba(20, 60, 74, 0.45);
  color: var(--text-primary, #d7f6ff);
  font-family: var(--font-mono, monospace);
  font-size: 10px;
  letter-spacing: 0.08em;
  cursor: pointer;
}

.person-submit:disabled {
  opacity: 0.45;
  cursor: default;
}

.person-submit .material-symbols-outlined {
  font-size: 14px;
}

.person-summary-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.person-speak {
  display: inline-flex;
  gap: 5px;
  align-items: center;
  padding: 4px 9px;
  border: 1px solid rgba(120, 200, 220, 0.35);
  background: rgba(20, 60, 74, 0.45);
  color: var(--text-primary, #d7f6ff);
  font-family: var(--font-mono, monospace);
  font-size: 10px;
  letter-spacing: 0.06em;
  cursor: pointer;
}

.person-speak:hover {
  border-color: rgba(120, 200, 220, 0.65);
  background: rgba(26, 78, 96, 0.55);
}

.person-speak.is-speaking {
  border-color: rgba(255, 120, 120, 0.7);
  background: rgba(90, 24, 28, 0.55);
  color: #ffd6d6;
}

.person-speak .material-symbols-outlined {
  font-size: 14px;
}

.person-section {
  margin-top: 4px;
  font-family: var(--font-mono, monospace);
  font-size: 9px;
  letter-spacing: 0.14em;
  color: var(--text-dim, #6f8b97);
}

.person-section--spaced {
  margin-top: 10px;
}

.person-count {
  margin-left: 6px;
  letter-spacing: 0;
}

.person-status,
.person-error {
  margin: 0;
  font-size: 10px;
  line-height: 1.4;
  color: var(--text-secondary, #8fb3bf);
}

.person-error {
  color: #ff8c8c;
}

.person-page {
  display: grid;
  gap: 3px;
  padding: 6px 0;
  border-bottom: 1px solid rgba(120, 200, 220, 0.12);
}

.person-page a {
  font-size: 11px;
  color: var(--text-primary, #d7f6ff);
}

.person-lang {
  margin-left: 5px;
  font-family: var(--font-mono, monospace);
  font-size: 8px;
  color: var(--text-dim, #6f8b97);
}

.person-extract {
  margin: 0;
  font-size: 10px;
  line-height: 1.45;
  color: var(--text-secondary, #8fb3bf);
}

.person-list {
  display: grid;
  gap: 7px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.person-list li {
  display: grid;
  gap: 2px;
  padding-bottom: 6px;
  border-bottom: 1px solid rgba(120, 200, 220, 0.12);
}

.person-list a,
.person-title {
  font-size: 11px;
  line-height: 1.35;
  color: var(--text-primary, #d7f6ff);
}

.person-meta {
  font-family: var(--font-mono, monospace);
  font-size: 9px;
  color: var(--text-dim, #6f8b97);
}

.person-contact {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
  align-items: baseline;
}

.person-contact a {
  font-family: var(--font-mono, monospace);
  font-size: 10px;
  color: var(--text-secondary, #8fb3bf);
  text-decoration: underline;
  text-decoration-color: rgba(120, 200, 220, 0.35);
  text-underline-offset: 2px;
}

.person-chip {
  padding: 1px 6px;
  border: 1px solid rgba(120, 200, 220, 0.35);
  background: rgba(20, 60, 74, 0.35);
  color: var(--text-primary, #d7f6ff) !important;
  text-decoration: none !important;
}

.person-chip:hover {
  border-color: rgba(120, 200, 220, 0.7);
  background: rgba(26, 78, 96, 0.55);
}

.person-address {
  flex: 1 1 auto;
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  line-height: 1.35;
  color: var(--text-primary, #d7f6ff);
}

.person-web {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.person-web a {
  padding: 3px 8px;
  border: 1px solid rgba(120, 200, 220, 0.3);
  font-family: var(--font-mono, monospace);
  font-size: 9px;
  letter-spacing: 0.06em;
  color: var(--text-primary, #d7f6ff);
  text-decoration: none;
}

.person-web a:hover {
  border-color: rgba(120, 200, 220, 0.6);
  background: rgba(20, 60, 74, 0.35);
}

.person-map {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 1px solid rgba(120, 200, 220, 0.3);
  background: rgba(20, 60, 74, 0.35);
  color: var(--text-secondary, #8fb3bf);
  cursor: pointer;
}

.person-map .material-symbols-outlined {
  font-size: 14px;
}

.person-map:disabled {
  opacity: 0.4;
  cursor: default;
}

.person-age {
  flex: 0 0 78px;
}

.person-summary {
  margin: 0;
  color: var(--text-primary, #d6e6ea);
  font: 400 11px/1.5 var(--font-sans);
  white-space: pre-line;
}

.person-clear {
  justify-self: start;
  padding: 3px 7px;
  border: 1px solid rgba(120, 200, 220, 0.3);
  background: transparent;
  color: var(--text-secondary, #8fb3bf);
  font-family: var(--font-mono, monospace);
  font-size: 9px;
  letter-spacing: 0.1em;
  cursor: pointer;
}
</style>

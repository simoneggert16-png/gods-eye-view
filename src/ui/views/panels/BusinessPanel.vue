<script setup>
import { computed, onBeforeUnmount, ref } from 'vue';
import { formatNumber, t } from '../../../i18n/index.js';
import RailPanel from '../../rail/RailPanel.vue';

const query = ref('');
const place = ref('');
const busy = ref(false);
const error = ref('');
const result = ref(null);
let controller = null;

const canSearch = computed(() => query.value.trim().length >= 2 && !busy.value);
const count = computed(() => result.value?.results?.length || 0);
const webSearchUrl = computed(
  () =>
    'https://duckduckgo.com/?q=' +
    encodeURIComponent(result.value?.query || query.value.trim()),
);

function websiteHref(url) {
  const text = String(url || '').trim();
  if (!text) return '';
  return /^https?:\/\//i.test(text) ? text : `https://${text}`;
}

function hostOf(url) {
  const text = websiteHref(url);
  try {
    return new URL(text).hostname.replace(/^www\./, '');
  } catch {
    return text.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  }
}

async function search() {
  const text = query.value.trim().replace(/\s+/g, ' ');
  const area = place.value.trim().replace(/\s+/g, ' ');
  if (text.length < 2 || busy.value) return;
  controller?.abort();
  const request = new AbortController();
  controller = request;
  busy.value = true;
  error.value = '';
  result.value = null;
  try {
    const params = new URLSearchParams({ q: text });
    if (area) params.set('place', area);
    const response = await fetch(`/api/business/search?${params}`, {
      cache: 'no-store',
      signal: request.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    if (request.signal.aborted) return;
    result.value = {
      query: String(body?.query || text),
      source: String(body?.source || ''),
      results: Array.isArray(body?.results) ? body.results : [],
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
  controller?.abort();
  controller = null;
  query.value = '';
  place.value = '';
  busy.value = false;
  error.value = '';
  result.value = null;
}

onBeforeUnmount(() => controller?.abort());
</script>

<template>
  <RailPanel id="business-panel" start-collapsed sideways scroll :title="t('BUSINESS CONTACTS')">
    <template #badge>
      <span id="business-panel-count" :aria-label="t('Matches found')">{{ result ? formatNumber(count) : '0' }}</span>
    </template>
    <div class="cyber-panel-body ui-scroll business-body" data-rail-scroller>
      <p class="business-note">{{ t('Searches publicly listed business and practice contacts only — no private individuals.') }}</p>
      <p class="business-note">{{ t('Company name or surname of the founder — finds companies, not people.') }}</p>
      <form class="business-form" @submit.prevent="search">
        <input
          v-model="query"
          class="business-input"
          type="search"
          maxlength="80"
          autocomplete="off"
          spellcheck="false"
          :placeholder="t('Company name or surname')"
          :aria-label="t('Company name or surname')"
        />
        <input
          v-model="place"
          class="business-input"
          type="search"
          maxlength="60"
          autocomplete="off"
          spellcheck="false"
          :placeholder="t('Place (optional)')"
          :aria-label="t('Place (optional)')"
        />
        <button class="business-submit" type="submit" :disabled="!canSearch" :aria-busy="String(busy)">
          <span class="material-symbols-outlined" aria-hidden="true">search</span>
          <span>{{ t('SEARCH') }}</span>
        </button>
      </form>

      <p v-if="error" class="business-error" role="status">{{ error }}</p>
      <p v-else-if="busy" class="business-status" role="status">{{ t('Searching…') }}</p>
      <template v-else-if="result">
        <p v-if="!count" class="business-status">{{ t('No public business contact found.') }}</p>
        <ul v-else class="business-list">
          <li v-for="(row, index) in result.results" :key="row.sourceUrl || row.name + index">
            <strong class="business-name">{{ row.name }}</strong>
            <span v-if="row.category" class="business-category">{{ row.category }}</span>
            <span v-if="row.address" class="business-address">{{ row.address }}</span>
            <span v-if="row.openingHours" class="business-meta">{{ row.openingHours }}</span>
            <span class="business-links">
              <a v-if="row.phone" :href="`tel:${row.phone}`">{{ row.phone }}</a>
              <a v-if="row.email" :href="`mailto:${row.email}`">{{ row.email }}</a>
              <a v-if="row.website" :href="websiteHref(row.website)" target="_blank" rel="noopener noreferrer">{{ hostOf(row.website) }}</a>
            </span>
            <a v-if="row.sourceUrl" class="business-source" :href="row.sourceUrl" target="_blank" rel="noopener noreferrer">{{ row.source }}</a>
            <span v-else class="business-source">{{ row.source }}</span>
          </li>
        </ul>
        <p class="business-note">{{ t('Name match only — no statement about owners, staff or family. Verify on the official page.') }}</p>
        <a class="business-web" :href="webSearchUrl" target="_blank" rel="noopener noreferrer">{{ t('Open web search') }}</a>
      </template>
      <p v-else class="business-status">{{ t('Enter a business, practice or place to search.') }}</p>

      <button v-if="result || error" class="business-clear" type="button" @click="clearSearch">{{ t('CLEAR') }}</button>
    </div>
  </RailPanel>
</template>

<style scoped>
.business-body {
  display: grid;
  gap: 8px;
  padding: 8px 10px 12px;
}

.business-note {
  margin: 0;
  font-size: 10px;
  line-height: 1.4;
  color: var(--text-secondary, #8fb3bf);
}

.business-form {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 6px;
}

.business-form .business-input:first-of-type {
  grid-column: 1;
}

.business-form .business-input:nth-of-type(2) {
  grid-column: 1;
}

.business-input {
  flex: 1 1 auto;
  min-width: 0;
  padding: 5px 7px;
  border: 1px solid rgba(120, 200, 220, 0.35);
  background: rgba(4, 14, 20, 0.65);
  color: var(--text-primary, #d7f6ff);
  font-family: var(--font-mono, monospace);
  font-size: 11px;
}

.business-input::placeholder {
  color: var(--text-dim, #6f8b97);
}

.business-submit {
  grid-column: 2;
  grid-row: 1 / span 2;
  align-self: stretch;
  display: inline-flex;
  justify-content: center;
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

.business-submit:disabled {
  opacity: 0.45;
  cursor: default;
}

.business-submit .material-symbols-outlined {
  font-size: 14px;
}

.business-status,
.business-error {
  margin: 0;
  font-size: 10px;
  line-height: 1.4;
  color: var(--text-secondary, #8fb3bf);
}

.business-error {
  color: #ff8c8c;
}

.business-list {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.business-list li {
  display: grid;
  gap: 2px;
  padding-bottom: 7px;
  border-bottom: 1px solid rgba(120, 200, 220, 0.12);
}

.business-name {
  font-size: 11px;
  color: var(--text-primary, #d7f6ff);
}

.business-category {
  font-size: 9px;
  letter-spacing: 0.06em;
  color: var(--text-dim, #6f8b97);
}

.business-address {
  font-size: 10px;
  line-height: 1.4;
  color: var(--text-secondary, #8fb3bf);
}

.business-links {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-family: var(--font-mono, monospace);
  font-size: 10px;
}

.business-links a {
  color: var(--text-primary, #d7f6ff);
}

.business-meta,
.business-source {
  font-family: var(--font-mono, monospace);
  font-size: 9px;
  color: var(--text-dim, #6f8b97);
}

.business-source {
  justify-self: start;
}

.business-web {
  justify-self: start;
  font-family: var(--font-mono, monospace);
  font-size: 10px;
  color: var(--text-primary, #d7f6ff);
}

.business-clear {
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

<script setup>
import { t } from '../../../i18n/index.js';
import RailPanel from '../../rail/RailPanel.vue';

// Static legend for the conflict layers and the feed-state chips. Coverage is
// stated on purpose: the front line is DeepState's Ukrainian data.
const conflict = [
  ['#ff4d4d', t('OCCUPIED TERRITORY')],
  ['#ffb84d', t('UNKNOWN STATUS')],
  ['#b48cff', t('FROZEN CONFLICT AREA')],
];

const osint = [
  ['#ff3b30', t('military target')],
  ['#ff8c00', t('energy target')],
  ['#ffd166', t('infrastructure target')],
];

const fires = [
  ['#ffc247', t('small heat source')],
  ['#ff3b30', t('large heat source (higher FRP)')],
];

const hotspots = [
  ['#ffc247', t('2 reports in one cell')],
  ['#ff8c00', t('3–4 reports in one cell')],
  ['#ff3b30', t('5 or more reports in one cell')],
];

const status = [
  ['#53e6a2', t('OK')],
  ['#ffcc5c', t('LOADING · PARTIAL · STALE')],
  ['#ff6b6b', t('FALLBACK · UNAVAILABLE')],
];
</script>

<template>
  <RailPanel id="legend-panel" start-collapsed sideways scroll :title="t('LEGEND')">
    <div class="cyber-panel-body ui-scroll legend-body" data-rail-scroller>
      <div class="legend-section">{{ t('CONFLICT') }}</div>
      <div v-for="[color, label] in conflict" :key="label" class="legend-sub">
        <span class="legend-swatch" :style="{ borderColor: color, background: color + '33' }"></span>
        <span>{{ label }}</span>
      </div>
      <div class="legend-note">{{ t('DeepState covers Ukraine and frozen conflicts — no open data for Gaza or Iran.') }}</div>

      <div class="legend-section">{{ t('HEADLINES & FIRES') }}</div>
      <div class="legend-label">{{ t('OSINT reports (Reddit)') }}</div>
      <div v-for="[color, label] in osint" :key="label" class="legend-sub">
        <span class="legend-swatch legend-swatch--dot" :style="{ background: color }"></span>
        <span>{{ label }}</span>
      </div>
      <div class="legend-label legend-label--spaced">{{ t('Fires near the front') }}</div>
      <div v-for="[color, label] in fires" :key="label" class="legend-sub">
        <span class="legend-swatch legend-swatch--dot" :style="{ background: color }"></span>
        <span>{{ label }}</span>
      </div>
      <div class="legend-note">{{ t('Click a point or an area for its summary.') }}</div>

      <div class="legend-section">{{ t('HOTSPOTS (DERIVED)') }}</div>
      <div v-for="[color, label] in hotspots" :key="label" class="legend-sub">
        <span class="legend-swatch" :style="{ borderColor: color, background: color + '33' }"></span>
        <span>{{ label }}</span>
      </div>
      <div class="legend-note">{{ t('Headline density per ~28 km cell — not control of territory.') }}</div>

      <div class="legend-section">{{ t('STATUS CHIPS') }}</div>
      <div v-for="[color, label] in status" :key="label" class="legend-sub">
        <span class="legend-swatch legend-swatch--dot" :style="{ background: color }"></span>
        <span>{{ label }}</span>
      </div>
    </div>
  </RailPanel>
</template>

<style scoped>
.legend-body {
  display: grid;
  gap: 5px;
  padding: 8px 10px 12px;
}

.legend-section {
  margin-top: 8px;
  font-family: var(--font-mono, monospace);
  font-size: 9px;
  letter-spacing: 0.14em;
  color: var(--text-dim, #6f8b97);
}

.legend-label {
  font-size: 11px;
  color: var(--text-primary, #d7f6ff);
}

.legend-label--spaced {
  margin-top: 6px;
}

.legend-note {
  font-size: 10px;
  line-height: 1.4;
  color: var(--text-secondary, #8fb3bf);
}

.legend-sub {
  display: flex;
  gap: 6px;
  align-items: center;
  font-size: 10px;
  color: var(--text-secondary, #8fb3bf);
}

.legend-swatch {
  flex: 0 0 10px;
  width: 10px;
  height: 10px;
  border: 1px solid;
}

.legend-swatch--dot {
  border-radius: 50%;
  border-color: transparent;
}
</style>

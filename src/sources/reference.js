import { createUsgsEarthquakeSource } from '../layers/earthquakes/source.js';
import { createEcccAirQualitySource } from '../layers/airQuality/source.js';
import { createWfigsPerimeterSource } from '../layers/perimeters/source.js';
import { createBundledCableSource } from '../layers/submarineCables/bundledSource.js';
import { createAdsbGnssSource } from '../layers/gnss/source.js';
import { createFrontlineSource } from '../layers/frontline/source.js';
import { createFrontFiresSource } from '../layers/frontfires/source.js';
import { createOsintSource } from '../layers/osint/source.js';
import { createBordersSource } from '../layers/borders/source.js';
import { createHotspotsSource } from '../layers/hotspots/source.js';

/** Construct the existing reference feeds independently of application setup. */
export function createReferenceSources() {
  return {
    earthquakes: createUsgsEarthquakeSource(),
    'air-quality': createEcccAirQualitySource(),
    'fire-perimeters': createWfigsPerimeterSource(),
    cables: createBundledCableSource(),
    'gnss-integrity': createAdsbGnssSource(),
    frontline: createFrontlineSource(),
    frontfires: createFrontFiresSource(),
    osint: createOsintSource(),
    borders: createBordersSource(),
    hotspots: createHotspotsSource(),
  };
}

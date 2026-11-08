import { createOsintLayer } from '../../layers/osint/index.js';
/** Wire the geocoded OSINT headlines to the application catalog. */
export function createApplicationOsint(options) {
  return createOsintLayer(options);
}

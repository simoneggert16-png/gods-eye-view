/**
 * @module tacticalInspector
 *
 * Universal click-to-inspect coordinator for all 9 military and special ops data layers:
 * conflicts, frontlines, missile-strikes, battles, bombardments,
 * missile-tests, military-convoys, campaign-trails, secret-service.
 */

import * as Cesium from 'cesium';
import { registerPickOwner, unregisterPickOwner, resolvePickId } from './pickRegistry.js';
import { registerEntityContext, selectEntityContext, clearSelectedEntityContextForLayer } from './contextStore.js';
import { showTacticalSitrep, initTacticalSitrepModal } from '../ui/tacticalSitrepModal.js';

const TACTICAL_LAYER_IDS = Object.freeze([
  'conflicts',
  'frontlines',
  'missile-strikes',
  'battles',
  'bombardments',
  'missile-tests',
  'military-convoys',
  'campaign-trails',
  'secret-service',
  'drone-attacks',
  'terror-attacks',
  'live-osint',
]);

let _handler = null;
let _viewer = null;
let _dataManager = null;
const _recordByEntityId = new Map();

/**
 * Register an entity's underlying tactical intelligence record so it can be
 * instantly inspected when clicked.
 */
export function registerTacticalRecord(entityId, intelRecord) {
  if (!entityId || !intelRecord) return;
  _recordByEntityId.set(String(entityId), intelRecord);
}

export function unregisterTacticalRecord(entityId) {
  _recordByEntityId.delete(String(entityId));
}

export function getTacticalRecord(entityId) {
  return _recordByEntityId.get(String(entityId)) || null;
}

/**
 * Initialize universal click interaction for all tactical layers.
 */
export function initTacticalInspector(viewer, dataManager) {
  if (!viewer || _handler) return;
  _viewer = viewer;
  _dataManager = dataManager;

  initTacticalSitrepModal(viewer);

  // Register pick ownership for each tactical layer
  for (const layerId of TACTICAL_LAYER_IDS) {
    registerPickOwner(layerId, (pickedId) => {
      if (!pickedId) return false;
      const strId = String(pickedId);
      return _recordByEntityId.has(strId) ||
        strId.startsWith(`${layerId}-`) ||
        strId.startsWith(`conflict-`) ||
        strId.startsWith(`frontline-`) ||
        strId.startsWith(`strike-`) ||
        strId.startsWith(`bt-`) ||
        strId.startsWith(`bm-`) ||
        strId.startsWith(`ms-`) ||
        strId.startsWith(`crater-`) ||
        strId.startsWith(`mtest-`) ||
        strId.startsWith(`convoy-`) ||
        strId.startsWith(`campaign-`) ||
        strId.startsWith(`usss-`) ||
        strId.startsWith(`drone-`) ||
        strId.startsWith(`terror-`) ||
        strId.startsWith(`live-osint-`) ||
        strId.startsWith(`osint-`);
    });
  }

  _handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  _handler.setInputAction((click) => {
    const picked = viewer.scene.pick(click.position);
    if (!picked) return;

    const rawId = resolvePickId(picked);
    if (!rawId) return;

    // Check if picked entity belongs to tactical records
    const entity = (picked.id instanceof Cesium.Entity ? picked.id : null) ||
                   (picked.primitive?.id instanceof Cesium.Entity ? picked.primitive.id : null);
    let intelRecord = (entity?.__gevIntelRecord) ||
                      (picked.primitive?.__gevIntelRecord) ||
                      _recordByEntityId.get(rawId) ||
                      null;

    // Secondary fallback: search active tactical layers
    if (!intelRecord && _dataManager) {
      for (const layerId of TACTICAL_LAYER_IDS) {
        if (!_dataManager.isEnabled(layerId)) continue;
        const entry = _dataManager.layers.get(layerId);
        const mod = entry?.module;
        if (!mod?.getRecords) continue;
        const records = mod.getRecords();
        const found = records.find(r => rawId.includes(r.id) || r.id === rawId);
        if (found) {
          intelRecord = { ...found, category: layerId };
          break;
        }
      }
    }

    if (intelRecord) {
      if (entity) {
        registerEntityContext(entity, {
          id: rawId,
          layerId: intelRecord.category || 'tactical-intel',
          layerName: intelRecord.title || intelRecord.name || 'Tactical Intel',
          source: intelRecord.source || 'OSINT',
          label: intelRecord.title || intelRecord.name,
          latitude: intelRecord.location?.lat ?? intelRecord.center?.lat ?? 0,
          longitude: intelRecord.location?.lon ?? intelRecord.center?.lon ?? 0,
          properties: intelRecord,
        });
        selectEntityContext(entity);
      }
      showTacticalSitrep(intelRecord);
    }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
}

export function destroyTacticalInspector() {
  if (_handler) {
    _handler.destroy();
    _handler = null;
  }
  for (const layerId of TACTICAL_LAYER_IDS) {
    unregisterPickOwner(layerId);
  }
  _recordByEntityId.clear();
  _viewer = null;
  _dataManager = null;
}

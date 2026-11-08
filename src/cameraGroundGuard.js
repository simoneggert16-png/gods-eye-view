/**
 * Camera ground guard: never leave an arrival buried in, or pressed against,
 * the rendered surface.
 *
 * Arrival framing is computed before the destination's tiles exist, so it has
 * to predict the ground height. `globe.getHeight()` answers nothing while the
 * globe is hidden under photoreal tiles, curated `groundElevation` presets
 * cover only a few cities, and the elevation service resolves asynchronously.
 * A missing prediction used to fall back to sea level, which buried the eye by
 * roughly the local elevation (Denver ~1,600 m; Austin ~170 m).
 *
 * After the flight lands and tiles have streamed in, this module measures the
 * rendered surface under the framed target. A prediction of ellipsoid height 0
 * (the globe is hidden under photoreal tiles, and the floor cache is still
 * cold) aims the shot under the mesh. A correction may only run in that case.
 * Once the address is already on screen, raising the eye — even while keeping
 * the old pitch — slides the building out of frame. A roof sample above the
 * street is not a buried camera.
 */
import * as Cesium from 'cesium';
import { ownCameraArrival } from './data/cameraArrival.js';

/** Minimum eye height above the rendered surface for a usable view. */
export const MIN_EYE_CLEARANCE_M = 120;
/** Retries while tiles stream in; sampling fails until the mesh exists. */
const GUARD_ATTEMPTS = 8;
const GUARD_INTERVAL_MS = 600;
/** Ignore sub-metre noise rather than nudging the camera forever. */
const GUARD_EPSILON_M = 2;

const probeScratch = new Cesium.Cartographic();

/**
 * Highest rendered surface across a few cells, with how many cells answered.
 * A cell whose tiles are not streamed yet contributes nothing.
 * @param {Cesium.Scene} scene Live scene.
 * @param {Array<{lat: number, lon: number}>} cells Cells to probe.
 * @returns {{heightM: number, sampled: number}} Reading.
 */
function sampleSurfaceM(scene, cells) {
  let heightM = Number.NaN;
  let sampled = 0;
  if (typeof scene?.sampleHeight !== 'function') return { heightM, sampled };
  for (const cell of cells) {
    try {
      const height = scene.sampleHeight(
        Cesium.Cartographic.fromDegrees(cell.lon, cell.lat, 0, probeScratch),
      );
      if (!Number.isFinite(height)) continue;
      sampled += 1;
      heightM = Number.isFinite(heightM) ? Math.max(heightM, height) : height;
    } catch {
      /* tiles not ready for this cell */
    }
  }
  return { heightM, sampled };
}

/**
 * How far the camera must rise to clear the ground, given a measured surface.
 * Pure so the policy is testable without a scene.
 * @param {number} cameraHeightM Eye height above the ellipsoid.
 * @param {number} groundHeightM Measured surface height above the ellipsoid.
 * @param {number} [clearanceM] Desired eye height above that surface.
 * @returns {number} Metres to lift; 0 when the view is already clear.
 */
export function groundClearanceDeficitM(
  cameraHeightM,
  groundHeightM,
  clearanceM = MIN_EYE_CLEARANCE_M,
) {
  if (!Number.isFinite(cameraHeightM) || !Number.isFinite(groundHeightM))
    return 0;
  const deficit = groundHeightM + clearanceM - cameraHeightM;
  return deficit > GUARD_EPSILON_M ? deficit : 0;
}

/**
 * How far the look point may sit under a mesh sample before it counts as
 * underground. A roof is tens of metres above the street the camera is
 * already showing; the height-0 miss is hundreds of metres under the mesh.
 */
const UNDERGROUND_AIM_M = 80;
/** Eye height above the surface for a correction. Close enough to still see the address. */
const ADDRESS_EYE_M = 70;
/** Steepest and shallowest pitch kept when re-aiming. Outside this, use -35°. */
const AIM_PITCH_MIN = -1.15;
const AIM_PITCH_MAX = -0.25;
const AIM_PITCH_DEFAULT = -0.61;

/**
 * Camera pose that looks at a surface point, or null when the current shot
 * already does and the eye is clear of the ground.
 *
 * `pitchRad` is Cesium's convention (negative looks down). `horizontalM` is
 * the ground distance from the eye to the point being framed.
 * @returns {{heading: number, pitch: number, range: number}|null}
 */
export function surfaceAimPlan({
  cameraHeightM,
  pitchRad,
  headingRad,
  horizontalM,
  surfaceM,
} = {}) {
  if (
    ![cameraHeightM, pitchRad, headingRad, horizontalM, surfaceM].every(
      Number.isFinite,
    )
  )
    return null;
  const eyeAbove = cameraHeightM - surfaceM;
  const lookingDown = pitchRad < -0.08 && horizontalM >= 0;
  const gazeHeightM = lookingDown
    ? cameraHeightM + horizontalM * Math.tan(pitchRad)
    : null;
  const gazeGap = gazeHeightM == null ? Infinity : surfaceM - gazeHeightM;
  // Already outside the mesh and looking at the address. Do not fly upward.
  if (gazeGap <= UNDERGROUND_AIM_M && eyeAbove > 8) return null;
  const pitch =
    pitchRad <= AIM_PITCH_MAX && pitchRad >= AIM_PITCH_MIN
      ? pitchRad
      : AIM_PITCH_DEFAULT;
  const sinDown = Math.sin(-pitch);
  let range =
    horizontalM >= 80 && horizontalM <= 320
      ? horizontalM
      : ADDRESS_EYE_M / sinDown;
  if (range * sinDown < 40) range = 40 / sinDown;
  return { heading: headingRad, pitch, range };
}

/**
 * Watch an arrival and lift the camera once the real surface can be measured.
 *
 * Stops quietly on a clear view, exhausted attempts, the user taking the
 * controls (pointer or wheel on the canvas), or `isStale()` reporting that a
 * newer arrival owns the camera.
 * @param {Cesium.Viewer} viewer Live viewer.
 * @param {{lat: number, lon: number}} at Destination being framed.
 * @param {{clearanceM?: number, attempts?: number, intervalMs?: number,
 *   isStale?: () => boolean, onLift?: (liftM: number) => void}} [options]
 * @returns {() => void} Cancel function.
 */
export function guardCameraAboveGround(viewer, at, options = {}) {
  const {
    clearanceM = MIN_EYE_CLEARANCE_M,
    attempts = GUARD_ATTEMPTS,
    intervalMs = GUARD_INTERVAL_MS,
    isStale = () => false,
    onLift = null,
  } = options;
  if (!viewer?.scene || !Number.isFinite(at?.lat) || !Number.isFinite(at?.lon))
    return () => {};

  let timer = null;
  let done = false;
  const canvas = viewer.scene.canvas;
  const documentRef = canvas?.ownerDocument;
  const removers = [];
  let release = () => {};
  const stop = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    for (const type of ['pointerdown', 'wheel'])
      canvas?.removeEventListener?.(type, stop);
    documentRef?.removeEventListener?.('keydown', stop, true);
    for (const remove of removers) remove();
    release();
  };
  release = ownCameraArrival(viewer, stop);
  // Direct camera API callers (including duration-zero flights) must yield
  // before moving the eye. Restore the exact method ownership on completion.
  for (const name of [
    'flyTo',
    'flyToBoundingSphere',
    'setView',
    'lookAt',
    'cancelFlight',
  ]) {
    const camera = viewer.camera;
    const original = camera[name];
    if (typeof original !== 'function') continue;
    const descriptor = Object.getOwnPropertyDescriptor(camera, name);
    const wrapped = function (...args) {
      stop();
      return original.apply(this, args);
    };
    camera[name] = wrapped;
    removers.push(() => {
      if (camera[name] !== wrapped) return;
      if (descriptor) Object.defineProperty(camera, name, descriptor);
      else delete camera[name];
    });
  }
  const removeTracking = viewer.trackedEntityChanged?.addEventListener(stop);
  if (removeTracking) removers.push(removeTracking);
  documentRef?.addEventListener?.('keydown', stop, true);
  // A manual gesture ends the guard, as it interrupts camera motion elsewhere.
  for (const type of ['pointerdown', 'wheel'])
    canvas?.addEventListener?.(type, stop, { once: true, passive: true });

  let remaining = attempts;
  const attempt = () => {
    if (done) return;
    if (isStale() || viewer.isDestroyed?.()) return stop();
    remaining -= 1;
    const camera = viewer.camera;
    const carto = camera.positionCartographic;
    // The eye must clear both the framed target and the ground beneath it.
    const below = {
      lat: Cesium.Math.toDegrees(carto.latitude),
      lon: Cesium.Math.toDegrees(carto.longitude),
    };
    const targetSample = sampleSurfaceM(viewer.scene, [
      { lat: at.lat, lon: at.lon },
    ]);
    if (targetSample.sampled !== 1 || !Number.isFinite(targetSample.heightM)) {
      if (remaining <= 0) return stop();
      timer = setTimeout(attempt, intervalMs);
      return;
    }
    const horizontalM = new Cesium.EllipsoidGeodesic(
      Cesium.Cartographic.fromDegrees(at.lon, at.lat),
      Cesium.Cartographic.fromRadians(carto.longitude, carto.latitude),
    ).surfaceDistance;
    const plan = surfaceAimPlan({
      cameraHeightM: carto.height,
      pitchRad: camera.pitch,
      headingRad: camera.heading,
      horizontalM,
      surfaceM: targetSample.heightM,
      clearanceM,
    });
    if (plan) {
      const deficit = groundClearanceDeficitM(
        carto.height,
        targetSample.heightM,
        clearanceM,
      );
      camera.flyToBoundingSphere(
        new Cesium.BoundingSphere(
          Cesium.Cartesian3.fromDegrees(at.lon, at.lat, targetSample.heightM),
          0,
        ),
        {
          offset: new Cesium.HeadingPitchRange(
            plan.heading,
            plan.pitch,
            plan.range,
          ),
          duration: 0.9,
          easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
        },
      );
      try {
        onLift?.(deficit);
      } catch {
        /* observer only */
      }
      return stop();
    }
    // The address is in frame. One more sample under the eye, then stop.
    const belowSample = sampleSurfaceM(viewer.scene, [below]);
    if (belowSample.sampled === 1) return stop();
    if (remaining <= 0) return stop();
    timer = setTimeout(attempt, intervalMs);
  };
  timer = setTimeout(attempt, intervalMs);
  return stop;
}

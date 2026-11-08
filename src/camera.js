import * as Cesium from 'cesium';

/**
 * The view the wall opens on: Kantonsschule Heerbrugg and the village around
 * it, seen from ~95 m above the forecourt and looking west toward the Rhine
 * valley.
 *
 * Ground heights around Heerbrugg are orthometric (MSL, ~408 m), while Cesium
 * and Google's Photorealistic 3D Tiles use ellipsoidal heights. The EGM96
 * undulation here is +46.6 m, so an "eye height" written straight into
 * Cartesian3.fromDegrees sits ~45 m UNDER the tile mesh — the camera ends up
 * inside the photogrammetry and the near-field geometry tears apart. Adding
 * the separation and keeping ~95 m clearance puts the camera outside the
 * coarse near tiles, where Google 3D renders cleanly.
 */
const START_VIEW = Object.freeze({
  lon: 9.6295451,
  lat: 47.4157283,
  groundM: 408,
  geoidM: 46.6,
  aboveGroundM: 95,
  headingDeg: 270.5,
  pitchDeg: -22,
});

const START_HEIGHT_M =
  START_VIEW.groundM + START_VIEW.geoidM + START_VIEW.aboveGroundM;

/**
 * Set the camera high over Heerbrugg on load, then fly down to the overview.
 *
 * The approach is deliberately short (2.6 s from a 900 m staging point): a long
 * descent gives the viewer time to abort a wheel-tick flight and then the wall
 * opens somewhere above the village instead of over the school. A final snap
 * once the approach would have landed guarantees the pose even when the flight
 * was interrupted or clamped by the terrain.
 *
 * @returns {Function} Cancels the pending or active startup flight.
 */
export function flyToStartView(viewer) {
  const destination = Cesium.Cartesian3.fromDegrees(
    START_VIEW.lon,
    START_VIEW.lat,
    START_HEIGHT_M,
  );
  const orientation = {
    heading: Cesium.Math.toRadians(START_VIEW.headingDeg),
    pitch: Cesium.Math.toRadians(START_VIEW.pitchDeg),
    roll: 0.0,
  };
  const start = Cesium.Cartesian3.fromDegrees(
    START_VIEW.lon,
    START_VIEW.lat,
    900,
  );
  viewer.camera.setView({
    destination: start,
    orientation: {
      heading: Cesium.Math.toRadians(0),
      pitch: Cesium.Math.toRadians(-90),
      roll: 0.0,
    },
  });

  const timer = setTimeout(() => {
    if (viewer.isDestroyed()) return;
    viewer.camera.flyTo({
      destination,
      orientation,
      duration: 2.6,
      easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
    });
  }, 150);
  const settleTimer = setTimeout(() => {
    if (viewer.isDestroyed()) return;
    // A voice or pointer navigation may have moved the camera off the school
    // in the meantime; snapping back would silently undo it. Only settle when
    // the camera is still over the start point (an interrupted approach).
    const position = Cesium.Cartographic.fromCartesian(
      viewer.camera.positionWC,
    );
    if (position) {
      const horizontal = new Cesium.EllipsoidGeodesic(
        Cesium.Cartographic.fromDegrees(START_VIEW.lon, START_VIEW.lat),
        position,
      ).surfaceDistance;
      if (horizontal > 1000) return;
    }
    viewer.camera.setView({ destination, orientation });
  }, 2900);
  return () => {
    clearTimeout(timer);
    clearTimeout(settleTimer);
    if (!viewer.isDestroyed()) viewer.camera.cancelFlight();
  };
}

import * as Cesium from 'cesium';

export function createController({
  flightState,
  services,
  parts,
  layer,
  resolveAsset,
}) {
  function _abortActiveUpdates() {
    for (const controller of flightState.feed._activeUpdateControllers)
      controller.abort();
    flightState.feed._activeUpdateControllers.clear();
  }

  function _flightQuery(viewer) {
    const cartographic = viewer?.camera?.positionCartographic;
    return cartographic
      ? {
          latitude: Cesium.Math.toDegrees(cartographic.latitude),
          longitude: Cesium.Math.toDegrees(cartographic.longitude),
          // Camera height in metres. The serverless bridge serves a regional
          // frame around the anchor at street/regional heights and a worldwide
          // frame once the view is zoomed out far enough to show the globe.
          altitude: cartographic.height,
        }
      : {};
  }
  return { _abortActiveUpdates, _flightQuery };
}

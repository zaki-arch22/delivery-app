// Loads the map library (MapLibre 6 ships as a JavaScript module) and tells the tracking page it is ready.
// The map's helper runs from our own server (worker-src 'self'), never from a blob.
import * as maplibregl from '/t/maplibre-gl.mjs';
maplibregl.setWorkerUrl('/t/maplibre-gl-worker.mjs');
window.maplibregl = maplibregl;
window.dispatchEvent(new Event('maplibre-ready'));

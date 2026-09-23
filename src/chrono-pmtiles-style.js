/**
 * chrono-pmtiles-style
 */

import { load as parseYaml }     from 'https://esm.sh/js-yaml@5.4.2';  // style files (v0.2.40)

// --- Version ---------------------------------------------------------------
const MODULE_VERSION = '1.0.100';

// --- Version History ---------------------------------------------------------
// v1.0.100: Split off from chrono-pmtiles-card 0.2.46; code moved unchanged, except resolveStyle()
//           now takes defaultTheme as a parameter.
//           Full earlier history in the main file.

// Merges "layers" paint/layout overrides, keyed by layer id, onto the generated layers.
// Layers not named are unchanged; unknown ids are ignored.
export function applyLayerOverrides(generatedLayers, overrides) {
  if (!overrides) return generatedLayers;
  return generatedLayers.map((layer) => {
    const override = overrides[layer.id];
    if (!override) return layer;
    const merged = { ...layer };
    // Only set paint/layout if one side has it: "layout: undefined" makes MapLibre reject the whole style.
    if (layer.paint || override.paint) {
      merged.paint = { ...layer.paint, ...override.paint };
    }
    if (layer.layout || override.layout) {
      merged.layout = { ...layer.layout, ...override.layout };
    }
    return merged;
  });
}

// --- Style files (v0.2.40) ---------------------------------------------------

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// True when "flavor" names a style file (.yaml/.yml/.json; query string and hash ignored).
function isStyleFileUrl(flavor) {
  if (typeof flavor !== 'string') return false;
  return /\.(ya?ml|json)$/i.test(flavor.split(/[?#]/)[0]);
}

// Fetches and parses a style file (parser by extension). Returns null when missing, unparseable
// or not an object. useCache false: fetched with cache 'no-store' (always fresh).
export async function loadStyleFile(url, useCache = true) {
  try {
    const response = await fetch(url, useCache ? undefined : { cache: 'no-store' });
    if (!response.ok) {
      console.error(`[chrono-pmtiles-card] Style file "${url}" not loaded: HTTP ${response.status}`);
      return null;
    }
    const text = await response.text();
    const isJson = /\.json$/i.test(url.split(/[?#]/)[0]);
    const parsed = isJson ? JSON.parse(text) : parseYaml(text);
    if (!isPlainObject(parsed)) {
      console.error(`[chrono-pmtiles-card] Style file "${url}" ignored: it does not contain an object.`);
      return null;
    }
    return parsed;
  } catch (err) {
    console.error(`[chrono-pmtiles-card] Style file "${url}" not loaded:`, err);
    return null;
  }
}

// Applies seasoning key by key; groups (pois, landcover) are merged one level deeper.
export function mergeSeasoning(base, override) {
  if (!isPlainObject(override)) return { ...base };
  const merged = { ...base };
  for (const [key, value] of Object.entries(override)) {
    merged[key] = isPlainObject(value) && isPlainObject(merged[key])
      ? { ...merged[key], ...value }
      : value;
  }
  return merged;
}

// Merges style-file and card-config "layers" per layer id and per paint/layout property; config wins.
export function mergeLayerOverrides(baseLayers, overrideLayers) {
  const merged = isPlainObject(baseLayers) ? { ...baseLayers } : {};
  if (!isPlainObject(overrideLayers)) return merged;
  for (const [id, override] of Object.entries(overrideLayers)) {
    const base = merged[id];
    if (!isPlainObject(base) || !isPlainObject(override)) {
      merged[id] = override;
      continue;
    }
    const layer = { ...base, ...override };
    if (base.paint || override.paint) layer.paint = { ...base.paint, ...override.paint };
    if (base.layout || override.layout) layer.layout = { ...base.layout, ...override.layout };
    merged[id] = layer;
  }
  return merged;
}

// Resolves the effective style: built-in flavor, then style file, then card config (per key).
export async function resolveStyle(config, defaultTheme) {
  let file = null;
  let flavorName = config.flavor;
  if (isStyleFileUrl(config.flavor)) {
    file = await loadStyleFile(config.flavor, config.cache !== false);
    flavorName = file?.flavor;
  }
  flavorName = flavorName ?? defaultTheme;
  return {
    flavorName,
    seasoning: mergeSeasoning(file?.seasoning ?? {}, config.seasoning),
    layers: mergeLayerOverrides(file?.layers, config.layers),
    controls: {
      ...(isPlainObject(file?.controls) ? file.controls : {}),
      ...(isPlainObject(config.controls) ? config.controls : {}),
    },
  };
}

// Builds CSS for the map controls from "controls"; only keys that are set produce declarations.
// Selectors outrank every leaflet.css rule they override, so load order doesn't matter.
export function buildControlsCss(controls) {
  const rule = (selector, declarations) => {
    const body = declarations
      .filter(([, value]) => value != null && value !== '')
      .map(([prop, value]) => `${prop}: ${value};`)
      .join(' ');
    return body ? `${selector} { ${body} }` : '';
  };
  return [
    rule('.map-container .leaflet-control.leaflet-bar a', [
      ['background-color', controls.background],
      ['color', controls.color],
      ['border-bottom-color', controls.border],
    ]),
    rule('.map-container .leaflet-control.leaflet-bar a:hover, .map-container .leaflet-control.leaflet-bar a:focus', [
      ['background-color', controls.hover_background],
    ]),
    rule('.map-container .leaflet-control.leaflet-bar a.leaflet-disabled', [
      ['background-color', controls.disabled_background],
      ['color', controls.disabled_color],
    ]),
    rule('.map-container .chrono-zoom-level, .map-container .chrono-center, .map-container .chrono-zoom-button', [
      ['background', controls.background],
      ['color', controls.color],
    ]),
    // Zoom preset buttons: hover, and the highlighted button of the current zoom level.
    rule('.map-container .chrono-zoom-button:hover', [
      ['background', controls.hover_background],
    ]),
    rule('.map-container .chrono-zoom-button.chrono-zoom-button-active', [
      ['background', controls.disabled_background],
      ['color', controls.disabled_color],
    ]),
  ].filter(Boolean).join('\n');
}

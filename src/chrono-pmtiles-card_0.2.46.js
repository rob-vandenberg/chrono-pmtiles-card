/**
 * chrono-pmtiles-card
 */

import { LitElement, html, css } from 'https://unpkg.com/lit@2.0.0/index.js?module';
import L                         from 'https://esm.sh/leaflet@1.9.4';
import * as maplibregl           from 'https://esm.sh/maplibre-gl@6.10.0';
import 'https://esm.sh/@maplibre/maplibre-gl-leaflet@0.1.4?deps=maplibre-gl@6.10.0,leaflet@1.9.4';  // attaches L.maplibreGL; ?deps= pins it to the same maplibre-gl/leaflet instances as above
import { Protocol }              from 'https://esm.sh/pmtiles@4.5.0';
import { layers, namedFlavor }   from 'https://esm.sh/@protomaps/basemaps@5.7.2';  // no ?deps= needed: no maplibre-gl/leaflet dependency of its own
import { load as parseYaml }     from 'https://esm.sh/js-yaml@5.4.2';  // style files (v0.2.40)

// --- Version ---------------------------------------------------------------
const CARD_VERSION = '0.2.46';

// --- Version History ---------------------------------------------------------
// v0.2.46: Compacted the version history and code comments (full history in 0.2.45 and older).
//          Fixed misplaced comments of _addZoomButtonsControl()/_addCenterControl(). No code changes.
// v0.2.45: Zoom preset buttons: show_zoom_buttons + zoom_buttons (levels), top right. A click zooms,
//          keeping the center; current level highlighted in disabled colors; invalid levels left out.
// v0.2.44: Lat/lon display moved to the bottom center (plain element, not a control); its text can
//          be selected and copied, since clicks on it no longer start a map drag or zoom.
// v0.2.43: New "cache" key (default true); cache: false fetches the style file with cache 'no-store',
//          so it always comes fresh from the server. Affects the style file only.
// v0.2.42: New "show_lat_lon" key: map center as "lat: .. lon: .." (4 decimals), updated on "move",
//          longitude wrapped to -180..180.
// v0.2.41: New "controls" key (background, color, border, hover_background, disabled_background,
//          disabled_color) for the map controls, as a shadow-root stylesheet; style file, then config.
// v0.2.40: "flavor" can be a .yaml/.yml/.json style file (flavor, seasoning, layers). Order: built-in
//          flavor, style file, card config, merged per key (also pois/landcover); style built async.
// v0.1.34: Fix sparse history trails for "person": /api/history/period is now called with
//          significant_changes_only=0, so GPS-only updates are included.
// v0.1.33: Two or more entities at exactly the same spot now count as a fit (max_auto_fit_zoom);
//          only a single entity on the center gets zoom 11.
// v0.1.32: Zoom/center rework: center and zoom decoupled, auto_fit fills in what isn't set; new keys
//          auto_fit, min/max_auto_fit_zoom, (undocumented) min/max_zoom_level replacing max_zoom.
// v0.1.31: "center" without initial_zoom_level keeps that center and zooms to fit all entities
//          around it (symmetric box, 5% padding).
// v0.1.30: "center" can name an entity (its current position; need not be in "entities"); a missing
//          entity falls back to zone.home with a warning.
// v0.1.29: Fix road shield numbers missing on first load: after "load" and the shield recolor, one
//          invalidateSize() + resize() on the next MapLibre "idle".
// v0.1.28: Fix blinking marker pictures: shouldUpdate() skips updates unless a tracked entity changed;
//          setLatLng()/setIcon() only when the position/HTML actually changed.
// v0.1.27: Renamed config key "zoom" to "initial_zoom_level"; no behavior change.
// v0.1.26: Without initial_zoom_level the initial zoom fits all entities (5% padding), computed once
//          on the ResizeObserver's first firing; reset-focus repeats the same fit.
// v0.1.25: Fix: a "layers" override with only paint (or layout) broke the whole map by setting
//          "layout: undefined"; paint/layout are now only set when one side has them.
// v0.1.24: Reset-focus icon centered (flex, 22px); new "max_zoom" key (default 18) fixes zooming to
//          level 42 and crashing the browser.
// v0.1.23: Reset-focus button (below +/-) returning to the initial view; new "show_zoom_level" key
//          showing the current zoom bottom left.
// v0.1.22: Renamed "theme" to "flavor" and "palette" to "seasoning" (Protomaps' own terms); trail
//          tooltip text centered.
// v0.1.21: Hover tooltips on trail points (entity name + time), formatted as HA's native map card,
//          including 12h/24h from the HA profile.
// v0.1.20: Trail fade with HA's formula (segments + dots, 20% floor); entities can be objects with
//          color and history_* keys; root history_* defaults; use_base_entity_only accepted, no-op.
// v0.0.11: Fix map filling only half the card (ResizeObserver + invalidateSize()); marker pictures
//          sized with inline styles because HA's CSS overrode the injected stylesheet.
// v0.0.10: Fix empty map on the dashboard after the editor preview: connectedCallback() re-initializes
//          the map when the element reconnects.
// v0.0.9: Entity tracking: "entities" markers (picture or initials) and "hours_to_show" trails from
//         /api/history/period, updated live.
// v0.0.8: palette.shield_fill/shield_border: recolors the road shield sprites via updateImage() after
//         "load", preserving anti-aliased edges.
// v0.0.7: New "layers" key: paint/layout overrides per generated layer id.
// v0.0.6: Fix missing labels/icons: added glyphs and sprite URLs; new "palette" key for Flavor overrides.
// v0.0.5: Real basemap styling with @protomaps/basemaps; new "theme" key (default light).
// v0.0.4: Fix "URL scheme pmtiles is not supported": imports moved to esm.sh with a ?deps= pin, so all
//         use one maplibre-gl instance.
// v0.0.3: Version bump only.
// v0.0.2: Fix "no default export" error: maplibre-gl imported as a namespace.
// v0.0.1: Initial scaffold: MapLibre vector layer from a PMTiles archive inside a Leaflet map, centered
//         on zone.home.

// --- Console log ---------------------------------------------------------------
console.info(
  `%c CHRONO-%cPMTILES%c-CARD %c v${CARD_VERSION} `,
  'background-color: #101010; color: #FFFFFF; font-weight: bold; padding: 2px 0 2px 4px; border-radius: 3px 0 0 3px;',
  'background-color: #101010; color: #4676d3; font-weight: bold; padding: 2px 0;',
  'background-color: #101010; color: #FFFFFF; font-weight: bold; padding: 2px 4px 2px 0;',
  'background-color: #1E1E1E; color: #FFFFFF; font-weight: bold; padding: 2px 4px; border-radius: 0 3px 3px 0;'
);

// --- Constants ---------------------------------------------------------------

// Self-hosted map file, served from HA's www/ folder via HTTP range requests.
const DEFAULT_PMTILES_URL = '/local/europe.pmtiles';

const DEFAULT_MAP_HEIGHT = '300px';
// v0.1.32 zoom constants (see version history):
const MIN_ZOOM_LEVEL             = 1;  // overridable via undocumented min_zoom_level
const MAX_ZOOM_LEVEL             = 18; // overridable via undocumented max_zoom_level
const DEFAULT_ZOOM_LEVEL         = 11; // no initial_zoom_level and nothing to fit / auto_fit off
const DEFAULT_MIN_AUTO_FIT_ZOOM  = 3;  // min_auto_fit_zoom default
const DEFAULT_MAX_AUTO_FIT_ZOOM  = 14; // max_auto_fit_zoom default
const DEFAULT_THEME      = 'light';

// pmtiles:// may only be registered once per page, across all card instances.
let protocolRegistered = false;
function ensurePmtilesProtocol() {
  if (protocolRegistered) return;
  // Explicit worker URL: works around the v6 CDN-ESM worker bug (maplibre-gl-js #8459).
  maplibregl.setWorkerUrl('https://esm.sh/maplibre-gl@6.10.0/dist/maplibre-gl-worker.js');
  const protocol = new Protocol();
  maplibregl.addProtocol('pmtiles', protocol.tile);
  protocolRegistered = true;
}

// Merges "layers" paint/layout overrides, keyed by layer id, onto the generated layers.
// Layers not named are unchanged; unknown ids are ignored.
function applyLayerOverrides(generatedLayers, overrides) {
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
async function loadStyleFile(url, useCache = true) {
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
function mergeSeasoning(base, override) {
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
function mergeLayerOverrides(baseLayers, overrideLayers) {
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
async function resolveStyle(config) {
  let file = null;
  let flavorName = config.flavor;
  if (isStyleFileUrl(config.flavor)) {
    file = await loadStyleFile(config.flavor, config.cache !== false);
    flavorName = file?.flavor;
  }
  flavorName = flavorName ?? DEFAULT_THEME;
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
function buildControlsCss(controls) {
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

// Shield sprite names recolored by shield_fill/shield_border (exhaustive for the v4 sprites).
const SHIELD_SPRITE_NAMES = [
  'generic_shield-1char', 'generic_shield-2char', 'generic_shield-3char',
  'generic_shield-4char', 'generic_shield-5char',
  'NL:S-road-1char', 'NL:S-road-2char', 'NL:S-road-3char',
  'NL:S-road-4char', 'NL:S-road-5char',
  'US:I-1char', 'US:I-2char', 'US:I-3char', 'US:I-4char', 'US:I-5char',
];

// Shield sprite reference colors (sampled): fill/border of the light and dark sprite sheets.
const SHIELD_REFERENCE_COLORS = {
  light: { fill: [255, 255, 255], border: [154, 154, 154] },
  dark:  { fill: [0, 0, 0],       border: [101, 101, 101] },
};

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex ?? '');
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
}

// Recolors one shield sprite's pixels in place, blending between the new fill/border colors in
// the same proportion as between the reference colors, so anti-aliased edges stay smooth.
function recolorShieldPixels(data, refFill, refBorder, newFill, newBorder) {
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a === 0) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const solveT = (c, fref, bref) => (bref === fref ? 0 : (c - fref) / (bref - fref));
    let t = (
      solveT(r, refFill[0], refBorder[0]) +
      solveT(g, refFill[1], refBorder[1]) +
      solveT(b, refFill[2], refBorder[2])
    ) / 3;
    t = Math.max(0, Math.min(1, t));
    data[i]     = Math.round(newFill[0] * (1 - t) + newBorder[0] * t);
    data[i + 1] = Math.round(newFill[1] * (1 - t) + newBorder[1] * t);
    data[i + 2] = Math.round(newFill[2] * (1 - t) + newBorder[2] * t);
  }
}

// Recolors all shield sprites per shield_fill/shield_border via updateImage(); no-op if neither set.
// Must run after MapLibre's "load"; uses the @1x/@2x sprite MapLibre loaded (same size required).
async function applyShieldColors(maplibreMap, spriteUrl, theme, paletteConfig) {
  const fillHex = paletteConfig?.shield_fill;
  const borderHex = paletteConfig?.shield_border;
  if (!fillHex && !borderHex) return;

  const ref = SHIELD_REFERENCE_COLORS[theme] ?? SHIELD_REFERENCE_COLORS.light;
  const newFill = hexToRgb(fillHex) ?? ref.fill;
  const newBorder = hexToRgb(borderHex) ?? ref.border;

  const suffix = window.devicePixelRatio > 1 ? '@2x' : '';
  const [spriteJson, spriteBlob] = await Promise.all([
    fetch(`${spriteUrl}${suffix}.json`).then((r) => r.json()),
    fetch(`${spriteUrl}${suffix}.png`).then((r) => r.blob()),
  ]);
  const spriteImg = await createImageBitmap(spriteBlob);
  const canvas = document.createElement('canvas');
  canvas.width = spriteImg.width;
  canvas.height = spriteImg.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(spriteImg, 0, 0);

  for (const name of SHIELD_SPRITE_NAMES) {
    const entry = spriteJson[name];
    if (!entry) continue; // this sprite build doesn't include this one
    if (!maplibreMap.hasImage(name)) continue; // nothing to replace

    const imageData = ctx.getImageData(entry.x, entry.y, entry.width, entry.height);
    recolorShieldPixels(imageData.data, ref.fill, ref.border, newFill, newBorder);
    maplibreMap.updateImage(name, {
      width: entry.width,
      height: entry.height,
      data: imageData.data,
    });
  }
}

// Marker HTML: entity_picture if present, else initials (as HA's own map card). Inline styles,
// because HA's CSS overrides an injected stylesheet (v0.0.11).
const MARKER_WRAPPER_STYLE = 'width:100%;height:100%;border-radius:50%;border:2px solid #ffffff;box-shadow:0 1px 4px rgba(0,0,0,0.4);background:#4676d3;overflow:hidden;display:flex;align-items:center;justify-content:center;color:#ffffff;font:bold 11px sans-serif;box-sizing:border-box;';
const MARKER_IMG_STYLE = 'width:100%;height:100%;object-fit:cover;display:block;';

function buildMarkerHtml(hass, stateObj) {
  const picture = stateObj.attributes.entity_picture;
  if (picture) {
    const src = typeof hass.hassUrl === 'function' ? hass.hassUrl(picture) : picture;
    return `<div style="${MARKER_WRAPPER_STYLE}"><img src="${src}" alt="" style="${MARKER_IMG_STYLE}" /></div>`;
  }
  const name = stateObj.attributes.friendly_name || stateObj.entity_id;
  const initials = name.split(' ').map((part) => part[0]).join('').substr(0, 3).toUpperCase();
  return `<div style="${MARKER_WRAPPER_STYLE}">${initials}</div>`;
}

function getEntityLatLon(stateObj) {
  const lat = stateObj?.attributes?.latitude;
  const lon = stateObj?.attributes?.longitude;
  if (lat == null || lon == null) return null;
  return [lat, lon];
}

// Same as getEntityLatLon, plus last_changed for the trail-point tooltip.
function getEntityTrailPoint(stateObj) {
  const latLon = getEntityLatLon(stateObj);
  if (!latLon) return null;
  return { lat: latLon[0], lon: latLon[1], time: stateObj.last_changed };
}

// Fetches one entity's position history over the last hoursToShow hours (/api/history/period).
// Needs attributes (lat/lon), so no minimal_response/no_attributes. Returns {lat, lon, time}.
async function fetchEntityTrailHistory(hass, entityId, hoursToShow) {
  const end = new Date();
  const start = new Date(end.getTime() - hoursToShow * 60 * 60 * 1000);
  // significant_changes_only=0: otherwise GPS-only updates of "person" are dropped (v0.1.34).
  const path = `history/period/${start.toISOString()}?filter_entity_id=${encodeURIComponent(entityId)}&end_time=${encodeURIComponent(end.toISOString())}&significant_changes_only=0`;
  const result = await hass.callApi('GET', path);
  const states = result?.[0] ?? [];
  return states.map(getEntityTrailPoint).filter(Boolean);
}

// Port of HA's useAmPm(): 12h vs 24h from the user's HA profile locale settings.
function useAmPm(locale) {
  const timeFormat = locale?.time_format;
  if (timeFormat === 'language' || timeFormat === 'system') {
    const testLanguage = timeFormat === 'language' ? locale?.language : undefined;
    const test = new Date('January 1, 2023 22:00:00').toLocaleString(testLanguage);
    return test.includes('10');
  }
  return timeFormat === 'am_pm';
}

// Formats a trail point's time as HA's map card: > 144 h full date + time, today time with
// seconds, else weekday + time. 12h/24h per useAmPm(), time zone from hass.config.
function formatTrailPointTime(hass, timestamp, hoursToShow) {
  const date = new Date(timestamp);
  const locale = hass?.locale;
  const language = locale?.language;
  const timeZone = hass?.config?.time_zone;
  const hour12 = useAmPm(locale);
  const hourCycle = hour12 ? 'h12' : 'h23';

  if (hoursToShow > 144) {
    return new Intl.DateTimeFormat(language, {
      year: 'numeric', month: 'numeric', day: 'numeric',
      hour: hour12 ? 'numeric' : '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle,
      timeZone,
    }).format(date);
  }

  const now = new Date();
  const isToday = date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();

  if (isToday) {
    return new Intl.DateTimeFormat(language, {
      hour: hour12 ? 'numeric' : '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle,
      timeZone,
    }).format(date);
  }

  return new Intl.DateTimeFormat(language, {
    weekday: 'long',
    hour: hour12 ? 'numeric' : '2-digit', minute: '2-digit',
    hourCycle,
    timeZone,
  }).format(date);
}

// Normalizes an "entities" entry (entity-id string or object) into an object.
function normalizeEntityConfig(entry) {
  if (typeof entry === 'string') {
    return { entity: entry };
  }
  return entry ?? {};
}

// [lat, lon] of every configured entity with a known position, for auto-fit; others are skipped.
function computeAutoFitEntityPoints(hass, entityEntries) {
  const points = [];
  for (const rawEntry of entityEntries ?? []) {
    const entityConfig = normalizeEntityConfig(rawEntry);
    const stateObj = hass?.states?.[entityConfig.entity];
    const latLon = getEntityLatLon(stateObj);
    if (latLon) points.push(latLon);
  }
  return points;
}

// Trail style per entity: per-entity value, then root default, then fallback. history_line_color
// also falls back to the entity's "color" (as chrono-map-card).
function resolveTrailStyle(entityConfig, rootConfig, markerColor) {
  const color =
    entityConfig.history_line_color ??
    rootConfig.history_line_color ??
    markerColor ??
    '#4676d3';
  const width =
    entityConfig.history_line_width ??
    rootConfig.history_line_width ??
    3;
  const radius =
    entityConfig.history_dot_radius ??
    rootConfig.history_dot_radius ??
    3;
  return { color, width, radius };
}

// Builds one entity's trail: a segment per point pair plus a dot per point, fading from old to new
// with HA's formula (base 0.2, step 0.8/(n-2); 2 points: opacity 1). Each dot has a hover tooltip
// with entity name and time, as HA's map card.
function buildTrailLayerGroup(points, style, hass, hoursToShow, entityName) {
  const group = L.layerGroup();

  const addPointMarker = (point, opacity) => {
    const marker = L.circleMarker([point.lat, point.lon], {
      radius: style.radius,
      color: style.color,
      weight: style.width,
      opacity,
      fillOpacity: opacity,
      interactive: true,
    }).addTo(group);
    const formattedTime = formatTrailPointTime(hass, point.time, hoursToShow);
    marker.bindTooltip(`<div style="text-align:center;">${entityName}<br>${formattedTime}</div>`, { direction: 'top' });
  };

  if (points.length < 2) {
    if (points.length === 1) {
      addPointMarker(points[0], 1);
    }
    return group;
  }

  const gradualOpacity = 0.8;
  const baseOpacity = 1 - gradualOpacity;
  const opacityStep = points.length > 2 ? gradualOpacity / (points.length - 2) : 0;

  points.forEach((point, index) => {
    const opacity = points.length > 2
      ? baseOpacity + index * opacityStep
      : 1;

    if (index > 0) {
      const prev = points[index - 1];
      L.polyline([[prev.lat, prev.lon], [point.lat, point.lon]], {
        color: style.color,
        weight: style.width,
        opacity,
        interactive: false,
      }).addTo(group);
    }

    addPointMarker(point, opacity);
  });

  return group;
}

// --- Card ---------------------------------------------------------------------
class ChronoPmtilesCard extends LitElement {
  static properties = {
    hass:    { attribute: false },
    _config: { state: true },
  };

  static getCardSize() {
    return 5;
  }

  static getStubConfig() {
    return {
      pmtiles_url: DEFAULT_PMTILES_URL,
      flavor: DEFAULT_THEME,
      seasoning: {},
      show_zoom_level: false,
      auto_fit: true,
      layers: {},
      entities: [],
      hours_to_show: 0,
      history_line_color: null,
      history_line_width: 3,
      history_dot_radius: 3,
    };
  }

  setConfig(config) {
    if (!config?.pmtiles_url) {
      throw new Error('chrono-pmtiles-card: "pmtiles_url" is required in config.');
    }
    this._config = config;
  }

  static styles = css`
    :host {
      display: block;
    }
    .map-container {
      box-sizing: border-box;
      position: relative;
      overflow: hidden;
      background-color: var(--ha-card-background, var(--card-background-color, white));
      border-color: var(--ha-card-border-color, var(--divider-color, #e0e0e0));
      border-radius: var(--ha-card-border-radius, var(--ha-border-radius-lg));
      border-width: var(--ha-card-border-width, 1px);
      border-style: solid;
      box-shadow: var(--ha-card-box-shadow, none);
    }
    .map-el {
      width: 100%;
      height: 100%;
    }
    .chrono-zoom-level, .chrono-center, .chrono-zoom-button {
      background: rgba(255,255,255,0.85);
      color: #333;
    }
    .chrono-zoom-button:hover {
      background: #f4f4f4;
    }
    /* Highlighted zoom button; outranks "controls" background/color, not disabled_*. */
    .map-container .chrono-zoom-button.chrono-zoom-button-active {
      background: #f4f4f4;
      color: #bbb;
      cursor: default;
    }
  `;

  render() {
    if (!this._config) return html``;
    const height = this._config.map_height || DEFAULT_MAP_HEIGHT;
    return html`
      <div class="map-container" style="height: ${height};">
        <div class="map-el" id="map"></div>
      </div>
    `;
  }

  // --- Lifecycle: mount/unmount the Leaflet + MapLibre map -------------------

  firstUpdated() {
    this._initMap();
    this._initEntities();
  }

  // Re-initializes the map when HA reconnects this element (firstUpdated() fires only once).
  // Waits for updateComplete, because <div id="map"> is not back in the DOM yet.
  connectedCallback() {
    super.connectedCallback();
    if (this._config && !this._leafletMap) {
      this.updateComplete.then(() => {
        this._initMap();
        this._initEntities();
      });
    }
  }

  // On hass updates only markers/trails change; the map itself is built once in _initMap().
  updated(changedProps) {
    if (changedProps.has('hass') && this._leafletMap) {
      // null = no filter (update all tracked entities), e.g. first hass.
      this._updateEntityPositions(this._pendingEntityIds ?? null);
    }
    this._pendingEntityIds = null;
  }

  // Skips the update when hass changed but none of this card's entities did (v0.1.28).
  shouldUpdate(changedProps) {
    this._pendingEntityIds = null;
    if (changedProps.has('_config')) return true;
    if (!changedProps.has('hass')) return true;
    const oldHass = changedProps.get('hass');
    if (!oldHass || !this._leafletMap) return true; // first hass / not initialized yet
    const changedIds = this._trackedEntityIds().filter(
      (id) => oldHass.states?.[id] !== this.hass?.states?.[id]
    );
    if (changedIds.length === 0) return false;
    this._pendingEntityIds = changedIds;
    return true;
  }

  _trackedEntityIds() {
    return (this._config?.entities ?? [])
      .map((entry) => normalizeEntityConfig(entry).entity)
      .filter(Boolean);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._teardownMap();
  }

  _initMap() {
    if (this._leafletMap) return; // already initialized

    ensurePmtilesProtocol();

    const mapEl = this.shadowRoot.getElementById('map');
    if (!mapEl) return;

    this._injectLibraryStyles();

    const center = this._getCenter();

    // maxBounds per maplibre-gl-leaflet docs; placeholder view until _applyView() on the first resize.
    const { minZoom, maxZoom } = this._zoomLimits();
    this._leafletMap = L.map(mapEl, {
      maxBounds: [[180, -Infinity], [-180, Infinity]],
      maxBoundsViscosity: 1,
      minZoom,
      maxZoom,
    }).setView([center.lat, center.lon], this._config.initial_zoom_level ?? DEFAULT_ZOOM_LEVEL);

    this._addResetFocusControl();
    if (this._config.show_zoom_level) {
      this._addZoomLevelControl();
    }
    if (this._config.show_lat_lon) {
      this._addCenterControl();
    }
    if (this._config.show_zoom_buttons) {
      this._addZoomButtonsControl();
    }

    // The MapLibre layer is added by _buildStyle() once the style (possibly a style file) is ready.
    this._buildStyle(this._leafletMap);

    // Re-measures on every resize (HA may settle the width late); the first firing sets the view.
    this._hasAutoFitted = false; // v0.1.32: initial view always applied on first firing
    this._resizeObserver = new ResizeObserver(() => {
      this._leafletMap?.invalidateSize();
      if (!this._hasAutoFitted) {
        this._hasAutoFitted = true;
        this._applyView();
      }
    });
    this._resizeObserver.observe(mapEl);
  }

  // Resolves the style and adds the MapLibre layer; skipped if the card was torn down meanwhile.
  async _buildStyle(leafletMap) {
    const style = await resolveStyle(this._config);
    if (this._leafletMap !== leafletMap) return; // torn down meanwhile

    // Control colors as a constructed stylesheet (removed in _teardownMap()).
    const controlsCss = buildControlsCss(style.controls);
    if (controlsCss) {
      this._controlsSheet = new CSSStyleSheet();
      this._controlsSheet.replaceSync(controlsCss);
      this.shadowRoot.adoptedStyleSheets = [
        ...this.shadowRoot.adoptedStyleSheets,
        this._controlsSheet,
      ];
    }

    const pmtilesUrl = this._config.pmtiles_url;
    const flavorName = style.flavorName;
    const flavor = mergeSeasoning(namedFlavor(flavorName), style.seasoning);
    const spriteUrl = `https://protomaps.github.io/basemaps-assets/sprites/v4/${flavorName}`;

    this._glLayer = L.maplibreGL({
      style: {
        version: 8,
        // Protomaps' hosted glyphs/sprites; without "glyphs" MapLibre silently drops all text layers.
        glyphs: 'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf',
        sprite: spriteUrl,
        sources: {
          'chrono-pmtiles-source': {
            type: 'vector',
            url: `pmtiles://${pmtilesUrl}`,
            attribution: '<a href="https://protomaps.com">Protomaps</a> © <a href="https://openstreetmap.org">OpenStreetMap</a>',
          },
        },
        layers: applyLayerOverrides(
          layers('chrono-pmtiles-source', flavor, { lang: 'en' }),
          style.layers
        ),
      },
    }).addTo(this._leafletMap);

    // Shield colors live in the sprite image; getMaplibreMap() gives the real maplibregl.Map.
    const maplibreMap = this._glLayer.getMaplibreMap();
    // After the shield recolor, resize once on the next "idle" so labels are placed (v0.1.29).
    maplibreMap.on('load', () => {
      applyShieldColors(maplibreMap, spriteUrl, flavorName, style.seasoning)
        .catch((err) => {
          console.error('[chrono-pmtiles-card] Failed to apply shield colors:', err);
        })
        .finally(() => {
          if (this._glLayer?.getMaplibreMap() !== maplibreMap) return; // map torn down meanwhile
          maplibreMap.once('idle', () => {
            if (!this._leafletMap || this._glLayer?.getMaplibreMap() !== maplibreMap) return;
            this._leafletMap.invalidateSize();
            maplibreMap.resize();
          });
          // "idle" only fires after a render, so force one.
          maplibreMap.triggerRepaint();
        });
    });
  }

  // Zoom limits: min/max_zoom_level (undocumented overrides); min/max_auto_fit_zoom bound the fit.
  _zoomLimits() {
    const cfg = this._config;
    const minZoom = cfg.min_zoom_level ?? MIN_ZOOM_LEVEL;
    const maxZoom = cfg.max_zoom_level ?? MAX_ZOOM_LEVEL;
    const clamp = (z) => Math.min(maxZoom, Math.max(minZoom, z));
    return {
      minZoom,
      maxZoom,
      clamp,
      minFit: clamp(cfg.min_auto_fit_zoom ?? DEFAULT_MIN_AUTO_FIT_ZOOM),
      maxFit: clamp(cfg.max_auto_fit_zoom ?? DEFAULT_MAX_AUTO_FIT_ZOOM),
    };
  }

  // Computes the view. Center: "center", else (auto_fit) middle of the entities, else zone.home.
  // Zoom: initial_zoom_level, else (auto_fit) fitted zoom within min/max_auto_fit_zoom, else 11.
  // The fit box is symmetric around the center and needs the final container size.
  _computeView() {
    const map = this._leafletMap;
    const cfg = this._config;
    const { clamp, minFit, maxFit } = this._zoomLimits();
    const autoFit = cfg.auto_fit !== false;
    const points = autoFit ? computeAutoFitEntityPoints(this.hass, cfg.entities) : [];

    let centerLatLng;
    if (cfg.center != null || !autoFit || points.length === 0) {
      const c = this._getCenter(); // "center" (with zone.home fallback) or zone.home
      centerLatLng = L.latLng(c.lat, c.lon);
    } else {
      centerLatLng = L.latLngBounds(points).getCenter();
    }

    if (cfg.initial_zoom_level != null) {
      return { center: centerLatLng, zoom: clamp(cfg.initial_zoom_level) };
    }
    if (!autoFit) {
      return { center: centerLatLng, zoom: clamp(DEFAULT_ZOOM_LEVEL) };
    }

    const cp = map.project(centerLatLng, 0);
    let dx = 0;
    let dy = 0;
    for (const p of points) {
      const pp = map.project(L.latLng(p[0], p[1]), 0);
      dx = Math.max(dx, Math.abs(pp.x - cp.x));
      dy = Math.max(dy, Math.abs(pp.y - cp.y));
    }
    if (dx === 0 && dy === 0) {
      // Zero-size box: one entity -> default zoom, 2+ on one spot -> max_auto_fit_zoom (v0.1.33).
      return {
        center: centerLatLng,
        zoom: points.length >= 2 ? maxFit : clamp(DEFAULT_ZOOM_LEVEL),
      };
    }

    const symmetricBounds = L.latLngBounds(
      map.unproject(L.point(cp.x - dx, cp.y - dy), 0),
      map.unproject(L.point(cp.x + dx, cp.y + dy), 0)
    ).pad(0.05);
    const fitted = map.getBoundsZoom(symmetricBounds);
    return { center: centerLatLng, zoom: Math.min(maxFit, Math.max(minFit, fitted)) };
  }

  // Applies _computeView(); used for the initial view and by reset-focus.
  _applyView() {
    if (!this._leafletMap) return;
    const { center, zoom } = this._computeView();
    this._leafletMap.setView(center, zoom);
  }

  // Reset-focus button below +/-; re-applies the initial view rules with current positions.
  _addResetFocusControl() {
    const ResetFocusControl = L.Control.extend({
      options: { position: 'topleft' },
      onAdd: () => {
        const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
        const link = L.DomUtil.create('a', '', container);
        link.href = '#';
        link.title = 'Reset focus';
        // Flex centering for the SVG icon (leaflet-bar a centers text via line-height only).
        link.style.cssText = 'display:flex;align-items:center;justify-content:center;';
        // mdiImageFilterCenterFocus, as HA's own reset-focus button.
        link.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24"><path fill="currentColor" d="M12,9A3,3 0 0,0 9,12A3,3 0 0,0 12,15A3,3 0 0,0 15,12A3,3 0 0,0 12,9M19,19H15V21H19A2,2 0 0,0 21,19V15H19M19,3H15V5H19V9H21V5A2,2 0 0,0 19,3M5,5H9V3H5A2,2 0 0,0 3,5V9H5M5,15H3V19A2,2 0 0,0 5,21H9V19H5V15Z"/></svg>`;
        L.DomEvent.on(link, 'click', L.DomEvent.stop)
          .on(link, 'click', () => {
            this._applyView();
          });
        return container;
      },
    });
    new ResetFocusControl().addTo(this._leafletMap);
  }

  // Zoom-level display (bottomleft), updated on "zoomend"; only with show_zoom_level.
  _addZoomLevelControl() {
    const ZoomLevelControl = L.Control.extend({
      options: { position: 'bottomleft' },
      onAdd: (map) => {
        const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control chrono-zoom-level');
        // background/color come from static styles, so "controls" can override them.
        container.style.cssText = 'padding:2px 6px;font:bold 12px sans-serif;';
        const render = () => { container.textContent = String(Math.round(map.getZoom())); };
        render();
        map.on('zoomend', render);
        return container;
      },
    });
    new ZoomLevelControl().addTo(this._leafletMap);
  }

  // Zoom preset buttons (topright), one per valid level in zoom_buttons; a click zooms, keeping
  // the center. The current level's button is highlighted. Only with show_zoom_buttons.
  _addZoomButtonsControl() {
    const { minZoom, maxZoom } = this._zoomLimits();
    const levels = (Array.isArray(this._config.zoom_buttons) ? this._config.zoom_buttons : [])
      .filter((level) => typeof level === 'number' && level >= minZoom && level <= maxZoom);
    if (levels.length === 0) return;
    const ZoomButtonsControl = L.Control.extend({
      options: { position: 'topright' },
      onAdd: (map) => {
        const container = L.DomUtil.create('div', 'leaflet-control chrono-zoom-buttons');
        L.DomEvent.disableClickPropagation(container);
        const buttons = levels.map((level, index) => {
          const button = L.DomUtil.create('div', 'leaflet-bar chrono-zoom-button', container);
          button.style.cssText = `padding:2px 6px;font:bold 12px sans-serif;text-align:center;cursor:pointer;${index > 0 ? 'margin-top:4px;' : ''}`;
          button.textContent = String(level);
          button.title = `Zoom to level ${level}`;
          L.DomEvent.on(button, 'click', () => {
            if (map.getZoom() !== level) map.setZoom(level);
          });
          return { level, button };
        });
        const highlight = () => {
          const zoom = map.getZoom();
          for (const { level, button } of buttons) {
            button.classList.toggle('chrono-zoom-button-active', zoom === level);
          }
        };
        highlight();
        map.on('zoomend', highlight);
        return container;
      },
    });
    new ZoomButtonsControl().addTo(this._leafletMap);
  }

  // Lat/lon display at the bottom center (plain element in the map container, not a control).
  // Text selectable: click/scroll propagation stopped, so dragging over it doesn't pan the map.
  _addCenterControl() {
    const map = this._leafletMap;
    const container = L.DomUtil.create('div', 'leaflet-bar chrono-center', map.getContainer());
    container.style.cssText = 'position:absolute;bottom:10px;left:50%;transform:translateX(-50%);z-index:1000;padding:2px 6px;font:bold 12px sans-serif;white-space:nowrap;user-select:text;-webkit-user-select:text;cursor:text;';
    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);
    const render = () => {
      const c = map.getCenter().wrap();
      container.textContent = `lat: ${c.lat.toFixed(4)} lon: ${c.lng.toFixed(4)}`;
    };
    render();
    map.on('move', render);
    this._centerControlEl = container;
  }

  _teardownMap() {
    // The lat/lon display is not a Leaflet control, so map.remove() doesn't remove it.
    if (this._centerControlEl) {
      this._centerControlEl.remove();
      this._centerControlEl = null;
    }
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
    if (this._glLayer) {
      this._leafletMap?.removeLayer(this._glLayer);
      this._glLayer = null;
    }
    if (this._leafletMap) {
      this._leafletMap.remove();
      this._leafletMap = null;
    }
    if (this._controlsSheet) {
      this.shadowRoot.adoptedStyleSheets = this.shadowRoot.adoptedStyleSheets
        .filter((sheet) => sheet !== this._controlsSheet);
      this._controlsSheet = null;
    }
    this._entityMarkers = null;
    this._entityMarkerHtml = null;
    this._entityTrails = null;
    this._entityTrailPoints = null;
    this._entityTrailStyles = null;
  }

  // --- Entity tracking ---------------------------------------------------

  async _initEntities() {
    if (this._entityMarkers) return; // already initialized
    const entityEntries = this._config.entities;
    if (!entityEntries?.length) return;

    this._entityMarkers = new Map();
    this._entityMarkerHtml = new Map();
    this._entityTrails = new Map();
    this._entityTrailPoints = new Map();
    this._entityTrailStyles = new Map();

    const hoursToShow = this._config.hours_to_show ?? 0;

    for (const rawEntry of entityEntries) {
      const entityConfig = normalizeEntityConfig(rawEntry);
      const entityId = entityConfig.entity;
      const stateObj = this.hass?.states?.[entityId];
      if (!stateObj) continue;

      const markerColor = entityConfig.color;
      const style = resolveTrailStyle(entityConfig, this._config, markerColor);
      this._entityTrailStyles.set(entityId, style);

      if (hoursToShow > 0) {
        // Trail first, so the marker is drawn on top of it.
        const trailGroup = L.layerGroup().addTo(this._leafletMap);
        this._entityTrails.set(entityId, trailGroup);
        this._entityTrailPoints.set(entityId, []);
        fetchEntityTrailHistory(this.hass, entityId, hoursToShow)
          .then((points) => {
            this._entityTrailPoints.set(entityId, points);
            this._redrawEntityTrail(entityId);
          })
          .catch((err) => console.error(`[chrono-pmtiles-card] Failed to fetch history for ${entityId}:`, err));
      }

      const latLon = getEntityLatLon(stateObj);
      if (!latLon) continue;

      const markerHtml = buildMarkerHtml(this.hass, stateObj);
      const icon = L.divIcon({
        html: markerHtml,
        className: '',
        iconSize: [36, 36],
      });
      const marker = L.marker(latLon, { icon }).addTo(this._leafletMap);
      marker.bindPopup(stateObj.attributes.friendly_name || entityId);
      this._entityMarkers.set(entityId, marker);
      this._entityMarkerHtml.set(entityId, markerHtml);
    }
  }

  // Rebuilds one entity's trail from all stored points (opacity depends on the point count),
  // reusing the same layerGroup so it stays on the map.
  _redrawEntityTrail(entityId) {
    const trailGroup = this._entityTrails?.get(entityId);
    const points = this._entityTrailPoints?.get(entityId);
    const style = this._entityTrailStyles?.get(entityId);
    if (!trailGroup || !points || !style) return;

    const stateObj = this.hass?.states?.[entityId];
    const entityName = stateObj?.attributes?.friendly_name || entityId;
    const hoursToShow = this._config.hours_to_show ?? 0;

    trailGroup.clearLayers();
    const freshGroup = buildTrailLayerGroup(points, style, this.hass, hoursToShow, entityName);
    freshGroup.eachLayer((layer) => trailGroup.addLayer(layer));
  }

  // Updates changed entities (null = all): moves a marker only if its position changed, replaces
  // its icon only if the HTML changed (v0.1.28), and appends new positions to the trail.
  _updateEntityPositions(entityIds = null) {
    if (!this._entityMarkers) return;
    for (const [entityId, marker] of this._entityMarkers) {
      if (entityIds && !entityIds.includes(entityId)) continue;
      const stateObj = this.hass?.states?.[entityId];
      const latLon = getEntityLatLon(stateObj);
      if (!latLon) continue;

      const current = marker.getLatLng();
      if (current.lat !== latLon[0] || current.lng !== latLon[1]) {
        marker.setLatLng(latLon);
      }

      const markerHtml = buildMarkerHtml(this.hass, stateObj);
      if (this._entityMarkerHtml?.get(entityId) !== markerHtml) {
        marker.setIcon(L.divIcon({
          html: markerHtml,
          className: '',
          iconSize: [36, 36],
        }));
        this._entityMarkerHtml?.set(entityId, markerHtml);
      }

      const points = this._entityTrailPoints?.get(entityId);
      if (points) {
        const last = points[points.length - 1];
        if (!last || last.lat !== latLon[0] || last.lon !== latLon[1]) {
          points.push({ lat: latLon[0], lon: latLon[1], time: stateObj.last_changed });
          this._redrawEntityTrail(entityId);
        }
      }
    }
  }

  // Map center: "center" entity (current position) or {lat, lon}; falls back to zone.home.
  // The center entity doesn't need to be in "entities".
  _getCenter() {
    const centerCfg = this._config.center;
    if (centerCfg != null) {
      const entityId = typeof centerCfg === 'string' ? centerCfg : centerCfg.entity;
      if (entityId) {
        const latLon = getEntityLatLon(this.hass?.states?.[entityId]);
        if (latLon) return { lat: latLon[0], lon: latLon[1] };
        console.warn(`[chrono-pmtiles-card] center entity "${entityId}" not found or has no location; falling back to zone.home.`);
      } else if (centerCfg.lat != null && centerCfg.lon != null) {
        return { lat: centerCfg.lat, lon: centerCfg.lon };
      }
    }
    const homeZone = this.hass?.states?.['zone.home'];
    if (homeZone?.attributes?.latitude != null && homeZone?.attributes?.longitude != null) {
      return { lat: homeZone.attributes.latitude, lon: homeZone.attributes.longitude };
    }
    // Last-resort fallback if hass/zone.home isn't available yet.
    return { lat: 0, lon: 0 };
  }

  // Adopts leaflet.css and maplibre-gl.css into the shadow root (a <link> in <head> can't reach it).
  async _injectLibraryStyles() {
    const sheets = await Promise.all([
      loadSharedStylesheet('leaflet-css', 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css'),
      loadSharedStylesheet('maplibre-css', 'https://cdn.jsdelivr.net/npm/maplibre-gl@6.10.0/dist/maplibre-gl.css'),
    ]);
    this.shadowRoot.adoptedStyleSheets = [
      ...this.shadowRoot.adoptedStyleSheets,
      ...sheets,
    ];
  }
}
customElements.define('chrono-pmtiles-card', ChronoPmtilesCard);

// --- Shared stylesheet loader --------------------------------------------------
// Fetches each CSS file once and shares the CSSStyleSheet across all card instances.
const _sheetCache = new Map();
function loadSharedStylesheet(key, url) {
  if (_sheetCache.has(key)) return _sheetCache.get(key);
  const promise = fetch(url)
    .then(res => res.text())
    .then(cssText => {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(cssText);
      return sheet;
    });
  _sheetCache.set(key, promise);
  return promise;
}

// --- Card registration ----------------------------------------------------------
window.customCards = window.customCards || [];
window.customCards.push({
  type:        'chrono-pmtiles-card',
  name:        'Chrono PMTiles Card',
  description: 'Renders a Home Assistant map using MapLibre GL vector tiles from a self-hosted PMTiles archive.',
  preview:     true,
});

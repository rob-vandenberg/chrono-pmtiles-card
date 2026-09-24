/**
 * chrono-pmtiles-card
 */

import { LitElement, html, css } from 'https://unpkg.com/lit@2.0.0/index.js?module';
import L                         from 'https://esm.sh/leaflet@1.9.4';
import * as maplibregl           from 'https://esm.sh/maplibre-gl@6.10.0';
import 'https://esm.sh/@maplibre/maplibre-gl-leaflet@0.1.4?deps=maplibre-gl@6.10.0,leaflet@1.9.4';  // attaches L.maplibreGL; ?deps= pins it to the same maplibre-gl/leaflet instances as above
import { Protocol }              from 'https://esm.sh/pmtiles@4.5.0';
import { layers, namedFlavor }   from 'https://esm.sh/@protomaps/basemaps@5.7.2';  // no ?deps= needed: no maplibre-gl/leaflet dependency of its own
import { applyLayerOverrides, mergeSeasoning, resolveStyle, buildControlsCss } from './chrono-pmtiles-style.js';
import { applyShieldColors, applyOnewayArrowSdf }                               from './chrono-pmtiles-shields.js';
import { buildMarkerHtml, getEntityLatLon, subscribeTrailHistory, buildTrailPaths, normalizeEntityConfig,
         computeAutoFitEntityPoints, resolveTrailStyle, buildTrailLayerGroup }   from './chrono-pmtiles-entities.js';

// --- Version ---------------------------------------------------------------
const CARD_VERSION = '1.0.102';

// --- Version History ---------------------------------------------------------
// v1.0.102: One-way arrows as SDF image at map load (applyOnewayArrowSdf()), so layers.roads_oneway
//           icon-color (also per road kind/zoom) and icon-halo-color work; default: the arrow's own color.
// v1.0.101: Trails as HA's map card: one history/stream subscription for all entities replaces the
//           REST fetch and the live point appending; old points expire; all trails redrawn per
//           message; tooltip time from last_updated (was last_changed); HA's tooltip look; a
//           subscription error shows HA's error alert instead of the map.
// v1.0.100: New codebase: split into modules chrono-pmtiles-style, -shields and -entities (style files,
//           shield recolor, markers/trails). resolveStyle() takes DEFAULT_THEME as a parameter. No behavior change.
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

// --- Card ---------------------------------------------------------------------
class ChronoPmtilesCard extends LitElement {
  static properties = {
    hass:    { attribute: false },
    _config: { state: true },
    _historyError: { state: true },
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
    /* Trail tooltip as HA's ha-map; .map-container outranks leaflet.css (adopted later). */
    .map-container .leaflet-tooltip {
      padding: 8px;
      font-size: var(--ha-font-size-s);
      background: rgba(80, 80, 80, 0.9) !important;
      color: white !important;
      border-radius: var(--ha-border-radius-sm);
      box-shadow: none !important;
      text-align: center;
    }
  `;

  render() {
    if (!this._config) return html``;
    // History subscription failed: HA's error alert instead of the map, as HA's map card.
    if (this._historyError) {
      return html`<ha-alert alert-type="error">
        ${this.hass.localize('ui.components.map.error')}: ${this._historyError.message}
        (${this._historyError.code})
      </ha-alert>`;
    }
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
    if (this._config && !this._leafletMap && !this._historyError) {
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
    const style = await resolveStyle(this._config, DEFAULT_THEME);
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
      // One-way arrows as SDF image, so roads_oneway icon-color works (v1.0.102).
      try {
        applyOnewayArrowSdf(maplibreMap, style.layers);
      } catch (err) {
        console.error('[chrono-pmtiles-card] Failed to make the one-way arrow colorable:', err);
      }
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
    if (this._historyUnsub) {
      this._historyUnsub.then((unsub) => unsub?.()).catch(() => undefined);
      this._historyUnsub = null;
    }
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
    this._trailGroup = null;
    this._trailHistory = null;
  }

  // --- Entity tracking ---------------------------------------------------

  async _initEntities() {
    if (this._entityMarkers) return; // already initialized
    const entityEntries = this._config.entities;
    if (!entityEntries?.length) return;

    this._entityMarkers = new Map();
    this._entityMarkerHtml = new Map();

    // Trails as HA's map card: one history/stream subscription for all configured entities (also
    // those without a current state), skipped without the history component or hours_to_show.
    const hoursToShow = this._config.hours_to_show ?? 0;
    if (hoursToShow && this.hass?.config?.components?.includes('history')) {
      // Trail group first, so the markers are drawn on top of it.
      this._trailGroup = L.layerGroup().addTo(this._leafletMap);
      const subscription = subscribeTrailHistory(
        this.hass,
        (history) => {
          if (this._historyUnsub !== subscription) return; // message came in after unsubscribing
          this._trailHistory = history;
          this._drawTrails();
        },
        hoursToShow,
        this._trackedEntityIds()
      ).catch((err) => {
        // As HA: no retry; the card shows the error instead of the map.
        if (this._historyUnsub !== subscription) return undefined;
        this._historyUnsub = null;
        this._teardownMap();
        this._historyError = err;
        return undefined;
      });
      this._historyUnsub = subscription;
    }

    for (const rawEntry of entityEntries) {
      const entityConfig = normalizeEntityConfig(rawEntry);
      const entityId = entityConfig.entity;
      const stateObj = this.hass?.states?.[entityId];
      if (!stateObj) continue;

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

  // Redraws all trails from the latest history, reusing the same layerGroup so it stays on the map.
  _drawTrails() {
    if (!this._trailGroup) return;
    this._trailGroup.clearLayers();
    const paths = buildTrailPaths(this._trailHistory, this._config, this.hass) ?? [];
    for (const path of paths) {
      const entityConfig = (this._config.entities ?? [])
        .map(normalizeEntityConfig)
        .find((e) => e.entity === path.entityId) ?? {};
      const style = resolveTrailStyle(entityConfig, this._config, entityConfig.color);
      buildTrailLayerGroup(path, style, this.hass)
        .eachLayer((layer) => this._trailGroup.addLayer(layer));
    }
  }

  // Updates changed entities (null = all): moves a marker only if its position changed, replaces
  // its icon only if the HTML changed (v0.1.28). Trails are updated by the history stream.
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

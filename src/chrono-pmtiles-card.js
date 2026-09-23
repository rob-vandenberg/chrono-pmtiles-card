/**
 * chrono-pmtiles-card
 */

import { LitElement, html, css } from 'https://unpkg.com/lit@2.0.0/index.js?module';
import L                         from 'https://esm.sh/leaflet@1.9.4';
import * as maplibregl           from 'https://esm.sh/maplibre-gl@6.10.0';
import 'https://esm.sh/@maplibre/maplibre-gl-leaflet@0.1.4?deps=maplibre-gl@6.10.0,leaflet@1.9.4';  // side-effect import: attaches L.maplibreGL. The ?deps= pin forces this package's internal "maplibre-gl"/"leaflet" imports to resolve to the SAME instances imported above, instead of a separate copy -- without it, addProtocol() registers on a different maplibregl instance than the one leaflet-maplibre-gl actually uses internally.
import { Protocol }              from 'https://esm.sh/pmtiles@4.5.0';
import { layers, namedFlavor }   from 'https://esm.sh/@protomaps/basemaps@5.7.2';  // No ?deps= pin needed: this package has no maplibre-gl/leaflet dependency of its own (confirmed via npm registry metadata) -- it only generates plain style-spec layer objects, so the module-duplication issue that affects maplibre-gl-leaflet above cannot apply here.

// --- Version ---------------------------------------------------------------
const CARD_VERSION = '0.1.34';

// --- Version History ---------------------------------------------------------
// v0.1.34: Fix history trails missing most points for "person" entities
//          (sparse trail with long straight segments, while chrono-map-card
//          showed the full route for the same entity and period). Root cause,
//          confirmed against HA core source: /api/history/period defaults to
//          significant_changes_only, which for domains outside the recorder's
//          SIGNIFICANT_DOMAINS (person is not in it) returns only rows where
//          the state itself changed, dropping attribute-only GPS updates.
//          Fixed by adding significant_changes_only=0 to the request in
//          fetchEntityTrailHistory().
// v0.1.33: Fix: two or more entities at exactly the same coordinates (e.g.
//          router-based presence reporting the zone's own coordinates) got
//          DEFAULT_ZOOM_LEVEL (11) instead of being treated as a fit. The
//          "nothing to fit -> 11" rule applies to a SINGLE entity only; 2+
//          entities on one spot are the tightest possible fit and now get
//          max_auto_fit_zoom (default 14), same as entities a few meters
//          apart.
// v0.1.32: Zoom/center rework, per explicit instruction. Fixes the map
//          zooming all the way in (to max zoom) when all tracked entities are
//          a few meters apart (e.g. everyone at home with slightly different
//          GPS positions): the fitted box was tiny but not zero, and nothing
//          capped the fitted zoom.
//          - Decoupled center and zoom; each key controls one thing, explicit
//            settings win for their own part, "auto_fit" fills in the rest:
//              Center: "center" if set; else, with auto_fit, the middle of
//                      the entities; else zone.home.
//              Zoom:   initial_zoom_level if set; else, with auto_fit, the
//                      fitted zoom clamped to [min_auto_fit_zoom,
//                      max_auto_fit_zoom]; else DEFAULT_ZOOM_LEVEL (11).
//                      Also 11 when auto_fit has nothing to fit.
//          - New YAML keys: auto_fit (default true), min_auto_fit_zoom
//            (default 3), max_auto_fit_zoom (default 14). Undocumented
//            testing/debug overrides: min_zoom_level (default 1),
//            max_zoom_level (default 18) -- "max_zoom_level" REPLACES the old
//            "max_zoom" key (renamed, no alias; "max_zoom" is now ignored).
//          - BEHAVIOR CHANGE: initial_zoom_level no longer switches off
//            auto-fit entirely. With it set and no "center", the map now
//            centers on the middle of the entities (previously zone.home).
//            Use auto_fit: false for the old behavior.
//          - One code path for all cases: _computeView() / _applyView(),
//            replacing _applyAutoFitView() and _fitAroundCenter(). Initial
//            view is always applied on the ResizeObserver's first firing;
//            reset-focus is always added and re-applies the same rules with
//            current positions.
// v0.1.31: "center" without "initial_zoom_level" now keeps that center and
//          zooms to fit all tracked entities around it, per explicit
//          instruction (replaces v0.1.30's fixed zoom 11 for that case):
//          - center + initial_zoom_level: that center at that zoom.
//          - center only: new _fitAroundCenter() -- center stays exactly in
//            the middle; zoom = largest at which a box symmetric around the
//            center (measured in Web Mercator pixel space) containing every
//            entity, plus the same 5% padding as auto-fit, fits. No entities
//            with a position, or all exactly on the center: zoom 11.
//          - neither: auto-fit, unchanged.
//          The center-only fit runs on the ResizeObserver's first firing,
//          like auto-fit, because getBoundsZoom() needs the final container
//          size. Reset-focus re-runs the same fit with current positions
//          (_addResetFocusControl() gained an optional resetFn argument).
// v0.1.30: "center" config can now name an entity, per explicit instruction:
//            center: person.rob            (short form)
//            center: { entity: person.rob } (long form)
//            center: { lat: .., lon: .. }   (fixed coordinates, unchanged)
//          - The entity's CURRENT position is used at load. It does not need
//            to be in "entities" (read straight from hass.states), so the
//            center can be something not drawn on the map.
//          - An explicit "center" now disables auto-fit, like an explicit
//            "initial_zoom_level" already did (previously "center" was
//            silently overridden by auto-fit whenever initial_zoom_level was
//            absent). Zoom: initial_zoom_level, else 11 (same as the
//            single-entity auto-fit).
//          - Reset-focus re-centers on the entity's current position at click
//            time (it now receives a center getter instead of a fixed value).
//            The map does NOT follow the entity while it moves.
//          - Missing entity or no location: falls back to zone.home, with a
//            console warning.
// v0.1.29: Fix road shield numbers (and possibly other labels) intermittently
//          missing on first load, appearing only after a zoom or a manual
//          window resize. Observed: a small window resize makes them appear
//          immediately, i.e. the text exists in the tiles and only the first
//          symbol placement dropped it. Start-up order, per this file: the
//          ResizeObserver's first firing (and its invalidateSize()) happens
//          almost immediately after observe(), before tiles, glyphs or the
//          sprite are loaded; applyShieldColors() then swaps shield images via
//          updateImage() only after MapLibre's "load" event; nothing
//          re-measures or re-places symbols after that. Fix, event-driven per
//          explicit instruction (no timers): on "load", await
//          applyShieldColors() (a no-op when no shield colors are
//          configured), then on MapLibre's next "idle" event call
//          invalidateSize() + maplibreMap.resize() once -- the same effect as
//          the manual resize that was observed to fix it. triggerRepaint() is
//          called right after registering the listener because "idle" only
//          fires following a render, and the map may already be idle.
//          [Unverified in a live HA dashboard at time of writing -- based on
//          the observed resize behavior, not a reproduced root cause inside
//          MapLibre.]
// v0.1.28: Fixed entity marker pictures blinking continuously. Root cause,
//          confirmed by reading this file: HA assigns a new "hass" object to
//          every card whenever ANY entity in the whole instance changes, and
//          _updateEntityPositions() ran on every one of those assignments
//          and unconditionally called marker.setIcon(L.divIcon(...)) for
//          every tracked entity. setIcon() makes Leaflet discard the marker's
//          DOM element and build a new one, including a new <img>, so the
//          picture was torn down and reloaded on every state change anywhere
//          in HA. Per explicit instruction, fixed at the source rather than
//          only short-circuited inside the update:
//          - New shouldUpdate(): when only "hass" changed, compares the
//            previous and new hass.states[id] object for this card's own
//            tracked entities only (HA replaces a state object only when
//            that entity changes; unchanged entities keep the same object
//            reference -- the same comparison HA's own built-in cards use via
//            hasConfigOrEntityChanged). If none of them changed, returns
//            false, so Lit skips the whole update cycle (no render, no
//            updated(), no marker/trail code). Config changes, the first hass
//            assignment, and the pre-init state always update, unchanged.
//          - The changed entity ids are handed to _updateEntityPositions(),
//            which now touches only those entities' markers/trails.
//          - Within a changed entity, setLatLng() only runs if the position
//            differs, and setIcon() only runs if the generated marker HTML
//            differs (new _entityMarkerHtml map). Needed because a person/
//            device_tracker state object also changes for attribute-only
//            updates (e.g. gps_accuracy, battery) that don't affect the
//            marker -- without this, those would still rebuild the <img>.
// v0.1.27: Renamed config key "zoom" -> "initial_zoom_level", per explicit
//          instruction. Rename only -- no behavior change. Updated the three
//          live reads (_initMap()'s hasExplicitZoom check, its setView()
//          fallback, and its call into _addResetFocusControl()) plus the
//          v0.1.26 comments that referenced the old name.
// v0.1.26: Auto-fit initial zoom to entities, per explicit instruction, only
//          when "initial_zoom_level" is not set in config (an explicit
//          "initial_zoom_level" config value still wins outright, unchanged):
//          - 0 or 1 resolved entities -> center on that entity (or the
//            existing _getCenter() fallback if 0), zoom 11.
//          - 2+ resolved entities -> L.latLngBounds(points).pad(0.05), fit
//            to that padded box. 0.05 (5%) confirmed by explicit instruction
//            this session, deliberately NOT matching HA's own real default
//            (confirmed against its actual hui-map-card.ts/ha-map.ts source
//            this session: ha-map.ts's fitMap() defaults to pad: 0.5, i.e.
//            50%, not the 10% initially recalled -- HA's own default was
//            rejected as too large per explicit instruction, 5% used
//            instead).
//          - Per explicit instruction, this computation must run AFTER the
//            container's real, final size is known (Leaflet's own
//            getBoundsZoom(), confirmed by reading Leaflet v1.9.4's actual
//            source this session, computes zoom from this.getSize() -- the
//            map's CURRENT pixel size -- so computing it before HA's
//            dashboard grid settles the card's final width, the same
//            pre-existing race documented in this file's own v0.0.11 fix,
//            would risk an incorrect zoom). There is no signal available to
//            tell "initial grid settling" apart from a later genuine window
//            resize -- both fire the same ResizeObserver callback -- so per
//            explicit instruction, the auto-fit now runs once, on that
//            ResizeObserver's FIRST-ever firing after _initMap() only,
//            gated by a new this._hasAutoFitted instance flag. Every
//            subsequent firing (real window resizes) continues to only call
//            invalidateSize(), unchanged. Per explicit instruction, the map
//            is visibly at its placeholder fallback view for the brief
//            window before that first firing; this is accepted as-is, not a
//            bug to fix.
//          - Per explicit instruction, auto-fit fires only at initial load
//            and on the reset-focus control's click, never on a plain
//            window resize. _addResetFocusControl() is now called from
//            inside that first-ResizeObserver branch (after the real
//            initial view is known) instead of synchronously inside
//            _initMap(), and its stored initialCenter/initialZoom are now
//            this computed auto-fit view rather than DEFAULT_ZOOM, so
//            reset-focus reproduces the same auto-fit computation.
//          - New module-level computeAutoFitEntityPoints() helper reuses
//            the existing normalizeEntityConfig()/getEntityLatLon() helpers
//            (unchanged) rather than duplicating entity-resolution logic.
// v0.1.25: Fixed a real bug in applyLayerOverrides() (present since v0.0.7)
//          that broke the ENTIRE map, not just the overridden layer, when a
//          "layers" config override set only "paint" (or only "layout") on
//          a layer that has no native counterpart key -- e.g. overriding
//          roads_highway's paint.line-width, since roads_highway has no
//          "layout" key at all in its generated form. The old code
//          unconditionally wrote "layout: layer.layout" even when both
//          sides were undefined, producing an explicit "layout: undefined"
//          on the layer object -- a present-but-invalid key, which
//          MapLibre's style validator rejects for the WHOLE style ("layers
//          [N].layout: object expected, undefined found"), not just that
//          layer. Root cause confirmed against a live error this session.
//          Fixed: paint/layout are now only set on the merged layer when
//          either the source layer or the override actually has one.
// v0.1.24: Two fixes, per explicit instruction:
//          1) Reset-focus button icon (added v0.1.23) was pinned to the top
//             of its 26x26 leaflet-bar button box instead of centered:
//             leaflet.css centers "leaflet-bar a" text via line-height,
//             which does not vertically center a display:block SVG. Fixed
//             by making the link a flex container (align-items/justify-
//             content: center) and sizing the icon up from 16px to 22px to
//             better fill the button.
//          2) New "max_zoom" config key (default 18, Leaflet's own default
//             max), passed as Leaflet's real maxZoom map option. Fixes an
//             unconstrained zoom reaching level 42 and crashing the
//             browser -- root cause confirmed this session: neither our
//             code nor maplibre-gl-leaflet (checked its real source, no
//             maxZoom handling exists in it at all) set any zoom ceiling,
//             so Leaflet had nothing constraining it. maplibre-gl-leaflet
//             purely mirrors whatever zoom Leaflet is at onto the MapLibre
//             canvas, so capping Leaflet's own maxZoom is sufficient -- no
//             separate MapLibre-side cap needed.
// v0.1.23: Two additions, per explicit instruction:
//          1) "Reset focus" Leaflet control (topleft, below the built-in
//             zoom +/- control), icon matching HA's own reset-focus button
//             (mdiImageFilterCenterFocus, confirmed against HA's real
//             hui-map-card.ts source this session). Deliberately does NOT
//             replicate HA's own behavior (HA's version fits bounds to
//             current entity positions) -- ours instead returns to the same
//             center/zoom _initMap() computes on initial load (this._config
//             .center or HA's zone.home, at this._config.zoom ??
//             DEFAULT_ZOOM), i.e. matching what a hard page reload (Ctrl+F5)
//             would show, per explicit instruction that this is the desired
//             behavior, not HA's fit-to-entities.
//          2) New "show_zoom_level" boolean config key (default false).
//             When true, adds a small Leaflet control (bottomleft) showing
//             the current integer zoom level, updated live on the map's own
//             "zoomend" event.
// v0.1.22: Two changes, per explicit instruction:
//          1) Renamed config keys "theme" -> "flavor" and "palette" ->
//             "seasoning", to match @protomaps/basemaps' own real
//             vocabulary (Flavor is the library's actual type/concept name,
//             confirmed against its source this session) instead of names
//             we invented. No backward-compat aliases -- card is unreleased,
//             explicitly not needed. Purely a rename; behavior unchanged.
//             "layers" key is unchanged (already a correct, complete,
//             untranslated pass-through, confirmed by inspecting real
//             generated layer objects this session).
//          2) Trail-point hover tooltip text (entity name + timestamp,
//             added in v0.1.21) is now center-aligned instead of Leaflet's
//             default left alignment.
// v0.1.21: Hover tooltips on trail points, showing entity name + timestamp.
//          Matches HA's native map card exactly (src/components/map/
//          ha-map.ts, confirmed this session): L.circleMarker.bindTooltip(),
//          default hover trigger (not a click popup), direction: 'top',
//          content "<friendly_name><br><formatted time>".
//          - fetchEntityTrailHistory() now returns {lat, lon, time} objects
//            instead of bare [lat, lon] tuples, sourcing "time" from each
//            history entry's last_changed. Live-appended points (from
//            _updateEntityPositions) source "time" from the live state
//            object's last_changed the same way. All trail point storage/
//            comparison logic (_entityTrailPoints, dedupe check in
//            _updateEntityPositions, buildTrailLayerGroup) updated to carry
//            the new shape.
//          - Date format replicates HA's own three-way branch exactly, on
//            explicit instruction to match native HA behavior rather than
//            use a fixed format: hours_to_show > 144 -> full date+time;
//            else point is today -> time with seconds only; else -> weekday
//            + time. Implemented via Intl.DateTimeFormat.
//          - 12h/24h choice ported from HA's real useAmPm() (src/common/
//            datetime/use_am_pm.ts, confirmed this session): reads
//            hass.locale.time_format or hass.locale.language (that
//            function's TimeFormat.language/system branch tests a fixed
//            10PM date string against the locale's own toLocaleString());
//            falls back to hass.locale.time_format === 'am_pm' directly
//            otherwise. hass.locale is confirmed part of the standard
//            documented custom-card HomeAssistant interface. Time zone
//            sourced from hass.config.time_zone.
//          - NOTE: this deliberately replicates HA's NATIVE map card
//            formatting logic, not chrono-map-card's -- confirmed this
//            session that chrono-map-card's own tooltip formatting does not
//            correctly follow the user's HA profile time-format setting,
//            while HA's native map card does.
// v0.1.20: Trail fade styling + per-entity/global trail config. Matches HA's
//          native map card trail rendering (src/components/map/ha-map.ts,
//          hui-map-card.ts), confirmed against its real formula:
//          - Trail is no longer one flat-opacity L.polyline per entity. It
//            is now an L.layerGroup per entity containing one L.polyline per
//            consecutive point pair (N points -> N-1 segments) plus one
//            L.circleMarker per point, oldest = most faded, newest = most
//            opaque.
//          - Opacity formula matches HA exactly: gradualOpacity = 0.8,
//            baseOpacity = 0.2, opacityStep = gradualOpacity /
//            (points.length - 2), opacity = baseOpacity + segmentIndex *
//            opacityStep. Floor is 20% (HA's own default), NOT the 10%
//            floor discussed earlier in this project -- corrected per
//            explicit instruction this session. 2-point trail (1 segment)
//            is a documented edge case: uses 100% opacity, no division.
//          - Live updates (_updateEntityPositions): a new point means every
//            existing segment's correct opacity has shifted, since the
//            formula's denominator is the total point count. There is no
//            valid append-only path. Each update now fully destroys and
//            rebuilds the entity's trail layerGroup from the complete
//            stored point array.
//          - New "entities" list entries may now be a bare entity-id string
//            (unchanged) OR an object: { entity, color, history_line_color,
//            history_line_width, history_dot_radius, use_base_entity_only }.
//          - New root-level optional config keys: history_line_color,
//            history_line_width, history_dot_radius -- global defaults,
//            overridable per-entity. Precedence: per-entity value -> root
//            default -> hardcoded fallback (color '#4676d3', width 3,
//            radius 3).
//          - "color" (per-entity) is the marker/circle color; "history_line_
//            color" (per-entity or root) is the trail-specific color,
//            defaulting to that entity's "color" if unset.
//          - "use_base_entity_only" is accepted on a per-entity object for
//            config-schema compatibility with chrono-map-card but is
//            currently a no-op: this card's history fetch (hass.callApi
//            against /api/history/period) is architecturally different from
//            chrono-map-card's HaHistoryService/websocket subscription
//            model where this flag has a verified effect, and no equivalent
//            behavior has been verified for this card's fetch path.
//          - "hours_to_show" (numeric, HA-native key) is unchanged and
//            remains the only history-duration config key -- confirmed
//            against HA's real hui-map-card.ts source this session that HA
//            itself has no relative-time-string key.
// v0.0.11: Two fixes, confirmed via live shadow-DOM inspection rather than
//          guessed:
//          1) Map only filled the left half of the card, rest gray. Cause:
//             neither Leaflet nor MapLibre were ever told to resize after
//             initial mount, and HA's dashboard grid can settle the card's
//             final width AFTER _initMap() already ran with an earlier,
//             narrower measurement. Fix: a ResizeObserver on the map
//             container now calls this._leafletMap.invalidateSize(), which
//             maplibre-gl-leaflet propagates to the underlying MapLibre
//             canvas automatically.
//          2) Entity marker pictures rendered at their raw natural size
//             (measured 512x516.75px instead of 36x36) despite matching
//             CSS rules existing in an injected <style> tag. Confirmed via
//             getComputedStyle() that HA's own frontend/card-mod styles
//             were overriding the global stylesheet's rules entirely
//             (display/overflow/border-radius/object-fit all came back as
//             unstyled defaults despite the selector matching). Fix:
//             dropped the injected global <style> tag approach and set
//             marker sizing directly as inline styles instead, which beat
//             the same cascade that was overriding the external sheet.
// v0.0.10: Fix map being empty (no tiles, no zoom controls, nothing) on the
//          live dashboard while working correctly in the card editor's own
//          preview. Root cause, confirmed via shadow-DOM inspection: the
//          editor preview and the live dashboard are separate connect/
//          disconnect cycles of the SAME element instance in HA's
//          frontend. Lit's firstUpdated() fires only once ever, so it
//          initialized the map for the editor preview; when the editor
//          closed, disconnectedCallback() -> _teardownMap() ran (setting
//          _leafletMap back to null) as designed, but nothing ever
//          re-initialized the map when the card reconnected for the real
//          dashboard view. Fix: added connectedCallback(), which
//          re-runs _initMap()/_initEntities() whenever the card reconnects
//          and _leafletMap is null, waiting on updateComplete first since
//          connectedCallback() fires before Lit's own re-render has put
//          the <div id="map"> back in the DOM.
// v0.0.9: Added entity tracking. New "entities" config key (explicit list
//         of person./device_tracker. entity ids) draws one circular marker
//         per entity, HA-native style: entity_picture if the state has one
//         (resolved to an absolute URL via hass.hassUrl(), confirmed as
//         the standard method exposed to custom cards), else initials from
//         the friendly name (matches HA's own hui-map-card/ha-map fallback
//         behavior, confirmed by reading its source). New "hours_to_show"
//         config key (name matches HA's built-in Map card, 0 = markers
//         only, default 0) draws a trail per entity by querying HA's own
//         /api/history/period REST endpoint (via hass.callApi, with
//         filter_entity_id and end_time, WITHOUT minimal_response/
//         no_attributes since lat/lon are needed from attributes) once on
//         load, then appending live hass updates to the same trail without
//         re-fetching. Entities/trails are plain Leaflet markers/polylines
//         (not MapLibre layers), per the original design: Leaflet drives
//         all interaction, MapLibre only renders the basemap.
// v0.0.8: Added palette.shield_fill / palette.shield_border config keys to
//         recolor highway route-number shield badges (e.g. "A12"). These
//         are NOT Flavor properties -- confirmed via TypeDoc that Flavor
//         has no shield_* keys, and via a local @protomaps/basemaps run
//         that the shield layer draws them as a sprite icon-image, not a
//         paint color. Fix: after the MapLibre map's "load" event, fetch
//         the active theme's real sprite sheet (PNG+JSON) from the same
//         "sprite" URL already in the style, recolor every shield entry
//         (generic_shield-1..5char, NL:S-road-1..5char, US:I-1..5char) by
//         blending each pixel between the sprite's own fill/border
//         reference colors (white/gray for light, black/gray for dark --
//         confirmed by sampling both sprite sheets) and the requested
//         colors, preserving anti-aliased edges, then replace each entry
//         via the real maplibregl.Map's updateImage() (confirmed via a
//         headless-browser test against the actual library: addImage() on
//         an existing name fires a non-fatal error event, updateImage() is
//         the correct replace call, and it requires the replacement image
//         to match the ORIGINAL entry's exact width/height, which this
//         preserves from the sprite JSON). Reached the real maplibregl.Map
//         instance via maplibre-gl-leaflet's public getMaplibreMap()
//         method (confirmed present in its dist build), not a private
//         field. No-op (no fetch, no recolor) when neither palette key is
//         set, so existing configs are unaffected.
// v0.0.7: Added "layers" config key: an object keyed by generated layer id
//         (e.g. "roads_shields", "roads_label_major") whose paint/layout
//         sub-objects are shallow-merged onto that layer's own paint/layout
//         after layers() generates the style. Covers styling not exposed
//         through Flavor/"palette" -- confirmed via a local install of
//         @protomaps/basemaps@5.7.2 that e.g. the highway route-number
//         shield's text color (roads_shields, paint['text-color']) and any
//         label's font size (layout['text-size']) are baked into the
//         generated layers directly, not Flavor properties. NOTE: the
//         shield's background/border shape is a sprite icon-image, not a
//         paint color, so it is NOT reachable via this mechanism -- would
//         need a self-hosted, modified sprite sheet.
// v0.0.6: Fix missing street/place labels and icons: the style object was
//         missing the required "glyphs" and "sprite" URLs (confirmed via
//         docs.protomaps.com/basemaps/maplibre's example style -- without
//         glyphs, MapLibre silently renders no text layers at all, no
//         error). Added Protomaps' free hosted basemaps-assets glyphs/
//         sprite URLs, and the {lang:'en'} options argument to layers()
//         per that same example. Added "palette" config key: a flat
//         object of Flavor key overrides spread onto namedFlavor(theme)
//         before being passed to layers(), e.g. palette: {highway: "#f60"}.
// v0.0.5: Replace the single hardcoded debug fill layer with real basemap
//         styling via @protomaps/basemaps. Added "theme" config key
//         (default 'light') selecting namedFlavor('light'|'dark'|...) --
//         switching happens at map init only, not live. Switched
//         DEFAULT_PMTILES_URL from the US ZCTA test dataset to the
//         self-hosted europe.pmtiles regional extract.
// v0.0.4: Fix "URL scheme pmtiles is not supported" despite addProtocol()
//         succeeding. Root cause: leaflet-maplibre-gl's ESM build imports
//         its own bare "maplibre-gl"/"leaflet" specifiers, which jsdelivr's
//         +esm resolved to a SEPARATE module instance from the one we
//         import and register the pmtiles:// protocol on -- so the map it
//         actually constructs internally never sees our addProtocol() call.
//         Switched leaflet/maplibre-gl/maplibre-gl-leaflet/pmtiles imports
//         to esm.sh with a ?deps= pin on the maplibre-gl-leaflet import,
//         forcing all of them to resolve to one shared instance. Removed
//         diagnostic console.log lines from the 0.0.3.x debug builds.
// v0.0.3: Version bump only (0.0.2 tag/release already consumed resolving
//         the earlier workflow/publish issue) -- no code changes beyond
//         the version number itself.
// v0.0.2: Fix "does not provide an export named 'default'" console error.
//         maplibre-gl@6.10.0's ESM build (+esm on jsdelivr) does not expose
//         a default export; switched to a namespace import
//         (import * as maplibregl) which works regardless of whether a
//         default export exists.
// v0.0.1: Initial scaffold. Renders a MapLibre GL vector layer (via
//         maplibre-gl-leaflet) reading a PMTiles archive over HTTP range
//         requests, hosted inside a plain Leaflet map. Centered on HA's
//         Home zone coordinates. Points at Protomaps' public sample
//         dataset (US ZIP code area polygons) purely to prove the render
//         pipeline end-to-end before any real regional PMTiles file or
//         @protomaps/basemaps styling is introduced. No editor, no
//         entity tracking yet -- YAML-only config, one required key.

// --- Console log ---------------------------------------------------------------
console.info(
  `%c CHRONO-%cPMTILES%c-CARD %c v${CARD_VERSION} `,
  'background-color: #101010; color: #FFFFFF; font-weight: bold; padding: 2px 0 2px 4px; border-radius: 3px 0 0 3px;',
  'background-color: #101010; color: #4676d3; font-weight: bold; padding: 2px 0;',
  'background-color: #101010; color: #FFFFFF; font-weight: bold; padding: 2px 4px 2px 0;',
  'background-color: #1E1E1E; color: #FFFFFF; font-weight: bold; padding: 2px 4px; border-radius: 0 3px 3px 0;'
);

// --- Constants ---------------------------------------------------------------

// Self-hosted regional extract (Europe, z0-14), served from this HA
// instance's www/ folder via HTTP range requests.
const DEFAULT_PMTILES_URL = '/local/europe.pmtiles';

const DEFAULT_MAP_HEIGHT = '300px';
// v0.1.32 zoom constants (see version history):
const MIN_ZOOM_LEVEL             = 1;  // overridable via undocumented min_zoom_level
const MAX_ZOOM_LEVEL             = 18; // overridable via undocumented max_zoom_level
const DEFAULT_ZOOM_LEVEL         = 11; // no initial_zoom_level and nothing to fit / auto_fit off
const DEFAULT_MIN_AUTO_FIT_ZOOM  = 3;  // min_auto_fit_zoom default
const DEFAULT_MAX_AUTO_FIT_ZOOM  = 14; // max_auto_fit_zoom default
const DEFAULT_THEME      = 'light';

// The pmtiles:// protocol must only ever be registered once per page,
// regardless of how many chrono-pmtiles-card instances get created or
// destroyed as the user navigates dashboards. A module-scope guard
// (rather than an instance flag) ensures this holds even across multiple
// card instances.
let protocolRegistered = false;
function ensurePmtilesProtocol() {
  if (protocolRegistered) return;
  // Known v6 CDN-ESM bug (maplibre/maplibre-gl-js #8459, duplicate of #8018):
  // the worker script's auto-detected URL can fail to load. Explicit
  // setWorkerUrl() bypasses the broken auto-detection.
  maplibregl.setWorkerUrl('https://esm.sh/maplibre-gl@6.10.0/dist/maplibre-gl-worker.js');
  const protocol = new Protocol();
  maplibregl.addProtocol('pmtiles', protocol.tile);
  protocolRegistered = true;
}

// Shallow-merges config-supplied paint/layout overrides, keyed by generated
// layer id, onto the layer array returned by layers(). Layers not named in
// overrides are returned unchanged; a named layer not present in the
// generated array is silently ignored (id typo, or theme doesn't produce
// it) rather than throwing, since this only ever runs against generated
// style layers, not user-authored ones.
function applyLayerOverrides(generatedLayers, overrides) {
  if (!overrides) return generatedLayers;
  return generatedLayers.map((layer) => {
    const override = overrides[layer.id];
    if (!override) return layer;
    const merged = { ...layer };
    // Only set paint/layout when the merged result should actually have
    // one -- i.e. the source layer already had it, or the override
    // supplies it. Unconditionally assigning e.g. "layout: layer.layout"
    // when neither side has a "layout" (a plain line/fill layer, which
    // legitimately has no "layout" key at all, like roads_highway) sets an
    // explicit "layout: undefined" on the object -- a real, present key
    // with an invalid value, which MapLibre's style validator rejects
    // ("layers[N].layout: object expected, undefined found"), aborting the
    // ENTIRE style, not just that one layer. Confirmed against a live error
    // this session.
    if (layer.paint || override.paint) {
      merged.paint = { ...layer.paint, ...override.paint };
    }
    if (layer.layout || override.layout) {
      merged.layout = { ...layer.layout, ...override.layout };
    }
    return merged;
  });
}

// Shield sprite icon names covered by palette.shield_fill/shield_border.
// Confirmed exhaustive against Protomaps' hosted v4 sprite JSON -- no other
// shield-type entries exist in either the light or dark sprite sheet.
const SHIELD_SPRITE_NAMES = [
  'generic_shield-1char', 'generic_shield-2char', 'generic_shield-3char',
  'generic_shield-4char', 'generic_shield-5char',
  'NL:S-road-1char', 'NL:S-road-2char', 'NL:S-road-3char',
  'NL:S-road-4char', 'NL:S-road-5char',
  'US:I-1char', 'US:I-2char', 'US:I-3char', 'US:I-4char', 'US:I-5char',
];

// Each shield sprite is drawn with exactly two flat colors plus anti-aliased
// blend pixels between them -- confirmed by sampling actual pixel data from
// Protomaps' hosted sprite sheets: white fill / gray(154,154,154) border in
// the light theme, black fill / gray(101,101,101) border in dark.
const SHIELD_REFERENCE_COLORS = {
  light: { fill: [255, 255, 255], border: [154, 154, 154] },
  dark:  { fill: [0, 0, 0],       border: [101, 101, 101] },
};

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex ?? '');
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
}

// Recolors one shield sprite's pixel data in place. Blends each pixel
// between the target fill/border colors using the same proportion it sits
// between the sprite's own reference fill/border colors (solved per
// channel, averaged), so anti-aliased edges stay smooth instead of
// becoming jagged. Fully transparent pixels are left untouched. Verified
// against real sprite pixel data (see v0.0.8 version history).
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

// Fetches the active theme's real sprite sheet, recolors every shield
// entry's fill/border pixels per palette.shield_fill/shield_border, and
// replaces them on the live map via updateImage(). No-op if neither key is
// set. Must run after the map's "load" event: the sprite has to already be
// loaded, both for MapLibre's own use and so updateImage()'s same-
// dimensions requirement has an existing image to match. Fetches the same
// @1x/@2x variant MapLibre itself selected (devicePixelRatio > 1 -- matches
// MapLibre's own load_sprite.ts logic), since updateImage() requires the
// replacement to match the currently loaded image's exact width/height.
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

// Builds the small HTML shown inside each entity's circular Leaflet marker:
// the entity_picture image if the state has one, else initials from the
// friendly name -- matches HA's own hui-map-card/ha-map fallback behavior.
// Sizing/shape is set as INLINE styles rather than a class + injected
// stylesheet: confirmed via getComputedStyle() that HA's own frontend/
// card-mod CSS overrides an injected global <style> tag's rules entirely
// (see v0.0.11 version history) -- inline styles beat that same cascade.
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

// Same as getEntityLatLon, but also carries the state's last_changed
// timestamp, for trail-point hover tooltips (see buildTrailLayerGroup).
function getEntityTrailPoint(stateObj) {
  const latLon = getEntityLatLon(stateObj);
  if (!latLon) return null;
  return { lat: latLon[0], lon: latLon[1], time: stateObj.last_changed };
}

// Fetches one entity's position history over the last `hoursToShow` hours
// via HA's own /api/history/period REST endpoint (same endpoint and
// "hours_to_show" naming as HA's built-in Map card). Deliberately omits
// minimal_response/no_attributes since latitude/longitude live in each
// state's attributes, not in the bare state string. Returns {lat, lon, time}
// objects (time from each history entry's last_changed), not bare
// [lat, lon] tuples, so trail points can show a timestamp on hover.
async function fetchEntityTrailHistory(hass, entityId, hoursToShow) {
  const end = new Date();
  const start = new Date(end.getTime() - hoursToShow * 60 * 60 * 1000);
  // v0.1.34: significant_changes_only=0 is required. The endpoint defaults
  // to significant changes only (HA core history/__init__.py:
  // query.get("significant_changes_only", "1") != "0"), which for any domain
  // outside the recorder's SIGNIFICANT_DOMAINS (climate, device_tracker,
  // humidifier, thermostat, water_heater) -- including "person" -- drops
  // attribute-only updates, i.e. every GPS position change that isn't also a
  // state change (home/not_home/zone). That left trails with only a few
  // points connected by long straight lines.
  const path = `history/period/${start.toISOString()}?filter_entity_id=${encodeURIComponent(entityId)}&end_time=${encodeURIComponent(end.toISOString())}&significant_changes_only=0`;
  const result = await hass.callApi('GET', path);
  const states = result?.[0] ?? [];
  return states.map(getEntityTrailPoint).filter(Boolean);
}

// Ported from HA's real useAmPm() (src/common/datetime/use_am_pm.ts,
// confirmed this session). Determines 12h vs 24h display from the user's HA
// profile locale settings, not from a fixed choice: if time_format is
// "language" or "system", it tests a fixed 22:00 date string against the
// locale's own toLocaleString() output and checks for "10" (12-hour clocks
// show "10", 24-hour clocks show "22"); otherwise it returns whether
// time_format is explicitly "am_pm".
function useAmPm(locale) {
  const timeFormat = locale?.time_format;
  if (timeFormat === 'language' || timeFormat === 'system') {
    const testLanguage = timeFormat === 'language' ? locale?.language : undefined;
    const test = new Date('January 1, 2023 22:00:00').toLocaleString(testLanguage);
    return test.includes('10');
  }
  return timeFormat === 'am_pm';
}

// Formats one trail point's timestamp for its hover tooltip, replicating
// HA's native map card three-way branch exactly (src/components/map/
// ha-map.ts, confirmed this session):
// - hoursToShow > 144 (trail spans more than 6 days): full date + time.
// - else point's timestamp is today: time with seconds, no date.
// - else: weekday + time (no seconds).
// hourCycle in all three follows useAmPm(); time zone from
// hass.config.time_zone.
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

// Normalizes one "entities" config list entry into a plain object, since an
// entry may be a bare entity-id string (unchanged since v0.0.9) or an
// object with entity/color/history_* overrides (new in v0.1.20, schema
// matched to chrono-map-card's "entities" list where relevant).
function normalizeEntityConfig(entry) {
  if (typeof entry === 'string') {
    return { entity: entry };
  }
  return entry ?? {};
}

// Resolves [lat, lon] pairs for every configured entity that currently has a
// known position, for the auto-fit-initial-zoom feature (v0.1.26). Reuses
// normalizeEntityConfig()/getEntityLatLon() rather than duplicating entity-
// resolution logic. Entities with no matching state, or no lat/lon on that
// state, are silently skipped (same behavior as _initEntities()).
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

// Resolves the three trail-styling values for one entity, applying the
// documented precedence: per-entity value -> root-level default -> hardcoded
// fallback. "history_line_color" additionally falls back to the entity's
// own marker "color" before the hardcoded fallback, matching chrono-map-
// card's EntityConfig behavior (historyLineColor defaults to the entity's
// own color, confirmed this session by reading its source).
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

// Builds one entity's full trail as an L.layerGroup: one L.polyline per
// consecutive point pair plus one L.circleMarker per point, with opacity
// increasing from oldest (most faded) to newest (most opaque). Matches HA's
// own trail-fade formula exactly (src/components/map/ha-map.ts /
// hui-map-card.ts, confirmed this session): gradualOpacity = 0.8,
// baseOpacity = 1 - gradualOpacity = 0.2, opacityStep = gradualOpacity /
// (points.length - 2), opacity = baseOpacity + segmentIndex * opacityStep.
// Floor is HA's own 20% (baseOpacity), not an override. A 2-point trail (1
// segment) is a documented edge case: avoids the points.length - 2 === 0
// division by using 100% opacity for that single segment, matching HA's own
// handling of the same case.
//
// Each point's circleMarker also gets a hover tooltip (entity name +
// formatted timestamp), matching HA's native map card exactly (bindTooltip,
// default hover trigger, direction: 'top' -- confirmed this session).
// Points are {lat, lon, time} objects (see fetchEntityTrailHistory/
// getEntityTrailPoint); "hass" and "hoursToShow" are needed to format the
// timestamp per HA's own today/6-day-window branching, "entityName" is the
// tooltip's first line.
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

  // firstUpdated() fires only once, ever. HA's frontend disconnects and
  // reconnects this same element between contexts (e.g. the card editor's
  // own preview closing and the live dashboard view taking over), which
  // runs disconnectedCallback() -> _teardownMap() without ever calling
  // firstUpdated() again -- so without this, the map stays dead after the
  // first disconnect. Waits on updateComplete because connectedCallback()
  // fires before Lit's own re-render has put <div id="map"> back in the DOM.
  connectedCallback() {
    super.connectedCallback();
    if (this._config && !this._leafletMap) {
      this.updateComplete.then(() => {
        this._initMap();
        this._initEntities();
      });
    }
  }

  // Lit calls this after every reactive property update, including each
  // time hass is reassigned by HA's frontend (new state snapshot). Only
  // entity marker positions/trails need to react to that -- the map/style
  // itself is built once in _initMap() and not rebuilt on every hass tick.
  updated(changedProps) {
    if (changedProps.has('hass') && this._leafletMap) {
      // null = no filter (update all tracked entities), e.g. first hass.
      this._updateEntityPositions(this._pendingEntityIds ?? null);
    }
    this._pendingEntityIds = null;
  }

  // v0.1.28: skip the whole Lit update cycle when HA reassigns "hass" but
  // none of THIS card's tracked entities changed (see version history). HA
  // replaces a state object only when that entity changes, so an object
  // reference comparison is sufficient and cheap.
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

    // maxBounds/maxBoundsViscosity/minZoom recommended by maplibre-gl-leaflet's
    // own docs, to avoid pan/zoom sync glitches between the two engines.
    // When "initial_zoom_level" is not set in config, the real initial view
    // is computed from entity positions (see v0.1.26 version history) --
    // but only once the map container's final size is known, which isn't
    // yet the case here. This setView() is a placeholder in that case: per
    // explicit instruction, being visibly at this placeholder view for the
    // brief window until the first ResizeObserver firing below is accepted
    // as-is.
    // v0.1.30: an explicit "center" also disables auto-fit (an explicit
    // choice of center is not overridden by the bounding-box fit). Zoom is
    // then initial_zoom_level, or CENTER_DEFAULT_ZOOM (11, same as the
    // single-entity auto-fit) when only "center" is set.
    // v0.1.31: only an explicit initial_zoom_level skips the deferred fit.
    // "center" without a zoom goes through the deferred path too, where
    // _applyAutoFitView() keeps that center and zooms to fit all entities
    // around it (needs the final container size, like auto-fit).
    // v0.1.32: the view is always (re)computed by _computeView() from the
    // center/zoom rules (see v0.1.32 version history). This setView() is only
    // a placeholder until the ResizeObserver's first firing below, when the
    // container's final size is known (the fitted zoom depends on it) and
    // _applyView() sets the real initial view.
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

    const pmtilesUrl = this._config.pmtiles_url;
    const flavorName = this._config.flavor ?? DEFAULT_THEME;
    const flavor = { ...namedFlavor(flavorName), ...this._config.seasoning };
    const spriteUrl = `https://protomaps.github.io/basemaps-assets/sprites/v4/${flavorName}`;

    this._glLayer = L.maplibreGL({
      style: {
        version: 8,
        // Protomaps' free hosted glyphs/sprites (per your original brief --
        // fine to start with, can move to self-hosted later). Required for
        // any text label or icon layer to render at all; without "glyphs"
        // specifically, MapLibre silently drops all text layers with no
        // console error, which is why labels were missing in v0.0.5.
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
          this._config.layers
        ),
      },
    }).addTo(this._leafletMap);

    // Shield badge fill/border colors aren't reachable through Flavor/
    // palette or layer paint/layout properties -- they're baked into the
    // sprite image itself (see v0.0.8 version history). getMaplibreMap() is
    // maplibre-gl-leaflet's public accessor for the real maplibregl.Map
    // instance it constructs internally.
    const maplibreMap = this._glLayer.getMaplibreMap();
    // v0.1.29: after the shield recolor has finished (instantly, if no
    // shield colors are configured), wait for MapLibre's next "idle" event
    // -- all tiles loaded, all rendering done, no transitions -- and then
    // re-measure and resize once, which makes MapLibre re-run symbol
    // placement with everything final. See v0.1.29 version history.
    maplibreMap.on('load', () => {
      applyShieldColors(maplibreMap, spriteUrl, flavorName, this._config.seasoning)
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
          // "idle" only fires after a render; if the map was already idle
          // (e.g. no shield colors, so nothing changed), force one frame so
          // the listener above is guaranteed to run.
          maplibreMap.triggerRepaint();
        });
    });

    // HA's dashboard grid can settle the card's final width AFTER this
    // point (e.g. during initial masonry layout), leaving Leaflet -- and
    // therefore the MapLibre canvas it drives -- sized to an earlier,
    // narrower measurement (confirmed live: map filled only the left half
    // of the card). invalidateSize() re-measures the container and
    // maplibre-gl-leaflet propagates that to MapLibre's own canvas.
    //
    // v0.1.26: when "initial_zoom_level" is not set in config, this callback's FIRST-ever
    // firing (this._hasAutoFitted starts false) is also when the deferred
    // auto-fit-to-entities view is computed and applied, and when
    // _addResetFocusControl() is finally added -- both must wait until
    // here because Leaflet's own getBoundsZoom() (confirmed by reading its
    // real v1.9.4 source this session) computes zoom from the map's
    // CURRENT container size, which is not yet final any earlier than this.
    // Every later firing (a genuine window resize) is indistinguishable
    // from this one at the ResizeObserver level, so this._hasAutoFitted
    // gates it to run exactly once, per explicit instruction.
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

  // v0.1.32: zoom limits. min/max_zoom_level are undocumented overrides
  // (for testing/debugging); defaults are the hardcoded MIN/MAX_ZOOM_LEVEL.
  // min/max_auto_fit_zoom bound the FITTED zoom only, and are themselves
  // kept inside the overall limits.
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

  // v0.1.32: computes the view from the decoupled center/zoom rules:
  //   Center: "center" if set; else, with auto_fit, the middle of the
  //           tracked entities; else zone.home.
  //   Zoom:   initial_zoom_level if set; else, with auto_fit, the fitted
  //           zoom kept within [min_auto_fit_zoom, max_auto_fit_zoom]; else
  //           DEFAULT_ZOOM_LEVEL (11). Also DEFAULT_ZOOM_LEVEL when auto_fit
  //           has nothing to fit (no entities with a position, or all of
  //           them exactly on the center).
  // The fitted zoom is the largest zoom at which a box SYMMETRIC around the
  // center (measured in Web Mercator pixel space, so the center stays
  // visually in the middle), containing every entity plus 5% padding, fits
  // the container. Uses Leaflet's getBoundsZoom(), which depends on the
  // container's current pixel size -- hence only called once that size is
  // final (ResizeObserver's first firing) and from reset-focus.
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
      // v0.1.33: a single entity exactly on the center has nothing to fit
      // -> DEFAULT_ZOOM_LEVEL. Two or more entities on the exact same spot
      // are still a fit (the tightest possible one) -> max_auto_fit_zoom.
      // (Leaflet can't compute a zoom for a zero-size box, so handled here.)
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

  // v0.1.32: applies _computeView(). Used for the initial view and by
  // reset-focus, so both follow exactly the same rules, with current entity
  // positions.
  _applyView() {
    if (!this._leafletMap) return;
    const { center, zoom } = this._computeView();
    this._leafletMap.setView(center, zoom);
  }

  // Adds a Leaflet control below the built-in zoom +/- buttons that resets
  // the view. Icon matches HA's own button (mdiImageFilterCenterFocus).
  // v0.1.32: always added once in _initMap(); on click it re-applies the
  // same view rules as the initial load (_applyView), with current entity
  // positions.
  _addResetFocusControl() {
    const ResetFocusControl = L.Control.extend({
      options: { position: 'topleft' },
      onAdd: () => {
        const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
        const link = L.DomUtil.create('a', '', container);
        link.href = '#';
        link.title = 'Reset focus';
        // display:flex + centering here fixes v0.1.23's icon being pinned
        // to the top of the 26x26 leaflet-bar button box: leaflet.css sizes
        // "leaflet-bar a" via line-height for text glyphs, which does not
        // vertically center a display:block SVG. Icon size bumped 16->22px
        // to better fill the button, matching HA's own icon-button sizing
        // more closely.
        link.style.cssText = 'display:flex;align-items:center;justify-content:center;';
        // Real mdiImageFilterCenterFocus path data, confirmed against MDI's
        // own icon library this session (pictogrammers.com/library/mdi),
        // matching HA's own reset-focus button icon exactly.
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

  // Adds a Leaflet control (bottomleft) showing the current integer zoom
  // level, kept live via the map's own "zoomend" event. Only added when
  // "show_zoom_level" is true in config (default false).
  _addZoomLevelControl() {
    const ZoomLevelControl = L.Control.extend({
      options: { position: 'bottomleft' },
      onAdd: (map) => {
        const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control chrono-zoom-level');
        container.style.cssText = 'background:rgba(255,255,255,0.85);padding:2px 6px;font:bold 12px sans-serif;color:#333;';
        const render = () => { container.textContent = String(Math.round(map.getZoom())); };
        render();
        map.on('zoomend', render);
        return container;
      },
    });
    new ZoomLevelControl().addTo(this._leafletMap);
  }

  _teardownMap() {
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
        // Draw the trail layerGroup BEFORE the live marker, so the marker
        // (added after) sits visually on top of its own trail's endpoint.
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

  // Rebuilds one entity's trail layerGroup from scratch against its full
  // stored point array. Required on every update, not just the initial
  // fetch: HA's own opacity formula (see buildTrailLayerGroup) divides by
  // total point count, so every existing segment's correct opacity changes
  // as soon as a new point is appended -- there is no valid append-only
  // path (confirmed/decided explicitly this session). Clears the previous
  // layerGroup's contents and adds the freshly built one's layers into it,
  // rather than replacing the layerGroup instance, so the group stays
  // addTo()'d to the map throughout.
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

  // Called from updated() when a tracked entity changed (v0.1.28: only for
  // the entity ids shouldUpdate() found changed; null = all). Moves the
  // marker only if its position changed, replaces its icon only if the
  // generated marker HTML changed (setIcon() rebuilds the <img>, which is
  // what caused the blinking -- see v0.1.28 version history), and -- if the
  // position is new -- appends it to the entity's stored point array and
  // fully rebuilds the trail (see _redrawEntityTrail).
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

  // Resolves the map center (v0.1.30). "center" config may be:
  //   center: person.rob            -> that entity's CURRENT position
  //   center: { entity: person.rob } -> same
  //   center: { lat: .., lon: .. }  -> fixed coordinates (unchanged behavior)
  // Falls back to HA's configured Home zone when no center is given, or when
  // a configured center entity doesn't exist / has no location (with a
  // console warning in that case). The center entity does NOT need to be in
  // the "entities" list -- it is read straight from hass.states.
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

  // leaflet.css and maplibre-gl.css are required for correct rendering
  // (marker positioning, canvas sizing, attribution control, etc.) but
  // neither library bundles its CSS into the JS import -- and a Lovelace
  // card's shadow DOM is not reached by a <link> placed in the document
  // head. So each stylesheet is fetched once and adopted into every
  // card instance's shadow root via a shared, cached constructable
  // stylesheet.
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
// Fetches a CSS file once per URL and caches the resulting CSSStyleSheet,
// so N card instances on a dashboard cause exactly one network request
// and one parse per stylesheet, not N of each.
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

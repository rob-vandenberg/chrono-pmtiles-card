/**
 * chrono-pmtiles-entities
 */

import L from 'https://esm.sh/leaflet@1.9.4';

// --- Version ---------------------------------------------------------------
const MODULE_VERSION = '1.0.100';

// --- Version History ---------------------------------------------------------
// v1.0.100: Split off from chrono-pmtiles-card 0.2.46; code moved unchanged.
//           Full earlier history in the main file.

// Marker HTML: entity_picture if present, else initials (as HA's own map card). Inline styles,
// because HA's CSS overrides an injected stylesheet (v0.0.11).
const MARKER_WRAPPER_STYLE = 'width:100%;height:100%;border-radius:50%;border:2px solid #ffffff;box-shadow:0 1px 4px rgba(0,0,0,0.4);background:#4676d3;overflow:hidden;display:flex;align-items:center;justify-content:center;color:#ffffff;font:bold 11px sans-serif;box-sizing:border-box;';
const MARKER_IMG_STYLE = 'width:100%;height:100%;object-fit:cover;display:block;';

export function buildMarkerHtml(hass, stateObj) {
  const picture = stateObj.attributes.entity_picture;
  if (picture) {
    const src = typeof hass.hassUrl === 'function' ? hass.hassUrl(picture) : picture;
    return `<div style="${MARKER_WRAPPER_STYLE}"><img src="${src}" alt="" style="${MARKER_IMG_STYLE}" /></div>`;
  }
  const name = stateObj.attributes.friendly_name || stateObj.entity_id;
  const initials = name.split(' ').map((part) => part[0]).join('').substr(0, 3).toUpperCase();
  return `<div style="${MARKER_WRAPPER_STYLE}">${initials}</div>`;
}

export function getEntityLatLon(stateObj) {
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
export async function fetchEntityTrailHistory(hass, entityId, hoursToShow) {
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
export function normalizeEntityConfig(entry) {
  if (typeof entry === 'string') {
    return { entity: entry };
  }
  return entry ?? {};
}

// [lat, lon] of every configured entity with a known position, for auto-fit; others are skipped.
export function computeAutoFitEntityPoints(hass, entityEntries) {
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
export function resolveTrailStyle(entityConfig, rootConfig, markerColor) {
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
export function buildTrailLayerGroup(points, style, hass, hoursToShow, entityName) {
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

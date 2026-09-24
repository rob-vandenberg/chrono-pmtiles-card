/**
 * chrono-pmtiles-entities
 */

import L                   from 'https://esm.sh/leaflet@1.9.4';
import xss                 from 'https://esm.sh/xss@1.0.15';          // HA's filterXSS (same version as HA)
import { timeZonesNames }  from 'https://esm.sh/@vvo/tzdb@6.198.0';   // HA's resolveTimeZone (same version as HA)

// --- Version ---------------------------------------------------------------
const MODULE_VERSION = '1.0.102';

// --- Version History ---------------------------------------------------------
// v1.0.102: Marker initials 14 px (was 11 px), for the 48 px markers of chrono-pmtiles-card 1.0.105.
// v1.0.101: Trails as HA's map card: subscribeTrailHistory() (history/stream, old points expire),
//           buildTrailPaths() (time = last_updated, skips zones and falsy lat/lon, name = config
//           "name" or state name), buildTrailLayerGroup() per HA's _drawPaths (segment gets the older
//           point's opacity, antimeridian split, touch dot radius 8, xss-filtered tooltip; 1 or 2
//           points opacity 1). Time zone per profile as HA; > 144 h HA's date format. Fix: 12h check
//           used 'am_pm' instead of HA's '12'. Removed fetchEntityTrailHistory()/getEntityTrailPoint().
// v1.0.100: Split off from chrono-pmtiles-card 0.2.46; code moved unchanged.
//           Full earlier history in the main file.

// Marker HTML: entity_picture if present, else initials (as HA's own map card). Inline styles,
// because HA's CSS overrides an injected stylesheet (v0.0.11).
const MARKER_WRAPPER_STYLE = 'width:100%;height:100%;border-radius:50%;border:2px solid #ffffff;box-shadow:0 1px 4px rgba(0,0,0,0.4);background:#4676d3;overflow:hidden;display:flex;align-items:center;justify-content:center;color:#ffffff;font:bold 14px sans-serif;box-sizing:border-box;';
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

// --- Trail history (port of HA's data/history.ts, v1.0.101) -------------------

// Port of HA's HistoryStream.processMessage(): merges stream messages per entity (sorted by lu) and
// drops states older than hoursToShow, keeping the last expired state re-stamped at the window start.
class HistoryStream {
  constructor(hoursToShow) {
    this.hoursToShow = hoursToShow;
    this.combinedHistory = {};
  }

  processMessage(streamMessage) {
    if (!this.combinedHistory || !Object.keys(this.combinedHistory).length) {
      this.combinedHistory = streamMessage.states;
      return this.combinedHistory;
    }
    if (!Object.keys(streamMessage.states).length) {
      // Empty messages are still sent to indicate no more historical events.
      return this.combinedHistory;
    }
    const purgeBeforePythonTime = this.hoursToShow
      ? (new Date().getTime() - 60 * 60 * this.hoursToShow * 1000) / 1000
      : undefined;
    const newHistory = {};
    const streamStates = streamMessage.states;
    const processEntity = (entityId) => {
      const inCombined = entityId in this.combinedHistory;
      const inStream = entityId in streamStates;
      if (inCombined && inStream) {
        const entityCombinedHistory = this.combinedHistory[entityId];
        const lastEntityCombinedHistory = entityCombinedHistory[entityCombinedHistory.length - 1];
        newHistory[entityId] = entityCombinedHistory.concat(streamStates[entityId]);
        if (streamStates[entityId][0].lu < lastEntityCombinedHistory.lu) {
          // Out of order: sort.
          newHistory[entityId] = newHistory[entityId].sort((a, b) => a.lu - b.lu);
        }
      } else if (inCombined) {
        newHistory[entityId] = this.combinedHistory[entityId];
      } else {
        newHistory[entityId] = streamStates[entityId];
        return;
      }
      // Remove old history.
      if (purgeBeforePythonTime) {
        const states = newHistory[entityId];
        const kept = [];
        let lastExpiredState;
        for (const state of states) {
          if (state.lu < purgeBeforePythonTime) {
            lastExpiredState = state;
          } else {
            kept.push(state);
          }
        }
        if (!lastExpiredState) {
          return;
        }
        newHistory[entityId] = kept;
        if (kept.length && kept[0].lu === purgeBeforePythonTime) {
          return;
        }
        // Keep the start-time state; only the rest expires as it ages.
        lastExpiredState.lu = purgeBeforePythonTime;
        delete lastExpiredState.lc;
        kept.unshift(lastExpiredState);
      }
    };
    for (const entityId of Object.keys(this.combinedHistory)) {
      processEntity(entityId);
    }
    for (const entityId of Object.keys(streamStates)) {
      if (!(entityId in this.combinedHistory)) {
        processEntity(entityId);
      }
    }
    this.combinedHistory = newHistory;
    return this.combinedHistory;
  }
}

// Port of HA's subscribeHistoryStatesTimeWindow() + subscribeHistoryStream(), with the map card's
// arguments (attributes on, full response, all changes). callback gets the combined history
// ({entity_id: [{s, a, lc?, lu}]}) on every message. On a reconnect ("ready") it resubscribes with a
// fresh window and a fresh HistoryStream. Resolves to an async unsubscribe function.
export async function subscribeTrailHistory(hass, callback, hoursToShow, entityIds) {
  let currentUnsub;
  let disposed = false;

  const buildParams = () => ({
    type: 'history/stream',
    entity_ids: entityIds,
    // Recomputed on every (re)subscribe, so the window stays anchored to "now".
    start_time: new Date(new Date().getTime() - 60 * 60 * hoursToShow * 1000).toISOString(),
    minimal_response: false,
    significant_changes_only: false,
    no_attributes: false,
  });

  const doSubscribe = async () => {
    const stream = new HistoryStream(hoursToShow);
    const unsub = await hass.connection.subscribeMessage(
      (message) => callback(stream.processMessage(message)),
      buildParams(),
      { resubscribe: false }
    );
    if (disposed) {
      unsub().catch(() => undefined);
      return;
    }
    currentUnsub = unsub;
  };

  const onReady = () => {
    if (disposed) return;
    currentUnsub = undefined;
    // Reconnect failures are swallowed, as in HA.
    doSubscribe().catch(() => undefined);
  };

  await doSubscribe();
  hass.connection.addEventListener('ready', onReady);

  return async () => {
    disposed = true;
    hass.connection.removeEventListener('ready', onReady);
    if (currentUnsub) {
      await currentUnsub();
    }
  };
}

// Port of HA's computeStateName(): friendly_name, else the object id with "_" as spaces.
function computeStateName(stateObj) {
  const friendlyName = stateObj.attributes.friendly_name;
  return friendlyName === undefined
    ? stateObj.entity_id.slice(stateObj.entity_id.indexOf('.') + 1).replace(/_/g, ' ')
    : (friendlyName ?? '').toString();
}

// Port of HA's map card _getHistoryPaths(): one path per entity in the history (zones skipped),
// points without a truthy lat/lon skipped, timestamp = last_updated (lu). Name: the entity config's
// "name", else the state name, else the entity id. Returns undefined without history or hours_to_show.
export function buildTrailPaths(history, config, hass) {
  const hoursToShow = config.hours_to_show ?? 0;
  if (!history || !hoursToShow) {
    return undefined;
  }
  const entityConfigs = (config.entities ?? []).map(normalizeEntityConfig);
  const paths = [];
  for (const entityId of Object.keys(history)) {
    if (entityId.slice(0, entityId.indexOf('.')) === 'zone') {
      continue;
    }
    const entityStates = history[entityId];
    if (!entityStates?.length) {
      continue;
    }
    const points = [];
    for (const entityState of entityStates) {
      const latitude = entityState.a.latitude;
      const longitude = entityState.a.longitude;
      if (!latitude || !longitude) {
        continue;
      }
      points.push({ point: [latitude, longitude], timestamp: new Date(entityState.lu * 1000) });
    }
    const entityConfig = entityConfigs.find((e) => e.entity === entityId);
    const name =
      entityConfig?.name ??
      (entityId in hass.states ? computeStateName(hass.states[entityId]) : entityId);
    paths.push({
      entityId,
      points,
      name,
      fullDatetime: hoursToShow > 144,
      gradualOpacity: 0.8,
    });
  }
  return paths;
}

// --- Trail tooltip helpers (ports of HA helpers) -------------------------------

// Port of HA's isTouch.
const IS_TOUCH = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

// Port of HA's filterXSS(): strips all HTML.
function filterXSS(html) {
  return xss(html, {
    whiteList: {},
    stripIgnoreTag: true,
    stripIgnoreTagBody: true,
  });
}

// Port of HA's resolve-time-zone.ts: the browser's zone counts only if it is a known IANA zone.
const RESOLVED_RAW = Intl.DateTimeFormat?.().resolvedOptions?.().timeZone;
const RESOLVED_TIME_ZONE =
  RESOLVED_RAW &&
  (RESOLVED_RAW === 'UTC' || RESOLVED_RAW === 'Etc/UTC' || timeZonesNames.includes(RESOLVED_RAW))
    ? RESOLVED_RAW
    : undefined;

// Profile time zone "local" uses the browser's zone (if known), else the server's.
function resolveTimeZone(option, serverTimeZone) {
  return option === 'local' && RESOLVED_TIME_ZONE ? RESOLVED_TIME_ZONE : serverTimeZone;
}

// Port of HA's useAmPm(): 12h vs 24h from the user's HA profile locale settings.
function useAmPm(locale) {
  const timeFormat = locale?.time_format;
  if (timeFormat === 'language' || timeFormat === 'system') {
    const testLanguage = timeFormat === 'language' ? locale?.language : undefined;
    const test = new Date('January 1, 2023 22:00:00').toLocaleString(testLanguage);
    return test.includes('10');
  }
  return timeFormat === '12';
}

// Formats a trail point's time as HA's map card: fullDatetime (> 144 h) date + time, today time
// with seconds, else weekday + time. 12h/24h per useAmPm(), time zone per resolveTimeZone().
function formatTrailPointTime(hass, timestamp, fullDatetime) {
  const date = new Date(timestamp);
  const locale = hass?.locale;
  const language = locale?.language;
  const timeZone = resolveTimeZone(locale?.time_zone, hass?.config?.time_zone);
  const hour12 = useAmPm(locale);
  const hourCycle = hour12 ? 'h12' : 'h23';

  if (fullDatetime) {
    return new Intl.DateTimeFormat(language, {
      year: 'numeric', month: 'long', day: 'numeric',
      hour: hour12 ? 'numeric' : '2-digit', minute: '2-digit',
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
// also falls back to the entity's "color" (as chrono-map-card). Dot radius fallback as HA: 8 on
// touch devices, else 3.
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
    (IS_TOUCH ? 8 : 3);
  return { color, width, radius };
}

// Port of HA's map _drawPaths() for one path from buildTrailPaths(): per point a dot, then the
// segment to the next point with that (older) point's opacity; segments crossing the antimeridian
// are split. Opacity per HA (base 1 - gradualOpacity, step gradualOpacity/(n-2)), except 1 or 2
// points: opacity 1 (HA gives 0.2 for 1 point and divides by zero for 2). Tooltip per HA.
export function buildTrailLayerGroup(path, style, hass) {
  const group = L.layerGroup();
  const points = path.points;
  const n = points.length;

  let opacityStep;
  let baseOpacity;
  if (path.gradualOpacity && n > 2) {
    opacityStep = path.gradualOpacity / (n - 2);
    baseOpacity = 1 - path.gradualOpacity;
  }
  const opacityAt = (pointIndex) => {
    if (!path.gradualOpacity) return undefined;
    if (n <= 2) return 1;
    return baseOpacity + pointIndex * opacityStep;
  };

  const tooltip = (point) =>
    `${filterXSS(path.name ?? '')}<br>${formatTrailPointTime(hass, point.timestamp, path.fullDatetime)}`;

  const addDot = (point, opacity) => {
    L.circleMarker(point.point, {
      radius: style.radius,
      color: style.color,
      weight: style.width,
      opacity,
      fillOpacity: opacity,
      interactive: true,
    }).bindTooltip(tooltip(point), { direction: 'top' }).addTo(group);
  };

  const addLine = (latLngs, opacity) => {
    L.polyline(latLngs, {
      color: style.color,
      weight: style.width,
      opacity,
      interactive: false,
    }).addTo(group);
  };

  for (let pointIndex = 0; pointIndex < n - 1; pointIndex++) {
    const opacity = opacityAt(pointIndex);
    const thisPoint = points[pointIndex];
    const nextPoint = points[pointIndex + 1];

    addDot(thisPoint, opacity);

    if (Math.abs(thisPoint.point[1] - nextPoint.point[1]) <= 180) {
      addLine([thisPoint.point, nextPoint.point], opacity);
    } else {
      // Crosses the antimeridian: split into two lines, so it isn't drawn across the whole map.
      const longitudeDifference = ((nextPoint.point[1] - thisPoint.point[1] + 540) % 360) - 180;
      let intersectionLatitude;
      if (longitudeDifference === 0) {
        intersectionLatitude = (thisPoint.point[0] + nextPoint.point[0]) / 2;
      } else {
        intersectionLatitude =
          thisPoint.point[0] +
          ((nextPoint.point[0] - thisPoint.point[0]) *
            (thisPoint.point[1] > 0 ? 180 - thisPoint.point[1] : -180 - thisPoint.point[1])) /
            longitudeDifference;
      }
      const intersectionPoint1 = [intersectionLatitude, thisPoint.point[1] > 0 ? 180 : -180];
      const intersectionPoint2 = [intersectionLatitude, nextPoint.point[1] > 0 ? 180 : -180];
      addLine([thisPoint.point, intersectionPoint1], opacity);
      addLine([intersectionPoint2, nextPoint.point], opacity);
    }
  }
  if (n - 1 >= 0) {
    // End point.
    addDot(points[n - 1], opacityAt(n - 1));
  }

  return group;
}

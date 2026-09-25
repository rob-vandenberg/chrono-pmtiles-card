/**
 * chrono-pmtiles-shields
 */

// --- Version ---------------------------------------------------------------
const MODULE_VERSION = '1.0.103';

// --- Version History ---------------------------------------------------------
// v1.0.103: Shield colors per shield family: Amsterdam S routes (NL:S-road) use shield_fill_nl_s /
//           shield_border_nl_s when set, else shield_fill / shield_border; other shields unchanged.
//           A family without any color set keeps its original look.
// v1.0.102: applyOnewayArrowSdf() now adds a real signed distance field (TinySDF's method, 3 px border)
//           computed from the arrow's alpha, instead of the arrow's own pixels, so the thin stem keeps
//           its width and icon-halo-color works.
// v1.0.101: New applyOnewayArrowSdf(): the one-way "arrow" sprite image becomes an SDF image, so
//           roads_oneway icon-color/icon-halo-color work; default icon-color = the arrow's own color.
// v1.0.100: Split off from chrono-pmtiles-card 0.2.46; code moved unchanged.
//           Full earlier history in the main file.

// Shield sprite names recolored by shield_fill/shield_border or their per-family keys (exhaustive
// for the v4 sprites).
const SHIELD_SPRITE_NAMES = [
  'generic_shield-1char', 'generic_shield-2char', 'generic_shield-3char',
  'generic_shield-4char', 'generic_shield-5char',
  'NL:S-road-1char', 'NL:S-road-2char', 'NL:S-road-3char',
  'NL:S-road-4char', 'NL:S-road-5char',
  'US:I-1char', 'US:I-2char', 'US:I-3char', 'US:I-4char', 'US:I-5char',
];

// Per-family seasoning keys (v1.0.103), keyed by sprite name without "-<n>char"; each color falls
// back to shield_fill/shield_border. Families not listed use shield_fill/shield_border only.
const SHIELD_FAMILY_KEYS = {
  'NL:S-road': { fill: 'shield_fill_nl_s', border: 'shield_border_nl_s' },
};

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

// Fill/border hex for one shield sprite: its family's keys, else shield_fill/shield_border (v1.0.103).
function shieldColorsFor(name, paletteConfig) {
  const familyKeys = SHIELD_FAMILY_KEYS[name.replace(/-\dchar$/, '')];
  return {
    fillHex: (familyKeys && paletteConfig?.[familyKeys.fill]) || paletteConfig?.shield_fill,
    borderHex: (familyKeys && paletteConfig?.[familyKeys.border]) || paletteConfig?.shield_border,
  };
}

// Recolors the shield sprites per shield_fill/shield_border (and per-family keys) via updateImage();
// sprites without any color set are left alone, and it's a no-op if none is set at all.
// Must run after MapLibre's "load"; uses the @1x/@2x sprite MapLibre loaded (same size required).
export async function applyShieldColors(maplibreMap, spriteUrl, theme, paletteConfig) {
  const anySet = SHIELD_SPRITE_NAMES.some((name) => {
    const { fillHex, borderHex } = shieldColorsFor(name, paletteConfig);
    return fillHex || borderHex;
  });
  if (!anySet) return;

  const ref = SHIELD_REFERENCE_COLORS[theme] ?? SHIELD_REFERENCE_COLORS.light;

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
    const { fillHex, borderHex } = shieldColorsFor(name, paletteConfig);
    if (!fillHex && !borderHex) continue; // no color set for this family: keep it as is
    const newFill = hexToRgb(fillHex) ?? ref.fill;
    const newBorder = hexToRgb(borderHex) ?? ref.border;

    const imageData = ctx.getImageData(entry.x, entry.y, entry.width, entry.height);
    recolorShieldPixels(imageData.data, ref.fill, ref.border, newFill, newBorder);
    maplibreMap.updateImage(name, {
      width: entry.width,
      height: entry.height,
      data: imageData.data,
    });
  }
}

// --- One-way arrows (v1.0.101) -------------------------------------------------

// Average color of the most opaque pixels (alpha >= 90% of the maximum) as #rrggbb; null if none.
function averageOpaqueColor(data) {
  let maxAlpha = 0;
  for (let i = 3; i < data.length; i += 4) maxAlpha = Math.max(maxAlpha, data[i]);
  if (maxAlpha === 0) return null;
  const threshold = maxAlpha * 0.9;
  let r = 0, g = 0, b = 0, count = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < threshold) continue;
    r += data[i]; g += data[i + 1]; b += data[i + 2]; count++;
  }
  const hex = (v) => Math.round(v / count).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

// SDF parameters as TinySDF (the generator of MapLibre's label SDFs): border, radius, cutoff (v1.0.102).
const SDF_BUFFER = 3;
const SDF_RADIUS = 8;
const SDF_CUTOFF = 0.25;
const SDF_INF = 1e20;

// TinySDF's lookup table: gamma-corrected, signed squared distance of a partially covered pixel.
const SDF_ALPHA_TABLE = new Float64Array(256);
for (let i = 0; i < 256; i++) {
  const d = 0.5 - Math.pow(i / 255, 1 / 2.2);
  SDF_ALPHA_TABLE[i] = d * Math.abs(d);
}
SDF_ALPHA_TABLE[255] = -SDF_INF;

// Builds a signed distance field (RGBA, SDF in alpha) from an RGBA image's alpha, with SDF_BUFFER
// transparent pixels on each side; same seeding and encoding as TinySDF. Squared distances are
// computed directly (the image is tiny), instead of TinySDF's Felzenszwalb transform.
function buildSdfImage(width, height, data) {
  const w = width + 2 * SDF_BUFFER;
  const h = height + 2 * SDF_BUFFER;
  const len = w * h;
  const gridOuter = new Float64Array(len).fill(SDF_INF);
  const gridInner = new Float64Array(len);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = data[(y * width + x) * 4 + 3];
      if (a === 0) continue;
      const t = SDF_ALPHA_TABLE[a];
      const j = (y + SDF_BUFFER) * w + (x + SDF_BUFFER);
      gridOuter[j] = Math.max(0, t);
      gridInner[j] = Math.max(0, -t);
    }
  }
  // Squared distance transform: min over q of |p - q|^2 + grid[q].
  const transform = (grid) => {
    const out = new Float64Array(len);
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        let best = SDF_INF;
        for (let qy = 0; qy < h; qy++) {
          const dy2 = (py - qy) * (py - qy);
          for (let qx = 0; qx < w; qx++) {
            const g = grid[qy * w + qx];
            if (g >= SDF_INF) continue;
            const v = dy2 + (px - qx) * (px - qx) + g;
            if (v < best) best = v;
          }
        }
        out[py * w + px] = best;
      }
    }
    return out;
  };
  const outer = transform(gridOuter);
  const inner = transform(gridInner);
  const scale = 255 / SDF_RADIUS;
  const base = 255 * (1 - SDF_CUTOFF);
  const sdf = new Uint8ClampedArray(len * 4);
  for (let i = 0; i < len; i++) {
    const d = Math.sqrt(outer[i]) - Math.sqrt(inner[i]);
    sdf[i * 4] = 255;
    sdf[i * 4 + 1] = 255;
    sdf[i * 4 + 2] = 255;
    sdf[i * 4 + 3] = Math.round(base - scale * d);
  }
  return { width: w, height: h, data: sdf };
}

// Replaces the "arrow" sprite image (roads_oneway) with an SDF built from its alpha, so icon-color and
// icon-halo-color apply (the sprite image isn't SDF; updateImage() can't change the flag). Without an
// icon-color in the layer overrides, icon-color is set to the arrow's own color (SDF default: black).
// Must run after MapLibre's "load" (sprite loaded).
export function applyOnewayArrowSdf(maplibreMap, layerOverrides) {
  if (!maplibreMap.hasImage('arrow')) return;
  const image = maplibreMap.getImage('arrow');
  const { width, height, data } = image.data;
  const originalColor = averageOpaqueColor(data);
  const sdfImage = buildSdfImage(width, height, data); // before removeImage(), which releases data

  maplibreMap.removeImage('arrow');
  maplibreMap.addImage('arrow', sdfImage, { pixelRatio: image.pixelRatio, sdf: true });

  const overrideColor = layerOverrides?.roads_oneway?.paint?.['icon-color'];
  if (overrideColor === undefined && originalColor && maplibreMap.getLayer('roads_oneway')) {
    maplibreMap.setPaintProperty('roads_oneway', 'icon-color', originalColor);
  }
}

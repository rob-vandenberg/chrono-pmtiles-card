/**
 * chrono-pmtiles-shields
 */

// --- Version ---------------------------------------------------------------
const MODULE_VERSION = '1.0.100';

// --- Version History ---------------------------------------------------------
// v1.0.100: Split off from chrono-pmtiles-card 0.2.46; code moved unchanged.
//           Full earlier history in the main file.

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
export async function applyShieldColors(maplibreMap, spriteUrl, theme, paletteConfig) {
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

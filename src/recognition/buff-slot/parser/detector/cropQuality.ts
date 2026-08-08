import type { BuffIconBox, ImageLike } from "../types.js";
import { clampInt } from "./math.js";

type CropQuality = {
  sat: number;
  edge: number;
  centerLuma: number;
  centerDark: number;
  centerBright: number;
  dark: number;
  bright: number;
};

const railControlCache = new WeakMap<ImageLike, Map<string, boolean>>();
const damageNumberCache = new WeakMap<ImageLike, Map<string, boolean>>();
const qualityCache = new WeakMap<ImageLike, Map<string, CropQuality>>();
const likelyFrameCache = new WeakMap<ImageLike, Map<string, boolean>>();

function roundedBoxKey(box: BuffIconBox) {
  return `${Math.round(box.x)},${Math.round(box.y)},${Math.round(box.size)}`;
}

function cachedValue<T>(store: WeakMap<ImageLike, Map<string, T>>, image: ImageLike, key: string, compute: () => T) {
  let imageCache = store.get(image);
  if (!imageCache) {
    imageCache = new Map<string, T>();
    store.set(image, imageCache);
  }
  if (imageCache.has(key)) return imageCache.get(key)!;
  const value = compute();
  imageCache.set(key, value);
  return value;
}

export function hasVisibleRightRailControl(image: ImageLike, box: BuffIconBox) {
  const key = roundedBoxKey(box);
  return cachedValue(railControlCache, image, key, () => computeHasVisibleRightRailControl(image, box));
}

function computeHasVisibleRightRailControl(image: ImageLike, box: BuffIconBox) {
  const size = Math.round(box.size);
  const x0 = Math.round(box.x + box.size + Math.max(1, size * 0.08));
  const x1 = Math.min(image.width - 1, x0 + Math.round(Math.max(12, Math.min(42, size * 0.65))));
  const y0 = Math.max(0, Math.round(box.y + size * 0.08));
  const y1 = Math.min(image.height - 1, Math.round(box.y + size * 0.92));
  if (x1 <= x0 || y1 <= y0) return false;

  let dark = 0;
  let bright = 0;
  let edge = 0;
  let count = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const luma = lumaAt(image, x, y);
      dark += luma < 78 ? 1 : 0;
      bright += luma > 148 ? 1 : 0;
      edge += Math.abs(luma - lumaAt(image, x + 1, y)) + Math.abs(luma - lumaAt(image, x, y + 1));
      count++;
    }
  }

  const brightRatio = bright / Math.max(1, count);
  const darkRatio = dark / Math.max(1, count);
  const edgeAvg = edge / Math.max(1, count);
  return brightRatio >= 0.32 && darkRatio <= 0.28 && edgeAvg >= 8;
}

export function isDamageNumberLikeCrop(image: ImageLike, box: BuffIconBox) {
  const key = roundedBoxKey(box);
  return cachedValue(damageNumberCache, image, key, () => computeIsDamageNumberLikeCrop(image, box));
}

function computeIsDamageNumberLikeCrop(image: ImageLike, box: BuffIconBox) {
  const x = Math.round(box.x);
  const y = Math.round(box.y);
  const size = Math.round(box.size);
  const pad = Math.max(2, Math.round(size * 0.16));
  let centerSat = 0;
  let centerEdge = 0;
  let centerCount = 0;

  for (let py = y + pad; py < y + size - pad; py++) {
    for (let px = x + pad; px < x + size - pad; px++) {
      const i = (clampInt(py, 0, image.height - 1) * image.width + clampInt(px, 0, image.width - 1)) * 4;
      const r = image.data[i] ?? 0;
      const g = image.data[i + 1] ?? 0;
      const b = image.data[i + 2] ?? 0;
      centerSat += Math.max(r, g, b) - Math.min(r, g, b);
      centerEdge += Math.abs(lumaAt(image, px, py) - lumaAt(image, px + 1, py)) + Math.abs(lumaAt(image, px, py) - lumaAt(image, px, py + 1));
      centerCount++;
    }
  }

  let borderDark = 0;
  let borderBright = 0;
  let borderCount = 0;
  for (let px = x; px < x + size; px++) {
    for (const py of [y, y + size - 1]) {
      const luma = lumaAt(image, px, py);
      borderDark += luma < 78 ? 1 : 0;
      borderBright += luma > 148 ? 1 : 0;
      borderCount++;
    }
  }
  for (let py = y; py < y + size; py++) {
    for (const px of [x, x + size - 1]) {
      const luma = lumaAt(image, px, py);
      borderDark += luma < 78 ? 1 : 0;
      borderBright += luma > 148 ? 1 : 0;
      borderCount++;
    }
  }

  const sat = centerSat / Math.max(1, centerCount);
  const edge = centerEdge / Math.max(1, centerCount);
  const dark = borderDark / Math.max(1, borderCount);
  const bright = borderBright / Math.max(1, borderCount);
  return sat > 118 && edge < 72 && dark < 0.72 && bright > 0.12;
}

export function isTextOverlayFragment(image: ImageLike, box: BuffIconBox) {
  const quality = cropQuality(image, box);
  return (
    (quality.dark < 0.45 && quality.bright > 0.15) ||
    (quality.sat > 145 && quality.edge < 55 && quality.dark < 0.58) ||
    (quality.edge < 34 && quality.dark < 0.72) ||
    (!hasLikelyBuffFrame(image, box) && quality.edge < 58 && quality.dark < 0.72)
  );
}

export function isSevereTextOverlayPrefix(image: ImageLike, box: BuffIconBox) {
  if (hasNearbyLikelyBuffFrame(image, box)) return false;
  const quality = cropQuality(image, box);
  return (quality.dark < 0.45 && quality.bright > 0.32) || (quality.edge < 24 && quality.dark < 0.72);
}

export function isWeakTextOverlayCompanion(image: ImageLike, box: BuffIconBox) {
  const quality = cropQuality(image, box);
  if (!hasNearbyLikelyBuffFrame(image, box)) return isTextOverlayFragment(image, box);
  return quality.edge < 70 && quality.dark < 0.82;
}

export function isBlankDarkWindowFragment(image: ImageLike, box: BuffIconBox) {
  const quality = cropQuality(image, box);
  return (
    quality.centerLuma < 72 &&
    quality.centerDark > 0.82 &&
    quality.centerBright < 0.1 &&
    quality.sat < 28 &&
    quality.edge < 34
  );
}

export function isFlatDarkEffectFragment(image: ImageLike, box: BuffIconBox) {
  const quality = cropQuality(image, box);
  return quality.centerLuma < 72 && quality.centerDark > 0.9 && quality.centerBright < 0.04 && quality.edge < 18;
}

export function isDamageTextPrefixFragment(image: ImageLike, box: BuffIconBox) {
  if (hasLikelyBuffFrame(image, box)) return false;
  const quality = cropQuality(image, box);
  return quality.dark < 0.38 && quality.bright > 0.16 && quality.sat > 80 && quality.edge < 48;
}

export function hasNearbyLikelyBuffFrame(image: ImageLike, box: BuffIconBox) {
  if (hasLikelyBuffFrame(image, box)) return true;
  for (const dy of [-1, 0, 1]) {
    for (const dx of [-1, 0, 1]) {
      if (dx === 0 && dy === 0) continue;
      if (hasLikelyBuffFrame(image, { ...box, x: box.x + dx, y: box.y + dy })) return true;
    }
  }
  return false;
}

export function cropQuality(image: ImageLike, box: BuffIconBox) {
  const key = roundedBoxKey(box);
  return cachedValue(qualityCache, image, key, () => computeCropQuality(image, box));
}

function computeCropQuality(image: ImageLike, box: BuffIconBox): CropQuality {
  const x = Math.round(box.x);
  const y = Math.round(box.y);
  const size = Math.round(box.size);
  const pad = Math.max(2, Math.round(size * 0.16));
  let centerSat = 0;
  let centerEdge = 0;
  let centerLuma = 0;
  let centerDark = 0;
  let centerBright = 0;
  let centerCount = 0;

  for (let py = y + pad; py < y + size - pad; py++) {
    for (let px = x + pad; px < x + size - pad; px++) {
      const i = (clampInt(py, 0, image.height - 1) * image.width + clampInt(px, 0, image.width - 1)) * 4;
      const r = image.data[i] ?? 0;
      const g = image.data[i + 1] ?? 0;
      const b = image.data[i + 2] ?? 0;
      const luma = lumaAt(image, px, py);
      centerSat += Math.max(r, g, b) - Math.min(r, g, b);
      centerEdge += Math.abs(luma - lumaAt(image, px + 1, py)) + Math.abs(luma - lumaAt(image, px, py + 1));
      centerLuma += luma;
      centerDark += luma < 78 ? 1 : 0;
      centerBright += luma > 148 ? 1 : 0;
      centerCount++;
    }
  }

  let borderDark = 0;
  let borderBright = 0;
  let borderCount = 0;
  for (let px = x; px < x + size; px++) {
    for (const py of [y, y + size - 1]) {
      const luma = lumaAt(image, px, py);
      borderDark += luma < 78 ? 1 : 0;
      borderBright += luma > 148 ? 1 : 0;
      borderCount++;
    }
  }
  for (let py = y; py < y + size; py++) {
    for (const px of [x, x + size - 1]) {
      const luma = lumaAt(image, px, py);
      borderDark += luma < 78 ? 1 : 0;
      borderBright += luma > 148 ? 1 : 0;
      borderCount++;
    }
  }

  return {
    sat: centerSat / Math.max(1, centerCount),
    edge: centerEdge / Math.max(1, centerCount),
    centerLuma: centerLuma / Math.max(1, centerCount),
    centerDark: centerDark / Math.max(1, centerCount),
    centerBright: centerBright / Math.max(1, centerCount),
    dark: borderDark / Math.max(1, borderCount),
    bright: borderBright / Math.max(1, borderCount),
  };
}

export function hasLikelyBuffFrame(image: ImageLike, box: BuffIconBox) {
  const key = roundedBoxKey(box);
  return cachedValue(likelyFrameCache, image, key, () => computeHasLikelyBuffFrame(image, box));
}

function computeHasLikelyBuffFrame(image: ImageLike, box: BuffIconBox) {
  const x = Math.round(box.x);
  const y = Math.round(box.y);
  const size = Math.round(box.size);
  let borderDark = 0;
  let borderCount = 0;
  for (let px = x; px < x + size; px++) {
    for (const py of [y, y + size - 1]) {
      borderDark += lumaAt(image, px, py) < 78 ? 1 : 0;
      borderCount++;
    }
  }
  for (let py = y; py < y + size; py++) {
    for (const px of [x, x + size - 1]) {
      borderDark += lumaAt(image, px, py) < 78 ? 1 : 0;
      borderCount++;
    }
  }

  const pad = Math.max(2, Math.round(size * 0.16));
  let centerSat = 0;
  let centerEdge = 0;
  let centerCount = 0;
  for (let py = y + pad; py < y + size - pad; py++) {
    for (let px = x + pad; px < x + size - pad; px++) {
      const i = (clampInt(py, 0, image.height - 1) * image.width + clampInt(px, 0, image.width - 1)) * 4;
      const r = image.data[i] ?? 0;
      const g = image.data[i + 1] ?? 0;
      const b = image.data[i + 2] ?? 0;
      centerSat += Math.max(r, g, b) - Math.min(r, g, b);
      centerEdge += Math.abs(lumaAt(image, px, py) - lumaAt(image, px + 1, py)) + Math.abs(lumaAt(image, px, py) - lumaAt(image, px, py + 1));
      centerCount++;
    }
  }

  const dark = borderDark / Math.max(1, borderCount);
  const sat = centerSat / Math.max(1, centerCount);
  const edge = centerEdge / Math.max(1, centerCount);
  return dark >= 0.74 && (sat < 125 || edge > 82);
}

export function lumaAt(image: ImageLike, x: number, y: number) {
  const px = clampInt(x, 0, image.width - 1);
  const py = clampInt(y, 0, image.height - 1);
  const i = (py * image.width + px) * 4;
  return ((image.data[i] ?? 0) * 299 + (image.data[i + 1] ?? 0) * 587 + (image.data[i + 2] ?? 0) * 114) / 1000;
}

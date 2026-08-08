const DEFAULT_ICON_SIZE = 32;
const DEFAULT_TIMER_REGION_RATIO = {
  xRatio: 0.05,
  yRatio: 0.48,
  widthRatio: 0.9,
  heightRatio: 0.48,
};

const DEFAULT_OPTIONS = {
  iconSize: DEFAULT_ICON_SIZE,
  alphaThreshold: 1,
  referencePaddingRatio: 0,
  referenceBackgroundMode: "loose-transparent",
  referenceBackgroundFill: [255, 255, 255, 255],
  referenceTransparentRatioThreshold: 0.1,
  detectedInsetRatio: 0.06,
  minDetectedInsetPx: 1,
  maxDetectedInsetRatio: 0.12,
  timerRegionRatio: DEFAULT_TIMER_REGION_RATIO,
};

export function normalizeReferenceIcon(imageData, options = {}) {
  const settings = makeSettings(options);
  assertImageData(imageData);

  const contentBounds = findAlphaBounds(imageData, settings.alphaThreshold) ?? fullBounds(imageData);
  const backgroundFilled = shouldFillReferenceBackground(imageData, settings);
  const sourceImageData = backgroundFilled ? compositeOverBackground(imageData, settings.referenceBackgroundFill) : imageData;
  const fitBounds = backgroundFilled ? fullBounds(imageData) : contentBounds;
  const squareBounds = makeSquareBounds(fitBounds, settings.referencePaddingRatio);
  const resizeOptions = backgroundFilled ? { outOfBoundsPixel: settings.referenceBackgroundFill } : {};
  const resizedIcon = resizeCropBilinear(sourceImageData, squareBounds, settings.iconSize, settings.iconSize, resizeOptions);
  const normalizedIcon = backgroundFilled ? compositeOverBackground(resizedIcon, settings.referenceBackgroundFill) : resizedIcon;

  return {
    normalizedIcon,
    contentBounds,
    fitBounds,
    squareBounds,
    backgroundFilled,
    iconSize: settings.iconSize,
  };
}

export function normalizeDetectedBuffCrop(imageData, box, options = {}) {
  const settings = makeSettings(options);
  assertImageData(imageData);

  const sourceBox = clampBox(box, imageData.width, imageData.height);
  const rawCrop = cropImageData(imageData, sourceBox);
  const sourceSide = Math.max(1, Math.min(sourceBox.width, sourceBox.height));
  const maxInset = Math.max(0, Math.floor(sourceSide * settings.maxDetectedInsetRatio));
  const inset = Number.isFinite(settings.detectedInsetPx)
    ? Math.max(0, Math.round(settings.detectedInsetPx))
    : clamp(Math.round(sourceSide * settings.detectedInsetRatio), settings.minDetectedInsetPx, maxInset);
  const iconBounds = insetBox(sourceBox, inset);
  const normalizedIcon = resizeCropBilinear(imageData, iconBounds, settings.iconSize, settings.iconSize);
  const timerRegion = makeTimerRegion(sourceBox, settings.timerRegionRatio);

  return {
    box,
    sourceBox,
    rawCrop,
    normalizedIcon,
    iconBounds,
    inset,
    timerRegion,
    iconSize: settings.iconSize,
  };
}

export function resizeCropBilinear(imageData, crop, targetWidth, targetHeight, options = {}) {
  assertImageData(imageData);
  const outOfBoundsPixel = normalizeOutOfBoundsPixel(options.outOfBoundsPixel);
  const width = Math.max(1, Math.round(targetWidth));
  const height = Math.max(1, Math.round(targetHeight));
  const data = new Uint8ClampedArray(width * height * 4);
  const scaleX = crop.width / width;
  const scaleY = crop.height / height;

  for (let y = 0; y < height; y += 1) {
    const sourceY = crop.y + (y + 0.5) * scaleY - 0.5;
    for (let x = 0; x < width; x += 1) {
      const sourceX = crop.x + (x + 0.5) * scaleX - 0.5;
      const pixel = sampleBilinear(imageData, sourceX, sourceY, outOfBoundsPixel);
      const offset = (y * width + x) * 4;
      data[offset] = pixel[0];
      data[offset + 1] = pixel[1];
      data[offset + 2] = pixel[2];
      data[offset + 3] = pixel[3];
    }
  }

  return {
    width,
    height,
    data,
  };
}

export function cropImageData(imageData, box) {
  assertImageData(imageData);
  const sourceBox = clampBox(box, imageData.width, imageData.height);
  const data = new Uint8ClampedArray(sourceBox.width * sourceBox.height * 4);

  for (let y = 0; y < sourceBox.height; y += 1) {
    const sourceOffset = ((sourceBox.y + y) * imageData.width + sourceBox.x) * 4;
    const targetOffset = y * sourceBox.width * 4;
    data.set(imageData.data.subarray(sourceOffset, sourceOffset + sourceBox.width * 4), targetOffset);
  }

  return {
    width: sourceBox.width,
    height: sourceBox.height,
    data,
  };
}

export function findAlphaBounds(imageData, alphaThreshold = 1) {
  assertImageData(imageData);
  let minX = imageData.width;
  let minY = imageData.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < imageData.height; y += 1) {
    for (let x = 0; x < imageData.width; x += 1) {
      const alpha = imageData.data[(y * imageData.width + x) * 4 + 3];
      if (alpha < alphaThreshold) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < minX || maxY < minY) return null;

  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

export function compositeOverBackground(imageData, backgroundFill = [255, 255, 255, 255]) {
  assertImageData(imageData);
  const bg = normalizeBackgroundFill(backgroundFill);
  const data = new Uint8ClampedArray(imageData.data.length);

  for (let offset = 0; offset < imageData.data.length; offset += 4) {
    const alpha = imageData.data[offset + 3] / 255;
    data[offset] = Math.round(imageData.data[offset] * alpha + bg[0] * (1 - alpha));
    data[offset + 1] = Math.round(imageData.data[offset + 1] * alpha + bg[1] * (1 - alpha));
    data[offset + 2] = Math.round(imageData.data[offset + 2] * alpha + bg[2] * (1 - alpha));
    data[offset + 3] = bg[3];
  }

  return {
    width: imageData.width,
    height: imageData.height,
    data,
  };
}

export function makeSquareBounds(bounds, paddingRatio = 0) {
  const contentSide = Math.max(bounds.width, bounds.height);
  const padding = Math.max(0, contentSide * paddingRatio);
  const side = contentSide + padding * 2;
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;

  return {
    x: centerX - side / 2,
    y: centerY - side / 2,
    width: side,
    height: side,
  };
}

function makeSettings(options) {
  return {
    ...DEFAULT_OPTIONS,
    ...options,
    timerRegionRatio: {
      ...DEFAULT_TIMER_REGION_RATIO,
      ...(options.timerRegionRatio ?? {}),
    },
  };
}

function shouldFillReferenceBackground(imageData, settings) {
  if (!settings.referenceBackgroundFill || settings.referenceBackgroundMode === "never") return false;
  const transparentRatio = getTransparentPixelRatio(imageData, settings.alphaThreshold);
  if (settings.referenceBackgroundMode === "always") return transparentRatio > 0;
  if (settings.referenceBackgroundMode !== "loose-transparent") {
    throw new RangeError(`Unsupported referenceBackgroundMode: ${settings.referenceBackgroundMode}`);
  }
  return transparentRatio >= settings.referenceTransparentRatioThreshold;
}

function getTransparentPixelRatio(imageData, alphaThreshold) {
  let transparentPixels = 0;
  for (let offset = 3; offset < imageData.data.length; offset += 4) {
    if (imageData.data[offset] < 255 - alphaThreshold + 1) transparentPixels += 1;
  }
  return transparentPixels / (imageData.width * imageData.height);
}

function normalizeBackgroundFill(backgroundFill) {
  if (!Array.isArray(backgroundFill) || backgroundFill.length < 3) {
    throw new TypeError("referenceBackgroundFill must be an RGB or RGBA array.");
  }
  return [
    clamp(Math.round(backgroundFill[0]), 0, 255),
    clamp(Math.round(backgroundFill[1]), 0, 255),
    clamp(Math.round(backgroundFill[2]), 0, 255),
    clamp(Math.round(backgroundFill[3] ?? 255), 0, 255),
  ];
}

function sampleBilinear(imageData, x, y, outOfBoundsPixel) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const tx = x - x0;
  const ty = y - y0;
  const p00 = getPixel(imageData, x0, y0, outOfBoundsPixel);
  const p10 = getPixel(imageData, x1, y0, outOfBoundsPixel);
  const p01 = getPixel(imageData, x0, y1, outOfBoundsPixel);
  const p11 = getPixel(imageData, x1, y1, outOfBoundsPixel);
  const result = [];

  for (let channel = 0; channel < 4; channel += 1) {
    const top = p00[channel] * (1 - tx) + p10[channel] * tx;
    const bottom = p01[channel] * (1 - tx) + p11[channel] * tx;
    result[channel] = Math.round(top * (1 - ty) + bottom * ty);
  }

  return result;
}

function getPixel(imageData, x, y, outOfBoundsPixel) {
  if (x < 0 || y < 0 || x >= imageData.width || y >= imageData.height) {
    return outOfBoundsPixel;
  }
  const offset = (y * imageData.width + x) * 4;
  return [
    imageData.data[offset],
    imageData.data[offset + 1],
    imageData.data[offset + 2],
    imageData.data[offset + 3],
  ];
}

function normalizeOutOfBoundsPixel(pixel) {
  if (!pixel) return [0, 0, 0, 0];
  return normalizeBackgroundFill(pixel);
}

function clampBox(box, frameWidth, frameHeight) {
  const x = clamp(Math.round(box.x), 0, Math.max(0, frameWidth - 1));
  const y = clamp(Math.round(box.y), 0, Math.max(0, frameHeight - 1));
  const right = clamp(Math.round(box.x + box.width), x + 1, frameWidth);
  const bottom = clamp(Math.round(box.y + box.height), y + 1, frameHeight);
  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
  };
}

function insetBox(box, inset) {
  const maxInsetX = Math.max(0, Math.floor((box.width - 1) / 2));
  const maxInsetY = Math.max(0, Math.floor((box.height - 1) / 2));
  const appliedInset = Math.min(inset, maxInsetX, maxInsetY);
  return {
    x: box.x + appliedInset,
    y: box.y + appliedInset,
    width: Math.max(1, box.width - appliedInset * 2),
    height: Math.max(1, box.height - appliedInset * 2),
  };
}

function makeTimerRegion(box, ratio) {
  const x = box.x + box.width * ratio.xRatio;
  const y = box.y + box.height * ratio.yRatio;
  const width = box.width * ratio.widthRatio;
  const height = box.height * ratio.heightRatio;
  return {
    ...ratio,
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };
}

function fullBounds(imageData) {
  return {
    x: 0,
    y: 0,
    width: imageData.width,
    height: imageData.height,
  };
}

function assertImageData(imageData) {
  if (!imageData || !Number.isFinite(imageData.width) || !Number.isFinite(imageData.height) || !imageData.data) {
    throw new TypeError("Expected an ImageData-like object with width, height, and data.");
  }
  if (imageData.data.length < imageData.width * imageData.height * 4) {
    throw new RangeError("ImageData-like data is shorter than width * height * 4.");
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

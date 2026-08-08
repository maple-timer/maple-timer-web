import { clamp } from "./geometry.js?v=row-detector-v3-20260524";

export function buildFeatures(imageData, roi) {
  const frameWidth = imageData.width;
  const frameHeight = imageData.height;
  const sourceData = imageData.data;
  const originX = clamp(Math.floor(roi.x), 0, frameWidth - 1);
  const originY = clamp(Math.floor(roi.y), 0, frameHeight - 1);
  const width = clamp(Math.floor(roi.width), 1, frameWidth - originX);
  const height = clamp(Math.floor(roi.height), 1, frameHeight - originY);
  const luma = new Uint8Array(width * height);
  const dark = new Uint8Array(width * height);
  const borderDark = new Uint8Array(width * height);
  const midDark = new Uint8Array(width * height);
  const softDark = new Uint8Array(width * height);
  const edge = new Uint8Array(width * height);

  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    const sourceRow = (originY + y) * frameWidth;
    for (let x = 0; x < width; x += 1) {
      const offset = (sourceRow + originX + x) * 4;
      const value = Math.round(sourceData[offset] * 0.299 + sourceData[offset + 1] * 0.587 + sourceData[offset + 2] * 0.114);
      luma[row + x] = value;
      dark[row + x] = value < 82 && sourceData[offset + 3] > 24 ? 1 : 0;
      borderDark[row + x] = value < 115 && sourceData[offset + 3] > 24 ? 1 : 0;
      midDark[row + x] = value < 150 && sourceData[offset + 3] > 24 ? 1 : 0;
      softDark[row + x] = value < 180 && sourceData[offset + 3] > 24 ? 1 : 0;
    }
  }

  for (let y = 1; y < height - 1; y += 1) {
    const row = y * width;
    for (let x = 1; x < width - 1; x += 1) {
      const gx = Math.abs(luma[row + x + 1] - luma[row + x - 1]);
      const gy = Math.abs(luma[row + width + x] - luma[row - width + x]);
      edge[row + x] = Math.min(255, gx + gy);
    }
  }

  return {
    width,
    height,
    frameWidth,
    frameHeight,
    originX,
    originY,
    roi: {
      x: 0,
      y: 0,
      width,
      height,
    },
    luma,
    dark,
    borderDark,
    midDark,
    softDark,
    edge,
    lumaIntegral: makeIntegral(luma, width, height),
    darkIntegral: makeIntegral(dark, width, height),
    borderDarkIntegral: makeIntegral(borderDark, width, height),
    midDarkIntegral: makeIntegral(midDark, width, height),
    softDarkIntegral: makeIntegral(softDark, width, height),
    edgeIntegral: makeIntegral(edge, width, height),
  };
}

export function makeIntegral(values, width, height) {
  const integral = new Uint32Array((width + 1) * (height + 1));
  for (let y = 1; y <= height; y += 1) {
    let rowSum = 0;
    const sourceRow = (y - 1) * width;
    const targetRow = y * (width + 1);
    const previousRow = (y - 1) * (width + 1);
    for (let x = 1; x <= width; x += 1) {
      rowSum += values[sourceRow + x - 1];
      integral[targetRow + x] = integral[previousRow + x] + rowSum;
    }
  }
  return integral;
}

export function rectSum(integral, stride, x, y, width, height) {
  const x1 = clamp(Math.floor(x), 0, stride - 1);
  const y1 = clamp(Math.floor(y), 0, Math.floor(integral.length / stride) - 1);
  const x2 = clamp(Math.floor(x + width), 0, stride - 1);
  const y2 = clamp(Math.floor(y + height), 0, Math.floor(integral.length / stride) - 1);
  return integral[y2 * stride + x2] - integral[y1 * stride + x2] - integral[y2 * stride + x1] + integral[y1 * stride + x1];
}

export function rectMean(integral, stride, x, y, width, height) {
  const area = Math.max(1, Math.floor(width) * Math.floor(height));
  return rectSum(integral, stride, x, y, width, height) / area;
}

export function getPixelLuma(features, x, y) {
  const px = clamp(Math.round(x), 0, features.width - 1);
  const py = clamp(Math.round(y), 0, features.height - 1);
  return features.luma[py * features.width + px];
}

export function isDarkAt(features, x, y) {
  const px = clamp(Math.round(x), 0, features.width - 1);
  const py = clamp(Math.round(y), 0, features.height - 1);
  return features.dark[py * features.width + px] === 1;
}

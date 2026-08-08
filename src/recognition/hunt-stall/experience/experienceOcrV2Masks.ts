export type ExperienceOcrV2MaskSource = {
  mode: string;
  mask: Uint8Array;
  width: number;
  height: number;
};

export type ExperienceOcrV2Band = { startY: number; endY: number; sum: number };

export function createExperienceOcrV2MaskSources(imageData: ImageData): ExperienceOcrV2MaskSource[] {
  const sources: ExperienceOcrV2MaskSource[] = [];
  for (const mode of [
    "neutral",
    "loose",
    "local_dark",
    "contrast",
    "bright",
    "colored_dark60",
    "colored_dark70",
    "colored_dark80",
    "colored_dark90",
  ]) {
    sources.push({
      mode,
      mask: makeExperienceOcrV2Mask(imageData, mode),
      width: imageData.width,
      height: imageData.height,
    });
  }

  const repainted = repaintColoredBackground(imageData);
  if (repainted) {
    for (const mode of ["bright", "neutral"]) {
      sources.push({
        mode: `repaint:${mode}`,
        mask: makeExperienceOcrV2Mask(repainted, mode),
        width: repainted.width,
        height: repainted.height,
      });
    }
  }

  const barRepainted = repaintBarBackground(imageData);
  if (barRepainted) {
    for (const mode of ["bright", "neutral"]) {
      sources.push({
        mode: `bar_repaint:${mode}`,
        mask: makeExperienceOcrV2Mask(barRepainted, mode),
        width: barRepainted.width,
        height: barRepainted.height,
      });
    }
  }

  return sources;
}

export function makeExperienceOcrV2Mask(imageData: ImageData, mode: string): Uint8Array {
  if (mode.startsWith("colored_dark")) {
    return coloredBackgroundMask(imageData, Number(mode.replace("colored_dark", "")));
  }

  const { width, height, data } = imageData;
  const gray = makeGray(imageData);
  const localMin = mode === "local_dark" || mode === "contrast" ? localExtreme(gray, width, height, 2, "min") : null;
  const localMax = mode === "contrast" ? localExtreme(gray, width, height, 1, "max") : null;
  const mask = new Uint8Array(width * height);

  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    const red = data[offset];
    const green = data[offset + 1];
    const blue = data[offset + 2];
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const saturation = max - min;
    const total = red + green + blue;
    let keep = false;

    if (mode === "neutral") {
      keep = max > 145 && saturation < 85 && total > 420;
    } else if (mode === "loose") {
      keep = max > 120 && saturation < 130 && total > 350;
    } else if (mode === "local_dark") {
      keep = max > 105 && saturation < 160 && total > 310 && (localMin?.[index] ?? 255) < 135;
    } else if (mode === "contrast") {
      const value = gray[index];
      keep =
        value - (localMin?.[index] ?? value) > 35 ||
        ((localMax?.[index] ?? value) - value > 35 && (localMax?.[index] ?? 0) > 130);
    } else if (mode === "bright") {
      keep = max > 165 && saturation < 140 && total > 420;
    }

    mask[index] = keep ? 1 : 0;
  }

  return mask;
}

export function findExperienceOcrV2RowBands(
  mask: Uint8Array,
  width: number,
  height: number,
  thresholdRatio: number,
): ExperienceOcrV2Band[] {
  const rowSums = new Array<number>(height).fill(0);
  let maxSum = 0;
  for (let y = 0; y < height; y += 1) {
    let sum = 0;
    for (let x = 0; x < width; x += 1) {
      sum += mask[y * width + x];
    }
    rowSums[y] = sum;
    maxSum = Math.max(maxSum, sum);
  }
  if (maxSum === 0) {
    return [];
  }

  const bands: ExperienceOcrV2Band[] = [];
  let start: number | null = null;
  for (let y = 0; y < height; y += 1) {
    const active = rowSums[y] > Math.max(1, maxSum * thresholdRatio);
    if (active && start === null) {
      start = y;
    }
    if (start !== null && (!active || y === height - 1)) {
      const end = active && y === height - 1 ? y + 1 : y;
      if (end - start >= 2) {
        bands.push({
          startY: start,
          endY: end,
          sum: rowSums.slice(start, end).reduce((total, item) => total + item, 0),
        });
      }
      start = null;
    }
  }
  return bands;
}

export function findExperienceOcrV2ColoredTextBands(
  mask: Uint8Array,
  width: number,
  height: number,
): ExperienceOcrV2Band[] {
  const rowSums = new Array<number>(height).fill(0);
  let maxSum = 0;
  for (let y = 0; y < height; y += 1) {
    let sum = 0;
    for (let x = 0; x < width; x += 1) {
      sum += mask[y * width + x];
    }
    rowSums[y] = sum;
    maxSum = Math.max(maxSum, sum);
  }
  if (maxSum === 0) {
    return [];
  }

  const bands: ExperienceOcrV2Band[] = [];
  let start: number | null = null;
  for (let y = 0; y < height; y += 1) {
    const active = rowSums[y] > Math.max(4, maxSum * 0.03) && rowSums[y] < width * 0.25;
    if (active && start === null) {
      start = y;
    }
    if (start !== null && (!active || y === height - 1)) {
      const end = active && y === height - 1 ? y + 1 : y;
      if (end - start >= 4) {
        for (const [y0, y1] of [
          [start, end],
          [start + 1, end],
          [start + 2, end - 1],
          [start + 3, end - 1],
          [start + 2, end],
          [start + 1, end - 1],
        ]) {
          if (y1 - y0 >= 4) {
            bands.push({
              startY: y0,
              endY: y1,
              sum: rowSums.slice(y0, y1).reduce((total, item) => total + item, 0),
            });
          }
        }
      }
      start = null;
    }
  }
  return bands;
}

export function findExperienceOcrV2RepaintTextBands(
  mask: Uint8Array,
  width: number,
  height: number,
): ExperienceOcrV2Band[] {
  const rowSums = new Array<number>(height).fill(0);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      rowSums[y] += mask[y * width + x];
    }
  }

  const bands: ExperienceOcrV2Band[] = [];
  for (const band of findExperienceOcrV2ColoredTextBands(mask, width, height)) {
    for (const [y0, y1] of [
      [band.startY, band.endY],
      [Math.max(0, band.startY - 4), Math.max(band.startY + 4, band.endY - 7)],
      [Math.max(0, band.startY - 4), Math.max(band.startY + 4, band.endY - 6)],
      [Math.max(0, band.startY - 5), Math.max(band.startY + 4, band.endY - 7)],
      [Math.max(0, band.startY - 6), Math.max(band.startY + 4, band.endY - 6)],
    ]) {
      if (y1 - y0 >= 4 && y1 - y0 <= 45) {
        bands.push({
          startY: y0,
          endY: y1,
          sum: rowSums.slice(y0, y1).reduce((total, item) => total + item, 0),
        });
      }
    }
  }
  return bands;
}

export function maskToExperienceOcrV2ImageData(mask: Uint8Array, width: number, height: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    const value = mask[index] ? 255 : 0;
    const offset = index * 4;
    data[offset] = value;
    data[offset + 1] = value;
    data[offset + 2] = value;
    data[offset + 3] = 255;
  }
  return new ImageData(data, width, height);
}

function coloredBackgroundMask(imageData: ImageData, darkThreshold: number): Uint8Array {
  const { width, height, data } = imageData;
  const mask = new Uint8Array(width * height);
  const coloredIndexes: number[] = [];

  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    const red = data[offset];
    const green = data[offset + 1];
    const blue = data[offset + 2];
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const saturation = max - min;
    const total = red + green + blue;
    if (max > 145 && saturation < 135 && total > 365) {
      mask[index] = 1;
    }
    if (
      max > 170 &&
      saturation > 80 &&
      ((green >= red - 30 && green > blue + 55) || (red >= green - 30 && red > blue + 55))
    ) {
      coloredIndexes.push(index);
    }
  }

  if (coloredIndexes.length < 20) {
    return mask;
  }

  const dominant = getDominantQuantizedColor(data, coloredIndexes);
  const close = new Uint8Array(width * height);
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    const distance = Math.sqrt(
      (data[offset] - dominant[0]) ** 2 +
        (data[offset + 1] - dominant[1]) ** 2 +
        (data[offset + 2] - dominant[2]) ** 2,
    );
    close[index] = distance < 45 ? 1 : 0;
  }

  const rows: number[] = [];
  for (let y = 0; y < height; y += 1) {
    let count = 0;
    for (let x = 0; x < width; x += 1) {
      count += close[y * width + x];
    }
    if (count > Math.max(5, width * 0.05)) {
      rows.push(y);
    }
  }
  if (rows.length === 0) {
    return mask;
  }

  const y0 = Math.max(0, Math.min(...rows) - 2);
  const y1 = Math.min(height, Math.max(...rows) + 3);
  const cols: number[] = [];
  for (let x = 0; x < width; x += 1) {
    let count = 0;
    for (let y = y0; y < y1; y += 1) {
      count += close[y * width + x];
    }
    if (count > Math.max(2, (y1 - y0) * 0.2)) {
      cols.push(x);
    }
  }
  if (cols.length === 0) {
    return mask;
  }

  const x0 = Math.max(0, Math.min(...cols) - 3);
  const x1 = Math.min(width, Math.max(...cols) + 4);
  const gray = makeGray(imageData);
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const index = y * width + x;
      if (gray[index] < darkThreshold) {
        mask[index] = 1;
      }
    }
  }

  return mask;
}

function repaintColoredBackground(imageData: ImageData): ImageData | null {
  const { width, height, data } = imageData;
  const output = new Uint8ClampedArray(data);
  let count = 0;

  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    const red = data[offset];
    const green = data[offset + 1];
    const blue = data[offset + 2];
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const saturation = max - min;
    const yellowGreen = green > 95 && red > 70 && blue < 110 && green > blue + 30 && red > blue + 25 && saturation > 45;
    const pink = red > 130 && blue > 80 && green < 180 && red > green + 25 && blue > green + 15 && saturation > 45;
    if (yellowGreen || pink) {
      output[offset] = 38;
      output[offset + 1] = 48;
      output[offset + 2] = 52;
      count += 1;
    }
  }

  return count >= 20 ? new ImageData(output, width, height) : null;
}

function repaintBarBackground(imageData: ImageData): ImageData | null {
  if (imageData.height > 45 || imageData.width > 980) {
    return null;
  }
  const { width, height, data } = imageData;
  const output = new Uint8ClampedArray(data);
  let count = 0;

  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    const red = data[offset];
    const green = data[offset + 1];
    const blue = data[offset + 2];
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const saturation = max - min;
    const total = red + green + blue;
    const textLike = (max > 155 && saturation < 95 && total > 410) || (max > 135 && saturation < 70 && total > 365);
    const yellowGreen = green > 90 && red > 65 && blue < 135 && green > blue + 22 && red > blue + 18 && saturation > 30;
    const pink = red > 125 && blue > 75 && green < 185 && red > green + 20 && blue > green + 10 && saturation > 35;
    const grayOverlay = saturation < 42 && max > 75 && max < 185 && total > 210 && total < 520;
    if ((yellowGreen || pink || grayOverlay) && !textLike) {
      output[offset] = 35;
      output[offset + 1] = 44;
      output[offset + 2] = 50;
      count += 1;
    }
  }

  return count >= 16 ? new ImageData(output, width, height) : null;
}

function getDominantQuantizedColor(data: Uint8ClampedArray, indexes: number[]): [number, number, number] {
  const counts = new Map<string, number>();
  for (const index of indexes) {
    const offset = index * 4;
    const key = `${Math.floor(data[offset] / 16)},${Math.floor(data[offset + 1] / 16)},${Math.floor(data[offset + 2] / 16)}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let bestKey = "0,0,0";
  let bestCount = 0;
  for (const [key, count] of counts) {
    if (count > bestCount) {
      bestKey = key;
      bestCount = count;
    }
  }
  const [red, green, blue] = bestKey.split(",").map((value) => Number(value) * 16 + 8);
  return [red, green, blue];
}

function makeGray(imageData: ImageData): Int16Array {
  const gray = new Int16Array(imageData.width * imageData.height);
  for (let index = 0; index < gray.length; index += 1) {
    const offset = index * 4;
    gray[index] = Math.round(
      imageData.data[offset] * 0.299 + imageData.data[offset + 1] * 0.587 + imageData.data[offset + 2] * 0.114,
    );
  }
  return gray;
}

function localExtreme(
  gray: Int16Array,
  width: number,
  height: number,
  radius: number,
  mode: "min" | "max",
): Int16Array {
  const output = new Int16Array(gray.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let value = mode === "min" ? 255 : 0;
      for (let dy = -radius; dy <= radius; dy += 1) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) {
          continue;
        }
        for (let dx = -radius; dx <= radius; dx += 1) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) {
            continue;
          }
          const item = gray[yy * width + xx];
          value = mode === "min" ? Math.min(value, item) : Math.max(value, item);
        }
      }
      output[y * width + x] = value;
    }
  }
  return output;
}

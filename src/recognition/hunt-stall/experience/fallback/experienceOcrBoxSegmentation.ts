import type { DigitBox } from "../../../template-digit/segmentation";

export function mergeOverlappingExperienceBoxes(boxes: DigitBox[]): DigitBox[] {
  return boxes
    .slice()
    .sort((a, b) => a.x - b.x)
    .reduce<DigitBox[]>((merged, box) => {
      const last = merged[merged.length - 1];
      if (!last || box.x > last.x + last.width) {
        merged.push({ ...box });
        return merged;
      }

      const minX = Math.min(last.x, box.x);
      const minY = Math.min(last.y, box.y);
      const maxX = Math.max(last.x + last.width, box.x + box.width);
      const maxY = Math.max(last.y + last.height, box.y + box.height);
      last.x = minX;
      last.y = minY;
      last.width = maxX - minX;
      last.height = maxY - minY;
      return merged;
    }, []);
}

export function splitWideExperienceBoxes(imageData: ImageData, boxes: DigitBox[]): DigitBox[] {
  return boxes
    .flatMap((box) => splitWideExperienceBox(imageData, box))
    .sort((a, b) => a.x - b.x);
}

export function splitWideExperienceBox(imageData: ImageData, box: DigitBox): DigitBox[] {
  const maxSingleGlyphWidth = Math.max(18, box.height * 1.25);
  if (box.width <= maxSingleGlyphWidth) {
    return [box];
  }

  const cut = findExperienceBoxSplitColumn(imageData, box);
  if (cut === null) {
    return [box];
  }

  const left = trimExperienceBox(imageData, {
    x: box.x,
    y: box.y,
    width: cut - box.x,
    height: box.height,
  });
  const right = trimExperienceBox(imageData, {
    x: cut + 1,
    y: box.y,
    width: box.x + box.width - cut - 1,
    height: box.height,
  });

  if (!left || !right) {
    return [box];
  }

  return [
    ...splitWideExperienceBox(imageData, left),
    ...splitWideExperienceBox(imageData, right),
  ];
}

export function findExperienceBoxSplitColumn(imageData: ImageData, box: DigitBox): number | null {
  const minPartWidth = Math.max(5, Math.round(box.height * 0.28));
  const startX = box.x + minPartWidth;
  const endX = box.x + box.width - minPartWidth;
  if (startX >= endX) {
    return null;
  }

  const columnCounts: number[] = [];
  for (let x = box.x; x < box.x + box.width; x += 1) {
    let count = 0;
    for (let y = box.y; y < box.y + box.height; y += 1) {
      if (imageData.data[(y * imageData.width + x) * 4] > 0) {
        count += 1;
      }
    }
    columnCounts.push(count);
  }

  let bestColumn: number | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  const center = box.x + box.width / 2;

  for (let x = startX; x <= endX; x += 1) {
    const localIndex = x - box.x;
    const smoothed =
      (columnCounts[localIndex - 1] ?? columnCounts[localIndex]) +
      columnCounts[localIndex] +
      (columnCounts[localIndex + 1] ?? columnCounts[localIndex]);
    const centerPenalty = Math.abs(x - center) / Math.max(1, box.width);
    const score = smoothed + centerPenalty;

    if (score < bestScore) {
      bestScore = score;
      bestColumn = x;
    }
  }

  if (bestColumn === null) {
    return null;
  }

  const localIndex = bestColumn - box.x;
  const valleyCount = columnCounts[localIndex];
  const averageCount =
    columnCounts.reduce((total, count) => total + count, 0) / Math.max(1, columnCounts.length);
  if (valleyCount > Math.max(2, averageCount * 0.55)) {
    return null;
  }

  return bestColumn;
}

export function trimExperienceBox(imageData: ImageData, box: DigitBox): DigitBox | null {
  let minX = box.x + box.width;
  let minY = box.y + box.height;
  let maxX = box.x - 1;
  let maxY = box.y - 1;

  for (let y = box.y; y < box.y + box.height; y += 1) {
    for (let x = box.x; x < box.x + box.width; x += 1) {
      if (imageData.data[(y * imageData.width + x) * 4] === 0) {
        continue;
      }

      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < minX || maxY < minY) {
    return null;
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

export function normalizeExperienceBoxToBitmap(
  imageData: ImageData,
  box: DigitBox,
  targetWidth = 9,
  targetHeight = 13,
  inkThreshold = 0.16,
): string[] {
  const rows: string[] = [];

  for (let gy = 0; gy < targetHeight; gy += 1) {
    let row = "";
    for (let gx = 0; gx < targetWidth; gx += 1) {
      const startX = Math.floor(box.x + (gx / targetWidth) * box.width);
      const endX = Math.max(
        startX + 1,
        Math.floor(box.x + ((gx + 1) / targetWidth) * box.width),
      );
      const startY = Math.floor(box.y + (gy / targetHeight) * box.height);
      const endY = Math.max(
        startY + 1,
        Math.floor(box.y + ((gy + 1) / targetHeight) * box.height),
      );
      let ink = 0;
      let total = 0;

      for (let y = startY; y < endY; y += 1) {
        for (let x = startX; x < endX; x += 1) {
          total += 1;
          if (imageData.data[(y * imageData.width + x) * 4] > 0) {
            ink += 1;
          }
        }
      }

      row += ink / Math.max(1, total) > inkThreshold ? "1" : "0";
    }
    rows.push(row);
  }

  return rows;
}

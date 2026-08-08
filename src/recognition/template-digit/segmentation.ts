export type DigitBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function countForegroundPixels(imageData: ImageData): number {
  let count = 0;
  for (let index = 0; index < imageData.data.length; index += 4) {
    if (imageData.data[index] > 0) {
      count++;
    }
  }
  return count;
}

export function segmentDigitBoxes(imageData: ImageData): DigitBox[] {
  const { width, height } = imageData;
  const minHeight = Math.max(3, height * 0.2);
  const rawCandidates = findForegroundComponents(imageData)
    .filter((box) => box.width >= 2 && box.height >= minHeight)
    .filter((box) => !isFrameLikeComponent(box, width, height))
    .sort((a, b) => a.x - b.x);
  const candidates = removeDominantEdgeNoise(rawCandidates, width, height);

  return selectTopDigitRow(candidates, height);
}

export function findForegroundComponents(imageData: ImageData): DigitBox[] {
  const { width, height, data } = imageData;
  const visited = new Uint8Array(width * height);
  const boxes: DigitBox[] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const startIndex = y * width + x;
      if (visited[startIndex] || data[startIndex * 4] === 0) {
        continue;
      }

      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      const stack = [startIndex];
      visited[startIndex] = 1;

      while (stack.length > 0) {
        const current = stack.pop() ?? 0;
        const currentX = current % width;
        const currentY = Math.floor(current / width);

        minX = Math.min(minX, currentX);
        maxX = Math.max(maxX, currentX);
        minY = Math.min(minY, currentY);
        maxY = Math.max(maxY, currentY);

        const neighbors = [
          currentX > 0 ? current - 1 : -1,
          currentX < width - 1 ? current + 1 : -1,
          currentY > 0 ? current - width : -1,
          currentY < height - 1 ? current + width : -1,
          currentX > 0 && currentY > 0 ? current - width - 1 : -1,
          currentX < width - 1 && currentY > 0 ? current - width + 1 : -1,
          currentX > 0 && currentY < height - 1 ? current + width - 1 : -1,
          currentX < width - 1 && currentY < height - 1 ? current + width + 1 : -1,
        ];

        for (const neighbor of neighbors) {
          if (neighbor < 0 || visited[neighbor] || data[neighbor * 4] === 0) {
            continue;
          }

          visited[neighbor] = 1;
          stack.push(neighbor);
        }
      }

      boxes.push({
        x: minX,
        y: minY,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
      });
    }
  }

  return boxes;
}

export function selectTopDigitRow(boxes: DigitBox[], imageHeight: number): DigitBox[] {
  if (boxes.length <= 1) {
    return boxes;
  }

  const top = Math.min(...boxes.map((box) => box.y));
  const rowTolerance = Math.max(2, Math.round(imageHeight * 0.12));
  return boxes.filter((box) => box.y <= top + rowTolerance);
}

function isFrameLikeComponent(box: DigitBox, imageWidth: number, imageHeight: number): boolean {
  const touchesTopEdge = box.y <= 1;
  const touchesHorizontalEdge = box.x <= 1 || box.x + box.width >= imageWidth - 1;
  const spansMostWidth = box.width >= imageWidth * 0.62;
  const isWide = box.width / Math.max(1, box.height) >= 1.75;
  const isUpperDecoration = box.y + box.height <= imageHeight * 0.52;

  return touchesTopEdge && touchesHorizontalEdge && spansMostWidth && isWide && isUpperDecoration;
}

function removeDominantEdgeNoise(
  boxes: DigitBox[],
  imageWidth: number,
  imageHeight: number,
): DigitBox[] {
  const hasPlausibleDigit = boxes.some((box) =>
    isPlausibleCooldownDigitComponent(box, imageWidth, imageHeight),
  );

  if (!hasPlausibleDigit) {
    return boxes;
  }

  return boxes.filter(
    (box) => !isDominantSkillIconEdgeComponent(box, imageWidth, imageHeight),
  );
}

function isPlausibleCooldownDigitComponent(
  box: DigitBox,
  imageWidth: number,
  imageHeight: number,
): boolean {
  const widthRatio = box.width / imageWidth;
  const heightRatio = box.height / imageHeight;
  const aspectRatio = box.width / Math.max(1, box.height);

  return (
    box.y > imageHeight * 0.18 &&
    widthRatio >= 0.06 &&
    widthRatio <= 0.32 &&
    heightRatio >= 0.18 &&
    heightRatio <= 0.48 &&
    aspectRatio >= 0.32 &&
    aspectRatio <= 1.15
  );
}

function isDominantSkillIconEdgeComponent(
  box: DigitBox,
  imageWidth: number,
  imageHeight: number,
): boolean {
  const touchesTopEdge = box.y <= 1;
  const touchesHorizontalEdge = box.x <= 1 || box.x + box.width >= imageWidth - 1;
  const spansMostWidth = box.width >= imageWidth * 0.62;
  const extendsIntoDigitArea = box.height >= imageHeight * 0.45;
  const doesNotFillWholeCrop = box.height <= imageHeight * 0.86;

  return (
    touchesTopEdge &&
    touchesHorizontalEdge &&
    spansMostWidth &&
    extendsIntoDigitArea &&
    doesNotFillWholeCrop
  );
}

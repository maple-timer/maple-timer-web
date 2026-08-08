import {
  findForegroundComponents,
  type DigitBox,
} from "../../../template-digit/segmentation";

export function preprocessExperienceImageData(source: ImageData): ImageData {
  const preliminary = new ImageData(source.width, source.height);
  const input = source.data;
  const data = preliminary.data;

  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const index = (y * source.width + x) * 4;
      const red = input[index];
      const green = input[index + 1];
      const blue = input[index + 2];
      const alpha = input[index + 3];
      const isTextPixel = isExperienceTextPixel(red, green, blue);
      const value =
        alpha > 24 &&
        ((isTextPixel &&
          (hasNearbyDarkOutline(source, x, y) ||
            hasNearbyExperienceBarFillContrast(source, x, y))) ||
          (isExperienceTextStrokePixel(red, green, blue) &&
            hasNearbyExperienceBarFillContrast(source, x, y) &&
            hasNearbyExperienceTextHighlight(source, x, y)))
          ? 255
          : 0;

      data[index] = value;
      data[index + 1] = value;
      data[index + 2] = value;
      data[index + 3] = 255;
    }
  }

  return keepExperienceTextComponents(preliminary);
}

function keepExperienceTextComponents(imageData: ImageData): ImageData {
  const output = new ImageData(imageData.width, imageData.height);
  const textLikeBoxes = findForegroundComponents(imageData).filter((box) =>
    isExperienceTextComponent(box, imageData.width, imageData.height),
  );
  const selectedBoxes = selectDominantExperienceTextRow(textLikeBoxes, imageData.height);

  for (const box of selectedBoxes) {
    for (let y = box.y; y < box.y + box.height; y += 1) {
      for (let x = box.x; x < box.x + box.width; x += 1) {
        const index = (y * imageData.width + x) * 4;
        if (imageData.data[index] === 0) {
          continue;
        }
        output.data[index] = 255;
        output.data[index + 1] = 255;
        output.data[index + 2] = 255;
        output.data[index + 3] = 255;
      }
    }
  }

  for (let index = 3; index < output.data.length; index += 4) {
    output.data[index] = 255;
  }

  return output;
}

export function isExperienceTextComponent(
  box: DigitBox,
  imageWidth: number,
  imageHeight: number,
): boolean {
  const area = box.width * box.height;
  return (
    box.height >= Math.max(2, imageHeight * 0.08) &&
    box.height <= imageHeight * 0.9 &&
    box.width <= Math.max(16, imageWidth * 0.12) &&
    area <= imageWidth * imageHeight * 0.08
  );
}

export function selectDominantExperienceTextRow(
  boxes: DigitBox[],
  imageHeight: number,
): DigitBox[] {
  if (boxes.length <= 2) {
    return boxes;
  }

  const centers = boxes.map((box) => box.y + box.height / 2).sort((a, b) => a - b);
  const medianCenter = centers[Math.floor(centers.length / 2)];
  const tolerance = Math.max(3, imageHeight * 0.28);

  return boxes.filter((box) => Math.abs(box.y + box.height / 2 - medianCenter) <= tolerance);
}

export function isExperienceTextPixel(red: number, green: number, blue: number): boolean {
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const neutralLightText = red >= 138 && green >= 138 && blue >= 138 && max - min <= 58;
  const tintedLightText = min >= 150 && max >= 188 && max - min <= 112;
  return neutralLightText || tintedLightText;
}

function isExperienceTextStrokePixel(red: number, green: number, blue: number): boolean {
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const yellowBarStroke =
    red >= 78 &&
    red <= 178 &&
    green >= 78 &&
    green <= 188 &&
    blue <= 145 &&
    Math.abs(red - green) <= 68 &&
    Math.max(red, green) - blue >= 10;
  const neutralStroke =
    red >= 55 &&
    red <= 150 &&
    green >= 55 &&
    green <= 160 &&
    blue >= 45 &&
    blue <= 170 &&
    max - min <= 76;

  return yellowBarStroke || neutralStroke;
}

export function hasNearbyDarkOutline(source: ImageData, x: number, y: number): boolean {
  const minX = Math.max(0, x - 2);
  const maxX = Math.min(source.width - 1, x + 2);
  const minY = Math.max(0, y - 2);
  const maxY = Math.min(source.height - 1, y + 2);

  for (let currentY = minY; currentY <= maxY; currentY += 1) {
    for (let currentX = minX; currentX <= maxX; currentX += 1) {
      if (currentX === x && currentY === y) {
        continue;
      }
      const index = (currentY * source.width + currentX) * 4;
      if (
        source.data[index] <= 72 &&
        source.data[index + 1] <= 72 &&
        source.data[index + 2] <= 72
      ) {
        return true;
      }
    }
  }

  return false;
}

function hasNearbyExperienceBarFillContrast(source: ImageData, x: number, y: number): boolean {
  const minX = Math.max(0, x - 2);
  const maxX = Math.min(source.width - 1, x + 2);
  const minY = Math.max(0, y - 2);
  const maxY = Math.min(source.height - 1, y + 2);

  for (let currentY = minY; currentY <= maxY; currentY += 1) {
    for (let currentX = minX; currentX <= maxX; currentX += 1) {
      if (currentX === x && currentY === y) {
        continue;
      }
      const index = (currentY * source.width + currentX) * 4;
      if (
        isExperienceBarFillPixel(
          source.data[index],
          source.data[index + 1],
          source.data[index + 2],
        )
      ) {
        return true;
      }
    }
  }

  return false;
}

function hasNearbyExperienceTextHighlight(source: ImageData, x: number, y: number): boolean {
  const minX = Math.max(0, x - 3);
  const maxX = Math.min(source.width - 1, x + 3);
  const minY = Math.max(0, y - 3);
  const maxY = Math.min(source.height - 1, y + 3);

  for (let currentY = minY; currentY <= maxY; currentY += 1) {
    for (let currentX = minX; currentX <= maxX; currentX += 1) {
      if (currentX === x && currentY === y) {
        continue;
      }
      const index = (currentY * source.width + currentX) * 4;
      if (
        source.data[index + 3] > 24 &&
        isExperienceTextPixel(
          source.data[index],
          source.data[index + 1],
          source.data[index + 2],
        )
      ) {
        return true;
      }
    }
  }

  return false;
}

function isExperienceBarFillPixel(red: number, green: number, blue: number): boolean {
  const yellowFill =
    red >= 130 &&
    green >= 125 &&
    blue <= 135 &&
    Math.max(red, green) - blue >= 55 &&
    green >= red * 0.65;
  const greenFill =
    green >= 130 &&
    red <= 180 &&
    blue <= 180 &&
    green > red * 1.12 &&
    green > blue * 1.08;
  const pinkFill =
    red >= 165 &&
    blue >= 165 &&
    green <= 205 &&
    red > green * 1.08 &&
    blue > green * 1.08;

  return yellowFill || greenFill || pinkFill;
}

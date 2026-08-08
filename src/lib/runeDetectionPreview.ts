import type { RuneCandidate } from "../recognition/rune/runeDetectionTypes";
import { buildPurpleMask } from "./runeMask";

export function createRuneMaskPreview(imageData: ImageData, candidates: RuneCandidate[]): ImageData {
  const output = new ImageData(imageData.width, imageData.height);
  const mask = buildPurpleMask(imageData);

  for (let index = 0; index < mask.length; index += 1) {
    const target = index * 4;
    if (mask[index]) {
      output.data[target] = 164;
      output.data[target + 1] = 92;
      output.data[target + 2] = 255;
      output.data[target + 3] = 255;
    } else {
      const source = target;
      const gray = Math.round(
        imageData.data[source] * 0.299 +
          imageData.data[source + 1] * 0.587 +
          imageData.data[source + 2] * 0.114,
      );
      output.data[target] = gray;
      output.data[target + 1] = gray;
      output.data[target + 2] = gray;
      output.data[target + 3] = 190;
    }
  }

  for (const candidate of candidates.slice(0, 3)) {
    const left = candidate.x;
    const right = candidate.x + candidate.width - 1;
    const top = candidate.y;
    const bottom = candidate.y + candidate.height - 1;

    for (let x = left; x <= right; x += 1) {
      paintPreviewPixel(output, x, top);
      paintPreviewPixel(output, x, bottom);
    }

    for (let y = top; y <= bottom; y += 1) {
      paintPreviewPixel(output, left, y);
      paintPreviewPixel(output, right, y);
    }
  }

  return output;
}

function paintPreviewPixel(imageData: ImageData, x: number, y: number) {
  if (x < 0 || y < 0 || x >= imageData.width || y >= imageData.height) {
    return;
  }

  const index = (y * imageData.width + x) * 4;
  imageData.data[index] = 255;
  imageData.data[index + 1] = 190;
  imageData.data[index + 2] = 0;
  imageData.data[index + 3] = 255;
}

const MAX_PLAUSIBLE_EXPERIENCE_DIGITS = 16;
const MIN_HEALTHY_FOREGROUND_RATIO = 0.055;
const MAX_HEALTHY_FOREGROUND_RATIO = 0.18;

export type HuntStallCropScoreInput = {
  recognizedText: string | null;
  confidence: number;
  foregroundRatio: number;
  regionWidth: number;
  processedImageData: ImageData;
};

export function scoreHuntStallCropCandidate(input: HuntStallCropScoreInput): number {
  if (!input.recognizedText) {
    return input.confidence;
  }

  const widthPenalty = Math.max(0, input.regionWidth - 640) / 640;
  return 100 + input.confidence * 10 - widthPenalty - cropQualityPenalty(input);
}

function cropQualityPenalty(input: HuntStallCropScoreInput): number {
  const foregroundRatio = Number.isFinite(input.foregroundRatio) ? input.foregroundRatio : 0;
  const edge = processedEdgeForegroundRatios(input.processedImageData);
  let penalty = 0;

  if (foregroundRatio < MIN_HEALTHY_FOREGROUND_RATIO) {
    penalty += (MIN_HEALTHY_FOREGROUND_RATIO - foregroundRatio) * 80 + 0.35;
  } else if (foregroundRatio > MAX_HEALTHY_FOREGROUND_RATIO) {
    penalty += (foregroundRatio - MAX_HEALTHY_FOREGROUND_RATIO) * 28 + 0.35;
  }

  if (edge.top <= 0.008 && edge.secondTop <= 0.008) {
    penalty += 3;
  } else if (edge.top <= 0.003 && edge.secondTop >= 0.04) {
    penalty += 1;
  }

  if (edge.bottom <= 0.006 && edge.secondBottom <= 0.006) {
    penalty += 2;
  }

  if (experienceNumberDigitCount(input.recognizedText) > MAX_PLAUSIBLE_EXPERIENCE_DIGITS) {
    penalty += 4;
  }

  return penalty;
}

function processedEdgeForegroundRatios(imageData: ImageData): {
  top: number;
  secondTop: number;
  bottom: number;
  secondBottom: number;
} {
  const rowRatio = (y: number): number => {
    let count = 0;
    const clampedY = Math.max(0, Math.min(imageData.height - 1, y));
    for (let x = 0; x < imageData.width; x += 1) {
      const index = (clampedY * imageData.width + x) * 4;
      if (
        imageData.data[index] > 0 ||
        imageData.data[index + 1] > 0 ||
        imageData.data[index + 2] > 0
      ) {
        count += 1;
      }
    }
    return count / Math.max(1, imageData.width);
  };

  return {
    top: rowRatio(0),
    secondTop: rowRatio(Math.min(1, imageData.height - 1)),
    bottom: rowRatio(imageData.height - 1),
    secondBottom: rowRatio(Math.max(0, imageData.height - 2)),
  };
}

function experienceNumberDigitCount(text: string | null): number {
  if (!text) {
    return 0;
  }
  const match = /^([^ ]+) \[/.exec(text);
  if (!match || match[1] === "--") {
    return 0;
  }
  return match[1].replace(/\D/g, "").length;
}

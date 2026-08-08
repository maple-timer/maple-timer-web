import {
  clampNumber,
  failTime,
  normalizeStrictRect,
} from "./timerImage";
import { makeDigitRect } from "./timerDigitRects";
import { isMapleTimerDigitPixel } from "./timerPixelClassifiers";
import {
  MAPLE_REMAINING_TIME_DIGIT_RATIOS,
  type ImageDataLike,
  type Rect,
  type SevenSegmentDigitResult,
  type SevenSegmentOptions,
  type TimeReadResult,
} from "./timerTypes";
import {
  SYNTHETIC_TEMPLATE_HEIGHT,
  SYNTHETIC_TEMPLATE_WIDTH,
  classifySyntheticDigitVector,
} from "./timerSyntheticDigitClassifier";
import {
  formatMapleMinuteSecondTime,
  validateMapleMinuteSecondTime,
} from "./timerTimeResult";

type SyntheticTimeReadSettings = Required<
  Pick<
    SevenSegmentOptions,
    "minSyntheticTemplateDigitScore" | "minSyntheticTemplateDigitMargin"
  >
>;

export function readSyntheticMapleMinuteSecondTime(
  imageData: ImageDataLike,
  rect: Rect | readonly [number, number, number, number],
  options: SevenSegmentOptions = {},
): TimeReadResult {
  const settings = makeSyntheticTimeReadSettings(options);
  const sourceRect = normalizeStrictRect(
    rect,
    imageData.width,
    imageData.height,
  );
  if (!sourceRect) return failTime("invalid-rect", null, [], []);

  const digits: number[] = [];
  const digitResults: SevenSegmentDigitResult[] = [];
  for (
    let index = 0;
    index < MAPLE_REMAINING_TIME_DIGIT_RATIOS.length;
    index += 1
  ) {
    const digitRect = makeDigitRect(
      sourceRect,
      MAPLE_REMAINING_TIME_DIGIT_RATIOS[index],
    );
    const digitResult = readSyntheticAreaDigit(imageData, digitRect);
    digitResults.push({ ...digitResult, index, rect: digitRect });

    if (
      !digitResult.ok ||
      digitResult.digit == null ||
      (digitResult.score ?? -Infinity) <
        settings.minSyntheticTemplateDigitScore ||
      (digitResult.scoreMargin ?? -Infinity) <
        settings.minSyntheticTemplateDigitMargin
    ) {
      return failTime(
        "low-synthetic-template-confidence",
        sourceRect,
        digits,
        digitResults,
      );
    }

    digits.push(digitResult.digit);
  }

  const result: TimeReadResult = {
    ok: true,
    reason: "ok",
    digits,
    digitResults,
    rect: sourceRect,
    seconds: null,
    text: null,
  };
  const invalidMinuteSecondTime = validateMapleMinuteSecondTime(
    result,
    options,
  );
  if (invalidMinuteSecondTime) return invalidMinuteSecondTime;

  return formatMapleMinuteSecondTime(result, "synthetic-template");
}

export function readSyntheticAreaDigit(
  imageData: ImageDataLike,
  rect: Rect,
): SevenSegmentDigitResult {
  const vector = syntheticVectorFromRect(imageData, rect);
  const candidates = classifySyntheticDigitVector(vector);
  const best = candidates[0] ?? null;
  const second = candidates[1] ?? null;
  if (!best) {
    return {
      ok: false,
      reason: "no-synthetic-template-candidate",
      mask: null,
      digit: null,
      score: -Infinity,
      scoreMargin: -Infinity,
      confidence: -Infinity,
      candidates: [],
    };
  }

  const scoreMargin = best.score - (second?.score ?? -Infinity);
  return {
    ok: true,
    reason: "ok",
    mask: best.mask,
    rawMask: null,
    rawDigit: null,
    digit: best.digit,
    score: best.score,
    scoreMargin,
    confidence: 6 + best.score * 4 + scoreMargin * 4,
    selectedBy: "synthetic-template",
    candidates: candidates
      .slice(0, 4)
      .map(({ digit, mask, score }) => ({ digit, mask, score })),
  };
}

export function syntheticVectorFromRect(
  imageData: ImageDataLike,
  rect: Rect,
): Float32Array {
  const vector = new Float32Array(
    SYNTHETIC_TEMPLATE_WIDTH * SYNTHETIC_TEMPLATE_HEIGHT,
  );

  for (let gridY = 0; gridY < SYNTHETIC_TEMPLATE_HEIGHT; gridY += 1) {
    const y1 = Math.floor(
      rect.y + (rect.height * gridY) / SYNTHETIC_TEMPLATE_HEIGHT,
    );
    const y2 = Math.max(
      y1 + 1,
      Math.floor(
        rect.y + (rect.height * (gridY + 1)) / SYNTHETIC_TEMPLATE_HEIGHT,
      ),
    );
    for (let gridX = 0; gridX < SYNTHETIC_TEMPLATE_WIDTH; gridX += 1) {
      const x1 = Math.floor(
        rect.x + (rect.width * gridX) / SYNTHETIC_TEMPLATE_WIDTH,
      );
      const x2 = Math.max(
        x1 + 1,
        Math.floor(
          rect.x + (rect.width * (gridX + 1)) / SYNTHETIC_TEMPLATE_WIDTH,
        ),
      );
      let count = 0;
      let total = 0;

      for (
        let y = clampNumber(y1, 0, imageData.height - 1);
        y < clampNumber(y2, 1, imageData.height);
        y += 1
      ) {
        for (
          let x = clampNumber(x1, 0, imageData.width - 1);
          x < clampNumber(x2, 1, imageData.width);
          x += 1
        ) {
          const offset = (y * imageData.width + x) * 4;
          if (isMapleTimerDigitPixel(imageData.data, offset)) count += 1;
          total += 1;
        }
      }

      vector[gridY * SYNTHETIC_TEMPLATE_WIDTH + gridX] =
        total > 0 ? count / total : 0;
    }
  }

  return vector;
}

function makeSyntheticTimeReadSettings(
  options: SevenSegmentOptions,
): SyntheticTimeReadSettings {
  return {
    minSyntheticTemplateDigitScore:
      options.minSyntheticTemplateDigitScore ?? 0.18,
    minSyntheticTemplateDigitMargin:
      options.minSyntheticTemplateDigitMargin ?? 0.01,
  };
}

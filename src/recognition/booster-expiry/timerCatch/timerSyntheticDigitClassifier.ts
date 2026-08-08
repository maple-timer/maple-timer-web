import { SEVEN_SEGMENT_DIGIT_TO_MASK } from "./timerTypes";

export const SYNTHETIC_TEMPLATE_WIDTH = 22;
export const SYNTHETIC_TEMPLATE_HEIGHT = 34;

const SYNTHETIC_TEMPLATE_SEGMENT_ZONES = Object.freeze([
  Object.freeze({ x1: 0.22, y1: 0.02, x2: 0.78, y2: 0.16, bit: 0 }),
  Object.freeze({ x1: 0.02, y1: 0.1, x2: 0.25, y2: 0.47, bit: 1 }),
  Object.freeze({ x1: 0.75, y1: 0.1, x2: 0.98, y2: 0.47, bit: 2 }),
  Object.freeze({ x1: 0.22, y1: 0.42, x2: 0.78, y2: 0.58, bit: 3 }),
  Object.freeze({ x1: 0.02, y1: 0.53, x2: 0.25, y2: 0.9, bit: 4 }),
  Object.freeze({ x1: 0.75, y1: 0.53, x2: 0.98, y2: 0.9, bit: 5 }),
  Object.freeze({ x1: 0.22, y1: 0.84, x2: 0.78, y2: 0.98, bit: 6 }),
]);

const SYNTHETIC_DIGIT_TEMPLATES = Object.freeze(
  SEVEN_SEGMENT_DIGIT_TO_MASK.map((mask, digit) =>
    Object.freeze({
      digit,
      mask,
      vector: makeSyntheticDigitTemplate(mask),
    }),
  ),
);

export function classifySyntheticDigitVector(
  vector: Float32Array,
): Array<{ digit: number; mask: number; score: number }> {
  let active = 0;
  for (let index = 0; index < vector.length; index += 1) {
    active += Math.min(1, vector[index] * 1.6);
  }

  return SYNTHETIC_DIGIT_TEMPLATES.map((template) => {
    let overlap = 0;
    let expected = 0;
    let extra = 0;

    for (let index = 0; index < vector.length; index += 1) {
      const value = Math.min(1, vector[index] * 1.6);
      if (template.vector[index]) {
        overlap += value;
        expected += 1;
      } else {
        extra += value;
      }
    }

    const recall = expected > 0 ? overlap / expected : 0;
    const precision = active > 0 ? overlap / active : 0;
    const f1 =
      recall + precision > 0
        ? (2 * recall * precision) / (recall + precision)
        : 0;
    return {
      digit: template.digit,
      mask: template.mask,
      score: f1 - (extra / Math.max(1, vector.length)) * 0.25,
    };
  }).sort((a, b) => b.score - a.score || a.digit - b.digit);
}

function makeSyntheticDigitTemplate(mask: number): Uint8Array {
  const vector = new Uint8Array(
    SYNTHETIC_TEMPLATE_WIDTH * SYNTHETIC_TEMPLATE_HEIGHT,
  );

  for (const zone of SYNTHETIC_TEMPLATE_SEGMENT_ZONES) {
    if (!(mask & (1 << zone.bit))) continue;
    const left = Math.floor(SYNTHETIC_TEMPLATE_WIDTH * zone.x1);
    const right = Math.ceil(SYNTHETIC_TEMPLATE_WIDTH * zone.x2);
    const top = Math.floor(SYNTHETIC_TEMPLATE_HEIGHT * zone.y1);
    const bottom = Math.ceil(SYNTHETIC_TEMPLATE_HEIGHT * zone.y2);

    for (let y = top; y < bottom; y += 1) {
      for (let x = left; x < right; x += 1) {
        if (
          x >= 0 &&
          x < SYNTHETIC_TEMPLATE_WIDTH &&
          y >= 0 &&
          y < SYNTHETIC_TEMPLATE_HEIGHT
        ) {
          vector[y * SYNTHETIC_TEMPLATE_WIDTH + x] = 1;
        }
      }
    }
  }

  return vector;
}

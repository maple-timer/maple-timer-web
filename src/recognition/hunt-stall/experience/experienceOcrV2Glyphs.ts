import { maskToExperienceOcrV2ImageData } from "./experienceOcrV2Masks";

export type ExperienceOcrV2Segment = {
  mask: Uint8Array;
  width: number;
  height: number;
  x0: number;
  x1: number;
  lineHeight: number;
};

export type ExperienceOcrV2DebugSegment = {
  index: number;
  x0: number;
  x1: number;
  width: number;
  height: number;
  activePixels: number;
  topClasses: Array<{ label: string; cost: number }>;
  imageData: ImageData;
};

const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;
const ALL_CLASSES = [...DIGITS, "sep", "[", "]", "%"] as const;
export type ExperienceOcrV2Class = (typeof ALL_CLASSES)[number];
export type ExperienceOcrV2CostRow = Record<ExperienceOcrV2Class, number>;

const TIE_RANK = new Map(
  "1823456079sep[]%"
    .replace("sep", "S")
    .split("")
    .map((item, index) => [item === "S" ? "sep" : item, index] as const),
);

const FONT: Record<string, string[]> = {
  "0": [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  "1": [".#", "##", ".#", ".#", ".#", ".#", ".#"],
  "2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
  "3": [".###.", "#...#", "....#", "..##.", "....#", "#...#", ".###."],
  "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
  "5": ["#####", "#....", "#....", ".###.", "....#", "#...#", ".###."],
  "6": [".###.", "#...#", "#....", "####.", "#...#", "#...#", ".###."],
  "7": ["#####", "....#", "....#", "...#.", "...#.", "..#..", "..#.."],
  "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
  "9": [".###.", "#...#", "#...#", ".####", "....#", "#...#", ".###."],
  sep: [".#", "#."],
  sep1: ["#"],
  "[": ["##", "#.", "#.", "#.", "#.", "#.", "##"],
  "]": ["##", ".#", ".#", ".#", ".#", ".#", "##"],
  "%": [".#....#", "#.#..#.", ".#..#..", "...#...", "..#..#.", ".#..#.#", "#....#."],
};

const CLASS_TEMPLATES: Record<ExperienceOcrV2Class, number[][][]> = {
  "0": [templateArray(FONT["0"])],
  "1": [templateArray(FONT["1"]), [[1], [1], [1], [1], [1], [1], [1]]],
  "2": [templateArray(FONT["2"])],
  "3": [templateArray(FONT["3"])],
  "4": [
    templateArray(FONT["4"]),
    templateArray(["....#", "..###", ".#..#", "#...#", "#...#", "#####", "....#"]),
    templateArray(["...#.", "..##.", ".#.#.", "#..#.", "#..#.", "#####", "...#."]),
  ],
  "5": [
    templateArray(FONT["5"]),
    templateArray(["#....", ".####", ".#...", "#.##.", "#...#", "#####", "#...."]),
  ],
  "6": [
    templateArray(FONT["6"]),
    templateArray(["....#", "#####", "#....", "####.", "#...#", "#####", "....#"]),
  ],
  "7": [templateArray(FONT["7"])],
  "8": [templateArray(FONT["8"])],
  "9": [templateArray(FONT["9"])],
  sep: [templateArray(FONT.sep), templateArray(FONT.sep1)],
  "[": [templateArray(FONT["["]), [[1], [1], [1], [1], [1], [1], [1]]],
  "]": [templateArray(FONT["]"])],
  "%": [templateArray(FONT["%"])],
};

export function formatExperienceOcrV2GlyphLabel(label: string): string {
  return label === "sep" ? "." : label;
}

export function getExperienceOcrV2BoundaryNoiseCost(costs: ExperienceOcrV2CostRow): number {
  // EXP bar edges often become a one-pixel vertical stroke right after the
  // opening bracket.  Treat one such segment as ignorable only when it already
  // looks like punctuation/a thin stroke, and keep a non-trivial penalty so the
  // normal parser remains preferred on clean crops.
  return Math.min(0.42, costs.sep + 0.08, costs["1"] + 0.12, costs["["] + 0.16, costs["]"] + 0.18);
}

export function parseExperienceOcrV2DigitSeparators(
  costRows: ExperienceOcrV2CostRow[],
  mode: "number" | "percent",
): { score: number; labels: string[]; digits: string } | null {
  const count = costRows.length;
  const results: Array<{ score: number; labels: string[]; digits: string }> = [];
  const minDigits = mode === "number" ? 1 : 4;
  const maxDigits = mode === "number" ? count : 6;

  for (let digitCount = minDigits; digitCount <= maxDigits; digitCount += 1) {
    if (digitCount > count) {
      continue;
    }
    const expectedSeps = new Set<number>();
    if (mode === "number") {
      for (let used = digitCount % 3 || 3; used < digitCount; used += 3) {
        expectedSeps.add(used);
      }
    } else {
      expectedSeps.add(digitCount - 3);
    }

    type State = { score: number; labels: string[]; digits: string[]; lastWasSep: boolean; sepRun: number };
    const states = new Map<string, State>();
    states.set("0:0:0", { score: 0, labels: [], digits: [], lastWasSep: false, sepRun: 0 });
    let currentStates = states;
    for (const costs of costRows) {
      const nextStates = new Map<string, State>();
      for (const [stateKey, state] of currentStates) {
        const usedDigits = Number(stateKey.split(":")[0]);
        if (usedDigits < digitCount) {
          const [digit, digitCost] = bestDigit(costs);
          updateState(nextStates, `${usedDigits + 1}:0:0`, {
            score: state.score + digitCost,
            labels: [...state.labels, digit],
            digits: [...state.digits, digit],
            lastWasSep: false,
            sepRun: 0,
          });
        }
        if (usedDigits > 0 && usedDigits < digitCount && expectedSeps.has(usedDigits) && state.sepRun < 3) {
          const nextSepRun = state.lastWasSep ? state.sepRun + 1 : 1;
          const repeatPenalty = state.lastWasSep ? 0.12 * state.sepRun : 0;
          updateState(nextStates, `${usedDigits}:1:${nextSepRun}`, {
            score: state.score + costs.sep + 0.03 + repeatPenalty,
            labels: [...state.labels, "sep"],
            digits: state.digits,
            lastWasSep: true,
            sepRun: nextSepRun,
          });
        }
      }
      currentStates = nextStates;
    }

    const finalState = currentStates.get(`${digitCount}:0:0`);
    if (!finalState) {
      continue;
    }
    let score = finalState.score;
    const digits = finalState.digits.join("");
    if (mode === "number" && digitCount < 8) {
      score += (8 - digitCount) * 0.15;
    }
    if (mode === "percent" && Number(digits) > 100000) {
      score += 1.5;
    }
    results.push({ score, labels: finalState.labels, digits });
  }

  return minBy(results, (item) => item.score);
}

export function getExperienceOcrV2SegmentCosts(segment: ExperienceOcrV2Segment): ExperienceOcrV2CostRow {
  const output = {} as ExperienceOcrV2CostRow;
  for (const label of ALL_CLASSES) {
    output[label] = classCost(segment, label);
  }
  return output;
}

export function debugExperienceOcrV2Segment(
  segment: ExperienceOcrV2Segment,
  index: number,
): ExperienceOcrV2DebugSegment {
  const costs = getExperienceOcrV2SegmentCosts(segment);
  const topClasses = ALL_CLASSES.map((label) => ({ label, cost: costs[label] }))
    .sort((left, right) => left.cost - right.cost || (TIE_RANK.get(left.label) ?? 99) - (TIE_RANK.get(right.label) ?? 99))
    .slice(0, 5);
  let activePixels = 0;
  for (const value of segment.mask) {
    activePixels += value ? 1 : 0;
  }
  return {
    index,
    x0: segment.x0,
    x1: segment.x1,
    width: segment.width,
    height: segment.height,
    activePixels,
    topClasses,
    imageData: maskToExperienceOcrV2ImageData(segment.mask, segment.width, segment.height),
  };
}

function templateArray(lines: string[]): number[][] {
  return lines.map((row) => row.split("").map((char) => (char === "#" ? 1 : 0)));
}

function updateState(
  states: Map<string, { score: number; labels: string[]; digits: string[]; lastWasSep: boolean; sepRun: number }>,
  key: string,
  value: { score: number; labels: string[]; digits: string[]; lastWasSep: boolean; sepRun: number },
) {
  const current = states.get(key);
  if (!current || value.score < current.score) {
    states.set(key, value);
  }
}

function bestDigit(costs: ExperienceOcrV2CostRow): [string, number] {
  let best: [string, number] = ["0", Number.POSITIVE_INFINITY];
  for (const digit of DIGITS) {
    const cost = costs[digit];
    if (
      cost < best[1] ||
      (cost === best[1] && (TIE_RANK.get(digit) ?? 99) < (TIE_RANK.get(best[0]) ?? 99))
    ) {
      best = [digit, cost];
    }
  }
  return best;
}

function classCost(segment: ExperienceOcrV2Segment, label: ExperienceOcrV2Class): number {
  const bbox = activeBBox(segment.mask, segment.width, segment.height);
  const activeHeight = bbox ? bbox.y1 - bbox.y0 : 0;
  const activeRatio = activeHeight / Math.max(1, segment.lineHeight);
  let best = 9;

  for (const template of CLASS_TEMPLATES[label]) {
    const candidate = resizeSegment(segment, template[0].length, template.length);
    let mismatch = 0;
    let common = 0;
    let candidateSum = 0;
    let templateSum = 0;
    for (let y = 0; y < template.length; y += 1) {
      for (let x = 0; x < template[0].length; x += 1) {
        const value = candidate[y][x];
        const expected = template[y][x];
        mismatch += (value - expected) ** 2;
        common += Math.min(value, expected);
        candidateSum += value;
        templateSum += expected;
      }
    }
    const size = template.length * template[0].length;
    const falseNegative = Math.max(0, templateSum - common) / Math.max(1, templateSum);
    const falsePositive = Math.max(0, candidateSum - common) / Math.max(1, size - templateSum);
    const aspect = segment.width / Math.max(1, segment.lineHeight) / (template[0].length / template.length);
    let score = mismatch / size + 0.15 * falseNegative + 0.04 * falsePositive;
    score += 0.02 * Math.abs(Math.log(aspect + 1e-6));

    if (label === "sep") {
      if (activeRatio > 0.45) {
        score += (0.7 * (activeRatio - 0.45)) / 0.55;
      }
    } else if (activeRatio < 0.5) {
      score += (0.45 * (0.5 - activeRatio)) / 0.5;
    }
    best = Math.min(best, score);
  }

  if (label === "1" && segment.width / Math.max(1, segment.lineHeight) > 0.34) {
    const wide = resizeSegment(segment, 5, 7);
    if (average(wide[0]) > 0.55 && average(wide[1]) > 0.35) {
      best += 0.18;
    }
  }
  return best;
}

function activeBBox(
  mask: Uint8Array,
  width: number,
  height: number,
): { x0: number; x1: number; y0: number; y1: number } | null {
  let x0 = width;
  let x1 = 0;
  let y0 = height;
  let y1 = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!mask[y * width + x]) {
        continue;
      }
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x + 1);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y + 1);
    }
  }
  return x1 > x0 && y1 > y0 ? { x0, x1, y0, y1 } : null;
}

function resizeSegment(segment: ExperienceOcrV2Segment, targetWidth: number, targetHeight: number): number[][] {
  const bbox = activeBBox(segment.mask, segment.width, segment.height);
  const output = Array.from({ length: targetHeight }, () => new Array<number>(targetWidth).fill(0));
  if (!bbox) {
    return output;
  }

  const sourceWidth = segment.width;
  const sourceHeight = bbox.y1 - bbox.y0;
  for (let ty = 0; ty < targetHeight; ty += 1) {
    const syStart = (ty / targetHeight) * sourceHeight;
    const syEnd = ((ty + 1) / targetHeight) * sourceHeight;
    const sy0 = Math.floor(syStart);
    const sy1 = Math.ceil(syEnd);
    for (let tx = 0; tx < targetWidth; tx += 1) {
      const sxStart = (tx / targetWidth) * sourceWidth;
      const sxEnd = ((tx + 1) / targetWidth) * sourceWidth;
      const sx0 = Math.floor(sxStart);
      const sx1 = Math.ceil(sxEnd);
      let sum = 0;
      let area = 0;
      for (let sy = sy0; sy < sy1; sy += 1) {
        const yOverlap = Math.max(0, Math.min(sy + 1, syEnd) - Math.max(sy, syStart));
        if (yOverlap <= 0) {
          continue;
        }
        for (let sx = sx0; sx < sx1; sx += 1) {
          const xOverlap = Math.max(0, Math.min(sx + 1, sxEnd) - Math.max(sx, sxStart));
          if (xOverlap <= 0) {
            continue;
          }
          const weight = xOverlap * yOverlap;
          sum += segment.mask[(bbox.y0 + sy) * segment.width + sx] * weight;
          area += weight;
        }
      }
      output[ty][tx] = sum / Math.max(1e-6, area);
    }
  }
  return output;
}

function minBy<T>(items: T[], getValue: (item: T) => number): T | null {
  if (items.length === 0) {
    return null;
  }
  return items.reduce((best, item) => (getValue(item) < getValue(best) ? item : best), items[0]);
}

function average(values: number[]): number {
  return values.reduce((total, item) => total + item, 0) / Math.max(1, values.length);
}

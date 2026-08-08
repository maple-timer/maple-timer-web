import {
  dedupeExperienceOcrV2Candidates,
  formatExperienceOcrV2Reading,
  isExperienceOcrV2BoundarySkipSource,
  isExperienceOcrV2ParserBoundaryAlternative,
  isValidExperienceOcrV2Reading,
  rankExperienceOcrV2Candidates,
  scoreToExperienceOcrV2Confidence,
  type ExperienceOcrV2Candidate as OcrCandidate,
  type ExperienceOcrV2Reading as OcrReading,
} from "./experienceOcrV2Candidates";
import {
  createExperienceOcrV2MaskSources,
  findExperienceOcrV2ColoredTextBands,
  findExperienceOcrV2RepaintTextBands,
  findExperienceOcrV2RowBands,
  makeExperienceOcrV2Mask,
  maskToExperienceOcrV2ImageData,
  type ExperienceOcrV2Band as Band,
  type ExperienceOcrV2MaskSource as MaskSource,
} from "./experienceOcrV2Masks";
import {
  debugExperienceOcrV2Segment,
  formatExperienceOcrV2GlyphLabel,
  getExperienceOcrV2BoundaryNoiseCost,
  getExperienceOcrV2SegmentCosts,
  parseExperienceOcrV2DigitSeparators,
  type ExperienceOcrV2DebugSegment,
  type ExperienceOcrV2Segment as Segment,
} from "./experienceOcrV2Glyphs";

export type { ExperienceOcrV2DebugSegment } from "./experienceOcrV2Glyphs";

type CandidateLine = {
  segments: Segment[];
  source: string;
  mask: Uint8Array;
  width: number;
  height: number;
};

export type ExperienceOcrV2Result = {
  text: string | null;
  debugText: string;
  confidence: number;
  source: string | null;
  score: number | null;
  processedImageData: ImageData;
  candidates: Array<{ text: string; source: string; score: number; sequence: string }>;
};

export type ExperienceOcrV2DebugLine = {
  source: string;
  width: number;
  height: number;
  segmentCount: number;
  imageData: ImageData;
  candidates: Array<{ text: string; source: string; score: number; sequence: string }>;
  segments: ExperienceOcrV2DebugSegment[];
};

export function readExperienceOcrV2(imageData: ImageData): ExperienceOcrV2Result {
  const candidates = rankExperienceOcrV2Candidates(fontCandidates(imageData), 12);
  const best = candidates.find((candidate) => !isExperienceOcrV2BoundarySkipSource(candidate.source)) ?? candidates[0] ?? null;
  const processedImageData = best
    ? maskToExperienceOcrV2ImageData(best.mask, best.width, best.height)
    : maskToExperienceOcrV2ImageData(makeExperienceOcrV2Mask(imageData, "neutral"), imageData.width, imageData.height);

  if (!best) {
    return {
      text: null,
      debugText: "",
      confidence: 0,
      source: null,
      score: null,
      processedImageData,
      candidates: [],
    };
  }

  return {
    text: formatExperienceOcrV2Reading(best.reading),
    debugText: `${best.sequence} (${best.source})`,
    confidence: scoreToExperienceOcrV2Confidence(best.score),
    source: best.source,
    score: best.score,
    processedImageData,
    candidates: candidates.map((candidate) => ({
      text: formatExperienceOcrV2Reading(candidate.reading),
      source: candidate.source,
      score: candidate.score,
      sequence: candidate.sequence,
    })),
  };
}

export function debugExperienceOcrV2(imageData: ImageData, limit = 24): ExperienceOcrV2DebugLine[] {
  return segmentCandidates(imageData)
    .map((line) => {
      const candidates = parseSegmentLineCandidates(line).map((candidate) => ({
        text: formatExperienceOcrV2Reading(candidate.reading),
        source: candidate.source,
        score: candidate.score,
        sequence: candidate.sequence,
      }));
      const bestScore = candidates[0]?.score ?? Number.POSITIVE_INFINITY;
      return {
        source: line.source,
        width: line.width,
        height: line.height,
        segmentCount: line.segments.length,
        imageData: maskToExperienceOcrV2ImageData(line.mask, line.width, line.height),
        candidates,
        segments: line.segments.map((segment, index) => debugExperienceOcrV2Segment(segment, index)),
        bestScore,
      };
    })
    .filter((line) => line.candidates.length > 0)
    .sort((left, right) => left.bestScore - right.bestScore)
    .slice(0, limit)
    .map(({ bestScore, ...line }) => line);
}

function fontCandidates(imageData: ImageData): OcrCandidate[] {
  const candidates: OcrCandidate[] = [];
  for (const line of segmentCandidates(imageData)) {
    for (const candidate of parseSegmentLineCandidates(line)) {
      if (isValidExperienceOcrV2Reading(candidate.reading)) {
        candidates.push(candidate);
      }
    }
  }
  candidates.sort((left, right) => left.score - right.score);
  return candidates.slice(0, 10);
}

function segmentCandidates(imageData: ImageData): CandidateLine[] {
  const sources = createExperienceOcrV2MaskSources(imageData);
  const output: CandidateLine[] = [];
  const seen = new Set<string>();

  for (const source of sources) {
    if (source.mode.startsWith("colored_dark")) {
      for (const band of findExperienceOcrV2ColoredTextBands(source.mask, source.width, source.height)) {
        addCandidateLine(output, seen, source, band, true, `${source.mode}:trim`);
      }
    }

    for (const threshold of [0.2, 0.15, 0.1, 0.06]) {
      const bands = findExperienceOcrV2RowBands(source.mask, source.width, source.height, threshold).filter(
        (band) => band.endY - band.startY >= 2 && band.endY - band.startY <= 45,
      );
      if (bands.length === 0) {
        continue;
      }

      const largest = Math.max(...bands.map((band) => band.sum));
      const choices = [
        ["sum", maxBy(bands, (band) => band.sum * 100 + (band.endY - band.startY))],
        ["bottom", maxBy(bands, (band) => band.endY * 100 + band.sum)],
        [
          "bottom_close",
          maxBy(
            bands.filter((band) => band.sum >= largest * 0.35),
            (band) => band.endY * 100 + band.sum,
          ),
        ],
      ] as const;

      for (const [name, band] of choices) {
        if (band) {
          addCandidateLine(output, seen, source, band, true, `${source.mode}:${threshold.toFixed(2)}:${name}`);
        }
      }
    }

    if (source.mode.startsWith("repaint:") || source.mode.startsWith("bar_repaint:")) {
      for (const band of findExperienceOcrV2RepaintTextBands(source.mask, source.width, source.height)) {
        addCandidateLine(output, seen, source, band, true, `${source.mode}:trim`);
      }
    }
  }

  return output;
}

function addCandidateLine(
  output: CandidateLine[],
  seen: Set<string>,
  source: MaskSource,
  band: Band,
  expandY: boolean,
  label: string,
) {
  const candidate = segmentCandidate(source.mask, source.width, source.height, band, label, expandY);
  if (!candidate) {
    return;
  }

  addCandidateLineVariant(output, seen, candidate);
  for (const variant of leadingBarEdgeTrimVariants(candidate)) {
    addCandidateLineVariant(output, seen, variant);
  }
}

function addCandidateLineVariant(output: CandidateLine[], seen: Set<string>, candidate: CandidateLine) {
  const key = [
    candidate.segments.length,
    candidate.segments.map((segment) => segment.width).join(","),
    candidate.segments.map((segment) => segment.x0).join(","),
  ].join(":");
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  output.push(candidate);
}

function leadingBarEdgeTrimVariants(line: CandidateLine): CandidateLine[] {
  const variants: CandidateLine[] = [];
  let current = line;

  // Wide fixed-Y crops can include the bright vertical edge of the filled EXP
  // bar far to the left of the actual text. If that edge survives masking, the
  // numeric parser has to consume it and usually reads it as a leading "1".
  // Keep the original candidate, but also try a variant that drops such an
  // isolated leading edge before the text parser runs.
  for (let trimmed = 1; trimmed <= 2; trimmed += 1) {
    if (!hasLeadingBarEdgeSegment(current.segments)) {
      break;
    }

    current = {
      ...current,
      source: `${line.source}:drop_left_edge${trimmed}`,
      segments: current.segments.slice(1),
    };
    if (current.segments.length >= 8) {
      variants.push(current);
    }
  }

  return variants;
}

function hasLeadingBarEdgeSegment(segments: Segment[]): boolean {
  if (segments.length < 9) {
    return false;
  }

  const first = segments[0];
  const second = segments[1];
  const firstWidth = first.x1 - first.x0;
  const gapToText = second.x0 - first.x1;
  const narrowEnough = firstWidth <= Math.max(4, first.lineHeight * 0.58);
  const isolatedEnough = gapToText >= Math.max(12, first.lineHeight * 2.5);

  return narrowEnough && isolatedEnough;
}

function segmentCandidate(
  mask: Uint8Array,
  width: number,
  height: number,
  band: Band,
  source: string,
  expandY: boolean,
): CandidateLine | null {
  let y0 = band.startY;
  let y1 = band.endY;
  if (expandY) {
    y0 = Math.max(0, y0 - 1);
    y1 = Math.min(height, y1 + 1);
  }

  let xLeft = width;
  let xRight = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (mask[y * width + x]) {
        xLeft = Math.min(xLeft, x);
        xRight = Math.max(xRight, x + 1);
      }
    }
  }
  if (xRight <= xLeft) {
    return null;
  }

  xLeft = Math.max(0, xLeft - 1);
  xRight = Math.min(width, xRight + 1);
  const lineWidth = xRight - xLeft;
  const lineHeight = y1 - y0;
  const line = new Uint8Array(lineWidth * lineHeight);
  for (let y = 0; y < lineHeight; y += 1) {
    for (let x = 0; x < lineWidth; x += 1) {
      line[y * lineWidth + x] = mask[(y0 + y) * width + xLeft + x];
    }
  }

  const activeCols = new Array<boolean>(lineWidth).fill(false);
  for (let x = 0; x < lineWidth; x += 1) {
    for (let y = 0; y < lineHeight; y += 1) {
      if (line[y * lineWidth + x]) {
        activeCols[x] = true;
        break;
      }
    }
  }

  const spans: Array<[number, number]> = [];
  let start: number | null = null;
  for (let x = 0; x < lineWidth; x += 1) {
    if (activeCols[x] && start === null) {
      start = x;
    }
    if (start !== null && (!activeCols[x] || x === lineWidth - 1)) {
      const end = activeCols[x] && x === lineWidth - 1 ? x + 1 : x;
      if (end > start) {
        spans.push([start, end]);
      }
      start = null;
    }
  }
  if (spans.length < 6 || spans.length > 36) {
    return null;
  }

  return {
    source,
    mask,
    width,
    height,
    segments: spans.map(([startX, endX]) => {
      const segmentWidth = endX - startX;
      const segmentMask = new Uint8Array(segmentWidth * lineHeight);
      for (let y = 0; y < lineHeight; y += 1) {
        for (let x = 0; x < segmentWidth; x += 1) {
          segmentMask[y * segmentWidth + x] = line[y * lineWidth + startX + x];
        }
      }
      return {
        mask: segmentMask,
        width: segmentWidth,
        height: lineHeight,
        x0: xLeft + startX,
        x1: xLeft + endX,
        lineHeight,
      };
    }),
  };
}

function parseSegmentLineCandidates(line: CandidateLine): OcrCandidate[] {
  if (line.segments.length < 8) {
    return [];
  }

  const costRows = line.segments.map(getExperienceOcrV2SegmentCosts);
  const candidates: OcrCandidate[] = [];
  const count = line.segments.length;

  for (let percentIndex = Math.max(0, count - 5); percentIndex < count - 1; percentIndex += 1) {
    const closeIndex = percentIndex + 1;
    for (let openIndex = Math.max(1, percentIndex - 10); openIndex < percentIndex - 3; openIndex += 1) {
      const prefix = parseExperienceOcrV2DigitSeparators(costRows.slice(0, openIndex), "number");
      if (!prefix) {
        continue;
      }

      for (const skipAfterOpen of [0, 1]) {
        if (skipAfterOpen === 0 && openIndex < Math.max(1, percentIndex - 9)) {
          continue;
        }
        if (skipAfterOpen > 0 && !line.source.includes("repaint")) {
          continue;
        }
        const percentStart = openIndex + 1 + skipAfterOpen;
        if (percentStart >= percentIndex) {
          continue;
        }
        const percent = parseExperienceOcrV2DigitSeparators(costRows.slice(percentStart, percentIndex), "percent");
        if (!percent) {
          continue;
        }
        if (skipAfterOpen > 0 && percent.digits.length < 5) {
          continue;
        }

        let score = prefix.score + percent.score;
        score += costRows[openIndex]["["] + costRows[percentIndex]["%"] + costRows[closeIndex]["]"];
        for (let index = openIndex + 1; index < percentStart; index += 1) {
          score += getExperienceOcrV2BoundaryNoiseCost(costRows[index]);
        }
        if (openIndex > 0) {
          const gap = line.segments[openIndex].x0 - line.segments[openIndex - 1].x1;
          score -= Math.min(0.25, Math.max(0, gap) * 0.025);
        }
        if (prefix.digits.length < 10) {
          score += (10 - prefix.digits.length) * 0.08;
        }

        const avgScore = score / Math.max(1, line.segments.length);
        const skipped = skipAfterOpen > 0 ? "~".repeat(skipAfterOpen) : "";
        const sequence = `${prefix.labels.map(formatExperienceOcrV2GlyphLabel).join("")}[${skipped}${percent.labels
          .map(formatExperienceOcrV2GlyphLabel)
          .join("")}%]`;
        candidates.push({
          reading: { numberDigits: prefix.digits, percentDigits: percent.digits },
          sequence,
          score: avgScore + (skipAfterOpen > 0 ? 0.015 : 0),
          weight: Math.max(0.16, 2 / (1 + avgScore * 12) * (skipAfterOpen > 0 ? 0.72 : 1)),
          source: `${skipAfterOpen > 0 ? "font_boundary_skip" : "font"}:${line.source}`,
          mask: line.mask,
          width: line.width,
          height: line.height,
        });
      }
    }
  }

  const deduped = dedupeExperienceOcrV2Candidates(candidates);
  const bestNormal = deduped.find((candidate) => !isExperienceOcrV2BoundarySkipSource(candidate.source));
  if (!bestNormal) {
    return deduped.slice(0, 1);
  }

  const output = [bestNormal];
  for (const candidate of deduped) {
    if (
      isExperienceOcrV2ParserBoundaryAlternative(bestNormal, candidate) &&
      !output.some(
        (item) =>
          item.reading.numberDigits === candidate.reading.numberDigits &&
          item.reading.percentDigits === candidate.reading.percentDigits,
      )
    ) {
      output.push(candidate);
      break;
    }
  }
  return output;
}

function maxBy<T>(items: T[], getValue: (item: T) => number): T | null {
  if (items.length === 0) {
    return null;
  }
  return items.reduce((best, item) => (getValue(item) > getValue(best) ? item : best), items[0]);
}

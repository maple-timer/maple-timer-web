import type { HuntStallReading } from "../../../contracts/recognition/huntStallExperienceRecognition";
import type { PixelRegion } from "../../../contracts/geometry/pixelRegion";
import {
  classifyBarCoverage,
  type ExpBarEstimate,
} from "../../../recognition/hunt-stall/experience/huntStallExperienceBar";

// Reuse the deterministic browser streaming corrector from the research
// pipeline, but feed it only the lightweight template OCR candidates. This does
// not load Paddle/ONNX models; it only applies candidate/history/total logic on
// top of the fast fixed-Y crop OCR.
import { buildBrowserStreamingRows, parseExpTableCsv } from "./browserStreaming";
// @ts-ignore - Vite can inline raw text assets; TypeScript does not know this external CSV import.
import expTableCsv from "../../../data/maplestory_exp_table_200_299.csv?raw";

type FixedYCorrectionMeta = {
  id: string;
  frameIndex: string;
  timestamp: string;
  cycle: string;
  category?: "no_bar" | "partial_bar" | "full_bar" | "unknown";
  barEstimate?: ExpBarEstimate | null;
  regionPixels?: PixelRegion | null;
};

type BrowserSampleRow = {
  id: string;
  frame_index: string;
  timestamp: string;
  cycle: string;
  category: string;
  bar_percent: string;
  bar_confidence: string;
  bar_fill_x1: string;
  bar_y: string;
};

type BrowserEngineRow = BrowserSampleRow & {
  engine: "template_js";
  predicted_value: string;
  candidate_json: string;
  attempts_json: string;
  latency_ms: string;
};

const MAX_HISTORY_ROWS = 180;
const VALUE_RE = /^([\d,]+)\s+\[(\d{1,3})\.(\d{3})%\]$/;
const PERCENT_SUFFIX_BAR_CONFIDENCE_MIN = 0.9;
const PERCENT_SUFFIX_CORRECTED_BAR_DIFF_MAX = 1.5;
const PERCENT_SUFFIX_MIN_BAR_IMPROVEMENT = 1.0;
const NUMBER_SUFFIX_CORRECTED_BAR_DIFF_MAX = 0.5;
const EMPTY_PERCENT_SUFFIX_CORRECTED_BAR_DIFF_MAX = 1.0;
const GROSS_TOTAL_PERCENT_DIFF_MIN = 3000;
const GROSS_TOTAL_PERCENT_BAR_DIFF_MAX = 1.2;
const GROSS_TOTAL_PERCENT_BAR_CONFIDENCE_MIN = 0.9;
const GROSS_TOTAL_PERCENT_MAX_NUMBER_RATIO = 1.03;
const TOTAL_CONSISTENT_CANDIDATE_DIFF_MAX = 180;
const TOTAL_CONSISTENT_CANDIDATE_MIN_GAIN = 180;
const TOTAL_CONSISTENT_CANDIDATE_SCORE_MAX = 0.24;
const SYNTHETIC_CANDIDATE_SCORE_MAX = 0.24;
const SYNTHETIC_PERCENT_SUPPORT_DIFF_MAX = 90;
const SYNTHETIC_BAR_SUPPORT_DIFF_MAX = 1.6;
const SYNTHETIC_TIGHT_BAR_SUPPORT_DIFF_MAX = 0.4;
const SYNTHETIC_TIGHT_BAR_MIN_GAIN = 30;
const DROP_EXTRA_DIGIT_REPAIR_MAX_INDEX = 4;
const DROP_EXTRA_DIGIT_REPAIR_BAR_DIFF_MAX = 1.7;
const DROP_EXTRA_DIGIT_REPAIR_MIN_BASELINE_GAIN = 2_000;
const DROP_EXTRA_DIGIT_REPAIR_SCORE_MAX = 0.24;
const PERCENT_SUFFIX_TOTAL_REPAIR_BAR_CONFIDENCE_MIN = 0.9;
const PERCENT_SUFFIX_TOTAL_REPAIR_SUPPORTED_WHOLE_BAR_DIFF_MAX = 1.25;
const PERCENT_SUFFIX_TOTAL_REPAIR_BAR_ONLY_DIFF_MAX = 0.55;
const PERCENT_SUFFIX_TOTAL_REPAIR_CANDIDATE_SCORE_MAX = 0.34;
const EXP_TABLE_MIN_TOTAL = 200_000_000;
const EXP_TABLE_MAX_SNAP_RELATIVE_ERROR = 0.0045;
const MAPLE_EXP_TABLE: Array<{ level: number; exp_to_next: number }> = parseExpTableCsv(expTableCsv);

export class FixedYDirectStreamCorrector {
  private samples: BrowserSampleRow[] = [];
  private rows: BrowserEngineRow[] = [];

  reset(): void {
    this.samples = [];
    this.rows = [];
  }

  correct(reading: HuntStallReading, meta: FixedYCorrectionMeta): HuntStallReading {
    const sample = this.sampleRow(meta);
    this.samples.push(sample);
    this.rows.push({
      ...sample,
      engine: "template_js",
      predicted_value: reading.recognizedText ?? "",
      candidate_json: candidateJson(reading, sample.category),
      attempts_json: "[]",
      latency_ms: "0",
    });
    this.trimHistory();

    const streaming = buildBrowserStreamingRows(this.samples, this.rows, {
      delaySeconds: 0,
      expTable: [],
      ensembleBarWeight: 0,
      streamBarWeight: 0,
    });
    const row = streaming.streamRows[streaming.streamRows.length - 1] ?? {};
    const correctedText = String(row.stream_value || "");
    const notes = String(row.stream_notes || "");
    const totalEstimateText = snapExpTableTotalText(String(row.stream_total_estimate || ""));
    if (!correctedText) {
      const totalCandidateCorrected = correctTotalConsistentCandidate(
        reading,
        totalEstimateText,
        sample,
        reading.recognizedText,
      );
      if (totalCandidateCorrected) {
        return {
          ...reading,
          recognizedText: totalCandidateCorrected.text,
          confidence: Math.max(reading.confidence, 0.74),
          debugText: appendDebug(reading.debugText, `total_candidate_repair:${totalCandidateCorrected.source}`),
        };
      }
      const syntheticCorrected = correctSyntheticBarTotalCandidate(
        reading,
        totalEstimateText,
        sample,
        reading.recognizedText,
        notes,
      );
      if (syntheticCorrected) {
        return {
          ...reading,
          recognizedText: syntheticCorrected.text,
          confidence: Math.max(reading.confidence, 0.74),
          debugText: appendDebug(reading.debugText, `synthetic_bar_total:${syntheticCorrected.source}`),
        };
      }
      const dropDigitCorrected = correctDroppedExtraDigitCandidate(
        reading,
        totalEstimateText,
        sample,
        reading.recognizedText,
      );
      if (dropDigitCorrected) {
        return {
          ...reading,
          recognizedText: dropDigitCorrected.text,
          confidence: Math.max(reading.confidence, 0.74),
          debugText: appendDebug(reading.debugText, `drop_extra_digit_total:${dropDigitCorrected.source}`),
        };
      }
      const suffixTotalCorrected = correctPercentSuffixTotalProjection(
        reading,
        totalEstimateText,
        sample,
        reading.recognizedText,
        null,
      );
      if (suffixTotalCorrected) {
        return {
          ...reading,
          recognizedText: suffixTotalCorrected.text,
          confidence: Math.max(reading.confidence, 0.74),
          debugText: appendDebug(reading.debugText, `suffix_total_projection:${suffixTotalCorrected.source}`),
        };
      }
      const grossPercentCorrected = correctGrossPercentFromTotal(reading, totalEstimateText, sample);
      if (grossPercentCorrected) {
        return {
          ...reading,
          recognizedText: grossPercentCorrected.text,
          confidence: Math.max(reading.confidence, 0.72),
          debugText: appendDebug(reading.debugText, `gross_total_percent_repair:${grossPercentCorrected.source}`),
        };
      }
      return reading;
    }
    if (
      correctedText !== reading.recognizedText &&
      notes.includes("percent_suffix") &&
      !allowsPercentSuffixCorrection(reading.recognizedText, correctedText, notes, sample)
    ) {
      const totalCandidateCorrected = correctTotalConsistentCandidate(
        reading,
        totalEstimateText,
        sample,
        reading.recognizedText,
      );
      if (totalCandidateCorrected) {
        return {
          ...reading,
          recognizedText: totalCandidateCorrected.text,
          confidence: Math.max(reading.confidence, 0.74),
          debugText: appendDebug(
            reading.debugText,
            `total_candidate_repair:${totalCandidateCorrected.source}|guarded:${notes}`,
          ),
        };
      }
      const syntheticCorrected = correctSyntheticBarTotalCandidate(
        reading,
        totalEstimateText,
        sample,
        reading.recognizedText,
        notes,
      );
      if (syntheticCorrected) {
        return {
          ...reading,
          recognizedText: syntheticCorrected.text,
          confidence: Math.max(reading.confidence, 0.74),
          debugText: appendDebug(reading.debugText, `synthetic_bar_total:${syntheticCorrected.source}|guarded:${notes}`),
        };
      }
      const dropDigitCorrected = correctDroppedExtraDigitCandidate(
        reading,
        totalEstimateText,
        sample,
        reading.recognizedText,
      );
      if (dropDigitCorrected) {
        return {
          ...reading,
          recognizedText: dropDigitCorrected.text,
          confidence: Math.max(reading.confidence, 0.74),
          debugText: appendDebug(
            reading.debugText,
            `drop_extra_digit_total:${dropDigitCorrected.source}|guarded:${notes}`,
          ),
        };
      }
      const leadingOneCorrected = correctLeadingExtraOne(reading.recognizedText, totalEstimateText);
      if (leadingOneCorrected && leadingOneCorrected !== reading.recognizedText) {
        return {
          ...reading,
          recognizedText: leadingOneCorrected,
          confidence: Math.max(reading.confidence, 0.74),
          debugText: appendDebug(reading.debugText, `leading_one_total:${notes}`),
        };
      }
      const suffixTotalCorrected = correctPercentSuffixTotalProjection(
        reading,
        totalEstimateText,
        sample,
        reading.recognizedText,
        correctedText,
      );
      if (suffixTotalCorrected) {
        return {
          ...reading,
          recognizedText: suffixTotalCorrected.text,
          confidence: Math.max(reading.confidence, 0.74),
          debugText: appendDebug(
            reading.debugText,
            `suffix_total_projection:${suffixTotalCorrected.source}|guarded:${notes}`,
          ),
        };
      }
      const grossPercentCorrected = correctGrossPercentFromTotal(reading, totalEstimateText, sample);
      if (grossPercentCorrected) {
        return {
          ...reading,
          recognizedText: grossPercentCorrected.text,
          confidence: Math.max(reading.confidence, 0.72),
          debugText: appendDebug(
            reading.debugText,
            `gross_total_percent_repair:${grossPercentCorrected.source}|guarded:${notes}`,
          ),
        };
      }
      return {
        ...reading,
        debugText: appendDebug(reading.debugText, `fixed_stream_guarded:${notes}`),
      };
    }
    if (correctedText === reading.recognizedText) {
      const totalCandidateCorrected = correctTotalConsistentCandidate(
        reading,
        totalEstimateText,
        sample,
        correctedText,
      );
      if (totalCandidateCorrected) {
        return {
          ...reading,
          recognizedText: totalCandidateCorrected.text,
          confidence: Math.max(reading.confidence, 0.74),
          debugText: appendDebug(reading.debugText, `total_candidate_repair:${totalCandidateCorrected.source}|${notes}`),
        };
      }
      const syntheticCorrected = correctSyntheticBarTotalCandidate(
        reading,
        totalEstimateText,
        sample,
        correctedText,
        notes,
      );
      if (syntheticCorrected) {
        return {
          ...reading,
          recognizedText: syntheticCorrected.text,
          confidence: Math.max(reading.confidence, 0.74),
          debugText: appendDebug(reading.debugText, `synthetic_bar_total:${syntheticCorrected.source}|${notes}`),
        };
      }
      const dropDigitCorrected = correctDroppedExtraDigitCandidate(reading, totalEstimateText, sample, correctedText);
      if (dropDigitCorrected) {
        return {
          ...reading,
          recognizedText: dropDigitCorrected.text,
          confidence: Math.max(reading.confidence, 0.74),
          debugText: appendDebug(reading.debugText, `drop_extra_digit_total:${dropDigitCorrected.source}|${notes}`),
        };
      }
      const leadingOneCorrected = correctLeadingExtraOne(reading.recognizedText, totalEstimateText);
      if (leadingOneCorrected && leadingOneCorrected !== reading.recognizedText) {
        return {
          ...reading,
          recognizedText: leadingOneCorrected,
          confidence: Math.max(reading.confidence, 0.74),
          debugText: appendDebug(reading.debugText, `leading_one_total:${notes}`),
        };
      }
      const suffixTotalCorrected = correctPercentSuffixTotalProjection(
        reading,
        totalEstimateText,
        sample,
        correctedText,
        null,
      );
      if (suffixTotalCorrected) {
        return {
          ...reading,
          recognizedText: suffixTotalCorrected.text,
          confidence: Math.max(reading.confidence, 0.74),
          debugText: appendDebug(reading.debugText, `suffix_total_projection:${suffixTotalCorrected.source}|${notes}`),
        };
      }
      return {
        ...reading,
        debugText: appendDebug(reading.debugText, notes),
      };
    }

    const totalCandidateCorrected = correctTotalConsistentCandidate(
      reading,
      totalEstimateText,
      sample,
      correctedText,
    );
    if (totalCandidateCorrected) {
      return {
        ...reading,
        recognizedText: totalCandidateCorrected.text,
        confidence: Math.max(reading.confidence, 0.74),
        debugText: appendDebug(
          reading.debugText,
          `total_candidate_repair:${totalCandidateCorrected.source}|fixed_stream:${notes || "corrected"}`,
        ),
      };
    }
    const syntheticCorrected = correctSyntheticBarTotalCandidate(
      reading,
      totalEstimateText,
      sample,
      correctedText,
      notes,
    );
    if (syntheticCorrected) {
      return {
        ...reading,
        recognizedText: syntheticCorrected.text,
        confidence: Math.max(reading.confidence, 0.74),
        debugText: appendDebug(
          reading.debugText,
          `synthetic_bar_total:${syntheticCorrected.source}|fixed_stream:${notes || "corrected"}`,
        ),
      };
    }
    const dropDigitCorrected = correctDroppedExtraDigitCandidate(reading, totalEstimateText, sample, correctedText);
    if (dropDigitCorrected) {
      return {
        ...reading,
        recognizedText: dropDigitCorrected.text,
        confidence: Math.max(reading.confidence, 0.74),
        debugText: appendDebug(
          reading.debugText,
          `drop_extra_digit_total:${dropDigitCorrected.source}|fixed_stream:${notes || "corrected"}`,
        ),
      };
    }
    const suffixTotalCorrected = correctPercentSuffixTotalProjection(
      reading,
      totalEstimateText,
      sample,
      correctedText,
      null,
    );
    if (suffixTotalCorrected) {
      return {
        ...reading,
        recognizedText: suffixTotalCorrected.text,
        confidence: Math.max(reading.confidence, 0.74),
        debugText: appendDebug(
          reading.debugText,
          `suffix_total_projection:${suffixTotalCorrected.source}|fixed_stream:${notes || "corrected"}`,
        ),
      };
    }

    return {
      ...reading,
      recognizedText: correctedText,
      confidence: Math.max(reading.confidence, 0.72),
      debugText: appendDebug(reading.debugText, `fixed_stream:${notes || "corrected"}`),
    };
  }

  private sampleRow(meta: FixedYCorrectionMeta): BrowserSampleRow {
    const category = meta.category ?? classifyBarCoverage(meta.barEstimate ?? null, meta.regionPixels ?? null);
    return {
      id: meta.id,
      frame_index: meta.frameIndex,
      timestamp: meta.timestamp,
      cycle: meta.cycle,
      category,
      bar_percent: meta.barEstimate ? meta.barEstimate.percent.toFixed(3) : "",
      bar_confidence: meta.barEstimate ? meta.barEstimate.confidence.toFixed(3) : "",
      bar_fill_x1: meta.barEstimate ? String(meta.barEstimate.fillX1) : "",
      bar_y: meta.barEstimate ? String(meta.barEstimate.y) : "",
    };
  }

  private trimHistory(): void {
    if (this.samples.length <= MAX_HISTORY_ROWS) {
      return;
    }
    const keepIds = new Set(this.samples.slice(-MAX_HISTORY_ROWS).map((sample) => sample.id));
    this.samples = this.samples.filter((sample) => keepIds.has(sample.id));
    this.rows = this.rows.filter((row) => keepIds.has(row.id));
  }
}

function snapExpTableTotalText(totalEstimateText: string): string {
  const estimate = Number(totalEstimateText);
  if (!Number.isFinite(estimate) || estimate < EXP_TABLE_MIN_TOTAL || MAPLE_EXP_TABLE.length === 0) {
    return totalEstimateText;
  }

  let nearest: { total: number; relativeError: number } | null = null;
  for (const row of MAPLE_EXP_TABLE) {
    const total = row.exp_to_next;
    if (!Number.isFinite(total) || total < EXP_TABLE_MIN_TOTAL) {
      continue;
    }
    const relativeError = Math.abs(total - estimate) / total;
    if (!nearest || relativeError < nearest.relativeError) {
      nearest = { total, relativeError };
    }
  }

  if (!nearest || nearest.relativeError > EXP_TABLE_MAX_SNAP_RELATIVE_ERROR) {
    return totalEstimateText;
  }
  return String(nearest.total);
}

function candidateJson(reading: HuntStallReading, category: string): string {
  const items: Array<{ value: string; number_digits: string; percent_digits: string; score: number; source: string }> = [];
  const seen = new Set<string>();
  const add = (value: string | null | undefined, source: string, score: number) => {
    if (!value || seen.has(value)) {
      return;
    }
    const parsed = parseValue(value);
    if (!parsed) {
      return;
    }
    seen.add(value);
    items.push({
      value: parsed.value,
      number_digits: parsed.numberDigits,
      percent_digits: parsed.percentDigits,
      score,
      source,
    });
  };

  add(reading.recognizedText, "template_js:selected", 0);
  reading.ocrCandidates?.slice(0, 12).forEach((candidate, index) => {
    if (category === "no_bar" && candidate.source?.startsWith("font_boundary_skip:")) {
      return;
    }
    add(candidate.text, candidate.source || `candidate_${index}`, Math.max(0.01, candidate.score || 0.25));
  });
  return JSON.stringify(items);
}

function correctTotalConsistentCandidate(
  reading: HuntStallReading,
  totalEstimateText: string,
  sample: BrowserSampleRow,
  baselineText: string | null,
): { text: string; source: string } | null {
  // When the parser already produced a candidate that is internally consistent
  // with the cycle's total EXP, prefer it over a guarded suffix/consensus result.
  // This does not invent new digits; it only promotes an existing OCR candidate.
  if (sample.category === "no_bar") {
    return null;
  }
  const totalEstimate = Number(totalEstimateText);
  if (!Number.isFinite(totalEstimate) || totalEstimate <= 0) {
    return null;
  }
  const baseline = baselineText ? parseValue(baselineText) : null;
  const baselineNumber = baseline ? Number(baseline.numberDigits) : Number.NaN;
  const baselineMilli = baseline ? Number(baseline.percentDigits) : Number.NaN;
  const baselineDiff =
    baseline &&
    Number.isFinite(baselineNumber) &&
    Number.isFinite(baselineMilli) &&
    baselineNumber > 0 &&
    baselineNumber <= totalEstimate * GROSS_TOTAL_PERCENT_MAX_NUMBER_RATIO
      ? Math.abs(expectedMilli(baselineNumber, totalEstimate) - baselineMilli)
      : Number.POSITIVE_INFINITY;

  let best: { text: string; source: string; diff: number; score: number } | null = null;
  for (const candidate of reading.ocrCandidates?.slice(0, 12) ?? []) {
    if (!isTotalCandidateSourceAllowed(candidate.source) || candidate.score > TOTAL_CONSISTENT_CANDIDATE_SCORE_MAX) {
      continue;
    }
    const parsed = parseValue(candidate.text);
    if (!parsed || parsed.value === baseline?.value) {
      continue;
    }
    const number = Number(parsed.numberDigits);
    const milli = Number(parsed.percentDigits);
    if (
      !Number.isFinite(number) ||
      !Number.isFinite(milli) ||
      number <= 0 ||
      number > totalEstimate * GROSS_TOTAL_PERCENT_MAX_NUMBER_RATIO
    ) {
      continue;
    }
    const diff = Math.abs(expectedMilli(number, totalEstimate) - milli);
    if (
      diff > TOTAL_CONSISTENT_CANDIDATE_DIFF_MAX ||
      (Number.isFinite(baselineDiff) && baselineDiff - diff < TOTAL_CONSISTENT_CANDIDATE_MIN_GAIN)
    ) {
      continue;
    }
    if (!best || diff < best.diff || (diff === best.diff && candidate.score < best.score)) {
      best = { text: parsed.value, source: candidate.source || "candidate", diff, score: candidate.score };
    }
  }

  return best ? { text: best.text, source: best.source } : null;
}

function isTotalCandidateSourceAllowed(source: string | undefined): boolean {
  const value = source ?? "";
  return (
    value.startsWith("font_boundary_skip:") ||
    value.startsWith("font:repaint:") ||
    value.startsWith("font:bar_repaint:")
  );
}

function correctSyntheticBarTotalCandidate(
  reading: HuntStallReading,
  totalEstimateText: string,
  sample: BrowserSampleRow,
  baselineText: string | null,
  notes: string,
): { text: string; source: string } | null {
  // Last-resort probe: build a candidate percent from total EXP for a number
  // that OCR already saw.  This handles cases where the visible percent is a
  // suffix or a nearby candidate carries the correct percent, while still
  // treating the animated bar only as a soft gate.
  if (sample.category === "no_bar") {
    return null;
  }
  const totalEstimate = Number(totalEstimateText);
  const barPercent = Number(sample.bar_percent);
  const barConfidence = Number(sample.bar_confidence);
  if (
    !Number.isFinite(totalEstimate) ||
    totalEstimate <= 0 ||
    !Number.isFinite(barPercent) ||
    !Number.isFinite(barConfidence) ||
    barConfidence < PERCENT_SUFFIX_BAR_CONFIDENCE_MIN
  ) {
    return null;
  }

  const baseline = baselineText ? parseValue(baselineText) : null;
  const baselineDiff = baseline ? totalConsistencyDiff(baseline, totalEstimate) : Number.POSITIVE_INFINITY;
  const shouldProbe = notes.includes("percent_suffix") || !baseline || baselineDiff >= SYNTHETIC_TIGHT_BAR_MIN_GAIN;
  if (!shouldProbe) {
    return null;
  }

  const percentSources = parsedOcrCandidates(reading, baselineText);
  const numberSources = parsedNumberSources(reading, baselineText);
  let best: { text: string; source: string; score: number } | null = null;

  for (const source of numberSources) {
    const number = Number(source.parsed.numberDigits);
    if (
      !Number.isFinite(number) ||
      number <= 0 ||
      number > totalEstimate * GROSS_TOTAL_PERCENT_MAX_NUMBER_RATIO
    ) {
      continue;
    }
    if (source.source !== "baseline" && baseline && sameHighBucket(source.parsed.numberDigits, baseline.numberDigits)) {
      continue;
    }
    const expected = Math.round(expectedMilli(number, totalEstimate));
    if (expected < 0 || expected > 100000) {
      continue;
    }
    const barDiff = Math.abs(expected / 1000 - barPercent);
    const baselineGain = Number.isFinite(baselineDiff) ? baselineDiff - Math.abs(expectedMilli(number, totalEstimate) - expected) : Number.POSITIVE_INFINITY;
    const hasNearPercent = percentSources.some((item) => Math.abs(Number(item.parsed.percentDigits) - expected) <= SYNTHETIC_PERCENT_SUPPORT_DIFF_MAX);
    const hasSuffixPercent = percentSources.some((item) => percentSuffixCompatible(item.parsed.percentDigits, expected));
    if (source.source === "baseline" && !hasNearPercent) {
      continue;
    }
    const hasTightBarSupport =
      barDiff <= SYNTHETIC_TIGHT_BAR_SUPPORT_DIFF_MAX && baselineGain >= SYNTHETIC_TIGHT_BAR_MIN_GAIN;
    const hasSoftBarSupport =
      barDiff <= SYNTHETIC_BAR_SUPPORT_DIFF_MAX && (hasNearPercent || hasSuffixPercent);
    if (!hasSoftBarSupport && !hasTightBarSupport) {
      continue;
    }
    const text = `${addCommas(source.parsed.numberDigits)} [${formatPercent(expected)}%]`;
    if (baseline?.value === text) {
      continue;
    }
    const score =
      source.score +
      barDiff * 0.03 +
      (hasNearPercent ? 0 : 0.08) +
      (hasSuffixPercent ? 0 : 0.08) +
      (source.source === "baseline" ? 0.02 : 0);
    if (!best || score < best.score) {
      best = { text, source: `${source.source}:expected_percent`, score };
    }
  }

  return best ? { text: best.text, source: best.source } : null;
}

function correctDroppedExtraDigitCandidate(
  reading: HuntStallReading,
  totalEstimateText: string,
  sample: BrowserSampleRow,
  baselineText: string | null,
): { text: string; source: string } | null {
  // Very narrow repair for over-segmented number candidates such as
  // "12,408,617,134" where removing one early noise digit yields a table-total
  // consistent value.  This intentionally does not try to solve general
  // full-bar damage; it only tests one extra digit near the number prefix.
  if (sample.category === "no_bar") {
    return null;
  }
  const totalEstimate = Number(totalEstimateText);
  const barPercent = Number(sample.bar_percent);
  const barConfidence = Number(sample.bar_confidence);
  if (
    !Number.isFinite(totalEstimate) ||
    totalEstimate <= 0 ||
    !Number.isFinite(barPercent) ||
    !Number.isFinite(barConfidence) ||
    barConfidence < PERCENT_SUFFIX_BAR_CONFIDENCE_MIN
  ) {
    return null;
  }

  const baseline = baselineText ? parseValue(baselineText) : null;
  const baselineDiff = baseline ? totalConsistencyDiff(baseline, totalEstimate) : Number.POSITIVE_INFINITY;
  let best: { text: string; source: string; score: number } | null = null;

  for (const candidate of reading.ocrCandidates?.slice(0, 12) ?? []) {
    if (
      !isTotalCandidateSourceAllowed(candidate.source) ||
      candidate.score > DROP_EXTRA_DIGIT_REPAIR_SCORE_MAX
    ) {
      continue;
    }
    const parsed = parseValue(candidate.text);
    if (!parsed || parsed.numberDigits.length < 10) {
      continue;
    }
    const originalNumber = Number(parsed.numberDigits);
    if (!Number.isFinite(originalNumber) || originalNumber <= totalEstimate * GROSS_TOTAL_PERCENT_MAX_NUMBER_RATIO) {
      continue;
    }

    for (let index = 1; index <= Math.min(DROP_EXTRA_DIGIT_REPAIR_MAX_INDEX, parsed.numberDigits.length - 9); index += 1) {
      const repairedDigits = parsed.numberDigits.slice(0, index) + parsed.numberDigits.slice(index + 1);
      if (!repairedDigits || repairedDigits.startsWith("0")) {
        continue;
      }
      const repairedNumber = Number(repairedDigits);
      if (
        !Number.isFinite(repairedNumber) ||
        repairedNumber <= 0 ||
        repairedNumber > totalEstimate * GROSS_TOTAL_PERCENT_MAX_NUMBER_RATIO
      ) {
        continue;
      }
      if (baseline && sameHighBucket(repairedDigits, baseline.numberDigits)) {
        continue;
      }
      if (!baseline || commonSuffixLength(repairedDigits, baseline.numberDigits) < 8) {
        continue;
      }
      const expected = Math.round(expectedMilli(repairedNumber, totalEstimate));
      if (expected < 0 || expected > 100000) {
        continue;
      }
      const barDiff = Math.abs(expected / 1000 - barPercent);
      if (barDiff > DROP_EXTRA_DIGIT_REPAIR_BAR_DIFF_MAX) {
        continue;
      }
      const repairedDiff = Math.abs(expectedMilli(repairedNumber, totalEstimate) - expected);
      if (Number.isFinite(baselineDiff) && baselineDiff - repairedDiff < DROP_EXTRA_DIGIT_REPAIR_MIN_BASELINE_GAIN) {
        continue;
      }
      const text = `${addCommas(repairedDigits)} [${formatPercent(expected)}%]`;
      const score = candidate.score + barDiff * 0.03 + index * 0.015;
      if (!best || score < best.score) {
        best = { text, source: `${candidate.source || "candidate"}:drop${index}`, score };
      }
    }
  }

  return best ? { text: best.text, source: best.source } : null;
}

function correctPercentSuffixTotalProjection(
  reading: HuntStallReading,
  totalEstimateText: string,
  sample: BrowserSampleRow,
  baselineText: string | null,
  guardedText: string | null,
): { text: string; source: string } | null {
  // Full-bar damage often preserves only the percent suffix, e.g. ".313%",
  // while corrupting the high EXP digits.  When a table-snapped total is known,
  // synthesize a value from that suffix plus either an OCR-supported percent
  // whole part or a very tight EXP-bar whole-part estimate.
  if (sample.category !== "full_bar") {
    return null;
  }

  const totalEstimate = Number(totalEstimateText);
  const barPercent = Number(sample.bar_percent);
  const barConfidence = Number(sample.bar_confidence);
  if (
    !Number.isFinite(totalEstimate) ||
    totalEstimate < EXP_TABLE_MIN_TOTAL ||
    !Number.isFinite(barPercent) ||
    !Number.isFinite(barConfidence) ||
    barConfidence < PERCENT_SUFFIX_TOTAL_REPAIR_BAR_CONFIDENCE_MIN
  ) {
    return null;
  }

  const baseline = baselineText ? parseValue(baselineText) : null;
  const guarded = guardedText && guardedText !== baselineText ? parseValue(guardedText) : null;
  if (!isImpossibleForPercentSuffixTotalProjection(baseline, totalEstimate)) {
    return null;
  }

  const sources = parsedOcrCandidates(reading, baselineText);

  const suffixes = new Map<string, { score: number; source: string }>();
  const wholeParts = new Map<number, { score: number; source: string }>();
  if (baseline) {
    const baselineMilli = Number(baseline.percentDigits);
    if (Number.isFinite(baselineMilli) && baselineMilli >= 0 && baselineMilli <= 100000) {
      suffixes.set(String(baselineMilli % 1000).padStart(3, "0"), { score: 0, source: "baseline" });
    }
  }

  for (const item of sources) {
    if (item.source !== "baseline" && item.score > PERCENT_SUFFIX_TOTAL_REPAIR_CANDIDATE_SCORE_MAX) {
      continue;
    }
    const milli = Number(item.parsed.percentDigits);
    if (!Number.isFinite(milli) || milli < 0 || milli > 100000) {
      continue;
    }
    const whole = Math.floor(milli / 1000);
    if (item.source !== "baseline" && whole >= 10 && whole <= 100) {
      const wholeCurrent = wholeParts.get(whole);
      if (!wholeCurrent || item.score < wholeCurrent.score) {
        wholeParts.set(whole, { score: item.score, source: item.source });
      }
    }
  }

  if (!suffixes.size) {
    return null;
  }

  let best: { text: string; source: string; priority: number; score: number } | null = null;
  for (const [suffixText, suffix] of suffixes) {
    const suffixValue = Number(suffixText);
    if (!Number.isFinite(suffixValue)) {
      continue;
    }

    for (const [whole, wholeSupport] of wholeParts) {
      const milli = whole * 1000 + suffixValue;
      const barDiff = Math.abs(milli / 1000 - barPercent);
      if (milli > 100000 || barDiff > PERCENT_SUFFIX_TOTAL_REPAIR_SUPPORTED_WHOLE_BAR_DIFF_MAX) {
        continue;
      }
      const text = projectedTextFromTotal(totalEstimate, milli, baseline, guarded);
      if (!text) {
        continue;
      }
      const score = wholeSupport.score * 0.5 + suffix.score * 0.2 + barDiff * 0.1;
      const source = `whole:${wholeSupport.source}|suffix:${suffix.source}|bar_diff=${barDiff.toFixed(3)}`;
      if (!best || 0 < best.priority || (best.priority === 0 && score < best.score)) {
        best = { text, source, priority: 0, score };
      }
    }

    const barWhole = Math.round(barPercent - suffixValue / 1000);
    if (barWhole >= 0 && barWhole <= 100) {
      const milli = barWhole * 1000 + suffixValue;
      const barDiff = Math.abs(milli / 1000 - barPercent);
      if (milli <= 100000 && barDiff <= PERCENT_SUFFIX_TOTAL_REPAIR_BAR_ONLY_DIFF_MAX) {
        const text = projectedTextFromTotal(totalEstimate, milli, baseline, guarded);
        if (text) {
          const score = 1 + suffix.score * 0.2 + barDiff * 0.1;
          const source = `bar_whole:${barWhole}|suffix:${suffix.source}|bar_diff=${barDiff.toFixed(3)}`;
          if (!best || 1 < best.priority || (best.priority === 1 && score < best.score)) {
            best = { text, source, priority: 1, score };
          }
        }
      }
    }
  }

  return best ? { text: best.text, source: best.source } : null;
}

function isImpossibleForPercentSuffixTotalProjection(
  parsed: ReturnType<typeof parseValue>,
  totalEstimate: number,
): boolean {
  if (!parsed) {
    return true;
  }
  const number = Number(parsed.numberDigits);
  return !Number.isFinite(number) || number <= 0 || number > totalEstimate * 1.03;
}

function projectedTextFromTotal(
  totalEstimate: number,
  milli: number,
  baseline: ReturnType<typeof parseValue>,
  guarded: ReturnType<typeof parseValue>,
): string | null {
  const number = Math.round((totalEstimate * milli) / 100000);
  if (!Number.isFinite(number) || number <= 0 || number > totalEstimate * 1.005) {
    return null;
  }
  const text = `${addCommas(String(number))} [${formatPercent(milli)}%]`;
  if (baseline?.value === text || guarded?.value === text) {
    return null;
  }
  return text;
}

function parsedOcrCandidates(
  reading: HuntStallReading,
  baselineText: string | null,
): Array<{ parsed: NonNullable<ReturnType<typeof parseValue>>; source: string; score: number }> {
  const output: Array<{ parsed: NonNullable<ReturnType<typeof parseValue>>; source: string; score: number }> = [];
  const seen = new Set<string>();
  const add = (text: string | null | undefined, source: string, score: number) => {
    if (!text) {
      return;
    }
    const parsed = parseValue(text);
    if (!parsed || seen.has(parsed.value)) {
      return;
    }
    seen.add(parsed.value);
    output.push({ parsed, source, score });
  };
  add(baselineText, "baseline", 0.02);
  reading.ocrCandidates?.slice(0, 12).forEach((candidate) => {
    add(candidate.text, candidate.source || "candidate", candidate.score || 0.25);
  });
  return output;
}

function parsedNumberSources(
  reading: HuntStallReading,
  baselineText: string | null,
): Array<{ parsed: NonNullable<ReturnType<typeof parseValue>>; source: string; score: number }> {
  return parsedOcrCandidates(reading, baselineText).filter((candidate) => {
    if (candidate.source === "baseline") {
      return true;
    }
    return isSyntheticNumberSourceAllowed(candidate.source) && candidate.score <= SYNTHETIC_CANDIDATE_SCORE_MAX;
  });
}

function isSyntheticNumberSourceAllowed(source: string): boolean {
  return isTotalCandidateSourceAllowed(source) || source.startsWith("font:bright:");
}

function totalConsistencyDiff(parsed: NonNullable<ReturnType<typeof parseValue>>, totalEstimate: number): number {
  const number = Number(parsed.numberDigits);
  const milli = Number(parsed.percentDigits);
  if (!Number.isFinite(number) || !Number.isFinite(milli) || number <= 0 || number > totalEstimate * 1.1) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.abs(expectedMilli(number, totalEstimate) - milli);
}

function sameHighBucket(leftDigits: string, rightDigits: string): boolean {
  const left = Number(leftDigits);
  const right = Number(rightDigits);
  if (!Number.isFinite(left) || !Number.isFinite(right)) {
    return false;
  }
  return Math.floor(left / 100_000_000) === Math.floor(right / 100_000_000);
}

function commonSuffixLength(left: string, right: string): number {
  let length = 0;
  while (
    length < left.length &&
    length < right.length &&
    left[left.length - 1 - length] === right[right.length - 1 - length]
  ) {
    length += 1;
  }
  return length;
}

function percentSuffixCompatible(rawPercentDigits: string, expectedMilliPercent: number): boolean {
  const raw = String(Number(rawPercentDigits));
  if (raw.length < 3 || raw.length > 4) {
    return false;
  }
  return String(expectedMilliPercent).endsWith(raw);
}

function correctGrossPercentFromTotal(
  reading: HuntStallReading,
  totalEstimateText: string,
  sample: BrowserSampleRow,
): { text: string; source: string } | null {
  // Gross percent repair only fixes cases where OCR kept a plausible EXP
  // number but dropped the large percent prefix, e.g. "2.640%" instead of
  // "52.640%".  It never rewrites a recognized number; fallback candidates are
  // used only when the recognized value is empty because confidence was low.
  if (sample.category === "no_bar") {
    return null;
  }
  const totalEstimate = Number(totalEstimateText);
  const barPercent = Number(sample.bar_percent);
  const barConfidence = Number(sample.bar_confidence);
  if (
    !Number.isFinite(totalEstimate) ||
    totalEstimate <= 0 ||
    !Number.isFinite(barPercent) ||
    !Number.isFinite(barConfidence) ||
    barConfidence < GROSS_TOTAL_PERCENT_BAR_CONFIDENCE_MIN
  ) {
    return null;
  }

  for (const source of grossPercentSources(reading)) {
    const parsed = source.loose ? parseLooseValue(source.text) : parseValue(source.text);
    if (!parsed) {
      continue;
    }
    const number = Number(parsed.numberDigits);
    const displayedMilli = Number(parsed.percentDigits);
    if (
      !Number.isFinite(number) ||
      !Number.isFinite(displayedMilli) ||
      number <= 0 ||
      number > totalEstimate * GROSS_TOTAL_PERCENT_MAX_NUMBER_RATIO
    ) {
      continue;
    }

    const expected = Math.round(expectedMilli(number, totalEstimate));
    if (
      expected < 0 ||
      expected > 100000 ||
      Math.abs(expected - displayedMilli) < GROSS_TOTAL_PERCENT_DIFF_MIN ||
      Math.abs(expected / 1000 - barPercent) > GROSS_TOTAL_PERCENT_BAR_DIFF_MAX
    ) {
      continue;
    }

    return {
      text: `${addCommas(parsed.numberDigits)} [${formatPercent(expected)}%]`,
      source: source.source,
    };
  }

  return null;
}

function grossPercentSources(reading: HuntStallReading): Array<{ text: string; source: string; loose: boolean }> {
  const sources: Array<{ text: string; source: string; loose: boolean }> = [];
  const seen = new Set<string>();
  const add = (text: string | null | undefined, source: string, loose: boolean) => {
    if (!text || seen.has(`${loose}:${text}`)) {
      return;
    }
    seen.add(`${loose}:${text}`);
    sources.push({ text, source, loose });
  };

  add(reading.recognizedText, "recognized", false);
  if (reading.recognizedText) {
    return sources;
  }

  reading.ocrCandidates?.slice(0, 4).forEach((candidate, index) => {
    add(candidate.text, `candidate${index + 1}`, false);
  });
  add(reading.debugText, "debug", true);
  return sources;
}

function allowsPercentSuffixCorrection(
  rawText: string | null,
  correctedText: string,
  notes: string,
  sample: BrowserSampleRow,
): boolean {
  if (notes.includes("number_suffix")) {
    return allowsNumberAndPercentSuffixCorrection(rawText, correctedText, notes, sample);
  }

  // Percent-suffix repair is the riskiest part of the research corrector.  In
  // live OCR we only accept it when the number stays identical and the visible
  // EXP bar strongly supports the repaired percent over the raw percent.
  if (sample.category === "no_bar") {
    return false;
  }
  const raw = rawText ? parseValue(rawText) : null;
  const corrected = parseValue(correctedText);
  if (!raw) {
    return allowsEmptyPercentSuffixCorrection(corrected, sample);
  }
  if (!raw || !corrected || raw.numberDigits !== corrected.numberDigits) {
    return false;
  }
  const barPercent = Number(sample.bar_percent);
  const barConfidence = Number(sample.bar_confidence);
  if (
    !Number.isFinite(barPercent) ||
    !Number.isFinite(barConfidence) ||
    barConfidence < PERCENT_SUFFIX_BAR_CONFIDENCE_MIN
  ) {
    return false;
  }
  const rawDiff = Math.abs(Number(raw.percentDigits) / 1000 - barPercent);
  const correctedDiff = Math.abs(Number(corrected.percentDigits) / 1000 - barPercent);
  return (
    correctedDiff <= PERCENT_SUFFIX_CORRECTED_BAR_DIFF_MAX &&
    rawDiff - correctedDiff >= PERCENT_SUFFIX_MIN_BAR_IMPROVEMENT
  );
}

function allowsEmptyPercentSuffixCorrection(
  corrected: ReturnType<typeof parseValue>,
  sample: BrowserSampleRow,
): boolean {
  if (!corrected || sample.category !== "full_bar") {
    return false;
  }
  const barPercent = Number(sample.bar_percent);
  const barConfidence = Number(sample.bar_confidence);
  if (
    !Number.isFinite(barPercent) ||
    !Number.isFinite(barConfidence) ||
    barConfidence < PERCENT_SUFFIX_BAR_CONFIDENCE_MIN
  ) {
    return false;
  }
  return Math.abs(Number(corrected.percentDigits) / 1000 - barPercent) <= EMPTY_PERCENT_SUFFIX_CORRECTED_BAR_DIFF_MAX;
}

function correctLeadingExtraOne(rawText: string | null, totalEstimateText: string): string | null {
  const raw = rawText ? parseValue(rawText) : null;
  const totalEstimate = Number(totalEstimateText);
  if (!raw || !Number.isFinite(totalEstimate) || totalEstimate <= 0) {
    return null;
  }
  if (!raw.numberDigits.startsWith("1") || raw.numberDigits.length < 10) {
    return null;
  }
  const trimmedDigits = raw.numberDigits.slice(1);
  if (!trimmedDigits || trimmedDigits.startsWith("0")) {
    return null;
  }
  const rawNumber = Number(raw.numberDigits);
  const trimmedNumber = Number(trimmedDigits);
  const displayedMilli = Number(raw.percentDigits);
  if (
    !Number.isFinite(rawNumber) ||
    !Number.isFinite(trimmedNumber) ||
    !Number.isFinite(displayedMilli) ||
    trimmedNumber <= 0
  ) {
    return null;
  }
  const rawDiff = Math.abs(expectedMilli(rawNumber, totalEstimate) - displayedMilli);
  const trimmedDiff = Math.abs(expectedMilli(trimmedNumber, totalEstimate) - displayedMilli);
  if (trimmedDiff <= 180 && rawDiff - trimmedDiff >= 8_000) {
    return `${addCommas(trimmedDigits)} [${formatPercent(displayedMilli)}%]`;
  }
  return null;
}

function expectedMilli(number: number, total: number): number {
  return (number / total) * 100000;
}

function allowsNumberAndPercentSuffixCorrection(
  rawText: string | null,
  correctedText: string,
  notes: string,
  sample: BrowserSampleRow,
): boolean {
  // Number+percent suffix repair can change high-value digits, so it is much
  // stricter than percent-only repair.  We only allow long visible number
  // suffixes in full-bar frames, and require the repaired percent to agree with
  // the measured bar.  If OCR returned no raw value, a 7-digit suffix is also
  // accepted because there is no safer raw reading to preserve.
  if (sample.category !== "full_bar") {
    return false;
  }
  const suffixLength = numberSuffixLength(notes);
  if (suffixLength === null) {
    return false;
  }
  const raw = rawText ? parseValue(rawText) : null;
  if (suffixLength < 8 && !(suffixLength >= 7 && !raw)) {
    return false;
  }
  const corrected = parseValue(correctedText);
  if (!corrected) {
    return false;
  }
  const barPercent = Number(sample.bar_percent);
  const barConfidence = Number(sample.bar_confidence);
  if (
    !Number.isFinite(barPercent) ||
    !Number.isFinite(barConfidence) ||
    barConfidence < PERCENT_SUFFIX_BAR_CONFIDENCE_MIN
  ) {
    return false;
  }
  return Math.abs(Number(corrected.percentDigits) / 1000 - barPercent) <= NUMBER_SUFFIX_CORRECTED_BAR_DIFF_MAX;
}

function numberSuffixLength(notes: string): number | null {
  const match = /number_suffix(\d+)/.exec(notes);
  return match ? Number(match[1]) : null;
}

function parseValue(value: string): { value: string; numberDigits: string; percentDigits: string } | null {
  const match = VALUE_RE.exec(value.trim());
  if (!match) {
    return null;
  }
  const numberDigits = match[1].replace(/\D/g, "");
  const percentDigits = `${Number.parseInt(match[2], 10)}${match[3]}`;
  if (!numberDigits || !percentDigits || Number(percentDigits) > 100000) {
    return null;
  }
  return {
    value: `${addCommas(numberDigits)} [${formatPercent(Number(percentDigits))}%]`,
    numberDigits,
    percentDigits,
  };
}

function parseLooseValue(value: string): { value: string; numberDigits: string; percentDigits: string } | null {
  const match = /([\d,]+)\s+\[(\d{1,3})\.(\d{3})%\]/.exec(value.trim());
  if (!match) {
    return null;
  }
  const numberDigits = match[1].replace(/\D/g, "");
  const percentDigits = `${Number.parseInt(match[2], 10)}${match[3]}`;
  if (!numberDigits || !percentDigits || Number(percentDigits) > 100000) {
    return null;
  }
  return {
    value: `${addCommas(numberDigits)} [${formatPercent(Number(percentDigits))}%]`,
    numberDigits,
    percentDigits,
  };
}

function addCommas(rawDigits: string): string {
  const parts: string[] = [];
  let digits = rawDigits;
  while (digits.length > 0) {
    parts.unshift(digits.slice(-3));
    digits = digits.slice(0, -3);
  }
  return parts.join(",");
}

function formatPercent(milliPercent: number): string {
  const rounded = Math.max(0, Math.min(100000, Math.round(milliPercent)));
  return `${Math.floor(rounded / 1000)}.${String(rounded % 1000).padStart(3, "0")}`;
}

function appendDebug(debugText: string | undefined, note: string): string {
  const cleanNote = note.trim();
  if (!cleanNote) {
    return debugText ?? "";
  }
  return [debugText, cleanNote].filter(Boolean).join(" | ");
}

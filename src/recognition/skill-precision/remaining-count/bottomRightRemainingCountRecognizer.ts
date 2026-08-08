import model from "./bottomRightCooldownCnn.model.json";
import { recognizeBottomRightCooldownCnn } from "./bottomRightCooldownCnnRuntime";
import {
  BOTTOM_RIGHT_REMAINING_COUNT_RECOGNIZER_VERSION,
  type BottomRightRemainingCountCandidate,
  type BottomRightRemainingCountObservation,
  type BottomRightRemainingCountRecognizer,
} from "./bottomRightRemainingCountContract";

type RawBottomRightCooldownCandidate = {
  text?: string | null;
  totalSeconds?: number | null;
  expectedSeconds?: number | null;
  probability?: number;
  className?: string;
  classIndex?: number;
  score?: number;
};

type RawBottomRightCooldownResult = {
  kind?: "exact" | "none";
  text?: string | null;
  totalSeconds?: number | null;
  expectedSeconds?: number | null;
  format?: string;
  textRegion?: string;
  confidence?: number;
  status?: "high" | "medium" | "low" | "missing";
  bestGuess?: RawBottomRightCooldownCandidate | null;
  candidates?: RawBottomRightCooldownCandidate[];
  debug?: BottomRightRemainingCountObservation["debug"];
};

const MIN_CONFIDENCE = 0.62;

export function createBottomRightRemainingCountRecognizer(): BottomRightRemainingCountRecognizer {
  if (model.version !== BOTTOM_RIGHT_REMAINING_COUNT_RECOGNIZER_VERSION) {
    throw new Error(
      `Remaining-count model version mismatch: ${model.version}`,
    );
  }
  return {
    recognizeIfReady(icon) {
      const result = recognizeBottomRightCooldownCnn(icon, model, {
        minConfidence: MIN_CONFIDENCE,
        maxCandidates: 5,
      }) as RawBottomRightCooldownResult;
      return normalizeBottomRightRemainingCountResult(result);
    },
    getStatus() {
      return "ready";
    },
  };
}

function normalizeBottomRightRemainingCountResult(
  result: RawBottomRightCooldownResult | null | undefined,
): BottomRightRemainingCountObservation | null {
  if (!result) {
    return null;
  }

  const rawCount = typeof result.totalSeconds === "number" ? result.totalSeconds : null;
  const count = rawCount !== null && Number.isFinite(rawCount)
    ? Math.max(0, Math.round(rawCount))
    : null;
  const candidates = (result.candidates ?? []).map(normalizeCandidate);
  const isExact = result.kind === "exact" && count !== null;
  return {
    kind: isExact ? "exact" : "none",
    text: result.text ?? (count === null ? null : String(count)),
    count,
    expectedCount: count,
    format: isExact ? "remaining-count" : "none",
    textRegion: isExact ? "bottom-right" : result.textRegion === "bottom-right" ? "bottom-right" : "none",
    confidence: round(result.confidence ?? 0),
    status: result.status ?? "missing",
    bestGuess: result.bestGuess ? normalizeCandidate(result.bestGuess) : null,
    candidates,
    debug: result.debug,
  };
}

function normalizeCandidate(
  candidate: RawBottomRightCooldownCandidate,
): BottomRightRemainingCountCandidate {
  const count = typeof candidate.totalSeconds === "number" && Number.isFinite(candidate.totalSeconds)
    ? Math.max(0, Math.round(candidate.totalSeconds))
    : null;
  return {
    text: candidate.text ?? (count === null ? null : String(count)),
    count,
    probability: round(candidate.probability ?? 0),
    className: candidate.className,
    classIndex: candidate.classIndex,
    score: candidate.score,
  };
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}

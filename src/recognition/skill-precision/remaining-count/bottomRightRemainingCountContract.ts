export const BOTTOM_RIGHT_REMAINING_COUNT_RECOGNIZER_VERSION =
  "bottom-right-cooldown-cnn-v1";

export type BottomRightRemainingCountIcon = {
  width: number;
  height: number;
  data: Uint8ClampedArray;
};

export type BottomRightRemainingCountModelStatus = "idle" | "ready";

export type BottomRightRemainingCountCandidate = {
  text: string | null;
  count: number | null;
  probability: number;
  className?: string;
  classIndex?: number;
  score?: number;
};

export type BottomRightRemainingCountObservation = {
  kind: "exact" | "none";
  text: string | null;
  count: number | null;
  expectedCount: number | null;
  format: "remaining-count" | "none";
  textRegion: "bottom-right" | "none";
  confidence: number;
  status: "high" | "medium" | "low" | "missing";
  bestGuess?: BottomRightRemainingCountCandidate | null;
  candidates: BottomRightRemainingCountCandidate[];
  debug?: {
    roi?: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
  };
};

export type BottomRightRemainingCountRecognizer = {
  recognizeIfReady(icon: BottomRightRemainingCountIcon): BottomRightRemainingCountObservation | null;
  getStatus(): BottomRightRemainingCountModelStatus;
};

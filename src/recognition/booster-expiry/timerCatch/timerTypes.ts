export type PixelArray = Uint8Array | Uint8ClampedArray;

export type ImageDataLike = {
  width: number;
  height: number;
  data: PixelArray;
};

export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DigitRatio = {
  xRatio: number;
  yRatio: number;
  widthRatio: number;
  heightRatio: number;
};

export type SevenSegmentDigitResult = {
  ok: boolean;
  reason: string;
  index?: number;
  rect?: Rect;
  mask: number | null;
  rawMask?: number | null;
  rawDigit?: number | null;
  digit: number | null;
  score?: number;
  scoreMargin?: number;
  confidence?: number;
  selectedBy?: string;
  densities?: number[];
  candidates?: Array<{ digit: number; mask: number; score: number }>;
};

export type TimeReadResult = {
  ok: boolean;
  reason: string;
  rect: Rect | null;
  digits: number[];
  digitResults: SevenSegmentDigitResult[];
  seconds: number | null;
  text: string | null;
  format?: "mm:ss" | "m:ss" | "ss.cc" | "s.cc";
  selectedBy?: string;
};

export type SevenSegmentOptions = {
  digitRatios?: readonly DigitRatio[];
  threshold?: number;
  brightnessMode?: "red-channel" | "max-channel" | "luma";
  rejectBrightBorder?: boolean;
  allowBlankLeadingDigit?: boolean;
  maskToDigit?: Readonly<Record<number, number>>;
  areaPreprocess?: boolean;
  areaPreprocessClosing?: boolean;
  areaPreprocessDilation?: number;
  minFuzzyOnSegments?: number;
  minFuzzyMargin?: number;
  requireFuzzyHorizontalSignal?: boolean;
  allowFuzzyCandidateFallback?: boolean;
  fuzzyTopSignalRatio?: number;
  fuzzyMiddleSignalRatio?: number;
  fuzzyBottomSignalRatio?: number;
  fuzzyVerticalSignalRatio?: number;
  maxMapleMinuteSecondMinutes?: number;
  minMapleMinuteSecondDigitConfidence?: number;
  rejectAmbiguousMapleMinuteSecondFuzzyDigits?: boolean;
  minAmbiguousMapleMinuteSecondFuzzyConfidence?: number;
  minAmbiguousMapleMinuteSecondFuzzyMargin?: number;
  correctWeakDirectAreaDigit?: boolean;
  minDirectCorrectionMargin?: number;
  allowSyntheticTemplateFallback?: boolean;
  minSyntheticTemplateDigitScore?: number;
  minSyntheticTemplateDigitMargin?: number;
};

export type TimerRectOptions = {
  roi?: Rect | readonly [number, number, number, number];
  minRectWidth?: number;
  minRectHeight?: number;
  sobelThresholdRatio?: number;
  maxRectLeftRatio?: number;
  maxCandidates?: number;
  maxMatches?: number;
  timeReadOptions?: SevenSegmentOptions;
};

export type TimerRectMatch = {
  rect: Rect;
  time: TimeReadResult;
  score: number;
};

export type TimerRectResult = {
  ok: boolean;
  reason: string;
  rect: Rect | null;
  time: TimeReadResult | null;
  matches: TimerRectMatch[];
  candidates: Rect[];
  roi: Rect | null;
};

export type TimerFlowOptions = {
  frameIntervalMs?: number;
  maxJumpSeconds?: number;
  lockToleranceSeconds?: number;
  maxHoldSeconds?: number;
  minLockObservations?: number;
  resetJumpSeconds?: number;
};

export type TimerFlowCorrection = {
  locked: boolean;
  source: string;
  time: TimeReadResult | null;
  rawTime: TimeReadResult | null;
  predictedSeconds: number | null;
  rawDeltaSeconds: number | null;
  timestampMs: number;
};

export type TimerCatchAnalyzeOptions = {
  roi?: Rect | readonly [number, number, number, number];
  timeRect?: Rect | readonly [number, number, number, number] | null;
  timerRect?: TimerRectOptions;
  timeRead?: SevenSegmentOptions;
  timerFlow?: TimerFlowOptions;
  timestampMs?: number;
  autoUpscale?: boolean;
  minTimerAnalysisHeight?: number;
  maxTimerAnalysisScale?: number;
};

export type TimerCatchTimerAnalysisResult = {
  timeRect: TimerRectResult;
  time: TimeReadResult | null;
};

export type TimerCatchFlowResult = TimerCatchTimerAnalysisResult & {
  rawTime: TimeReadResult | null;
  flow: TimerFlowCorrection;
};

export type TimerCatchFlowTracker = {
  update(imageData: ImageDataLike, updateOptions?: TimerCatchAnalyzeOptions): TimerCatchFlowResult;
  reset(): void;
};

export type TimerCatchOptions = Omit<TimerCatchAnalyzeOptions, "timerFlow"> & {
  timerFlow?: TimerFlowOptions;
};

export type TimerCatchFrameOptions = TimerCatchOptions;
export type TimerCatchResult = TimerCatchFlowResult;
export type TimerCatchTracker = TimerCatchFlowTracker;

export const TIMER_CATCH_TIME_DIGIT_RATIOS: readonly DigitRatio[] = Object.freeze([
  Object.freeze({ xRatio: 0.385, yRatio: 0.175, widthRatio: 0.095, heightRatio: 0.615 }),
  Object.freeze({ xRatio: 0.48, yRatio: 0.175, widthRatio: 0.098, heightRatio: 0.615 }),
  Object.freeze({ xRatio: 0.698, yRatio: 0.175, widthRatio: 0.101, heightRatio: 0.615 }),
  Object.freeze({ xRatio: 0.799, yRatio: 0.175, widthRatio: 0.098, heightRatio: 0.615 }),
]);

export const MAPLE_REMAINING_TIME_DIGIT_RATIOS: readonly DigitRatio[] = Object.freeze([
  Object.freeze({ xRatio: 0.464, yRatio: 0.021, widthRatio: 0.123, heightRatio: 0.851 }),
  Object.freeze({ xRatio: 0.692, yRatio: 0.064, widthRatio: 0.123, heightRatio: 0.723 }),
  Object.freeze({ xRatio: 0.792, yRatio: 0.064, widthRatio: 0.118, heightRatio: 0.723 }),
]);

export const MAPLE_DECIMAL_TIME_DIGIT_RATIOS: readonly DigitRatio[] = Object.freeze([
  Object.freeze({ xRatio: 0.408, yRatio: 0.08, widthRatio: 0.105, heightRatio: 0.75 }),
  Object.freeze({ xRatio: 0.508, yRatio: 0.08, widthRatio: 0.105, heightRatio: 0.75 }),
  Object.freeze({ xRatio: 0.67, yRatio: 0.08, widthRatio: 0.105, heightRatio: 0.75 }),
  Object.freeze({ xRatio: 0.778, yRatio: 0.08, widthRatio: 0.105, heightRatio: 0.75 }),
]);

export const MAPLE_SINGLE_SECOND_DECIMAL_TIME_DIGIT_RATIOS: readonly DigitRatio[] = Object.freeze([
  Object.freeze({ xRatio: 0.482, yRatio: 0.08, widthRatio: 0.155, heightRatio: 0.75 }),
  Object.freeze({ xRatio: 0.67, yRatio: 0.08, widthRatio: 0.105, heightRatio: 0.75 }),
  Object.freeze({ xRatio: 0.778, yRatio: 0.08, widthRatio: 0.105, heightRatio: 0.75 }),
]);

export const SEVEN_SEGMENT_DIGIT_TO_MASK: readonly number[] = Object.freeze([
  0x77,
  0x24,
  0x5d,
  0x6d,
  0x2e,
  0x6b,
  0x7b,
  0x25,
  0x7f,
  0x6f,
]);

export const SEVEN_SEGMENT_MASK_TO_DIGIT: Readonly<Record<number, number>> = Object.freeze(
  SEVEN_SEGMENT_DIGIT_TO_MASK.reduce<Record<number, number>>((index, mask, digit) => {
    index[mask] = digit;
    return index;
  }, {}),
);

export const DEFAULT_TIMER_CATCH_FLOW_OPTIONS: Readonly<Required<TimerFlowOptions>> = Object.freeze({
  frameIntervalMs: 1000,
  maxJumpSeconds: 1.25,
  lockToleranceSeconds: 1.5,
  maxHoldSeconds: 12,
  minLockObservations: 2,
  resetJumpSeconds: 30,
});

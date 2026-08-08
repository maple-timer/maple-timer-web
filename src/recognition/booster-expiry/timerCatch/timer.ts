import {
  assertImageData,
  cropImageData,
  makeTimerAnalysisImageData,
  mapTimerRectResult,
  mergeFrameOptions,
  normalizeStrictRect,
  resolveTimerCatchRoi,
  scaleRectInput,
  scaleTimerRectOptions,
} from "./timerImage";
import { makeTimerFlowState, updateTimerFlowState } from "./timerFlowCore";
import {
  findTimerCatchTimeRect,
  makeFixedTimerRectResult,
} from "./timerRectDetector";
import { DEFAULT_TIMER_CATCH_FLOW_OPTIONS } from "./timerTypes";
import type {
  ImageDataLike,
  Rect,
  SevenSegmentOptions,
  TimerCatchAnalyzeOptions,
  TimerCatchFlowResult,
  TimerCatchFlowTracker,
  TimerCatchOptions,
  TimerCatchTracker,
  TimerRectOptions,
  TimerCatchTimerAnalysisResult,
} from "./timerTypes";

export { cropImageData, resolveTimerCatchRoi } from "./timerImage";
export {
  readSevenSegmentDigit,
  readSevenSegmentDigits,
  readTimerCatchSegmentTime,
  readTimerCatchTime,
  readTimerCatchTimeSeconds,
} from "./timerDigitReader";
export {
  findEdgeRectCandidates,
  findTimerCatchTimeRect,
  makeSobelEdgeMask,
} from "./timerRectDetector";
export {
  DEFAULT_TIMER_CATCH_FLOW_OPTIONS,
  MAPLE_DECIMAL_TIME_DIGIT_RATIOS,
  MAPLE_REMAINING_TIME_DIGIT_RATIOS,
  MAPLE_SINGLE_SECOND_DECIMAL_TIME_DIGIT_RATIOS,
  SEVEN_SEGMENT_DIGIT_TO_MASK,
  SEVEN_SEGMENT_MASK_TO_DIGIT,
  TIMER_CATCH_TIME_DIGIT_RATIOS,
} from "./timerTypes";
export type {
  DigitRatio,
  ImageDataLike,
  PixelArray,
  Rect,
  SevenSegmentDigitResult,
  SevenSegmentOptions,
  TimeReadResult,
  TimerCatchAnalyzeOptions,
  TimerCatchFlowResult,
  TimerCatchFlowTracker,
  TimerCatchFrameOptions,
  TimerCatchOptions,
  TimerCatchResult,
  TimerCatchTimerAnalysisResult,
  TimerCatchTracker,
  TimerFlowCorrection,
  TimerFlowOptions,
  TimerRectMatch,
  TimerRectOptions,
  TimerRectResult,
} from "./timerTypes";

export function analyzeTimerCatchTimer(
  imageData: ImageDataLike,
  options: TimerCatchAnalyzeOptions = {},
): TimerCatchTimerAnalysisResult {
  assertImageData(imageData);
  const roi = resolveTimerCatchRoi(imageData, options.roi);
  const timerAnalysis = makeTimerAnalysisImageData(imageData, options);
  const timerImageData = timerAnalysis.imageData;
  const timerScale = timerAnalysis.scale;
  const timerRectOptions: TimerRectOptions = {
    ...scaleTimerRectOptions(options.timerRect ?? {}, timerScale),
    roi: scaleRectInput(options.timerRect?.roi ?? roi, timerScale) ?? roi,
    timeReadOptions: {
      ...(options.timeRead ?? {}),
      ...(options.timerRect?.timeReadOptions ?? {}),
    },
  };

  const fixedTimeRect = normalizeStrictRect(
    scaleRectInput(options.timeRect ?? null, timerScale),
    timerImageData.width,
    timerImageData.height,
  );
  const timeRect = fixedTimeRect
    ? makeFixedTimerRectResult(
        timerImageData,
        fixedTimeRect,
        timerRectOptions.timeReadOptions,
      )
    : findTimerCatchTimeRect(timerImageData, timerRectOptions);
  const mappedTimeRect =
    timerScale === 1 ? timeRect : mapTimerRectResult(timeRect, 1 / timerScale);

  return {
    timeRect: mappedTimeRect,
    time: mappedTimeRect.time,
  };
}

export function createTimerCatchFlowTracker(
  options: TimerCatchAnalyzeOptions = {},
): TimerCatchFlowTracker {
  let state = makeTimerFlowState();

  return {
    update(
      imageData: ImageDataLike,
      updateOptions: TimerCatchAnalyzeOptions = {},
    ): TimerCatchFlowResult {
      const mergedOptions = mergeFrameOptions(options, updateOptions);
      const timer = analyzeTimerCatchTimer(imageData, mergedOptions);
      const flow = updateTimerFlowState(
        state,
        timer.time,
        timer.timeRect.rect,
        mergedOptions.timerFlow,
        updateOptions.timestampMs ?? mergedOptions.timestampMs,
      );

      return {
        ...timer,
        rawTime: timer.time,
        time: flow.time,
        flow,
      };
    },
    reset(): void {
      state = makeTimerFlowState();
    },
  };
}

export function withDefaultTimerCatchFlowOptions(
  options: TimerCatchOptions = {},
): TimerCatchAnalyzeOptions {
  return {
    ...options,
    timerFlow: {
      ...DEFAULT_TIMER_CATCH_FLOW_OPTIONS,
      ...(options.timerFlow ?? {}),
    },
  };
}

export function createTimerCatchFlow(
  options: TimerCatchOptions = {},
): TimerCatchTracker {
  return createTimerCatchFlowTracker(withDefaultTimerCatchFlowOptions(options));
}

export const createTimerCatch = createTimerCatchFlow;

export const __timerCatchFlowTestHooks = {
  makeTimerFlowState,
  updateTimerFlowState,
};

import {
  createTimerCatchFlow,
  type ImageDataLike,
  type TimerCatchFrameOptions,
  type TimerCatchOptions,
  type TimerCatchResult,
  type TimerCatchTracker,
} from "./timer";

export type TimerCatchInputFrame = {
  imageData: ImageDataLike;
  timestampMs?: number;
  sourceId?: string;
  sequence?: number;
  metadata?: Record<string, unknown>;
};

export type TimerCatchInputSource = {
  nextFrame(): TimerCatchInputFrame | null | Promise<TimerCatchInputFrame | null>;
  reset?(): void | Promise<void>;
  close?(): void | Promise<void>;
};

export type TimerCatchPipelineOptions = TimerCatchOptions & {
  source?: TimerCatchInputSource;
};

export type TimerCatchPipelineUpdate = {
  frame: TimerCatchInputFrame;
  result: TimerCatchResult;
};

export type TimerCatchPipelineNextResult =
  | {
      done: false;
      frame: TimerCatchInputFrame;
      result: TimerCatchResult;
    }
  | {
      done: true;
      frame: null;
      result: null;
    };

export type TimerCatchPipeline = {
  readonly tracker: TimerCatchTracker;
  update(frame: TimerCatchInputFrame | ImageDataLike, options?: TimerCatchFrameOptions): TimerCatchPipelineUpdate;
  next(): Promise<TimerCatchPipelineNextResult>;
  reset(): Promise<void>;
  close(): Promise<void>;
};

export function createTimerCatchPipeline(options: TimerCatchPipelineOptions = {}): TimerCatchPipeline {
  const { source, ...timerOptions } = options;
  const tracker = createTimerCatchFlow(timerOptions);

  return {
    tracker,
    update(frameInput: TimerCatchInputFrame | ImageDataLike, updateOptions: TimerCatchFrameOptions = {}): TimerCatchPipelineUpdate {
      const frame = normalizeInputFrame(frameInput);
      const result = tracker.update(frame.imageData, {
        ...updateOptions,
        timestampMs: updateOptions.timestampMs ?? frame.timestampMs,
      });

      return {
        frame,
        result,
      };
    },
    async next(): Promise<TimerCatchPipelineNextResult> {
      if (!source) throw new Error("TimerCatchPipeline.next() requires a source.");
      const frame = await source.nextFrame();
      if (!frame) {
        return {
          done: true,
          frame: null,
          result: null,
        };
      }

      const update = this.update(frame);
      return {
        done: false,
        frame: update.frame,
        result: update.result,
      };
    },
    async reset(): Promise<void> {
      tracker.reset();
      await source?.reset?.();
    },
    async close(): Promise<void> {
      await source?.close?.();
    },
  };
}

function normalizeInputFrame(frameInput: TimerCatchInputFrame | ImageDataLike): TimerCatchInputFrame {
  if ("imageData" in frameInput) return frameInput;
  return {
    imageData: frameInput,
  };
}

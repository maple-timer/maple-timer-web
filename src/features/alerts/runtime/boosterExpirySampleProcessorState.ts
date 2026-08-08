import type {
  BoosterExpiryRuntimeState,
  BoosterExpiryRuntimeTraceFrame,
  BoosterExpirySnapshot,
} from "../../../lib/boosterExpiry/boosterExpiryTypes";
import type { BoosterExpiryWorkerClient } from "../../../platform/runtime-workers/booster-expiry/boosterExpiryWorkerClient";
import type { MonitoringFrameContext } from "../../../runtime/monitoring/monitoringFrameContext";

export const BOOSTER_EXPIRY_PREVIEW_INTERVAL_MS = 2000;
export const BOOSTER_EXPIRY_LATEST_TRACE_LIMIT = 1;
export const BOOSTER_EXPIRY_CANVAS_ERROR_MESSAGE =
  "부스터 종료 감지용 캔버스를 준비하지 못했습니다.";

export type BoosterExpiryVideoSample = ReturnType<
  MonitoringFrameContext["sampleVideoRegion"]
>;
export type BoosterExpiryWorkerProcessed = Awaited<
  ReturnType<BoosterExpiryWorkerClient["process"]>
>;

export type BoosterExpirySampleProcessorState = {
  lastPreviewAt: number;
  previewUrls: {
    rawPreviewUrl: string | null;
    timerPreviewUrl: string | null;
  };
  trace: BoosterExpiryRuntimeTraceFrame[];
  snapshot: BoosterExpirySnapshot | null;
};

export type BoosterExpirySampleProcessResult = {
  stateBefore: BoosterExpiryRuntimeState;
  state: BoosterExpiryRuntimeState;
  snapshot: BoosterExpirySnapshot;
  diagnostics: BoosterExpirySampleProcessorState;
  shouldAlertNow: boolean;
  alreadyAlertedForSameSchedule: boolean;
  errorMessage: string | null;
};

export function createBoosterExpirySampleProcessorState(): BoosterExpirySampleProcessorState {
  return {
    lastPreviewAt: 0,
    previewUrls: { rawPreviewUrl: null, timerPreviewUrl: null },
    trace: [],
    snapshot: null,
  };
}

export function resetBoosterExpirySampleProcessorState({
  clearDiagnostics,
  previous,
}: {
  clearDiagnostics: boolean;
  now?: number;
  previous: BoosterExpirySampleProcessorState;
}): BoosterExpirySampleProcessorState {
  if (clearDiagnostics) {
    return createBoosterExpirySampleProcessorState();
  }

  return {
    ...previous,
    lastPreviewAt: 0,
  };
}

export function shouldIncludeBoosterExpiryPreview({
  diagnostics,
  sampledAt,
}: {
  diagnostics: BoosterExpirySampleProcessorState;
  sampledAt: number;
}) {
  return (
    sampledAt - diagnostics.lastPreviewAt >= BOOSTER_EXPIRY_PREVIEW_INTERVAL_MS
  );
}

import type { MutableRefObject } from "react";
import { describe, expect, it, vi } from "vitest";
import { createBuffExpiryRuntimeState } from "../../../lib/buffExpiry/buffExpiryRuntimeState";
import type { BuffExpiryRuntimeState, BuffExpirySnapshot } from "../../../lib/buffExpiry/buffExpiryTypes";
import type { BuffExpiryPrecisionPreloadStatus } from "../../../platform/runtime-workers/buff-expiry/buffExpiryPrecisionWorkerClient";
import {
  createBuffExpiryPrecisionSampleProcessorContext,
  createBuffExpirySampleProcessorCommonContext,
  resetBuffExpirySampleLoopState,
  type BuffExpirySampleLoopRefs,
} from "./buffExpirySampleLoopRuntime";

describe("buff expiry sample loop runtime helpers", () => {
  it("resets volatile loop refs while preserving the preloaded precision engine when requested", () => {
    const refs = createRefs();
    const clearBuffExpiryAlertTimers = vi.fn();
    const resetPrecisionEnginePreload = vi.fn();

    resetBuffExpirySampleLoopState({
      refs,
      resetPrecisionEngine: false,
      clearBuffExpiryAlertTimers,
      resetPrecisionEnginePreload,
    });

    expect(clearBuffExpiryAlertTimers).toHaveBeenCalledTimes(1);
    expect(refs.precisionEngineRef.current.reset).not.toHaveBeenCalled();
    expect(resetPrecisionEnginePreload).not.toHaveBeenCalled();
    expectVolatileRefsCleared(refs);
  });

  it("resets precision worker and preload state when leaving precision mode", () => {
    const refs = createRefs();
    const resetPrecisionEnginePreload = vi.fn();

    resetBuffExpirySampleLoopState({
      refs,
      resetPrecisionEngine: true,
      clearBuffExpiryAlertTimers: vi.fn(),
      resetPrecisionEnginePreload,
    });

    expect(refs.precisionEngineRef.current.reset).toHaveBeenCalledTimes(1);
    expect(resetPrecisionEnginePreload).toHaveBeenCalledTimes(1);
    expectVolatileRefsCleared(refs);
  });

  it("builds the precision processor context from shared refs", () => {
    const refs = createRefs();
    const precisionEnginePreloadStatusRef = ref<BuffExpiryPrecisionPreloadStatus>("ready");
    const trackMonitoringStarted = vi.fn();
    const publishState = vi.fn();
    const updatePrecisionEnginePreloadStatusFromSample = vi.fn();
    const commonContext = createBuffExpirySampleProcessorCommonContext({
      refs,
      trackMonitoringStarted,
      publishState,
    });

    const nextContext = createBuffExpiryPrecisionSampleProcessorContext({
      commonContext,
      refs,
      precisionEnginePreloadStatusRef,
      updatePrecisionEnginePreloadStatusFromSample,
    });

    expect(commonContext.buffExpiryRuntimeRef).toBe(refs.buffExpiryRuntimeRef);
    expect(commonContext.displayBoxTracksRef).toBe(refs.displayBoxTracksRef);
    expect(commonContext.trackMonitoringStarted).toBe(trackMonitoringStarted);
    expect(commonContext.publishState).toBe(publishState);
    expect(nextContext.precisionEngineRef).toBe(refs.precisionEngineRef);
    expect(nextContext.precisionEnginePreloadStatusRef).toBe(precisionEnginePreloadStatusRef);
    expect(nextContext.updatePrecisionEnginePreloadStatusFromSample).toBe(
      updatePrecisionEnginePreloadStatusFromSample,
    );
    expect(nextContext.precisionTrackedBuffsRef).toBe(refs.precisionTrackedBuffsRef);
  });
});

function expectVolatileRefsCleared(refs: BuffExpirySampleLoopRefs) {
  expect(refs.lastPreviewAtRef.current).toBe(0);
  expect(refs.lastPreviewUrlsRef.current).toEqual({
    rawPreviewUrl: null,
    processedPreviewUrl: null,
    fullFramePreviewUrl: null,
  });
  expect(refs.displayBoxTracksRef.current).toEqual([]);
  expect(refs.precisionTrackedBuffsRef.current).toEqual([]);
  expect(refs.precisionPendingTracksRef.current).toEqual([]);
  expect(refs.precisionRecentRoiFramesRef.current).toEqual([]);
  expect(refs.lastPrecisionPeriodicRoiFrameAtRef.current).toBe(0);
  expect(refs.lastPrecisionNearMissRoiFrameAtRef.current).toBe(0);
  expect(refs.lastPrecisionAlertRoiFrameAtRef.current).toBeNull();
  expect(refs.debugDetectionHistoryRef.current).toEqual([]);
  expect(refs.runtimeTraceRef.current).toEqual([]);
  expect(refs.alertDecisionHistoryRef.current).toEqual([]);
  expect(refs.iconEvidenceRef.current).toEqual([]);
  expect(refs.temporalCandidateTracksRef.current).toEqual([]);
  expect(refs.expiryClustersRef.current).toEqual([]);
}

function createRefs(): BuffExpirySampleLoopRefs {
  return {
    precisionEngineRef: ref({ reset: vi.fn(), preload: vi.fn(), process: vi.fn() }),
    buffExpiryRuntimeRef: ref<BuffExpiryRuntimeState>(createBuffExpiryRuntimeState()),
    buffExpirySnapshotRef: ref<BuffExpirySnapshot | null>(null),
    lastAlertErrorRef: ref("previous-error"),
    lastPreviewAtRef: ref(12_345),
    lastPreviewUrlsRef: ref({
      rawPreviewUrl: "raw",
      processedPreviewUrl: "processed",
      fullFramePreviewUrl: "full",
    }),
    displayBoxTracksRef: ref([{}]),
    precisionTrackedBuffsRef: ref([{}]),
    precisionPendingTracksRef: ref([{}]),
    precisionRecentRoiFramesRef: ref([{}]),
    lastPrecisionPeriodicRoiFrameAtRef: ref(1_000),
    lastPrecisionNearMissRoiFrameAtRef: ref(2_000),
    lastPrecisionAlertRoiFrameAtRef: ref(3_000),
    debugDetectionHistoryRef: ref([{}]),
    runtimeTraceRef: ref([{}]),
    alertDecisionHistoryRef: ref([{}]),
    iconEvidenceRef: ref([{}]),
    temporalCandidateTracksRef: ref([{}]),
    expiryClustersRef: ref([{}]),
  } as unknown as BuffExpirySampleLoopRefs;
}

function ref<T>(current: T): MutableRefObject<T> {
  return { current };
}

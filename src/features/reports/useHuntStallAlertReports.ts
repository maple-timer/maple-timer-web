import {
  type MutableRefObject,
  type RefObject,
  useCallback,
  useRef,
  useState,
} from "react";
import type {
  HuntStallRuntimeState,
  HuntStallSnapshot,
} from "../../alertTypes";
import { createDefaultHuntStallAlert } from "../../lib/storage";
import type { HuntStallAlertConfig, Profile } from "../../types";
import type { AlertIssueReportDetails } from "./alertReportPayloads";
import { getAlertIssueReportUnavailableMessage } from "../../application/reporting/alertIssueReportAvailability";
import type { AlertIncidentJournalSelection } from "../../application/reporting/alertIncidentJournal";
import type { HuntStallIncidentRuntimeRecorder } from "../../runtime/hunt-stall/evidence/huntStallIncidentRuntimeRecorder";
import {
  createHuntStallIncidentFrozenState,
  createHuntStallIncidentRegionRevision,
  recordHuntStallIncidentSample,
} from "../../runtime/hunt-stall/evidence/huntStallIncidentRuntimeRecorder";
import { createHuntStallIncidentConfiguration } from "../../application/reporting/huntStallIncidentConfiguration";
import { freezeHuntStallIncidentBoundary } from "../../runtime/hunt-stall/evidence/huntStallIncidentBoundary";
import { freezeHuntStallIncidentEvidence } from "../../runtime/hunt-stall/evidence/huntStallIncidentEvidenceArchive";
import type {
  FrozenHuntStallIncidentEvidence,
  HuntStallIncidentRegion,
  HuntStallIncidentRelatedPlayback,
} from "../../runtime/hunt-stall/evidence/huntStallIncidentEvidenceTypes";
import { selectHuntStallReportIncident } from "../../runtime/hunt-stall/evidence/huntStallIncidentEvidenceSelection";
import {
  createHuntStallIncidentReportEvidence,
  type HuntStallIncidentReportEvidence,
} from "../../runtime/hunt-stall/evidence/huntStallIncidentReportEvidence";
import { coerceRegionToSquare } from "../../lib/capture";
import {
  captureSizeToLayoutKey,
  getSkillRegionForLayout,
  hasUsableRegion,
  regionToPixels,
} from "../../lib/regions";
import {
  createLegacyReportFrameSourceContext,
  type ReportFrameSourceContext,
} from "../../contracts/reporting/frameSourceDiagnostics";

type FrozenHuntStallIssueReportEvidence = {
  config: HuntStallAlertConfig;
  state: HuntStallRuntimeState;
  snapshot: HuntStallSnapshot | null;
  incident: FrozenHuntStallIncidentEvidence;
};

export function useHuntStallAlertReports({
  videoRef,
  profileRef,
  huntStallRuntimeRef,
  huntStallIncidentRecorderRef,
  huntStallSnapshotRef,
  currentLayoutKey,
  reportFrameSourceContext,
  onMessage,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  profileRef: MutableRefObject<Profile>;
  huntStallRuntimeRef: MutableRefObject<HuntStallRuntimeState>;
  huntStallIncidentRecorderRef: MutableRefObject<HuntStallIncidentRuntimeRecorder>;
  huntStallSnapshotRef: MutableRefObject<HuntStallSnapshot | null>;
  currentLayoutKey: string | null;
  reportFrameSourceContext?: ReportFrameSourceContext;
  onMessage: (message: string) => void;
}) {
  const [isHuntStallDebugSubmitting, setHuntStallDebugSubmitting] = useState(false);
  const [isHuntStallIssueSubmitting, setHuntStallIssueSubmitting] = useState(false);
  const frozenHuntStallIssueEvidenceRef = useRef<
    FrozenHuntStallIssueReportEvidence | undefined
  >(undefined);

  const createCurrentHuntStallIssueEvidence = useCallback(
    (
      capturedAt: number,
      journalSelection: AlertIncidentJournalSelection | null = null,
    ): FrozenHuntStallIssueReportEvidence => {
      const currentProfile = profileRef.current;
      const currentConfig = cloneHuntStallAlertConfig(
        currentProfile.huntStallAlert ?? createDefaultHuntStallAlert(),
      );
      const state = cloneReportValue(huntStallRuntimeRef.current);
      const video = videoRef.current;
      const recorder = synchronizeHuntStallReportConfiguration({
        recorder: huntStallIncidentRecorderRef.current,
        config: currentConfig,
        masterVolume: currentProfile.masterVolume,
        state,
        capturedAt,
        video,
        currentLayoutKey,
        gameViewport: reportFrameSourceContext?.gameViewport ?? null,
      });
      const boundary = recorder.boundary;
      if (!boundary) {
        throw new Error("사냥 멈춤 제보 증거 경계를 만들지 못했습니다.");
      }
      const frozenBoundary = freezeHuntStallIncidentBoundary({
        previous: boundary,
        frozenAt: capturedAt,
      });
      const nextRecorder = {
        ...recorder,
        boundary: frozenBoundary.state,
      };
      huntStallIncidentRecorderRef.current = nextRecorder;

      return {
        config: currentConfig,
        state,
        snapshot: cloneHuntStallSnapshot(huntStallSnapshotRef.current),
        incident: freezeHuntStallIncidentEvidence({
          archive: nextRecorder.archive,
          lease: frozenBoundary.lease,
          frozenState: createHuntStallIncidentFrozenState({
            recorder: nextRecorder,
            capturedAt,
            state,
          }),
          relatedPlayback: toHuntStallRelatedPlayback(journalSelection),
        }),
      };
    },
    [
      currentLayoutKey,
      huntStallIncidentRecorderRef,
      huntStallRuntimeRef,
      huntStallSnapshotRef,
      profileRef,
      reportFrameSourceContext,
      videoRef,
    ],
  );

  const freezeHuntStallIssueReportEvidence = useCallback(
    (
      capturedAt = Date.now(),
      journalSelection: AlertIncidentJournalSelection | null = null,
    ) => {
      frozenHuntStallIssueEvidenceRef.current =
        createCurrentHuntStallIssueEvidence(capturedAt, journalSelection);
    },
    [createCurrentHuntStallIssueEvidence],
  );

  const clearHuntStallIssueReportEvidence = useCallback(() => {
    frozenHuntStallIssueEvidenceRef.current = undefined;
  }, []);

  const submitHuntStallDebugSample = useCallback(async () => {
    const video = videoRef.current;
    if (
      !video ||
      video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
      !video.videoWidth ||
      !video.videoHeight
    ) {
      onMessage("화면 공유가 준비된 뒤 사냥 멈춤 디버그 샘플을 보낼 수 있습니다.");
      return;
    }

    setHuntStallDebugSubmitting(true);
    try {
      const [
        { buildHuntStallDebugReportPayload },
        { formatReportSuccessMessage, getOrCreateReportClientId, postDebugSample },
        {
          getCaptureDiagnostics,
          getViewportDiagnostics,
        },
        { createHuntStallReportSnapshot },
      ] = await Promise.all([
        import("./alertReportPayloads"),
        import("./reportClient"),
        import("./reportDiagnostics"),
        import("./huntStallReportSnapshot"),
      ]);
      const currentProfile = profileRef.current;
      const config = currentProfile.huntStallAlert ?? createDefaultHuntStallAlert();
      const frameLayoutKey = currentLayoutKey;
      const diagnosticsContext =
        reportFrameSourceContext ??
        createLegacyReportFrameSourceContext(currentLayoutKey);
      const existingSnapshot = huntStallSnapshotRef.current;
      const snapshot = await createHuntStallReportSnapshot({
        config,
        layoutKey: frameLayoutKey,
        state: huntStallRuntimeRef.current,
        video,
        gameViewport: reportFrameSourceContext?.gameViewport ?? null,
      });
      const snapshotWithHistory: HuntStallSnapshot = {
        ...snapshot,
        runtimeTrace: existingSnapshot?.runtimeTrace ?? [],
        cropHistory: existingSnapshot?.cropHistory ?? [],
      };

      if (!snapshotWithHistory.rawPreviewUrl || !snapshotWithHistory.processedPreviewUrl) {
        throw new Error("디버그 이미지를 만들지 못했습니다.");
      }

      const data = await postDebugSample(
        buildHuntStallDebugReportPayload({
          submittedAt: new Date().toISOString(),
          url: window.location.href,
          clientId: getOrCreateReportClientId(),
          viewportDiagnostics: getViewportDiagnostics(),
          captureDiagnostics: getCaptureDiagnostics(
            video,
            diagnosticsContext,
            "game-viewport",
            frameLayoutKey,
          ),
          config,
          snapshot: snapshotWithHistory,
          state: huntStallRuntimeRef.current,
        }),
        "사냥 멈춤 디버그 샘플 전송에 실패했습니다.",
      );

      huntStallSnapshotRef.current = snapshotWithHistory;
      onMessage(
        formatReportSuccessMessage(
          data,
          (id) => `사냥 멈춤 디버그 샘플을 보냈습니다. ID: ${id}`,
          "사냥 멈춤 디버그 샘플을 보냈습니다.",
        ),
      );
    } catch (error) {
      onMessage(
        error instanceof Error ? error.message : "사냥 멈춤 디버그 샘플 전송에 실패했습니다.",
      );
    } finally {
      setHuntStallDebugSubmitting(false);
    }
  }, [
    currentLayoutKey,
    huntStallRuntimeRef,
    huntStallSnapshotRef,
    onMessage,
    profileRef,
    reportFrameSourceContext,
    videoRef,
  ]);

  const submitHuntStallIssueReport = useCallback(async (
    issue: AlertIssueReportDetails,
    journalSelection: AlertIncidentJournalSelection | null = null,
  ) => {
    const currentProfile = profileRef.current;
    const unavailableMessage = getAlertIssueReportUnavailableMessage({
      profile: currentProfile,
      target: { kind: "hunt-stall" },
    });
    if (unavailableMessage) {
      onMessage(unavailableMessage);
      return false;
    }

    const video = videoRef.current;
    if (
      !video ||
      video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
      !video.videoWidth ||
      !video.videoHeight
    ) {
      onMessage("화면 공유가 준비된 뒤 제보할 수 있습니다.");
      return false;
    }

    setHuntStallIssueSubmitting(true);
    try {
      const [
        { buildHuntStallIssueReportPayload },
        { getOrCreateReportClientId, postDebugSample },
        {
          getCaptureDiagnostics,
          getViewportDiagnostics,
        },
      ] = await Promise.all([
        import("./alertReportPayloads"),
        import("./reportClient"),
        import("./reportDiagnostics"),
      ]);
      const frameLayoutKey = currentLayoutKey;
      const diagnosticsContext =
        reportFrameSourceContext ??
        createLegacyReportFrameSourceContext(currentLayoutKey);
      const frozenEvidence =
        frozenHuntStallIssueEvidenceRef.current ??
        createCurrentHuntStallIssueEvidence(Date.now(), journalSelection);
      const selection = selectHuntStallReportIncident({
        evidence: frozenEvidence.incident,
        reason: issue.reason,
        scenario: issue.scenario,
        occurrence: issue.occurrence,
        otherCategory: issue.otherCategory,
      });
      const incidentEvidence = createHuntStallIncidentReportEvidence({
        evidence: frozenEvidence.incident,
        selection,
      });
      const snapshot = createLegacyHuntStallSnapshot({
        frozenSnapshot: frozenEvidence.snapshot,
        incidentEvidence,
      });

      await postDebugSample(
        buildHuntStallIssueReportPayload({
          submittedAt: new Date().toISOString(),
          url: window.location.href,
          clientId: getOrCreateReportClientId(),
          viewportDiagnostics: getViewportDiagnostics(),
          captureDiagnostics: getCaptureDiagnostics(
            video,
            diagnosticsContext,
            "game-viewport",
            frameLayoutKey,
          ),
          config: frozenEvidence.config,
          snapshot,
          state: frozenEvidence.state,
          incidentEvidence,
          issue,
          journalSelection,
        }),
        "사냥 멈춤 감지 제보 전송에 실패했습니다.",
      );

      onMessage("제보를 보냈습니다.");
      return true;
    } catch (error) {
      onMessage(
        error instanceof Error ? error.message : "사냥 멈춤 감지 제보 전송에 실패했습니다.",
      );
      return false;
    } finally {
      setHuntStallIssueSubmitting(false);
    }
  }, [
    createCurrentHuntStallIssueEvidence,
    currentLayoutKey,
    onMessage,
    profileRef,
    reportFrameSourceContext,
    videoRef,
  ]);

  return {
    isHuntStallDebugSubmitting,
    isHuntStallIssueSubmitting,
    submitHuntStallDebugSample,
    submitHuntStallIssueReport,
    freezeHuntStallIssueReportEvidence,
    clearHuntStallIssueReportEvidence,
  };
}

function synchronizeHuntStallReportConfiguration({
  recorder,
  config,
  masterVolume,
  state,
  capturedAt,
  video,
  currentLayoutKey,
  gameViewport,
}: {
  recorder: HuntStallIncidentRuntimeRecorder;
  config: HuntStallAlertConfig;
  masterVolume: number;
  state: HuntStallRuntimeState;
  capturedAt: number;
  video: HTMLVideoElement | null;
  currentLayoutKey: string | null;
  gameViewport: ReportFrameSourceContext["gameViewport"];
}): HuntStallIncidentRuntimeRecorder {
  const sourceDimensions =
    gameViewport
      ? {
          width: gameViewport.region.width,
          height: gameViewport.region.height,
        }
      : video?.videoWidth && video.videoHeight
      ? { width: video.videoWidth, height: video.videoHeight }
      : null;
  const previousContinuity = recorder.boundary?.resetEpoch.continuity ?? null;
  const layoutKey =
    currentLayoutKey ??
    captureSizeToLayoutKey(sourceDimensions) ??
    previousContinuity?.layoutKey ??
    "unknown";
  const region = resolveHuntStallIncidentRegion({
    config,
    layoutKey,
    sourceDimensions,
  });
  const regionRevision =
    region ||
    !previousContinuity ||
    previousContinuity.mode !== config.mode ||
    previousContinuity.layoutKey !== layoutKey
      ? createHuntStallIncidentRegionRevision({
          mode: config.mode,
          layoutKey,
          region,
        })
      : previousContinuity.regionRevision;

  return recordHuntStallIncidentSample({
    previous: recorder,
    input: {
      sampledAt: capturedAt,
      configuration: createHuntStallIncidentConfiguration(config, masterVolume),
      mode: config.mode,
      layoutKey,
      regionRevision,
      recordFrame: false,
      stateBefore: state,
      stateAfter: state,
      shouldAlert: false,
    },
  });
}

function resolveHuntStallIncidentRegion({
  config,
  layoutKey,
  sourceDimensions,
}: {
  config: HuntStallAlertConfig;
  layoutKey: string;
  sourceDimensions: { width: number; height: number } | null;
}): HuntStallIncidentRegion | null {
  if (!sourceDimensions) return null;
  const region =
    config.mode === "cooldown-presence"
      ? getSkillRegionForLayout(
          {
            region: config.cooldownRegion,
            regionsByLayout: config.cooldownRegionsByLayout,
          },
          layoutKey,
        )
      : getSkillRegionForLayout(
          {
            region: config.manualExperienceRegion ?? null,
            regionsByLayout: config.manualExperienceRegionsByLayout,
          },
          layoutKey,
        );
  if (!hasUsableRegion(region)) return null;
  const normalizedRegion =
    config.mode === "cooldown-presence"
      ? coerceRegionToSquare(
          region,
          sourceDimensions.width / sourceDimensions.height,
        )
      : region;
  return regionToPixels(
    normalizedRegion,
    sourceDimensions.width,
    sourceDimensions.height,
  );
}

function toHuntStallRelatedPlayback(
  selection: AlertIncidentJournalSelection | null,
): HuntStallIncidentRelatedPlayback[] {
  return (selection?.relatedPlaybackEntries ?? [])
    .filter((entry) => entry.kind === "playback")
    .map((entry) => {
      const status = normalizePlaybackStatus(entry.status);
      return {
        id: entry.id,
        feature: entry.feature,
        requestedAt: getFiniteNumber(entry.details.requestedAt) ?? entry.occurredAt,
        startedAt: getFiniteNumber(entry.details.startedAt),
        finishedAt: getFiniteNumber(entry.details.finishedAt),
        failedAt: getFiniteNumber(entry.details.failedAt),
        status,
      };
    });
}

function normalizePlaybackStatus(
  status: string | null,
): HuntStallIncidentRelatedPlayback["status"] {
  return status === "started" || status === "finished" || status === "failed"
    ? status
    : "requested";
}

function getFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function cloneHuntStallAlertConfig(
  config: HuntStallAlertConfig,
): HuntStallAlertConfig {
  return {
    ...config,
    manualExperienceRegion: config.manualExperienceRegion
      ? { ...config.manualExperienceRegion }
      : config.manualExperienceRegion,
    manualExperienceRegionsByLayout: cloneRegionMap(
      config.manualExperienceRegionsByLayout,
    ),
    cooldownRegion: config.cooldownRegion ? { ...config.cooldownRegion } : null,
    cooldownRegionsByLayout: cloneRegionMap(config.cooldownRegionsByLayout),
  };
}

function cloneRegionMap<T extends Record<string, { x: number; y: number; width: number; height: number }>>(
  regions: T | undefined,
): T | undefined {
  return regions
    ? (Object.fromEntries(
        Object.entries(regions).map(([key, region]) => [key, { ...region }]),
      ) as T)
    : undefined;
}

function cloneHuntStallSnapshot(
  snapshot: HuntStallSnapshot | null,
): HuntStallSnapshot | null {
  return snapshot ? cloneReportValue(snapshot, true) : null;
}

function cloneReportValue<T>(value: T, omitImageData = false): T {
  return JSON.parse(
    JSON.stringify(value, (key, entry) =>
      omitImageData && /ImageData$/.test(key) ? undefined : entry,
    ),
  ) as T;
}

function createLegacyHuntStallSnapshot({
  frozenSnapshot,
  incidentEvidence,
}: {
  frozenSnapshot: HuntStallSnapshot | null;
  incidentEvidence: HuntStallIncidentReportEvidence;
}): HuntStallSnapshot {
  const selectedFrames = [...incidentEvidence.frames].sort(
    (left, right) =>
      left.sampledAt - right.sampledAt || left.sequence - right.sequence,
  );
  const selectedFrame = selectedFrames[selectedFrames.length - 1] ?? null;
  const selectedObservation = selectedFrame
    ? incidentEvidence.observations.find(
        (entry) => entry.frameId === selectedFrame.id,
      ) ?? null
    : null;
  const recognition = selectedObservation?.recognition ?? null;
  const fallbackSampledAt = frozenSnapshot?.sampledAt ?? incidentEvidence.frozenAt;
  const hasSelectedIncidentMedia = incidentEvidence.media.some(
    (entry) => Boolean(entry.rawDataUrl || entry.processedDataUrl),
  );

  return {
    ...(frozenSnapshot ?? {
      sampledAt: fallbackSampledAt,
      rawPreviewUrl: null,
      processedPreviewUrl: null,
      regionLabel: null,
      recognizedText: null,
      confidence: 0,
      foregroundRatio: 0,
      changeScore: 0,
    }),
    sampledAt: selectedFrame?.sampledAt ?? fallbackSampledAt,
    mode:
      selectedFrame?.mode ??
      incidentEvidence.selection.mode ??
      frozenSnapshot?.mode ??
      "manual-experience",
    regionLabel: selectedFrame?.region
      ? `${selectedFrame.region.width}x${selectedFrame.region.height}`
      : (frozenSnapshot?.regionLabel ?? null),
    rawPreviewUrl: hasSelectedIncidentMedia
      ? null
      : (frozenSnapshot?.rawPreviewUrl ?? null),
    processedPreviewUrl: hasSelectedIncidentMedia
      ? null
      : (frozenSnapshot?.processedPreviewUrl ??
        frozenSnapshot?.rawPreviewUrl ??
        null),
    displayPreviewUrl: null,
    fullFramePreviewUrl: null,
    cropCandidates: [],
    runtimeTrace: [],
    cropHistory: [],
    recognizedText:
      recognition?.correctedValue !== null && recognition?.correctedValue !== undefined
        ? String(recognition.correctedValue)
        : (recognition?.rawText ?? frozenSnapshot?.recognizedText ?? null),
    debugText: recognition?.reason ?? frozenSnapshot?.debugText,
    confidence: recognition?.confidence ?? frozenSnapshot?.confidence ?? 0,
    foregroundRatio:
      recognition?.foregroundRatio ?? frozenSnapshot?.foregroundRatio ?? 0,
    changeScore:
      recognition?.visualChangeScore ?? frozenSnapshot?.changeScore ?? 0,
  };
}

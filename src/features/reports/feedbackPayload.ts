import type {
  HuntStallRuntimeState,
  HuntStallSnapshot,
  RuneAlertTriggerEvidence,
  RuneSnapshot,
  SkillSnapshot,
} from "../../alertTypes";
import type { Profile, SkillRuntimeState } from "../../types";
import type { AppBuildReportInfo } from "../../contracts/deployment/appBuildInfo";
import { getAppBuildReportInfo } from "../../platform/runtime-build/currentAppBuildInfo";
import type { FeedbackKind } from "../../contracts/reporting/feedback";
import type { ReportFrameSourceContext } from "../../contracts/reporting/frameSourceDiagnostics";
import type { PrecisionParserRuntimeReport } from "../../contracts/reporting/precisionParserRuntimeReport";
import type { CaptureDiagnostics } from "./alertReportPayloadShared";
import { createReportFrameSourceDiagnostics } from "./reportDiagnostics";
import { RUNE_LAST_ALERT_TRIGGER_RETENTION_MS } from "../../lib/runeEvidenceArchive";

export type FeedbackAttachment = {
  name: string;
  type: string;
  dataUrl: string;
};

export type FeedbackPayload = {
  kind: FeedbackKind;
  message: string;
  contact: string | null;
  submittedAt: string;
  url: string;
  appBuild: AppBuildReportInfo;
  diagnostics: {
    userAgent: string;
    viewport: { width: number; height: number };
    capture: CaptureDiagnostics;
    precisionParserRuntime: PrecisionParserRuntimeReport;
    settings?: unknown;
  };
  attachments: FeedbackAttachment[];
};

export const KIND_LABELS: Record<FeedbackKind, string> = {
  bug: "버그",
  suggestion: "제안",
  other: "기타",
};

const MAX_SCREENSHOT_WIDTH = 1280;
const SCREENSHOT_QUALITY = 0.78;
const MAX_FEEDBACK_ATTACHMENTS = 10;
const MAX_RUNE_TRIGGER_ATTACHMENTS = 4;

function captureVideoFrame(video: HTMLVideoElement | null): FeedbackAttachment | null {
  if (!video || !video.videoWidth || !video.videoHeight) {
    return null;
  }

  const scale = Math.min(1, MAX_SCREENSHOT_WIDTH / video.videoWidth);
  const width = Math.max(1, Math.round(video.videoWidth * scale));
  const height = Math.max(1, Math.round(video.videoHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    return null;
  }

  context.drawImage(video, 0, 0, width, height);

  return {
    name: "shared-screen.jpg",
    type: "image/jpeg",
    dataUrl: canvas.toDataURL("image/jpeg", SCREENSHOT_QUALITY),
  };
}

function collectCropAttachments(
  profile: Profile,
  snapshots: Record<string, SkillSnapshot>,
  runeSnapshot: RuneSnapshot | null,
  runeAlertTrigger: RuneAlertTriggerEvidence | null,
  huntStallSnapshot: HuntStallSnapshot | null,
): FeedbackAttachment[] {
  const attachments: FeedbackAttachment[] = [];

  if (runeSnapshot?.rawPreviewUrl) {
    attachments.push({
      name: "rune-minimap-raw.png",
      type: "image/png",
      dataUrl: runeSnapshot.rawPreviewUrl,
    });
  }

  if (runeSnapshot?.maskPreviewUrl) {
    attachments.push({
      name: "rune-minimap-mask.png",
      type: "image/png",
      dataUrl: runeSnapshot.maskPreviewUrl,
    });
  }

  const triggerFrames = (runeAlertTrigger?.frames ?? [])
    .filter((frame) => Boolean(frame.rawDataUrl))
    .slice(-MAX_RUNE_TRIGGER_ATTACHMENTS);
  triggerFrames.forEach((frame, index) => {
    attachments.push({
      name: `rune-alert-trigger-${String(index + 1).padStart(2, "0")}.png`,
      type: "image/png",
      dataUrl: frame.rawDataUrl,
    });
  });

  attachments.push(
    ...profile.skills.flatMap((skill, index) => {
      const snapshot = snapshots[skill.id];
      if (!snapshot) {
        return [];
      }

      const number = String(index + 1).padStart(2, "0");
      const attachments: FeedbackAttachment[] = [];

      if (snapshot.rawPreviewUrl) {
        attachments.push({
          name: `crop-${number}-raw.png`,
          type: "image/png",
          dataUrl: snapshot.rawPreviewUrl,
        });
      }

      if (snapshot.previewUrl) {
        attachments.push({
          name: `crop-${number}-processed.png`,
          type: "image/png",
          dataUrl: snapshot.previewUrl,
        });
      }

      return attachments;
    }),
  );

  if (huntStallSnapshot?.rawPreviewUrl) {
    attachments.push({
      name:
        huntStallSnapshot.mode === "cooldown-presence"
          ? "hunt-stall-cooldown-raw.png"
          : "hunt-stall-exp-raw.png",
      type: "image/png",
      dataUrl: huntStallSnapshot.rawPreviewUrl,
    });
  }

  if (huntStallSnapshot?.processedPreviewUrl) {
    attachments.push({
      name:
        huntStallSnapshot.mode === "cooldown-presence"
          ? "hunt-stall-cooldown-processed.png"
          : "hunt-stall-exp-processed.png",
      type: "image/png",
      dataUrl: huntStallSnapshot.processedPreviewUrl,
    });
  }

  return attachments;
}

function buildSettingsSnapshot({
  profile,
  states,
  snapshots,
  runeSnapshot,
  runeAlertTrigger,
  huntStallState,
  huntStallSnapshot,
}: {
  profile: Profile;
  states: Record<string, SkillRuntimeState>;
  snapshots: Record<string, SkillSnapshot>;
  runeSnapshot: RuneSnapshot | null;
  runeAlertTrigger: RuneAlertTriggerEvidence | null;
  huntStallState: HuntStallRuntimeState | null;
  huntStallSnapshot: HuntStallSnapshot | null;
}) {
  return {
    profile: {
      name: profile.name,
      displayMode: profile.displayMode,
      captureHint: profile.captureHint,
      masterVolume: profile.masterVolume,
      alertDefaults: profile.alertDefaults,
      runeAlert: profile.runeAlert ?? null,
      huntStallAlert: profile.huntStallAlert ?? null,
      skills: profile.skills.map((skill) => ({
        name: skill.name,
        presetId: skill.presetId,
        enabled: skill.enabled,
        countdownSource: skill.countdownSource,
        durationSeconds: skill.durationSeconds,
        cooldownDurationSeconds: skill.cooldownDurationSeconds,
        alertThresholdSeconds: skill.alertThresholdSeconds,
        recognitionStartSeconds: skill.recognitionStartSeconds,
        recognitionMode: skill.recognitionMode,
        soundId: skill.soundId,
        volume: skill.volume,
        region: skill.region,
        regionsByLayout: skill.regionsByLayout ?? {},
      })),
    },
    runtime: profile.skills.map((skill) => ({
      name: skill.name,
      state: states[skill.id] ?? null,
      lastReading: snapshots[skill.id]?.result ?? null,
      regionLabel: snapshots[skill.id]?.regionLabel ?? null,
    })),
    runeRuntime: runeSnapshot
      ? {
          detected: runeSnapshot.detected,
          confidence: runeSnapshot.confidence,
          candidateCount: runeSnapshot.candidateCount,
          sampledAt: runeSnapshot.sampledAt,
          latestAlertTrigger: summarizeRuneAlertTrigger(runeAlertTrigger),
        }
      : null,
    huntStallRuntime: huntStallState
      ? {
          status: huntStallState.status,
          recognizedText: huntStallState.recognizedText,
          alertedRecognizedText: huntStallState.alertedRecognizedText,
          pendingRecognizedText: huntStallState.pendingRecognizedText,
          pendingRecognizedCount: huntStallState.pendingRecognizedCount,
          lastRejectedRecognizedText: huntStallState.lastRejectedRecognizedText,
          lastDecision: huntStallState.lastDecision,
          lastReadableAt: huntStallState.lastReadableAt,
          lastReadFailureAt: huntStallState.lastReadFailureAt,
          unreadableSinceAt: huntStallState.unreadableSinceAt,
          lastReadFailureReason: huntStallState.lastReadFailureReason,
          stableSampleCount: huntStallState.stableSampleCount,
          unchangedSeconds: huntStallState.unchangedSeconds,
          confidence: huntStallState.confidence,
          changeScore: huntStallState.changeScore,
          sampledAt: huntStallSnapshot?.sampledAt ?? huntStallState.lastSampledAt,
          regionLabel: huntStallSnapshot?.regionLabel ?? null,
          snapshotRecognizedText: huntStallSnapshot?.recognizedText ?? null,
          snapshotDebugText: huntStallSnapshot?.debugText ?? null,
          foregroundRatio: huntStallSnapshot?.foregroundRatio ?? null,
          performance: huntStallSnapshot?.performance ?? null,
        }
      : null,
  };
}

function selectRecentRuneAlertTrigger(
  snapshot: RuneSnapshot | null,
  submittedAt: number,
): RuneAlertTriggerEvidence | null {
  if (!snapshot) {
    return null;
  }

  const byCycleId = new Map<string, RuneAlertTriggerEvidence>();
  snapshot.evidenceArchive?.alertTriggers.forEach((trigger) => {
    byCycleId.set(trigger.cycleId, trigger);
  });
  if (snapshot.lastAlertTrigger) {
    byCycleId.set(snapshot.lastAlertTrigger.cycleId, snapshot.lastAlertTrigger);
  }

  const cutoff = submittedAt - RUNE_LAST_ALERT_TRIGGER_RETENTION_MS;
  const recentTriggers = [...byCycleId.values()]
    .filter(
      (trigger) =>
        trigger.triggeredAt >= cutoff && trigger.triggeredAt <= submittedAt,
    )
    .sort((left, right) => left.triggeredAt - right.triggeredAt);
  return recentTriggers[recentTriggers.length - 1] ?? null;
}

function summarizeRuneAlertTrigger(trigger: RuneAlertTriggerEvidence | null) {
  if (!trigger) {
    return null;
  }

  return {
    schemaVersion: trigger.schemaVersion,
    cycleId: trigger.cycleId,
    episodeId: trigger.episodeId ?? null,
    decision: trigger.decision,
    triggeredAt: trigger.triggeredAt,
    detectorVersion: trigger.detectorVersion,
    sceneEpoch: trigger.sceneEpoch,
    frameCount: trigger.frames.length,
    retainedFrameCount: trigger.frames.filter((frame) => frame.rawDataUrl).length,
    frames: trigger.frames.map(({ rawDataUrl: _rawDataUrl, ...frame }) => frame),
  };
}

export async function buildFeedbackPayload({
  kind,
  message,
  includeFullScreenshot,
  includeCropImages,
  includeSettings,
  profile,
  states,
  snapshots,
  runeSnapshot,
  huntStallState,
  huntStallSnapshot,
  video,
  stream,
  captureSize,
  currentLayoutKey,
  frameSourceContext,
  precisionParserRuntime,
}: {
  kind: FeedbackKind;
  message: string;
  includeFullScreenshot: boolean;
  includeCropImages: boolean;
  includeSettings: boolean;
  profile: Profile;
  states: Record<string, SkillRuntimeState>;
  snapshots: Record<string, SkillSnapshot>;
  runeSnapshot: RuneSnapshot | null;
  huntStallState: HuntStallRuntimeState | null;
  huntStallSnapshot: HuntStallSnapshot | null;
  video: HTMLVideoElement | null;
  stream: MediaStream | null;
  captureSize: { width: number; height: number } | null;
  currentLayoutKey: string | null;
  frameSourceContext: ReportFrameSourceContext;
  precisionParserRuntime: PrecisionParserRuntimeReport;
}): Promise<FeedbackPayload> {
  const submittedAt = Date.now();
  const runeAlertTrigger = selectRecentRuneAlertTrigger(
    runeSnapshot,
    submittedAt,
  );
  const attachments: FeedbackAttachment[] = [];

  if (includeFullScreenshot) {
    const screenshot = captureVideoFrame(video);
    if (screenshot) {
      attachments.push(screenshot);
    }
  }

  if (includeCropImages) {
    attachments.push(
      ...collectCropAttachments(
        profile,
        snapshots,
        runeSnapshot,
        runeAlertTrigger,
        huntStallSnapshot,
      ),
    );
  }

  return {
    kind,
    message: message.trim(),
    // The form no longer collects a contact; the field stays null so the
    // payload keeps one shape with the server and older stored reports.
    contact: null,
    submittedAt: new Date(submittedAt).toISOString(),
    url: window.location.href,
    appBuild: getAppBuildReportInfo(),
    diagnostics: {
      userAgent: navigator.userAgent,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
      capture: {
        hasStream: Boolean(stream),
        size: captureSize,
        layoutKey: currentLayoutKey,
        frameSource: createReportFrameSourceDiagnostics({
          context: frameSourceContext,
          coordinateSpace: "capture",
          frameLayoutKey: currentLayoutKey,
          liveCaptureSize: captureSize,
        }),
      },
      precisionParserRuntime,
      settings: includeSettings
        ? buildSettingsSnapshot({
            profile,
            states,
            snapshots,
            runeSnapshot,
            runeAlertTrigger,
            huntStallState,
            huntStallSnapshot,
          })
        : undefined,
    },
    attachments: attachments.slice(0, MAX_FEEDBACK_ATTACHMENTS),
  };
}

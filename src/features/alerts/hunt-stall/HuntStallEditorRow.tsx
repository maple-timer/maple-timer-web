import type { HuntStallPerformanceMetrics, RgbaImageSnapshot } from "../../../alertTypes";
import { getHuntStallAlertSounds } from "../../../lib/sounds";
import type { HuntStallAlertConfig } from "../../../types";
import { isAlertIssueReportButtonDisabled } from "../../../application/reporting/alertIssueReportAvailability";
import { AlertEditorRow } from "../../../shared/components/AlertEditorRow";
import { HuntStallDebugPanel } from "./HuntStallDebugPanel";

export function HuntStallEditorRow({
  editorId,
  isExpanded,
  colSpan,
  config,
  showDebug,
  confidence,
  foregroundRatio,
  changeScore,
  recognizedText,
  processedPreviewUrl,
  processedPreviewImageData,
  rawPreviewUrl,
  rawPreviewImageData,
  cropLabel,
  lastSampledAt,
  lastReadableAt,
  lastReadFailureAt,
  unreadableSinceAt,
  lastReadFailureReason,
  lastDecision,
  lastRejectedRecognizedText,
  pendingRecognizedText,
  pendingRecognizedCount,
  stableSampleCount,
  unchangedSeconds,
  performance,
  hasDebugPayload,
  hasIssueReportPayload,
  isGloballyDisabled,
  canPickRegion,
  isSubmittingDebugSample,
  isSubmittingIssueReport,
  onChange,
  onOpenRegionPicker,
  onPreviewSound,
  onSubmitDebugSample,
  onSubmitIssueReport,
}: {
  editorId: string;
  isExpanded: boolean;
  colSpan: number;
  config: HuntStallAlertConfig;
  showDebug: boolean;
  confidence: number;
  foregroundRatio: number;
  changeScore: number;
  recognizedText: string | null;
  processedPreviewUrl: string | null;
  processedPreviewImageData: RgbaImageSnapshot | null;
  rawPreviewUrl: string | null;
  rawPreviewImageData: RgbaImageSnapshot | null;
  cropLabel: string;
  lastSampledAt: number | null;
  lastReadableAt: number | null;
  lastReadFailureAt: number | null;
  unreadableSinceAt: number | null;
  lastReadFailureReason: string | null;
  lastDecision: string;
  lastRejectedRecognizedText: string | null;
  pendingRecognizedText: string | null;
  pendingRecognizedCount: number;
  stableSampleCount: number;
  unchangedSeconds: number;
  performance: HuntStallPerformanceMetrics | null;
  hasDebugPayload: boolean;
  hasIssueReportPayload: boolean;
  isGloballyDisabled: boolean;
  canPickRegion: boolean;
  isSubmittingDebugSample: boolean;
  isSubmittingIssueReport: boolean;
  onChange: (patch: Partial<HuntStallAlertConfig>) => void;
  onOpenRegionPicker: () => void;
  onPreviewSound: (soundId: string, volume: number) => void;
  onSubmitDebugSample: () => void;
  onSubmitIssueReport: () => void;
}) {
  const isCooldownPresenceMode = config.mode === "cooldown-presence";
  const isManualExperienceMode = config.mode === "manual-experience";

  return (
    <AlertEditorRow
      isExpanded={isExpanded}
      colSpan={colSpan}
      editorId={editorId}
      rowClassName="inline-editor-row hunt-stall-editor-row"
      editorClassName={
        isCooldownPresenceMode
          ? "inline-skill-editor hunt-stall-inline-editor cooldown-presence-mode"
          : "inline-skill-editor hunt-stall-inline-editor experience-mode"
      }
      editorLayout="command-rail"
      soundId={config.soundId}
      soundLabel="알림음"
      sounds={getHuntStallAlertSounds()}
      volume={config.volume}
      volumeWarningKey="hunt-stall"
      canPickRegion={canPickRegion}
      reportLabel="감지 제보"
      reportButtonClassName="hunt-issue-report-button"
      reportDisabled={isAlertIssueReportButtonDisabled({
        featureEnabled: config.enabled,
        isGloballyDisabled,
        hasReportPayload: hasIssueReportPayload,
      })}
      isSubmittingReport={isSubmittingIssueReport}
      onSoundChange={(soundId) => onChange({ soundId })}
      onVolumeChange={(volume) => onChange({ volume })}
      onOpenRegionPicker={
        isCooldownPresenceMode || isManualExperienceMode ? onOpenRegionPicker : undefined
      }
      onPreviewSound={(volumeOverride) => onPreviewSound(config.soundId, volumeOverride ?? config.volume)}
      onSubmitReport={onSubmitIssueReport}
      debugContent={
        showDebug ? (
          <HuntStallDebugPanel
            isManualExperienceMode={isManualExperienceMode}
            confidence={confidence}
            foregroundRatio={foregroundRatio}
            changeScore={changeScore}
            recognizedText={recognizedText}
            processedPreviewUrl={processedPreviewUrl}
            processedPreviewImageData={processedPreviewImageData}
            rawPreviewUrl={rawPreviewUrl}
            rawPreviewImageData={rawPreviewImageData}
            cropLabel={cropLabel}
            lastSampledAt={lastSampledAt}
            lastReadableAt={lastReadableAt}
            lastReadFailureAt={lastReadFailureAt}
            unreadableSinceAt={unreadableSinceAt}
            lastReadFailureReason={lastReadFailureReason}
            lastDecision={lastDecision}
            lastRejectedRecognizedText={lastRejectedRecognizedText}
            pendingRecognizedText={pendingRecognizedText}
            pendingRecognizedCount={pendingRecognizedCount}
            stableSampleCount={stableSampleCount}
            unchangedSeconds={unchangedSeconds}
            performance={performance}
            hasDebugPayload={hasDebugPayload}
            isSubmittingDebugSample={isSubmittingDebugSample}
            onSubmitDebugSample={onSubmitDebugSample}
          />
        ) : null
      }
    />
  );
}

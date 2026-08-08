import { Send } from "lucide-react";
import type { RgbaImageSnapshot } from "../../../alertTypes";
import type { RuneAlertConfig } from "../../../types";
import { getRuneAlertSounds } from "../../../lib/sounds";
import { ImageDataCanvas } from "../../../shared/components/ImageDataCanvas";
import { isAlertIssueReportButtonDisabled } from "../../../application/reporting/alertIssueReportAvailability";
import { AlertEditorRow } from "../../../shared/components/AlertEditorRow";

export function RuneAlertEditorRow({
  editorId,
  isExpanded,
  config,
  confidence,
  candidateCount,
  maskPreviewUrl,
  maskPreviewImageData,
  canPickRegion,
  hasCurrentRegion,
  hasStream,
  isGloballyDisabled,
  showDebug,
  hasFalsePositivePayload,
  isSubmittingDebugSample,
  isSubmittingFalsePositive,
  onChange,
  onOpenRegionPicker,
  onPreviewSound,
  onSubmitDebugSample,
  onSubmitFalsePositive,
}: {
  editorId: string;
  isExpanded: boolean;
  config: RuneAlertConfig;
  confidence: number;
  candidateCount: number;
  maskPreviewUrl: string | null;
  maskPreviewImageData: RgbaImageSnapshot | null;
  canPickRegion: boolean;
  hasCurrentRegion: boolean;
  hasStream: boolean;
  isGloballyDisabled: boolean;
  showDebug: boolean;
  hasFalsePositivePayload: boolean;
  isSubmittingDebugSample: boolean;
  isSubmittingFalsePositive: boolean;
  onChange: (patch: Partial<RuneAlertConfig>) => void;
  onOpenRegionPicker: () => void;
  onPreviewSound: (soundId: string, volume: number) => void;
  onSubmitDebugSample: () => void;
  onSubmitFalsePositive: () => void;
}) {
  return (
    <AlertEditorRow
      isExpanded={isExpanded}
      colSpan={8}
      editorId={editorId}
      rowClassName="inline-editor-row rune-editor-row"
      editorClassName="inline-skill-editor rune-inline-editor"
      editorLayout="command-rail"
      soundId={config.soundId}
      soundLabel="알림음"
      sounds={getRuneAlertSounds()}
      volume={config.volume}
      volumeWarningKey="rune"
      canPickRegion={canPickRegion}
      reportLabel="감지 제보"
      reportDisabled={isAlertIssueReportButtonDisabled({
        featureEnabled: config.enabled,
        isGloballyDisabled,
        hasReportPayload: hasFalsePositivePayload,
      })}
      isSubmittingReport={isSubmittingFalsePositive}
      onSoundChange={(soundId) => onChange({ soundId })}
      onVolumeChange={(volume) => onChange({ volume })}
      onOpenRegionPicker={onOpenRegionPicker}
      onPreviewSound={(volumeOverride) => onPreviewSound(config.soundId, volumeOverride ?? config.volume)}
      onSubmitReport={onSubmitFalsePositive}
      debugContent={
        showDebug ? (
          <>
            <div className="inline-metric rune-inline-metric" aria-label="룬 신뢰도">
              <span>신뢰도</span>
              <strong>{Math.round(confidence * 100)}%</strong>
            </div>
            <div className="inline-metric rune-inline-metric" aria-label="룬 후보 수">
              <span>후보</span>
              <strong>{candidateCount}</strong>
            </div>
            {maskPreviewImageData ? (
              <ImageDataCanvas
                className="rune-debug-mask"
                image={maskPreviewImageData}
                ariaLabel="룬 감지 마스크 디버그"
              />
            ) : maskPreviewUrl ? (
              <img className="rune-debug-mask" src={maskPreviewUrl} alt="룬 감지 마스크 디버그" />
            ) : null}
            <button
              className="secondary-button rune-debug-submit-button"
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onSubmitDebugSample();
              }}
              disabled={!hasStream || !hasCurrentRegion || isSubmittingDebugSample}
            >
              <Send size={16} />
              {isSubmittingDebugSample ? "전송 중" : "디버그 전송"}
            </button>
          </>
        ) : null
      }
    />
  );
}

import type { SkillConfig } from "../../../types";
import {
  getErdaFountainAlertSounds,
  getSolJanusAlertSounds,
} from "../../../lib/sounds";
import {
  inferSkillPresetId,
  isErdaFountainPresetId,
  isSolJanusPresetId,
} from "../../../lib/skillPresets";
import { getSkillBuffDurationTargetForSkill } from "../../../lib/skillBuffDuration/skillBuffDurationTargets";
import { isAlertIssueReportButtonDisabled } from "../../../application/reporting/alertIssueReportAvailability";
import { AlertEditorPanel, AlertEditorRow } from "../../../shared/components/AlertEditorRow";
import { formatConfidence } from "./skillDashboardUtils";

type SkillAlertEditorProps = {
  editorId: string;
  skill: SkillConfig;
  confidence: number;
  isExpanded: boolean;
  showDebugColumns: boolean;
  isGloballyDisabled: boolean;
  canPickRegion: boolean;
  onChangeSkill: (skillId: string, patch: Partial<SkillConfig>) => void;
  onOpenRegionPicker: (id: string) => void;
  onPreviewSound: (soundId: string, volume: number) => void;
  hasMisreadPayload: boolean;
  isSubmittingMisread: boolean;
  onSubmitMisreadReport: (id: string) => void;
};

function getSkillEditorSounds(skill: SkillConfig) {
  const presetId = inferSkillPresetId(skill);
  return isSolJanusPresetId(presetId)
    ? getSolJanusAlertSounds()
    : isErdaFountainPresetId(presetId)
      ? getErdaFountainAlertSounds()
      : undefined;
}

function getSkillEditorDebugContent({
  confidence,
  showDebugColumns,
}: {
  confidence: number;
  showDebugColumns: boolean;
}) {
  return showDebugColumns ? (
    <div className="inline-metric" aria-label="신뢰도">
      <span>신뢰도</span>
      <strong>{formatConfidence(confidence)}</strong>
    </div>
  ) : null;
}

function canShowSkillRegionPicker(skill: SkillConfig) {
  return !getSkillBuffDurationTargetForSkill(skill);
}

export function SkillAlertEditorPanel({
  editorId,
  skill,
  confidence,
  isExpanded,
  showDebugColumns,
  isGloballyDisabled,
  canPickRegion,
  onChangeSkill,
  onOpenRegionPicker,
  onPreviewSound,
  hasMisreadPayload,
  isSubmittingMisread,
  onSubmitMisreadReport,
}: SkillAlertEditorProps) {
  const showRegionPicker = canShowSkillRegionPicker(skill);

  return (
    <AlertEditorPanel
      isExpanded={isExpanded}
      editorId={editorId}
      editorLayout="command-rail"
      soundId={skill.soundId}
      soundLabel="알림음"
      sounds={getSkillEditorSounds(skill)}
      volume={skill.volume}
      volumeWarningKey={`skill:${skill.id}`}
      canPickRegion={canPickRegion && showRegionPicker}
      reportLabel="감지 제보"
      reportDisabled={isAlertIssueReportButtonDisabled({
        featureEnabled: skill.enabled,
        isGloballyDisabled,
        hasReportPayload: hasMisreadPayload,
      })}
      isSubmittingReport={isSubmittingMisread}
      onSoundChange={(soundId) => onChangeSkill(skill.id, { soundId })}
      onVolumeChange={(volume) => onChangeSkill(skill.id, { volume })}
      onOpenRegionPicker={showRegionPicker ? () => onOpenRegionPicker(skill.id) : undefined}
      onPreviewSound={(volumeOverride) => onPreviewSound(skill.soundId, volumeOverride ?? skill.volume)}
      onSubmitReport={() => onSubmitMisreadReport(skill.id)}
      debugContent={getSkillEditorDebugContent({ confidence, showDebugColumns })}
    />
  );
}

export function SkillAlertEditorRow({
  colSpan,
  ...props
}: SkillAlertEditorProps & {
  colSpan: number;
}) {
  const showRegionPicker = canShowSkillRegionPicker(props.skill);

  return (
    <AlertEditorRow
      {...props}
      colSpan={colSpan}
      editorLayout="command-rail"
      soundId={props.skill.soundId}
      soundLabel="알림음"
      sounds={getSkillEditorSounds(props.skill)}
      volume={props.skill.volume}
      volumeWarningKey={`skill:${props.skill.id}`}
      canPickRegion={props.canPickRegion && showRegionPicker}
      reportLabel="감지 제보"
      reportDisabled={isAlertIssueReportButtonDisabled({
        featureEnabled: props.skill.enabled,
        isGloballyDisabled: props.isGloballyDisabled,
        hasReportPayload: props.hasMisreadPayload,
      })}
      isSubmittingReport={props.isSubmittingMisread}
      onSoundChange={(soundId) => props.onChangeSkill(props.skill.id, { soundId })}
      onVolumeChange={(volume) => props.onChangeSkill(props.skill.id, { volume })}
      onOpenRegionPicker={showRegionPicker ? () => props.onOpenRegionPicker(props.skill.id) : undefined}
      onPreviewSound={(volumeOverride) =>
        props.onPreviewSound(props.skill.soundId, volumeOverride ?? props.skill.volume)
      }
      onSubmitReport={() => props.onSubmitMisreadReport(props.skill.id)}
      debugContent={getSkillEditorDebugContent({
        confidence: props.confidence,
        showDebugColumns: props.showDebugColumns,
      })}
    />
  );
}

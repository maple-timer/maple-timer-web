import { AlertTriangle, Crosshair } from "lucide-react";
import { m as motion, useReducedMotion } from "motion/react";
import { type ReactNode, type SyntheticEvent, useEffect, useState } from "react";
import { useBoostedVolumeControl } from "../hooks/useBoostedVolumeControl";
import type { AlertSound } from "../../lib/sounds";
import {
  clampAlertVolume,
  getVolumePercentLabel,
  MAX_ALERT_VOLUME,
  VOLUME_STEP,
} from "../../lib/volume";
import { SoundPicker } from "./SoundPicker";
import { VolumeBoostWarningDialog } from "./VolumeBoostWarningDialog";
import { MotionVolumeSlider } from "./MotionVolumeSlider";

function stopRowClick(event: SyntheticEvent) {
  event.stopPropagation();
}

const editorShellTransition = {
  height: { duration: 0.22, ease: [0.22, 1, 0.36, 1] },
  opacity: { duration: 0.14, ease: "easeOut" },
  y: { duration: 0.18, ease: "easeOut" },
} as const;
const editorShellCloseTransition = {
  height: { duration: 0.18, delay: 0.08, ease: [0.22, 1, 0.36, 1] },
  opacity: { duration: 0 },
  y: { duration: 0 },
} as const;

const inlineActionTransition = { duration: 0.14, ease: [0.22, 1, 0.36, 1] } as const;
const editorFieldTransition = { duration: 0.22, ease: [0.22, 1, 0.36, 1] } as const;
type EditorFieldMotionDirection = "left" | "right";

function getInlineActionMotion(disabled: boolean, reducedMotion: boolean) {
  if (disabled || reducedMotion) {
    return {};
  }

  return {
    whileHover: { y: -1 },
    whileTap: { scale: 0.985 },
    transition: inlineActionTransition,
  };
}

function getEditorFieldMotion(
  index: number,
  reducedMotion: boolean,
  direction: EditorFieldMotionDirection,
  isExpanded: boolean,
) {
  if (reducedMotion) {
    return {};
  }

  const offsetX = direction === "right" ? 10 : -10;
  const enterDelay = Math.min(index * 0.035, 0.105);

  return {
    initial: isExpanded ? { opacity: 0, x: offsetX } : false,
    animate: isExpanded ? { opacity: 1, x: 0 } : { opacity: 0, x: offsetX },
    transition: {
      ...editorFieldTransition,
      duration: isExpanded ? editorFieldTransition.duration : 0.14,
      delay: isExpanded ? enterDelay : 0,
    },
  };
}

type AlertEditorPanelProps = {
  isExpanded: boolean;
  editorId: string;
  editorClassName?: string;
  editorLayout?: "default" | "command-rail";
  disabled?: boolean;
  soundId: string;
  sounds?: AlertSound[];
  volume: number;
  volumeWarningKey: string;
  volumeAriaLabelPrefix?: string;
  canPickRegion?: boolean;
  reportLabel?: string;
  reportSubmittingLabel?: string;
  reportButtonClassName?: string;
  reportDisabled?: boolean;
  isSubmittingReport?: boolean;
  soundLabel?: string;
  debugContent?: ReactNode;
  extraContent?: ReactNode;
  onSoundChange: (soundId: string) => void;
  onVolumeChange: (volume: number) => void;
  onOpenRegionPicker?: () => void;
  onPreviewSound: (volumeOverride?: number) => void;
  onSubmitReport?: () => void;
};

export function AlertEditorPanel({
  isExpanded,
  editorId,
  editorClassName = "inline-skill-editor",
  editorLayout = "default",
  disabled = false,
  soundId,
  sounds,
  volume,
  volumeWarningKey,
  volumeAriaLabelPrefix,
  canPickRegion,
  reportLabel = "제보",
  reportSubmittingLabel = "전송 중",
  reportButtonClassName,
  reportDisabled = false,
  isSubmittingReport = false,
  soundLabel = "알람음",
  debugContent = null,
  extraContent = null,
  onSoundChange,
  onVolumeChange,
  onOpenRegionPicker,
  onPreviewSound,
  onSubmitReport,
}: AlertEditorPanelProps) {
  const [shouldRender, setShouldRender] = useState(isExpanded);
  const shouldReduceMotion = useReducedMotion();
  const {
    draftVolume,
    pendingBoostedVolume,
    changeDraftVolume,
    finalizeDraftVolume,
    cancelBoostedVolume,
    confirmBoostedVolume,
  } = useBoostedVolumeControl({
    volume,
    warningKey: volumeWarningKey,
    onCommit: onVolumeChange,
  });

  useEffect(() => {
    if (isExpanded) {
      setShouldRender(true);
    }
  }, [isExpanded]);

  if (!shouldRender) {
    return null;
  }

  const controlsDisabled = !isExpanded || disabled;
  const visibleVolume = clampAlertVolume(draftVolume);
  const volumeLabel = getVolumePercentLabel(visibleVolume);
  const reportButtonClassNames = reportButtonClassName
    ? `inline-action-button inline-report-button ${reportButtonClassName}`
    : "inline-action-button inline-report-button";
  const hasRegionButton = Boolean(onOpenRegionPicker);
  const regionButtonDisabled = controlsDisabled || !canPickRegion;
  const reportButtonDisabled = controlsDisabled || reportDisabled || isSubmittingReport;

  const soundPicker = (
    <SoundPicker
      value={soundId}
      sounds={sounds}
      disabled={controlsDisabled}
      ariaLabel={soundLabel}
      previewLabel={`${soundLabel} 재생`}
      onChange={onSoundChange}
      onPreview={() => onPreviewSound()}
    />
  );

  const renderVolumeSlider = ({
    label,
    showValue = true,
  }: {
    label?: ReactNode;
    showValue?: boolean;
  } = {}) => (
    <MotionVolumeSlider
      className="inline-volume-field"
      label={label}
      value={visibleVolume}
      valueLabel={volumeLabel}
      ariaLabel={`${volumeAriaLabelPrefix ?? "볼륨"} ${volumeLabel}`}
      max={MAX_ALERT_VOLUME}
      step={VOLUME_STEP}
      disabled={controlsDisabled}
      boostThreshold={1}
      showValue={showValue}
      onClick={stopRowClick}
      onChange={changeDraftVolume}
      onPointerUp={finalizeDraftVolume}
      onKeyUp={finalizeDraftVolume}
      onBlur={finalizeDraftVolume}
    />
  );

  const regionButton =
    onOpenRegionPicker && (
      <motion.button
        className="inline-action-button inline-region-button"
        type="button"
        disabled={regionButtonDisabled}
        onClick={(event) => {
          event.stopPropagation();
          onOpenRegionPicker();
        }}
        {...getInlineActionMotion(regionButtonDisabled, Boolean(shouldReduceMotion))}
      >
        <Crosshair size={17} />
        영역 선택
      </motion.button>
    );

  const reportButton = onSubmitReport ? (
    <motion.button
      className={reportButtonClassNames}
      type="button"
      disabled={reportButtonDisabled}
      onClick={(event) => {
        event.stopPropagation();
        onSubmitReport();
      }}
      {...getInlineActionMotion(reportButtonDisabled, Boolean(shouldReduceMotion))}
    >
      <AlertTriangle size={16} />
      {isSubmittingReport ? reportSubmittingLabel : reportLabel}
    </motion.button>
  ) : null;
  const commandRailClassName = [
    "inline-editor-controls",
    "inline-editor-command-rail",
    hasRegionButton ? "has-region" : "without-region",
    reportButton ? "has-report" : "without-report",
  ].join(" ");
  const regionActionFieldClassName = [
    "inline-editor-field",
    "command-action-field",
    "command-region-field",
    hasRegionButton ? "is-visible" : "is-hidden",
  ].join(" ");
  const hasExtraContent = Boolean(extraContent);
  const regionFieldIndex = hasExtraContent ? 3 : 2;
  const reportFieldIndex = regionFieldIndex + (hasRegionButton ? 1 : 0);

  const controls =
    editorLayout === "command-rail" ? (
      <div className={commandRailClassName}>
        <motion.div
          className="inline-editor-field command-sound-field"
          onClick={stopRowClick}
          {...getEditorFieldMotion(0, Boolean(shouldReduceMotion), "left", isExpanded)}
        >
          <span className="inline-editor-field-label">{soundLabel}</span>
          <div className="inline-editor-field-control">{soundPicker}</div>
        </motion.div>

        <motion.div
          className="inline-editor-field command-volume-field"
          onClick={stopRowClick}
          {...getEditorFieldMotion(1, Boolean(shouldReduceMotion), "left", isExpanded)}
        >
          <div className="inline-editor-field-heading">
            <span className="inline-editor-field-label">볼륨</span>
            <strong className="inline-editor-field-value">{volumeLabel}</strong>
          </div>
          <div className="inline-editor-field-control">
            {renderVolumeSlider({ label: null, showValue: false })}
          </div>
        </motion.div>

        {hasExtraContent && (
          <motion.div
            className="inline-editor-field command-extra-field"
            {...getEditorFieldMotion(2, Boolean(shouldReduceMotion), "left", isExpanded)}
          >
            {extraContent}
          </motion.div>
        )}

        {(hasRegionButton || reportButton) && (
          <motion.div
            className={regionActionFieldClassName}
            aria-hidden={!hasRegionButton}
            {...getEditorFieldMotion(regionFieldIndex, Boolean(shouldReduceMotion), "right", isExpanded)}
          >
            {hasRegionButton && (
              <>
                <span className="inline-editor-field-label">영역</span>
                <div className="inline-editor-field-control">{regionButton}</div>
              </>
            )}
          </motion.div>
        )}

        {reportButton && (
          <motion.div
            className="inline-editor-field command-action-field command-report-field"
            {...getEditorFieldMotion(reportFieldIndex, Boolean(shouldReduceMotion), "right", isExpanded)}
          >
            <span className="inline-editor-field-label">제보</span>
            <div className="inline-editor-field-control">{reportButton}</div>
          </motion.div>
        )}
      </div>
    ) : (
      <div className="inline-editor-controls">
        <label className="field-label inline-field sound-field" onClick={stopRowClick}>
          <span>{soundLabel}</span>
          {soundPicker}
        </label>

        {renderVolumeSlider()}

        {extraContent}

        {regionButton}

        {reportButton}
      </div>
    );

  return (
    <>
      <motion.div
        id={editorId}
        className="inline-editor-shell"
        aria-hidden={!isExpanded}
        initial={isExpanded ? { height: 0, opacity: 0, y: -4 } : false}
        animate={
          isExpanded
            ? { height: "auto", opacity: 1, y: 0 }
            : { height: 0, opacity: 1, y: 0 }
        }
        transition={shouldReduceMotion ? { duration: 0 } : isExpanded ? editorShellTransition : editorShellCloseTransition}
        style={{ overflow: isExpanded ? "visible" : "hidden" }}
        onAnimationComplete={() => {
          if (!isExpanded) {
            setShouldRender(false);
          }
        }}
        onTransitionEnd={(event) => {
          if (event.propertyName === "max-height" && !isExpanded) {
            setShouldRender(false);
          }
        }}
      >
        <div
          className={
            editorLayout === "command-rail"
              ? `${editorClassName} inline-editor-command-layout`
              : editorClassName
          }
        >
          {controls}

          {debugContent && <div className="inline-editor-debug">{debugContent}</div>}
        </div>
      </motion.div>
      {pendingBoostedVolume !== null && (
        <VolumeBoostWarningDialog
          volume={pendingBoostedVolume}
          onPreview={() => onPreviewSound(pendingBoostedVolume)}
          onCancel={cancelBoostedVolume}
          onConfirm={confirmBoostedVolume}
        />
      )}
    </>
  );
}

export function AlertEditorRow({
  colSpan,
  rowClassName = "inline-editor-row",
  ...panelProps
}: AlertEditorPanelProps & {
  colSpan: number;
  rowClassName?: string;
}) {
  return (
    <tr className={panelProps.isExpanded ? `${rowClassName} open` : rowClassName}>
      <td colSpan={colSpan}>
        <AlertEditorPanel {...panelProps} />
      </td>
    </tr>
  );
}

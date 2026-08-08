import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Hand, MonitorCog, MousePointer2 } from "lucide-react";
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { coerceRegionToSquare } from "../../lib/capture";
import { hasUsableRegion, normalizeRegion } from "../../lib/regions";
import type { PixelRegion } from "../../contracts/geometry/pixelRegion";
import { MotionDialogFrame } from "../../shared/components/MotionDialogFrame";
import {
  type RegionShape,
  RegionEditor,
} from "../../shared/components/RegionEditor";
import type { RelativeRegion } from "../../types";
import { CropGestureGuide } from "./CropGestureGuide";
import { CropHelperPanel } from "./CropHelperPanel";
import { CropQuickSlotWarningDialog } from "./CropQuickSlotWarningDialog";
import { CropSelectionHeader } from "./CropSelectionHeader";
import { BandRegionEditor } from "./BandRegionEditor";
import {
  type CropPlacementWarningType,
  isRegionInExpectedCropArea,
} from "./cropSelectionUtils";
import { useCropPanZoom } from "./useCropPanZoom";

export { isRegionCenteredInQuickSlotQuadrant } from "./cropSelectionUtils";

export function CropSelectionModal({
  captureSize,
  region,
  sourceRegion = null,
  stream,
  shape = "square",
  title = "스킬 아이콘 하나를 정사각형으로 선택하세요",
  eyebrow = "Region Picker",
  helpText = "인게임 설정 > UI > 퀵슬롯&버프 시간표시가 [중앙, 크게]인지 확인해주세요.",
  helpTooltipText,
  selectGuideText = "영역 선택: 아이콘 드래그",
  emptySelectText = "스킬 아이콘을 드래그해서 선택",
  helperTitle = "퀵슬롯의 스킬 아이콘을 선택하세요",
  helperDescription = "스킬 아이콘 하나가 딱 들어가고 옆 아이콘은 넘치지 않게 잡으면 가장 안정적으로 인식됩니다.",
  helperVideoSrc = "/media/quickslot-crop-guide.mp4",
  helperVideoLabel = "퀵슬롯 crop 예시 영상",
  helperMediaVariant = "wide",
  helperSteps = [
    "처음에는 아이콘 하나를 바로 드래그합니다.",
    "화면 위치가 안 맞으면 이동으로 맞춥니다.",
    "이미 만든 상자는 이동에서 그대로 옮길 수 있습니다.",
  ],
  placementWarning = "skill-quickslot",
  validateRegion,
  validationActionLabel,
  onValidationAction,
  onApply,
  onClose,
}: {
  captureSize: { width: number; height: number } | null;
  region: RelativeRegion | null;
  sourceRegion?: PixelRegion | null;
  stream: MediaStream;
  shape?: RegionShape;
  title?: string;
  eyebrow?: string;
  helpText?: string;
  helpTooltipText?: string | null;
  selectGuideText?: string;
  emptySelectText?: string;
  helperTitle?: string;
  helperDescription?: string;
  helperVideoSrc?: string | null;
  helperVideoLabel?: string;
  helperMediaVariant?: "wide" | "portrait";
  helperSteps?: string[];
  placementWarning?: CropPlacementWarningType | false;
  validateRegion?: (region: RelativeRegion) => string | null;
  validationActionLabel?: string;
  onValidationAction?: () => void;
  onApply: (region: RelativeRegion) => void;
  onClose: () => void;
}) {
  const modalVideoRef = useRef<HTMLVideoElement | null>(null);
  const isHorizontalBand = shape === "horizontal-band";
  const sourceWidth = sourceRegion?.width ?? captureSize?.width ?? 16;
  const sourceHeight = sourceRegion?.height ?? captureSize?.height ?? 9;
  const sourceAspect = sourceWidth / sourceHeight;
  const [draftRegion, setDraftRegion] = useState<RelativeRegion | null>(() =>
    region
      ? shape === "square"
        ? coerceRegionToSquare(region, sourceAspect)
        : normalizeRegion(region)
      : null,
  );
  const {
    activeTool,
    setActiveTool,
    zoom,
    pan,
    setZoomClamped,
    resetView,
    stageHandlers,
  } = useCropPanZoom();
  const [warningRegion, setWarningRegion] = useState<RelativeRegion | null>(null);
  const [validationMessage, setValidationMessage] = useState<string | null>(
    null,
  );
  const [hasAcceptedOffQuickSlotWarning, setAcceptedOffQuickSlotWarning] = useState(false);
  const [hasInteractedWithStage, setHasInteractedWithStage] = useState(false);
  const aspect = `${sourceWidth} / ${sourceHeight}`;
  const croppedVideoStyle =
    sourceRegion && captureSize
      ? {
          width: `${(captureSize.width / sourceRegion.width) * 100}%`,
          height: `${(captureSize.height / sourceRegion.height) * 100}%`,
          left: `${(-sourceRegion.x / sourceRegion.width) * 100}%`,
          top: `${(-sourceRegion.y / sourceRegion.height) * 100}%`,
        }
      : undefined;
  const effectiveActiveTool = isHorizontalBand ? "select" : activeTool;
  const effectiveZoom = isHorizontalBand ? 1 : zoom;
  const effectivePan = isHorizontalBand ? { x: 0, y: 0 } : pan;
  const cropLayerTransform = isHorizontalBand
    ? "translate3d(-50%, -90%, 0)"
    : `translate3d(calc(-50% + ${effectivePan.x}px), calc(-50% + ${effectivePan.y}px), 0)`;
  const effectiveHelpTooltipText =
    helpTooltipText === undefined && placementWarning === "skill-quickslot"
      ? "측면/보통은 숫자가 작아 인식이 불안정할 수 있습니다."
      : helpTooltipText;

  const applyRegion = useCallback(
    (nextRegion: RelativeRegion) => {
      const nextValidationMessage = validateRegion?.(nextRegion) ?? null;
      if (nextValidationMessage) {
        setValidationMessage(nextValidationMessage);
        return;
      }

      setValidationMessage(null);
      if (
        placementWarning &&
        !hasAcceptedOffQuickSlotWarning &&
        !isRegionInExpectedCropArea(nextRegion, placementWarning)
      ) {
        setWarningRegion(nextRegion);
        return;
      }

      onApply(nextRegion);
    },
    [
      hasAcceptedOffQuickSlotWarning,
      onApply,
      placementWarning,
      validateRegion,
    ],
  );

  const changeDraftRegion = useCallback((nextRegion: RelativeRegion | null) => {
    setValidationMessage(null);
    setDraftRegion(nextRegion);
  }, []);

  const warnIfPlacedOutsideExpectedArea = useCallback(
    (nextRegion: RelativeRegion) => {
      if (
        placementWarning &&
        !hasAcceptedOffQuickSlotWarning &&
        !isRegionInExpectedCropArea(nextRegion, placementWarning)
      ) {
        setWarningRegion(nextRegion);
      }
    },
    [hasAcceptedOffQuickSlotWarning, placementWarning],
  );

  const handleStagePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      setHasInteractedWithStage(true);
      if (!isHorizontalBand) {
        stageHandlers.onPointerDown(event);
      }
    },
    [isHorizontalBand, stageHandlers],
  );

  useEffect(() => {
    const video = modalVideoRef.current;
    if (!video) {
      return;
    }

    video.srcObject = stream;
    video.play().catch(() => undefined);
  }, [stream]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (draftRegion) {
          event.preventDefault();
          setDraftRegion(null);
        } else {
          onClose();
        }
      }

      if (event.key === "Enter" && draftRegion && hasUsableRegion(draftRegion)) {
        applyRegion(draftRegion);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [applyRegion, draftRegion, onClose]);

  return (
    <MotionDialogFrame
      backdropClassName="modal-backdrop"
      dialogClassName={
        validationMessage ? "crop-modal has-validation" : "crop-modal"
      }
      labelledBy="crop-modal-title"
    >
        <CropSelectionHeader
          title={title}
          eyebrow={eyebrow}
          helpText={helpText}
          helpTooltipText={effectiveHelpTooltipText}
          activeTool={activeTool}
          zoom={zoom}
          canApply={Boolean(draftRegion && hasUsableRegion(draftRegion))}
          onToolChange={setActiveTool}
          onZoomChange={setZoomClamped}
          onResetView={resetView}
          onClose={onClose}
          onApply={() => draftRegion && applyRegion(draftRegion)}
          showViewportControls={!isHorizontalBand}
        />

        {validationMessage ? (
          <Banner
            className="crop-region-validation-banner"
            status="warning"
            title="선택 영역을 확인해주세요"
            description={validationMessage}
            container="card"
            endContent={
              validationActionLabel && onValidationAction ? (
                <Button
                  label={validationActionLabel}
                  variant="secondary"
                  size="sm"
                  icon={<MonitorCog size={14} aria-hidden="true" />}
                  onClick={onValidationAction}
                />
              ) : null
            }
          />
        ) : null}

        <div className="crop-modal-body">
          <div className="crop-workspace">
            <CropGestureGuide selectGuideText={selectGuideText} />

            <div
              className={[
                effectiveActiveTool === "pan" ? "crop-stage panning" : "crop-stage selecting",
                isHorizontalBand ? "manual-band-stage" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              {...(isHorizontalBand ? {} : stageHandlers)}
              onPointerDown={handleStagePointerDown}
            >
              <div
                className={isHorizontalBand ? "crop-pan-layer manual-band-pan-layer" : "crop-pan-layer"}
                style={{
                  transform: cropLayerTransform,
                }}
              >
                <div
                  className={isHorizontalBand ? "crop-scene manual-band-scene" : "crop-scene"}
                  style={{
                    aspectRatio: aspect,
                    transform: `scale(${effectiveZoom})`,
                  }}
                >
                  {croppedVideoStyle ? (
                    <div className="crop-source-viewport">
                      <video
                        ref={modalVideoRef}
                        muted
                        playsInline
                        style={croppedVideoStyle}
                      />
                    </div>
                  ) : (
                    <video ref={modalVideoRef} muted playsInline />
                  )}
                  {isHorizontalBand ? (
                    <BandRegionEditor
                      region={draftRegion}
                      onChange={changeDraftRegion}
                      onCommit={applyRegion}
                      disabled={false}
                    />
                  ) : (
                    <RegionEditor
                      region={draftRegion}
                      onChange={changeDraftRegion}
                      onCommit={warnIfPlacedOutsideExpectedArea}
                      disabled={false}
                      sourceAspect={sourceAspect}
                      shape={shape}
                      interactionMode={effectiveActiveTool === "select" ? "replace" : "move-only"}
                    />
                  )}
                </div>
              </div>
              {!draftRegion && !hasInteractedWithStage && (
                <div className="crop-stage-hint" aria-hidden="true">
                  {effectiveActiveTool === "select" ? (
                    <>
                      <MousePointer2 size={20} />
                      <strong>{emptySelectText}</strong>
                    </>
                  ) : (
                    <>
                      <Hand size={20} />
                      <strong>영역 선택을 누르고 시작</strong>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          <CropHelperPanel
            helperTitle={helperTitle}
            helperDescription={helperDescription}
            helperVideoSrc={helperVideoSrc}
            helperVideoLabel={helperVideoLabel}
            helperMediaVariant={helperMediaVariant}
            helperSteps={helperSteps}
          />
        </div>

        {warningRegion && (
          <CropQuickSlotWarningDialog
            warningType={placementWarning || "skill-quickslot"}
            onCancel={() => setWarningRegion(null)}
            onConfirm={() => {
              setAcceptedOffQuickSlotWarning(true);
              onApply(warningRegion);
            }}
          />
        )}
    </MotionDialogFrame>
  );
}

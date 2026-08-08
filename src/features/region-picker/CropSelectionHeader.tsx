import { Check, Hand, Maximize2, MousePointer2, X, ZoomIn, ZoomOut } from "lucide-react";
import { FloatingTooltipButton, InfoTooltip } from "../../shared/components/FloatingTooltip";
import type { CropTool } from "./cropSelectionUtils";

export function CropSelectionHeader({
  title,
  eyebrow,
  helpText,
  helpTooltipText,
  activeTool,
  zoom,
  canApply,
  onToolChange,
  onZoomChange,
  onResetView,
  onClose,
  onApply,
  showViewportControls = true,
}: {
  title: string;
  eyebrow: string;
  helpText: string;
  helpTooltipText?: string | null;
  activeTool: CropTool;
  zoom: number;
  canApply: boolean;
  onToolChange: (tool: CropTool) => void;
  onZoomChange: (zoom: number) => void;
  onResetView: () => void;
  onClose: () => void;
  onApply: () => void;
  showViewportControls?: boolean;
}) {
  return (
    <header className="crop-modal-header">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2 id="crop-modal-title">{title}</h2>
        <p className="crop-modal-help">
          <span>{helpText}</span>
          {helpTooltipText && (
            <InfoTooltip
              id="crop-modal-help-tooltip"
              label="쿨타임 표시 설정 안내"
              className="crop-modal-info-button"
              iconSize={13}
              text={helpTooltipText}
              width={300}
            />
          )}
        </p>
      </div>
      <div className="crop-modal-actions">
        {showViewportControls && (
          <>
            <div className="mode-status" aria-label="작업 모드">
              <FloatingTooltipButton
                aria-label="이동"
                className={activeTool === "pan" ? "mode-pill selected" : "mode-pill"}
                type="button"
                aria-pressed={activeTool === "pan"}
                onClick={() => onToolChange("pan")}
                tooltipId="crop-tool-pan-tooltip"
                tooltip="화면 이동과 기존 상자 이동"
              >
                <Hand size={16} />
                <span>
                  <strong>이동</strong>
                  <small>화면/상자</small>
                </span>
              </FloatingTooltipButton>
              <FloatingTooltipButton
                aria-label="영역 선택"
                className={
                  activeTool === "select"
                    ? "mode-pill select-mode selected"
                    : "mode-pill select-mode"
                }
                type="button"
                aria-pressed={activeTool === "select"}
                onClick={() => onToolChange("select")}
                tooltipId="crop-tool-select-tooltip"
                tooltip="새 crop 영역 선택"
              >
                <MousePointer2 size={16} />
                <span>
                  <strong>영역 선택</strong>
                  <small>드래그</small>
                </span>
              </FloatingTooltipButton>
            </div>
            <FloatingTooltipButton
              className="icon-button"
              type="button"
              onClick={() => onZoomChange(zoom / 1.25)}
              tooltipId="crop-zoom-out-tooltip"
              tooltip="축소"
            >
              <ZoomOut size={18} />
            </FloatingTooltipButton>
            <span className="zoom-readout">{Math.round(zoom * 100)}%</span>
            <FloatingTooltipButton
              className="icon-button"
              type="button"
              onClick={() => onZoomChange(zoom * 1.25)}
              tooltipId="crop-zoom-in-tooltip"
              tooltip="확대"
            >
              <ZoomIn size={18} />
            </FloatingTooltipButton>
            <FloatingTooltipButton
              className="icon-button"
              type="button"
              onClick={onResetView}
              tooltipId="crop-reset-view-tooltip"
              tooltip="화면 맞춤"
            >
              <Maximize2 size={18} />
            </FloatingTooltipButton>
          </>
        )}
        <button className="secondary-button" type="button" onClick={onClose}>
          <X size={17} />
          닫기
        </button>
        <button className="primary-button" type="button" disabled={!canApply} onClick={onApply}>
          <Check size={17} />
          적용
        </button>
      </div>
    </header>
  );
}

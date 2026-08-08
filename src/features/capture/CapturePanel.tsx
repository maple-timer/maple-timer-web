import { ChevronDown, MonitorUp } from "lucide-react";
import type { RefObject } from "react";
import type { CaptureStatus } from "../../captureTypes";
import {
  WINDOWS_CAPTURE_NOTICE_LINES,
  WINDOWS_CAPTURE_NOTICE_TITLE,
} from "./windowsCaptureNotice";
import type { RuneAlertConfig, SkillConfig } from "../../types";
import { AlertChecklistBadge } from "../../shared/components/AlertChecklistBadge";
import { FloatingTooltipButton } from "../../shared/components/FloatingTooltip";
import { MotionCollapse } from "../../shared/components/MotionCollapse";
import { useWindowsCaptureNoticeController } from "./useWindowsCaptureNoticeController";
import {
  getCapturePanelViewModel,
  getCaptureStaticRegionBoxes,
  isInteractiveHeaderTarget,
} from "./capturePanelViewModel";

export { getGameResolutionLabel } from "./capturePanelViewModel";

export function CapturePanel({
  stream,
  captureStatus,
  captureSize,
  videoRef,
  skills,
  runeAlert,
  currentLayoutKey,
  isCollapsed,
  onStartCapture,
  onChangeCapture,
  onToggleCollapsed,
  onMetadata,
}: {
  stream: MediaStream | null;
  captureStatus: CaptureStatus;
  captureSize: { width: number; height: number } | null;
  videoRef: RefObject<HTMLVideoElement | null>;
  skills: SkillConfig[];
  runeAlert?: RuneAlertConfig;
  currentLayoutKey?: string | null;
  isCollapsed: boolean;
  onStartCapture: () => void;
  onChangeCapture: () => void;
  onToggleCollapsed: () => void;
  onMetadata: () => void;
}) {
  const viewModel = getCapturePanelViewModel({
    stream,
    captureStatus,
    captureSize,
    currentLayoutKey,
    isCollapsed,
  });
  const {
    shouldShowNotice: showWindowsCaptureNotice,
    hideNoticeForSession,
    dismissNoticePermanently,
  } = useWindowsCaptureNoticeController({
    isCollapsed,
    stream,
    captureStatus,
  });

  return (
    <section className={isCollapsed ? "capture-panel collapsed" : "capture-panel"}>
      <div
        className="panel-heading capture-panel-heading"
        onClick={(event) => {
          if (isInteractiveHeaderTarget(event.target)) {
            return;
          }
          onToggleCollapsed();
        }}
      >
        <div>
          <div className="capture-title-row">
            <h2>화면 공유</h2>
            <AlertChecklistBadge
              id="capture-checklist"
              label="화면 공유 체크리스트"
              title="화면 공유 전 확인해주세요."
              items={[
                "확장 UI를 사용한다면 화면 공유 메뉴에서 게임 영역을 설정해주세요.",
                "설정한 게임 영역은 화면을 변경하거나 공유 크기가 달라지면 다시 확인해주세요.",
                <span className="tooltip-nowrap">
                  길라잡이, 이벤트 UI, 다른 창 등이 인식 대상 영역을 가리면 알림이 정상 동작하지 않을 수 있습니다.
                </span>,
              ]}
              width={620}
            />
            <span className="capture-resolution-badge">{viewModel.captureSizeLabel}</span>
          </div>
        </div>
        <div className="capture-panel-actions">
          {viewModel.shouldShowCollapsedStartButton && (
            <button
              className="primary-button compact-capture-button"
              type="button"
              onClick={onStartCapture}
            >
              <MonitorUp size={16} />
              화면 공유 시작
            </button>
          )}
          {viewModel.shouldShowChangeButton && (
            <button
              className="primary-button compact-capture-button"
              type="button"
              onClick={onChangeCapture}
              disabled={captureStatus === "starting"}
            >
              <MonitorUp size={16} />
              화면 변경
            </button>
          )}
          <FloatingTooltipButton
            className="icon-button small capture-collapse-button"
            type="button"
            aria-expanded={!isCollapsed}
            aria-label={isCollapsed ? "화면 공유 패널 펼치기" : "화면 공유 패널 접기"}
            tooltipId="capture-panel-collapse-tooltip"
            tooltip={isCollapsed ? "펼치기" : "접기"}
            onClick={onToggleCollapsed}
          >
            <ChevronDown size={16} />
          </FloatingTooltipButton>
        </div>
      </div>

      {showWindowsCaptureNotice && (
        <div className="capture-windows-notice" role="status">
          <div className="capture-windows-notice-content">
            <strong>{WINDOWS_CAPTURE_NOTICE_TITLE}</strong>
            <p>{WINDOWS_CAPTURE_NOTICE_LINES.join(" ")}</p>
          </div>
          <div className="capture-windows-notice-actions">
            <button className="ghost-button" type="button" onClick={hideNoticeForSession}>
              닫기
            </button>
            <button className="secondary-button" type="button" onClick={dismissNoticePermanently}>
              다시 보지 않기
            </button>
          </div>
        </div>
      )}

      <MotionCollapse
        className={viewModel.shellClassName}
        collapsedClassName="is-collapsed"
        isCollapsed={isCollapsed}
        aria-hidden={isCollapsed}
        style={viewModel.shellStyle}
      >
        <video
          ref={videoRef}
          muted
          playsInline
          onLoadedMetadata={onMetadata}
          onPlaying={onMetadata}
          onResize={onMetadata}
        />
        {viewModel.shouldShowStaticOverlay && captureSize ? (
          <StaticRegionOverlay
            skills={skills}
            runeAlert={runeAlert}
            layoutKey={viewModel.layoutKey}
            sourceAspect={captureSize.width / captureSize.height}
          />
        ) : viewModel.shouldShowPlaceholder ? (
          <div className="video-placeholder">
            <button
              className="primary-button large-capture-button"
              type="button"
              onClick={onStartCapture}
              disabled={captureStatus === "starting"}
            >
              <MonitorUp size={19} />
              {captureStatus === "starting" ? "시작 중" : "화면 공유 시작"}
            </button>
          </div>
        ) : null}
      </MotionCollapse>
    </section>
  );
}

function StaticRegionOverlay({
  skills,
  runeAlert,
  layoutKey,
  sourceAspect,
}: {
  skills: SkillConfig[];
  runeAlert?: RuneAlertConfig;
  layoutKey: string | null;
  sourceAspect: number;
}) {
  const boxes = getCaptureStaticRegionBoxes({ skills, runeAlert, layoutKey, sourceAspect });

  if (boxes.length === 0) {
    return null;
  }

  return (
    <div className="region-static-overlay" aria-hidden="true">
      {boxes.map((box) => (
        <div key={box.id} className={box.className} style={box.style} />
      ))}
    </div>
  );
}

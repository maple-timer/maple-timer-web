import { usePopover } from "@astryxdesign/core/Popover";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  MonitorCog,
  MonitorUp,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { CaptureStatus } from "../../captureTypes";
import type {
  GameViewportCalibrationState,
  GameViewportVerificationStatus,
} from "../../contracts/geometry/frameSource";
import { CAPTURE_BROWSER_NOTICE } from "../../lib/browserSupport";
import type { CaptureSize } from "../../lib/gameResolutions";
import { getGameResolutionLabel } from "../../lib/gameResolutions";
import { WINDOWS_CAPTURE_NOTICE_LINES } from "./windowsCaptureNotice";

function getGameViewportStatus(
  state: GameViewportCalibrationState,
  verificationStatus: GameViewportVerificationStatus,
): {
  className: string;
  description: string;
  label: string;
} {
  if (state.status === "calibrated") {
    return {
      className: "calibrated",
      description: "설정한 게임 화면을 기준으로 알림을 분석합니다.",
      label: `${state.calibration.gameResolution.width} x ${state.calibration.gameResolution.height} 설정됨`,
    };
  }
  if (verificationStatus === "stale") {
    return {
      className: "stale",
      description: "공유 화면 크기가 바뀌어 다시 설정해야 합니다.",
      label: "다시 설정 필요",
    };
  }
  if (verificationStatus === "unverified") {
    return {
      className: "recommended",
      description: "확장 UI 사용 시 게임 화면 영역을 맞춰주세요.",
      label: "게임 화면 확인 필요",
    };
  }
  if (verificationStatus === "user-confirmed") {
    return {
      className: "passthrough",
      description: "공유 화면 전체가 게임 화면이라고 확인했습니다.",
      label: "전체 화면 확인됨",
    };
  }
  return {
    className: "passthrough",
    description: "현재 공유 화면을 게임 화면 기준으로 사용합니다.",
    label: "게임 화면 확인됨",
  };
}

export function ScreenShareHeaderControl({
  stream,
  captureStatus,
  captureSize,
  gameViewportState,
  gameViewportVerification,
  onStartCapture,
  onChangeCapture,
  onOpenGameViewportSetup,
  onUseFullCaptureAsGameViewport,
}: {
  stream: MediaStream | null;
  captureStatus: CaptureStatus;
  captureSize: CaptureSize | null;
  gameViewportState: GameViewportCalibrationState;
  gameViewportVerification: GameViewportVerificationStatus;
  attentionKey?: number;
  onStartCapture: () => void;
  onChangeCapture: () => void;
  onOpenGameViewportSetup: () => void;
  onUseFullCaptureAsGameViewport: () => void;
}) {
  const detailsPopover = usePopover({
    dialogLabel: "화면 공유 상세",
    hasAutoFocus: false,
    hasCloseButton: false,
    hasLightDismiss: true,
    hasSurface: false,
  });
  const {
    hide: hideDetailsPopover,
    isOpen: isDetailsOpen,
    render: renderDetailsPopover,
    show: showDetailsPopover,
    toggle: toggleDetailsPopover,
    triggerProps: detailsTriggerProps,
    triggerRef: detailsTriggerRef,
  } = detailsPopover;
  const previousStreamRef = useRef<MediaStream | null>(stream);
  const hasStream = Boolean(stream);
  const isStarting = captureStatus === "starting";
  const isGameViewportSetupRequired =
    gameViewportVerification === "stale";
  const isGameViewportUnverified =
    gameViewportVerification === "unverified";
  const hasGameViewportAttention =
    isGameViewportUnverified || isGameViewportSetupRequired;
  const statusLabel = !hasStream
    ? "화면 공유 필요"
    : isGameViewportSetupRequired
      ? "게임 화면 다시 설정"
      : isGameViewportUnverified
        ? "게임 화면 확인"
        : "화면 공유 중";
  const sizeLabel = hasStream ? getGameResolutionLabel(captureSize) : "화면 공유 필요";
  const detailLabel = !hasStream
    ? "선택 대기"
    : isGameViewportSetupRequired
      ? "설정 필요"
      : isGameViewportUnverified
        ? "확인 필요"
        : sizeLabel;
  const controlAriaLabel = !hasStream
    ? "화면 공유 시작"
    : isGameViewportSetupRequired
      ? `게임 화면 다시 설정 필요 ${sizeLabel}`
      : isGameViewportUnverified
        ? `게임 화면 확인 필요 ${sizeLabel}`
        : `화면 공유 중 ${sizeLabel}`;
  const gameViewportStatus = getGameViewportStatus(
    gameViewportState,
    gameViewportVerification,
  );
  const controlClassName = [
    "screen-share-header-control",
    hasStream ? "active" : "needs-share",
    isGameViewportUnverified ? "game-viewport-recommended" : "",
    isGameViewportSetupRequired ? "game-viewport-required" : "",
    isStarting ? "starting" : "",
    isDetailsOpen ? "details-open" : "",
    !hasStream || hasGameViewportAttention ? "attention-beat" : "",
  ].filter(Boolean).join(" ");

  useEffect(() => {
    const previousStream = previousStreamRef.current;
    previousStreamRef.current = stream;

    if (!stream) {
      hideDetailsPopover();
      return;
    }

    if (!previousStream) {
      showDetailsPopover({ skipAutoFocus: true });
    }
  }, [hideDetailsPopover, showDetailsPopover, stream]);

  const status = (
    <span className="screen-share-header-status" aria-live="polite">
      <span className={hasStream ? "screen-share-header-dot active" : "screen-share-header-dot"} />
      <span className="screen-share-header-text">
        <strong>{statusLabel}</strong>
      </span>
    </span>
  );
  const detail = (
    <span className="screen-share-header-detail">
      {detailLabel}
    </span>
  );

  if (!stream) {
    return (
      <button
        className={controlClassName}
        type="button"
        onClick={onStartCapture}
        disabled={isStarting}
        aria-label="화면 공유 시작"
      >
        {status}
        <span className="screen-share-header-separator" aria-hidden="true" />
        {detail}
        <span className="screen-share-header-separator" aria-hidden="true" />
        <span className="screen-share-header-action">
          <MonitorUp size={14} />
          시작
        </span>
      </button>
    );
  }

  return (
    <div
      ref={detailsTriggerRef}
      className={controlClassName}
      aria-label={controlAriaLabel}
      role="button"
      tabIndex={0}
      onClick={toggleDetailsPopover}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) {
          return;
        }
        if (event.key !== "Enter" && event.key !== " ") {
          return;
        }
        event.preventDefault();
        toggleDetailsPopover();
      }}
      {...detailsTriggerProps}
    >
      {status}
      <span className="screen-share-header-separator" aria-hidden="true" />
      {detail}
      <span className="screen-share-header-separator" aria-hidden="true" />
      <button
        className="screen-share-header-action"
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onChangeCapture();
        }}
      >
        <MonitorUp size={14} />
        변경
      </button>

      {renderDetailsPopover(
        isDetailsOpen ? (
          <div
            id="screen-share-header-detail"
            className="screen-share-header-popover"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="screen-share-header-popover-head">
              <strong>화면 공유 상세</strong>
              <div className="screen-share-header-popover-actions">
                <span className="screen-share-header-resolution">{sizeLabel}</span>
                <button
                  className="screen-share-header-change-button"
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onChangeCapture();
                  }}
                >
                  <MonitorUp size={14} />
                  화면 변경
                </button>
                <button
                  className="screen-share-header-close-button"
                  type="button"
                  aria-label="화면 공유 상세 닫기"
                  onClick={(event) => {
                    event.stopPropagation();
                    hideDetailsPopover();
                    event.currentTarget.blur();
                  }}
                >
                  <X size={14} />
                </button>
              </div>
            </div>
            <div
              className={[
                "screen-share-header-game-viewport",
                gameViewportStatus.className,
              ].filter(Boolean).join(" ")}
            >
              <span className="screen-share-header-game-viewport-copy">
                <MonitorCog size={15} aria-hidden="true" />
                <span className="screen-share-header-game-viewport-text">
                  <span className="screen-share-header-game-viewport-title">
                    <strong>게임 화면 영역</strong>
                    <span className={gameViewportStatus.className}>
                      {gameViewportStatus.label}
                    </span>
                  </span>
                  <span className="screen-share-header-game-viewport-description">
                    {gameViewportStatus.description}
                  </span>
                </span>
              </span>
              <span className="screen-share-header-game-viewport-actions">
                <button
                  className="game-viewport-action-button is-primary"
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    hideDetailsPopover();
                    onOpenGameViewportSetup();
                  }}
                >
                  <MonitorCog size={15} aria-hidden="true" />
                  게임 화면 맞추기
                </button>
                {hasGameViewportAttention ? (
                  <button
                    className="game-viewport-action-button"
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      hideDetailsPopover();
                      onUseFullCaptureAsGameViewport();
                    }}
                  >
                    <Check size={15} aria-hidden="true" />
                    공유 화면 그대로 사용
                  </button>
                ) : null}
              </span>
            </div>
            <div className="screen-share-header-popover-body">
              <ul className="screen-share-header-checklist">
                <li>
                  <CheckCircle2 size={13} />
                  다른 UI가 인식 영역을 가리지 않게 해주세요.
                </li>
                <li>
                  <CheckCircle2 size={13} />
                  선택한 화면은 이 브라우저에서만 분석합니다.
                </li>
                <li>
                  <CheckCircle2 size={13} />
                  게임 화면 이미지나 영상은 서버로 전송되거나 저장되지 않습니다.
                </li>
                <li>
                  <CheckCircle2 size={13} />
                  {CAPTURE_BROWSER_NOTICE}
                </li>
              </ul>
              <ScreenShareHeaderPreview stream={stream} />
            </div>
            <div className="screen-share-header-windows-warning">
              <AlertTriangle size={14} />
              <span className="screen-share-header-windows-warning-copy">
                {WINDOWS_CAPTURE_NOTICE_LINES.map((line) => (
                  <span key={line}>{line}</span>
                ))}
              </span>
            </div>
          </div>
        ) : null,
        { placement: "below", alignment: "end" },
      )}
    </div>
  );
}

function ScreenShareHeaderPreview({ stream }: { stream: MediaStream }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [hasMetadata, setMetadata] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    setMetadata(false);
    if (!video) {
      return;
    }

    video.srcObject = stream;
    const playResult = video.play();
    if (playResult && typeof playResult.catch === "function") {
      void playResult.catch(() => undefined);
    }

    return () => {
      if (video.srcObject === stream) {
        video.srcObject = null;
      }
    };
  }, [stream]);

  return (
    <figure className={hasMetadata ? "screen-share-header-preview ready" : "screen-share-header-preview"}>
      <div className="screen-share-header-preview-frame">
        <video
          ref={videoRef}
          aria-label="공유 화면 미리보기"
          muted
          playsInline
          autoPlay
          onLoadedMetadata={() => setMetadata(true)}
        />
      </div>
    </figure>
  );
}

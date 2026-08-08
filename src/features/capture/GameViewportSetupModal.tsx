import { Selector } from "@astryxdesign/core/Selector";
import {
  Check,
  Crop,
  Hand,
  Maximize2,
  RotateCcw,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  type CSSProperties,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  GameViewportCalibrationState,
  GameViewportVerificationStatus,
  PixelSize,
} from "../../contracts/geometry/frameSource";
import {
  getInitialGameViewportRegion,
  getSuggestedGameResolution,
  isSamePixelSize,
} from "../../lib/gameViewport";
import { KNOWN_GAME_RESOLUTIONS } from "../../lib/gameResolutions";
import { hasUsableRegion, pixelsToRegion } from "../../lib/regions";
import { MotionDialogFrame } from "../../shared/components/MotionDialogFrame";
import { MotionSegmentedControl } from "../../shared/components/MotionSegmentedControl";
import { RegionEditor } from "../../shared/components/RegionEditor";
import type { RelativeRegion } from "../../types";
import {
  GAME_VIEWPORT_EDITOR_ZOOM_INCREMENT,
  MAX_GAME_VIEWPORT_EDITOR_ZOOM,
  MIN_GAME_VIEWPORT_EDITOR_ZOOM,
  useGameViewportEditorView,
} from "./useGameViewportEditorView";

type GameViewportEditorMode = "region" | "pan";

const GAME_RESOLUTION_OPTIONS = KNOWN_GAME_RESOLUTIONS.map((resolution) => ({
  value: `${resolution.width}x${resolution.height}`,
  label: `${resolution.width} x ${resolution.height}`,
}));

function getResolutionValue(resolution: PixelSize): string {
  return `${resolution.width}x${resolution.height}`;
}

function findResolution(value: string): PixelSize | null {
  const matched = KNOWN_GAME_RESOLUTIONS.find(
    (resolution) => getResolutionValue(resolution) === value,
  );
  return matched ? { width: matched.width, height: matched.height } : null;
}

function getInitialDraft({
  captureSize,
  state,
}: {
  captureSize: PixelSize;
  state: GameViewportCalibrationState;
}): {
  gameResolution: PixelSize;
  region: RelativeRegion;
} {
  if (
    state.status === "calibrated" &&
    isSamePixelSize(state.calibration.captureSize, captureSize)
  ) {
    return {
      gameResolution: state.calibration.gameResolution,
      region: pixelsToRegion(
        state.calibration.region,
        captureSize.width,
        captureSize.height,
      ),
    };
  }

  const gameResolution = getSuggestedGameResolution(captureSize);
  return {
    gameResolution,
    region: getInitialGameViewportRegion(captureSize, gameResolution),
  };
}

export function GameViewportSetupModal({
  captureSize,
  state,
  verificationStatus,
  stream,
  onApply,
  onClose,
  onUseFullCapture,
}: {
  captureSize: PixelSize;
  state: GameViewportCalibrationState;
  verificationStatus: GameViewportVerificationStatus;
  stream: MediaStream;
  onApply: (value: {
    gameResolution: PixelSize;
    region: RelativeRegion;
  }) => void;
  onClose: () => void;
  onUseFullCapture: () => void;
}) {
  const initialDraft = useMemo(
    () => getInitialDraft({ captureSize, state }),
    [captureSize, state],
  );
  const [gameResolution, setGameResolution] = useState<PixelSize>(
    initialDraft.gameResolution,
  );
  const [draftRegion, setDraftRegion] = useState<RelativeRegion>(
    initialDraft.region,
  );
  const [editorMode, setEditorMode] =
    useState<GameViewportEditorMode>("region");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const sourceAspect = captureSize.width / captureSize.height;
  const gameAspect = gameResolution.width / gameResolution.height;
  const isPreviouslyCalibrated = state.status !== "legacy-passthrough";
  const canUseFullCapture =
    isPreviouslyCalibrated || verificationStatus === "unverified";
  const {
    stageRef,
    view: editorView,
    isPanning,
    setZoom,
    resetView,
    stageHandlers,
  } = useGameViewportEditorView();

  useEffect(() => {
    if (
      editorView.zoom <= MIN_GAME_VIEWPORT_EDITOR_ZOOM &&
      editorMode === "pan"
    ) {
      setEditorMode("region");
    }
  }, [editorMode, editorView.zoom]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    video.srcObject = stream;
    void video.play().catch(() => undefined);
    return () => {
      if (video.srcObject === stream) {
        video.srcObject = null;
      }
    };
  }, [stream]);

  useEffect(() => {
    const video = videoRef.current;
    const canvas = previewCanvasRef.current;
    if (!video || !canvas) {
      return;
    }

    const renderPreview = () => {
      if (!video.videoWidth || !video.videoHeight) {
        return;
      }

      const context = canvas.getContext("2d");
      if (!context) {
        return;
      }

      const sourceX = Math.round(draftRegion.x * video.videoWidth);
      const sourceY = Math.round(draftRegion.y * video.videoHeight);
      const sourceWidth = Math.max(
        1,
        Math.round(draftRegion.width * video.videoWidth),
      );
      const sourceHeight = Math.max(
        1,
        Math.round(draftRegion.height * video.videoHeight),
      );
      const targetWidth = 640;
      const targetHeight = Math.max(
        1,
        Math.round(targetWidth / Math.max(0.1, gameAspect)),
      );

      if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
        canvas.width = targetWidth;
        canvas.height = targetHeight;
      }
      context.drawImage(
        video,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        0,
        0,
        targetWidth,
        targetHeight,
      );
    };

    renderPreview();
    const interval = window.setInterval(renderPreview, 250);
    return () => window.clearInterval(interval);
  }, [draftRegion, gameAspect]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
      if (event.key === "Enter" && hasUsableRegion(draftRegion)) {
        onApply({ gameResolution, region: draftRegion });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [draftRegion, gameResolution, onApply, onClose]);

  const changeResolution = (value: string) => {
    const nextResolution = findResolution(value);
    if (!nextResolution) {
      return;
    }

    setGameResolution(nextResolution);
    setDraftRegion(getInitialGameViewportRegion(captureSize, nextResolution));
    setEditorMode("region");
    resetView();
  };

  const fitEditorView = () => {
    setEditorMode("region");
    resetView();
  };

  return (
    <MotionDialogFrame
      backdropClassName="modal-backdrop"
      dialogClassName="game-viewport-modal"
      labelledBy="game-viewport-modal-title"
      describedBy="game-viewport-modal-description"
    >
      <header className="game-viewport-modal-header">
        <span className="game-viewport-modal-heading">
          <span className="eyebrow">Game viewport</span>
          <strong id="game-viewport-modal-title">게임 영역 설정</strong>
          <span id="game-viewport-modal-description">
            공유 화면에서 실제 메이플 화면이 보이는 부분을 맞춰주세요.
          </span>
        </span>
        <button
          className="game-viewport-modal-close"
          type="button"
          aria-label="게임 영역 설정 닫기"
          title="닫기"
          onClick={onClose}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </header>

      <div className="game-viewport-modal-body">
        <section
          className="game-viewport-editor-panel"
          aria-label="공유 화면에서 게임 영역 맞추기"
        >
          <span className="game-viewport-editor-controls">
            <span className="game-viewport-editor-copy">
              <span className="game-viewport-editor-resolution">
                {gameResolution.width} x {gameResolution.height}
              </span>
              <span className="game-viewport-editor-help">
                박스 드래그 · 모서리 조절 · 휠 확대
              </span>
            </span>
            <span
              className="game-viewport-editor-toolbar"
              role="toolbar"
              aria-label="게임 화면 보기 도구"
              onPointerDown={(event) => event.stopPropagation()}
            >
              <span className="game-viewport-editor-mode-control">
                <MotionSegmentedControl<GameViewportEditorMode>
                  ariaLabel="게임 화면 편집 모드"
                  className="game-viewport-editor-mode-toggle"
                  optionClassName="game-viewport-editor-mode-option"
                  value={editorMode}
                  onChange={setEditorMode}
                  options={[
                    {
                      value: "region",
                      label: "영역 조절",
                      icon: <Crop size={14} aria-hidden="true" />,
                    },
                    {
                      value: "pan",
                      label: "화면 이동",
                      icon: <Hand size={14} aria-hidden="true" />,
                      disabled:
                        editorView.zoom <= MIN_GAME_VIEWPORT_EDITOR_ZOOM,
                    },
                  ]}
                />
              </span>
              <span className="game-viewport-editor-zoom-controls">
                <button
                  className="game-viewport-tool-button"
                  type="button"
                  aria-label="게임 화면 축소"
                  title="축소 (휠 아래)"
                  disabled={
                    editorView.zoom <= MIN_GAME_VIEWPORT_EDITOR_ZOOM
                  }
                  onClick={() => {
                    setZoom(
                      editorView.zoom - GAME_VIEWPORT_EDITOR_ZOOM_INCREMENT,
                    );
                  }}
                >
                  <ZoomOut size={16} aria-hidden="true" />
                </button>
                <span
                  className="game-viewport-editor-zoom-readout"
                  aria-live="polite"
                >
                  {Math.round(editorView.zoom * 100)}%
                </span>
                <button
                  className="game-viewport-tool-button"
                  type="button"
                  aria-label="게임 화면 확대"
                  title="확대 (휠 위)"
                  disabled={
                    editorView.zoom >= MAX_GAME_VIEWPORT_EDITOR_ZOOM
                  }
                  onClick={() => {
                    setZoom(
                      editorView.zoom + GAME_VIEWPORT_EDITOR_ZOOM_INCREMENT,
                    );
                  }}
                >
                  <ZoomIn size={16} aria-hidden="true" />
                </button>
                <button
                  className="game-viewport-tool-button"
                  type="button"
                  aria-label="게임 화면 전체 맞춤"
                  title="100%로 돌아가기"
                  disabled={
                    editorView.zoom === MIN_GAME_VIEWPORT_EDITOR_ZOOM &&
                    editorView.pan.x === 0 &&
                    editorView.pan.y === 0
                  }
                  onClick={fitEditorView}
                >
                  <Maximize2 size={16} aria-hidden="true" />
                </button>
              </span>
            </span>
          </span>
          <div
            ref={stageRef}
            className={[
              "game-viewport-editor-stage",
              editorView.zoom > MIN_GAME_VIEWPORT_EDITOR_ZOOM
                ? "zoomed"
                : "",
              editorMode === "pan" ? "pan-mode" : "region-mode",
              isPanning ? "panning" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            style={{
              aspectRatio: `${captureSize.width} / ${captureSize.height}`,
            }}
            aria-label="게임 화면 영역 편집기"
            onWheel={stageHandlers.onWheel}
            onPointerDown={
              editorMode === "pan" ? stageHandlers.onPointerDown : undefined
            }
            onPointerMove={
              editorMode === "pan" ? stageHandlers.onPointerMove : undefined
            }
            onPointerUp={
              editorMode === "pan" ? stageHandlers.onPointerUp : undefined
            }
            onPointerCancel={
              editorMode === "pan" ? stageHandlers.onPointerCancel : undefined
            }
          >
            <div
              className="game-viewport-editor-pan-layer"
              style={{
                transform: `translate3d(${editorView.pan.x}px, ${editorView.pan.y}px, 0)`,
              }}
            >
              <div
                className="game-viewport-editor-scene"
                style={
                  {
                    transform: `scale(${editorView.zoom})`,
                    "--game-viewport-editor-inverse-zoom":
                      1 / editorView.zoom,
                  } as CSSProperties
                }
              >
                <video ref={videoRef} muted playsInline autoPlay />
                <RegionEditor
                  region={draftRegion}
                  onChange={setDraftRegion}
                  disabled={editorMode === "pan"}
                  sourceAspect={sourceAspect}
                  shape="rectangle"
                  lockedAspectRatio={gameAspect}
                  interactionMode="edit-existing"
                />
              </div>
            </div>
          </div>
        </section>

        <aside className="game-viewport-settings-panel">
          <div className="game-viewport-setting-step">
            <span className="game-viewport-step-number">1</span>
            <span>
              <strong>인게임 해상도 선택</strong>
              <span>메이플 설정에서 사용 중인 해상도를 선택하세요.</span>
            </span>
          </div>
          <Selector
            label="인게임 해상도"
            isLabelHidden
            options={GAME_RESOLUTION_OPTIONS}
            value={getResolutionValue(gameResolution)}
            onChange={changeResolution}
            width="100%"
          />

          <div className="game-viewport-setting-step">
            <span className="game-viewport-step-number">2</span>
            <span>
              <strong>게임 화면에 맞추기</strong>
              <span>확장 UI 바깥 영역은 테두리 밖에 남겨두세요.</span>
            </span>
          </div>

          <div className="game-viewport-setting-step">
            <span className="game-viewport-step-number">3</span>
            <span>
              <strong>선택 결과 확인</strong>
              <span>아래 화면에 게임 화면만 보이면 설정을 적용하세요.</span>
            </span>
          </div>
          <figure
            className="game-viewport-result-preview"
            style={{ aspectRatio: `${gameResolution.width} / ${gameResolution.height}` }}
          >
            <canvas
              ref={previewCanvasRef}
              aria-label="선택한 게임 화면 미리보기"
            />
            <figcaption>
              <Check size={13} aria-hidden="true" />
              게임 영역 미리보기
            </figcaption>
          </figure>

          <dl className="game-viewport-selection-summary">
            <div>
              <dt>공유 화면</dt>
              <dd>
                {captureSize.width} x {captureSize.height}
              </dd>
            </div>
            <div>
              <dt>게임 화면</dt>
              <dd>
                {gameResolution.width} x {gameResolution.height}
              </dd>
            </div>
          </dl>
        </aside>
      </div>

      <footer className="game-viewport-modal-footer">
        <span className="game-viewport-modal-footnote">
          확장 UI 영역은 박스 밖에 두세요. 현재 공유 화면에만 적용됩니다.
        </span>
        <span className="game-viewport-modal-actions">
          {canUseFullCapture ? (
            <button
              className="game-viewport-action-button is-full-capture"
              type="button"
              onClick={onUseFullCapture}
            >
              {isPreviouslyCalibrated ? (
                <RotateCcw size={15} aria-hidden="true" />
              ) : (
                <Check size={15} aria-hidden="true" />
              )}
              공유 화면 그대로 사용
            </button>
          ) : null}
          <button
            className="game-viewport-action-button"
            type="button"
            onClick={onClose}
          >
            취소
          </button>
          <button
            className="game-viewport-action-button is-primary"
            type="button"
            disabled={!hasUsableRegion(draftRegion)}
            onClick={() => onApply({ gameResolution, region: draftRegion })}
          >
            <Check size={15} aria-hidden="true" />
            게임 영역 사용
          </button>
        </span>
      </footer>
    </MotionDialogFrame>
  );
}

import { Switch } from "@astryxdesign/core/Switch";
import { ArrowLeft, ArrowRight, PictureInPicture2, Play, SlidersHorizontal, X } from "lucide-react";
import { AnimatePresence, m as motion, useReducedMotion } from "motion/react";
import {
  forwardRef,
  useCallback,
  type CSSProperties,
  useEffect,
  type MouseEvent,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import type { HuntStallRuntimeState, RuneRuntimeState } from "../../../alertTypes";
import {
  trackPipTimerConfigChanged,
  trackPipTimerSettingsOpen,
  trackPipTimerToggle,
} from "../../../lib/analyticsEvents";
import type { BuffExpiryRuntimeState } from "../../../lib/buffExpiry/buffExpiryTypes";
import { RECOMMENDED_BROWSER_LABEL } from "../../../lib/browserSupport";
import type { CaptureSize } from "../../../lib/gameResolutions";
import {
  getSpecialCorePipTimerDisplay,
  getPipTimerDisplay,
  type PipTimerDisplay,
} from "../../../application/pip/pipTimerPresentation";
import {
  getPipTimerAlertColorTheme,
  type PipTimerAlertColorTheme,
  getPipTimerWindowSize,
  PIP_TIMER_ALERT_COLOR_OPTIONS,
  PIP_TIMER_EMPHASIS_OPTIONS,
  PIP_TIMER_MODE_OPTIONS,
  PIP_TIMER_SIZE_OPTIONS,
  PIP_TIMER_VISIBLE_ITEM_OPTIONS,
} from "../../../lib/pipTimerSettings";
import type { SpecialCoreRuntimeState } from "../../../lib/specialCore/specialCoreAlertTypes";
import { MotionDialogFrame } from "../../../shared/components/MotionDialogFrame";
import { getSubtlePressMotion } from "../../../shared/motionPresets";
import {
  browserDocumentPipPlatform,
  type DocumentPipPlatform,
  type DocumentPipWindow,
} from "../../../platform/document-pip/documentPipPlatform";
import {
  createPipTimerSettingsPreviewDisplay,
  DEFAULT_PIP_SETTINGS_PREVIEW_ITEM_KEY,
  getPipMakerPreviewButtonLabel,
  getPipMakerStepMotionView,
  getPipMakerStepView,
  getPipMakerStepViewportHeight,
  getPipTimerActiveDisplay,
  getPipTimerAlertStylePreviewUntil,
  getPipTimerConfigChangeEffects,
  getPipTimerItemAlertColorsAfterChange,
  getPipTimerWindowCleanupPlan,
  type PipMakerStep,
} from "./pipTimerControlViewModel";
import { PipTimerWindow, injectPipStyles } from "./PipTimerWindow";
import type {
  GeneralTimerConfig,
  BuffExpiryAlertConfig,
  HuntStallAlertConfig,
  PipTimerAlertColor,
  PipTimerConfig,
  PipTimerItemAlertColors,
  PipTimerMode,
  PipTimerVisibleItems,
  RuneAlertConfig,
  SkillConfig,
  SkillRuntimeState,
  SpecialCoreAlertConfig,
} from "../../../types";

function trackPipTimerPatch(
  currentConfig: PipTimerConfig,
  patch: Partial<PipTimerConfig>,
) {
  if (patch.mode && patch.mode !== currentConfig.mode) {
    trackPipTimerConfigChanged("mode", { value: patch.mode });
  }
  if (patch.alertColor && patch.alertColor !== currentConfig.alertColor) {
    trackPipTimerConfigChanged("alert_color", { value: patch.alertColor });
  }
  if (patch.size && patch.size !== currentConfig.size) {
    trackPipTimerConfigChanged("size", { value: patch.size });
  }
  if (patch.emphasis && patch.emphasis !== currentConfig.emphasis) {
    trackPipTimerConfigChanged("emphasis", { value: patch.emphasis });
  }
  if (
    typeof patch.showScreenPreview === "boolean" &&
    patch.showScreenPreview !== Boolean(currentConfig.showScreenPreview)
  ) {
    trackPipTimerConfigChanged("screen_preview", {
      value: patch.showScreenPreview,
    });
  }
  if (patch.visibleItems) {
    (Object.keys(patch.visibleItems) as Array<keyof PipTimerVisibleItems>).forEach((item) => {
      const nextValue = patch.visibleItems?.[item];
      if (
        typeof nextValue === "boolean" &&
        nextValue !== currentConfig.visibleItems[item]
      ) {
        trackPipTimerConfigChanged("visible_item", {
          item,
          value: nextValue,
        });
      }
    });
  }
  if (patch.itemAlertColors) {
    (Object.keys(patch.itemAlertColors) as Array<keyof PipTimerItemAlertColors>).forEach(
      (item) => {
        const nextValue = patch.itemAlertColors?.[item];
        if (nextValue && nextValue !== currentConfig.itemAlertColors[item]) {
          trackPipTimerConfigChanged("item_alert_color", {
            item,
            value: nextValue,
          });
        }
      },
    );
  }
}

export function PipTimerControl({
  skills,
  states,
  runeConfig,
  runeState,
  generalTimers,
  huntStallConfig,
  huntStallState,
  buffExpiryConfig,
  buffExpiryState,
  specialCoreConfig,
  specialCoreState,
  config,
  documentPip = browserDocumentPipPlatform,
  screenPreviewStream = null,
  screenPreviewSize = null,
  isAllAlertsDisabled,
  hasActiveAlerts,
  masterVolume,
  onConfigChange,
  onToggleAllAlertsDisabled,
  onMasterVolumeChange,
  onMessage,
}: {
  skills: SkillConfig[];
  states: Record<string, SkillRuntimeState>;
  runeConfig: RuneAlertConfig | null;
  runeState: RuneRuntimeState;
  generalTimers: GeneralTimerConfig[];
  huntStallConfig: HuntStallAlertConfig | null;
  huntStallState: HuntStallRuntimeState | null;
  buffExpiryConfig: BuffExpiryAlertConfig | null;
  buffExpiryState: BuffExpiryRuntimeState | null;
  specialCoreConfig: SpecialCoreAlertConfig | null;
  specialCoreState: SpecialCoreRuntimeState | null;
  config: PipTimerConfig;
  documentPip?: DocumentPipPlatform;
  screenPreviewStream?: MediaStream | null;
  screenPreviewSize?: CaptureSize | null;
  isAllAlertsDisabled: boolean;
  hasActiveAlerts: boolean;
  masterVolume: number;
  onConfigChange: (patch: Partial<PipTimerConfig>) => void;
  onToggleAllAlertsDisabled: (disabled: boolean) => void;
  onMasterVolumeChange: (volume: number) => void;
  onMessage: (message: string) => void;
}) {
  const shouldReduceMotion = useReducedMotion();
  const pressMotion = getSubtlePressMotion(Boolean(shouldReduceMotion));
  const [isOpen, setIsOpen] = useState(false);
  const [isSettingsOpen, setSettingsOpen] = useState(false);
  const [settingsPreviewItemKey, setSettingsPreviewItemKey] =
    useState<keyof PipTimerVisibleItems>(DEFAULT_PIP_SETTINGS_PREVIEW_ITEM_KEY);
  const [alertStylePreviewUntil, setAlertStylePreviewUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const pipWindowRef = useRef<DocumentPipWindow | null>(null);
  const pipRootRef = useRef<Root | null>(null);

  const huntingDisplay = useMemo(
    () =>
      getPipTimerDisplay({
        skills,
        states,
        runeConfig,
        runeState,
        generalTimers,
        huntStallConfig,
        huntStallState,
        buffExpiryConfig,
        buffExpiryState,
        visibleItems: config.visibleItems,
        now,
      }),
    [
      generalTimers,
      huntStallConfig,
      huntStallState,
      buffExpiryConfig,
      buffExpiryState,
      config.visibleItems,
      now,
      runeConfig,
      runeState,
      skills,
      states,
    ],
  );
  const specialCoreDisplay = useMemo(
    () =>
      getSpecialCorePipTimerDisplay({
        specialCoreConfig,
        specialCoreState,
        now,
      }),
    [now, specialCoreConfig, specialCoreState],
  );
  const display = config.mode === "specialCore" ? specialCoreDisplay : huntingDisplay;
  const settingsPreviewDisplay = useMemo(
    () => createPipTimerSettingsPreviewDisplay(config, settingsPreviewItemKey),
    [config, settingsPreviewItemKey],
  );
  const activeDisplay = getPipTimerActiveDisplay({
    isSettingsOpen,
    runtimeDisplay: display,
    settingsPreviewDisplay,
  });
  const isAlertStylePreviewActive = isOpen && now < alertStylePreviewUntil;

  const cleanupPipWindow = useCallback((closeWindow = true) => {
    const pipWindow = pipWindowRef.current;
    const pipRoot = pipRootRef.current;

    pipRootRef.current = null;
    pipWindowRef.current = null;

    const cleanupPlan = getPipTimerWindowCleanupPlan({
      closeWindow,
      hasPipRoot: Boolean(pipRoot),
      hasPipWindow: Boolean(pipWindow),
      isPipWindowClosed: pipWindow ? documentPip.isWindowClosed(pipWindow) : false,
    });

    if (cleanupPlan.shouldUnmountRoot && pipRoot) {
      window.setTimeout(() => {
        try {
          pipRoot.unmount();
        } catch {
          // The PiP document may already be gone if the user closed the native window.
        }
      }, 0);
    }

    if (cleanupPlan.shouldCloseWindow && pipWindow) {
      documentPip.closeWindow(pipWindow);
    }

    setIsOpen(false);
  }, [documentPip]);

  const renderPipWindow = useCallback(
    (nextDisplay: PipTimerDisplay) => {
      const pipRoot = pipRootRef.current;
      if (!pipRoot) {
        return;
      }

      pipRoot.render(
        <PipTimerWindow
          config={config}
          display={nextDisplay}
          isAlertStylePreview={isAlertStylePreviewActive}
          isSettingsPreview={isSettingsOpen}
          screenPreviewStream={screenPreviewStream}
          screenPreviewSize={screenPreviewSize}
          isAllAlertsDisabled={isAllAlertsDisabled}
          canToggleAllAlerts={isAllAlertsDisabled || hasActiveAlerts}
          masterVolume={masterVolume}
          onToggleAllAlertsDisabled={onToggleAllAlertsDisabled}
          onMasterVolumeChange={onMasterVolumeChange}
          onClose={() => cleanupPipWindow()}
        />,
      );
    },
    [
      cleanupPipWindow,
      config,
      hasActiveAlerts,
      isAllAlertsDisabled,
      isAlertStylePreviewActive,
      isSettingsOpen,
      masterVolume,
      onMasterVolumeChange,
      onToggleAllAlertsDisabled,
      screenPreviewStream,
      screenPreviewSize,
    ],
  );

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const interval = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(interval);
  }, [isOpen]);

  useEffect(() => {
    renderPipWindow(activeDisplay);
  }, [activeDisplay, renderPipWindow]);

  useEffect(() => {
    if (!isOpen || now >= alertStylePreviewUntil) {
      return;
    }

    const timeoutId = window.setTimeout(
      () => setNow(Date.now()),
      Math.max(0, alertStylePreviewUntil - now),
    );
    return () => window.clearTimeout(timeoutId);
  }, [alertStylePreviewUntil, isOpen, now]);

  useEffect(() => () => cleanupPipWindow(), [cleanupPipWindow]);

  const resizePipWindow = useCallback((size: PipTimerConfig["size"]) => {
    const pipWindow = pipWindowRef.current;
    if (!pipWindow || documentPip.isWindowClosed(pipWindow)) {
      return;
    }

    const nextSize = getPipTimerWindowSize(size);
    documentPip.tryResizeWindow(pipWindow, nextSize);
  }, [documentPip]);

  const previewAlertStyle = useCallback(() => {
    const nextNow = Date.now();
    setAlertStylePreviewUntil(getPipTimerAlertStylePreviewUntil(nextNow));
    setNow(nextNow);
  }, []);

  const handleConfigChange = useCallback(
    (patch: Partial<PipTimerConfig>) => {
      trackPipTimerPatch(config, patch);
      if (patch.mode && patch.mode !== config.mode) {
        setAlertStylePreviewUntil(0);
        setSettingsPreviewItemKey(DEFAULT_PIP_SETTINGS_PREVIEW_ITEM_KEY);
      }
      onConfigChange(patch);
      const effects = getPipTimerConfigChangeEffects(patch);
      if (effects.resizeSize) {
        resizePipWindow(effects.resizeSize);
      }
      if (effects.shouldPreviewAlertStyle) {
        previewAlertStyle();
      }
    },
    [config, onConfigChange, previewAlertStyle, resizePipWindow],
  );

  const handleItemAlertColorChange = useCallback(
    (itemKey: keyof PipTimerItemAlertColors, color: PipTimerAlertColor) => {
      setSettingsPreviewItemKey(itemKey);
      handleConfigChange({
        itemAlertColors: getPipTimerItemAlertColorsAfterChange({
          itemAlertColors: config.itemAlertColors,
          itemKey,
          color,
        }),
      });
    },
    [config.itemAlertColors, handleConfigChange],
  );

  const openPipTimer = useCallback(async () => {
    if (!documentPip.isSupported()) {
      trackPipTimerToggle("unsupported");
      onMessage(
        `이 브라우저는 PIP 타이머를 지원하지 않습니다. ${RECOMMENDED_BROWSER_LABEL} 최신 버전에서 사용할 수 있습니다.`,
      );
      return;
    }

    try {
      const pipWindow = await documentPip.requestWindow(
        getPipTimerWindowSize(config.size),
      );
      const host = documentPip.createMountHost(pipWindow, "maple-timer-pip-root");
      injectPipStyles(pipWindow);

      pipWindowRef.current = pipWindow;
      pipRootRef.current = createRoot(host);
      documentPip.onPageHide(pipWindow, () => cleanupPipWindow(false));
      setNow(Date.now());
      setIsOpen(true);
      renderPipWindow(activeDisplay);
      trackPipTimerToggle("open");
      return true;
    } catch (error) {
      trackPipTimerToggle("failed");
      onMessage(
        error instanceof Error
          ? `PIP 타이머를 열지 못했습니다. ${error.message}`
          : "PIP 타이머를 열지 못했습니다.",
      );
      cleanupPipWindow(false);
      return false;
    }
  }, [
    activeDisplay,
    cleanupPipWindow,
    config.size,
    documentPip,
    onMessage,
    renderPipWindow,
  ]);

  const togglePipTimer = useCallback(async () => {
    if (
      pipWindowRef.current &&
      !documentPip.isWindowClosed(pipWindowRef.current)
    ) {
      cleanupPipWindow();
      trackPipTimerToggle("close");
      return;
    }

    await openPipTimer();
  }, [cleanupPipWindow, documentPip, openPipTimer]);

  const handleOpenPreview = useCallback(async () => {
    if (
      !pipWindowRef.current ||
      documentPip.isWindowClosed(pipWindowRef.current)
    ) {
      const didOpen = await openPipTimer();
      if (!didOpen) {
        return;
      }
    }
    trackPipTimerConfigChanged("preview");
    previewAlertStyle();
  }, [documentPip, openPipTimer, previewAlertStyle]);
  const handleStartPipTimer = useCallback(async () => {
    if (
      pipWindowRef.current &&
      !documentPip.isWindowClosed(pipWindowRef.current)
    ) {
      return true;
    }
    return Boolean(await openPipTimer());
  }, [documentPip, openPipTimer]);

  const openPipSettings = useCallback(() => {
    if (!isSettingsOpen) {
      trackPipTimerSettingsOpen();
    }
    setSettingsOpen(true);
  }, [isSettingsOpen]);

  useEffect(() => {
    if (!isSettingsOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSettingsOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isSettingsOpen]);

  return (
    <div
      className={`pip-timer-control${isOpen ? " is-open" : ""}${
        isSettingsOpen ? " is-settings-open" : ""
      }`}
    >
      <motion.button
        className={`secondary-button pip-timer-button${isOpen ? " active" : ""}`}
        type="button"
        aria-label="PIP 타이머"
        data-header-tooltip="남은 시간을 PIP 창으로 크게 표시합니다"
        onClick={() => void togglePipTimer()}
        {...pressMotion}
      >
        <PictureInPicture2 size={16} />
        PIP 타이머
      </motion.button>
      <span className="pip-timer-separator" aria-hidden="true">
        |
      </span>
      <motion.button
        className="secondary-button pip-timer-settings-button"
        type="button"
        aria-haspopup="dialog"
        aria-expanded={isSettingsOpen}
        aria-controls="pip-maker-title"
        aria-label="PIP 타이머 표시 설정"
        data-header-tooltip="PIP 크기와 알림 강조 설정"
        data-header-tooltip-align="end"
        onClick={openPipSettings}
        {...pressMotion}
      >
        <SlidersHorizontal size={15} />
      </motion.button>
      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {isSettingsOpen && (
              <PipTimerMakerDialog
                config={config}
                isPipOpen={isOpen}
                previewItemKey={settingsPreviewItemKey}
                onChange={handleConfigChange}
                onClose={() => setSettingsOpen(false)}
                onItemAlertColorChange={handleItemAlertColorChange}
                onOpenPreview={() => void handleOpenPreview()}
                onStartPipTimer={handleStartPipTimer}
              />
            )}
          </AnimatePresence>,
          document.body,
        )}
    </div>
  );
}

type PipTimerMakerDialogProps = {
  config: PipTimerConfig;
  isPipOpen: boolean;
  previewItemKey: keyof PipTimerVisibleItems;
  onChange: (patch: Partial<PipTimerConfig>) => void;
  onClose: () => void;
  onItemAlertColorChange: (
    itemKey: keyof PipTimerItemAlertColors,
    color: PipTimerAlertColor,
  ) => void;
  onOpenPreview: () => void;
  onStartPipTimer: () => Promise<boolean>;
};

const PipTimerMakerDialog = forwardRef<HTMLDivElement, PipTimerMakerDialogProps>(function PipTimerMakerDialog(
  {
    config,
    isPipOpen,
    previewItemKey,
    onChange,
    onClose,
    onItemAlertColorChange,
    onOpenPreview,
    onStartPipTimer,
  },
  ref,
) {
  const shouldReduceMotion = useReducedMotion();
  const [step, setStep] = useState<PipMakerStep>("mode");
  const [stepHeight, setStepHeight] = useState<number | null>(null);
  const stepObserverRef = useRef<ResizeObserver | null>(null);
  const alertTheme = getPipTimerAlertColorTheme(
    config.mode === "specialCore"
      ? config.alertColor
      : config.itemAlertColors[previewItemKey] ?? config.alertColor,
  );
  const stopMouseDown = (event: MouseEvent<HTMLElement>) => event.stopPropagation();
  const stepView = getPipMakerStepView(step, config.mode);
  const isModeStep = stepView.isModeStep;
  const isContentStep = stepView.isContentStep;
  const isSpecialCoreAppearanceStep = stepView.isSpecialCoreAppearanceStep;
  const isFinalStep = step === "appearance" || step === "specialCoreAppearance";
  const stepMotionView = getPipMakerStepMotionView({
    step,
    shouldReduceMotion: Boolean(shouldReduceMotion),
  });
  const stepViewportHeight = getPipMakerStepViewportHeight(stepHeight);
  const goToStep = useCallback((nextStep: PipMakerStep) => {
    trackPipTimerConfigChanged("maker_step", { value: nextStep });
    setStep(nextStep);
  }, []);
  const goToNextStep = useCallback(() => {
    if (step === "mode") {
      goToStep(config.mode === "specialCore" ? "specialCoreAppearance" : "content");
      return;
    }
    if (step === "content") {
      goToStep("appearance");
    }
  }, [config.mode, goToStep, step]);
  const goToPreviousStep = useCallback(() => {
    if (step === "appearance") {
      goToStep("content");
      return;
    }
    goToStep("mode");
  }, [goToStep, step]);
  const startPipTimerAndClose = useCallback(async () => {
    const didStart = await onStartPipTimer();
    if (didStart) {
      onClose();
    }
  }, [onClose, onStartPipTimer]);
  useEffect(() => {
    if (config.mode === "specialCore" && (step === "content" || step === "appearance")) {
      setStep("mode");
      return;
    }
    if (config.mode === "hunting" && step === "specialCoreAppearance") {
      setStep("mode");
    }
  }, [config.mode, step]);
  const setStepMotionNode = useCallback((node: HTMLDivElement | null) => {
    stepObserverRef.current?.disconnect();
    stepObserverRef.current = null;

    if (!node) {
      return;
    }

    const updateHeight = () => {
      setStepHeight(node.getBoundingClientRect().height);
    };

    updateHeight();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(updateHeight);
    observer.observe(node);
    stepObserverRef.current = observer;
  }, []);

  useEffect(() => {
    return () => {
      stepObserverRef.current?.disconnect();
    };
  }, []);

  return (
    <MotionDialogFrame
      ref={ref}
      backdropClassName="pip-maker-backdrop"
      dialogClassName="pip-maker-dialog"
      dialogLayout="size"
      labelledBy="pip-maker-title"
      describedBy="pip-maker-description"
      onBackdropMouseDown={onClose}
      onDialogMouseDown={stopMouseDown}
    >
      <header className="pip-maker-header">
        <div>
          <p className="eyebrow">PIP Maker</p>
          <h2 id="pip-maker-title">PIP 창 메이커</h2>
          <p id="pip-maker-description">
            사냥용 타이머와 보스용 특수코어 타이머를 선택해 조정합니다.
          </p>
        </div>
        <button
          className="icon-button small pip-maker-close-button"
          type="button"
          aria-label="닫기"
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </header>
      <div className="pip-maker-layout">
        <aside className="pip-maker-preview-pane" aria-label="PIP 미리보기">
          <PipTimerSettingsPreview config={config} theme={alertTheme} />
          <div className="pip-maker-preview-meta">
            <p className="pip-maker-preview-note">
              설정을 바꾸면 열린 PIP 창에도 샘플 알림이 바로 표시됩니다.
            </p>
            <nav className="pip-maker-step-tabs" aria-label="PIP 창 메이커 단계">
              <button
                type="button"
                className={isModeStep ? "active" : ""}
                aria-current={isModeStep ? "step" : undefined}
                onClick={() => goToStep("mode")}
              >
                <span>1</span>
                사용 모드
              </button>
              {config.mode === "hunting" ? (
                <>
                  <button
                    type="button"
                    className={isContentStep ? "active" : ""}
                    aria-current={isContentStep ? "step" : undefined}
                    onClick={() => goToStep("content")}
                  >
                    <span>2</span>
                    표시 항목
                  </button>
                  <button
                    type="button"
                    className={step === "appearance" ? "active" : ""}
                    aria-current={step === "appearance" ? "step" : undefined}
                    onClick={() => goToStep("appearance")}
                  >
                    <span>3</span>
                    화면 모양
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className={isSpecialCoreAppearanceStep ? "active" : ""}
                  aria-current={isSpecialCoreAppearanceStep ? "step" : undefined}
                  onClick={() => goToStep("specialCoreAppearance")}
                >
                  <span>2</span>
                  화면 모양
                </button>
              )}
            </nav>
          </div>
        </aside>
        <motion.div
          className="pip-maker-step-viewport"
          animate={
            shouldReduceMotion || stepViewportHeight === undefined
              ? undefined
              : { height: stepViewportHeight }
          }
          transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
        >
          <AnimatePresence mode="wait" initial={false}>
            {isModeStep ? (
              <motion.div
                key={stepMotionView.key}
                initial={stepMotionView.initial}
                animate={{ opacity: 1, x: 0 }}
                exit={stepMotionView.exit}
                transition={stepMotionView.transition}
              >
                <div ref={setStepMotionNode} className={stepMotionView.className}>
                  <PipTimerModeGroup
                    value={config.mode}
                    onSelect={(mode) => onChange({ mode })}
                  />
                </div>
              </motion.div>
            ) : isContentStep ? (
              <motion.div
                key={stepMotionView.key}
                initial={stepMotionView.initial}
                animate={{ opacity: 1, x: 0 }}
                exit={stepMotionView.exit}
                transition={stepMotionView.transition}
              >
                <div ref={setStepMotionNode} className={stepMotionView.className}>
                  <PipTimerVisibleItemsGroup
                    value={config.visibleItems}
                    onChange={(visibleItems) => onChange({ visibleItems })}
                  />
                  <PipTimerItemAlertColorsGroup
                    value={config.itemAlertColors}
                    onChange={onItemAlertColorChange}
                  />
                  <PipTimerScreenPreviewGroup
                    value={Boolean(config.showScreenPreview)}
                    onChange={(showScreenPreview) => onChange({ showScreenPreview })}
                  />
                </div>
              </motion.div>
            ) : (
              <motion.div
                key={stepMotionView.key}
                initial={stepMotionView.initial}
                animate={{ opacity: 1, x: 0 }}
                exit={stepMotionView.exit}
                transition={stepMotionView.transition}
              >
                <div ref={setStepMotionNode} className={stepMotionView.className}>
                  {isSpecialCoreAppearanceStep && (
                    <PipTimerSettingGroup
                      title="색감"
                      options={PIP_TIMER_ALERT_COLOR_OPTIONS}
                      value={config.alertColor}
                      onSelect={(alertColor) => onChange({ alertColor })}
                      renderPrefix={(color) => <PipTimerColorSwatch color={color} />}
                    />
                  )}
                  <PipTimerSettingGroup
                    title="크기"
                    options={PIP_TIMER_SIZE_OPTIONS}
                    value={config.size}
                    onSelect={(size) => onChange({ size })}
                  />
                  <PipTimerSettingGroup
                    title="강조"
                    options={PIP_TIMER_EMPHASIS_OPTIONS}
                    value={config.emphasis}
                    onSelect={(emphasis) => onChange({ emphasis })}
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
        <footer className="pip-maker-actions">
          <span>{stepView.stepCounterLabel}</span>
          <div>
            {!isModeStep && (
              <button
                className="pip-maker-action-button"
                type="button"
                onClick={goToPreviousStep}
              >
                <ArrowLeft size={15} />
                이전
              </button>
            )}
            {!isFinalStep ? (
              <button
                className="pip-maker-action-button primary"
                type="button"
                onClick={goToNextStep}
              >
                다음
                <ArrowRight size={15} />
              </button>
            ) : (
              <>
                <button
                  className="pip-maker-action-button"
                  type="button"
                  onClick={onOpenPreview}
                >
                  <PictureInPicture2 size={15} />
                  {getPipMakerPreviewButtonLabel(isPipOpen)}
                </button>
                <button
                  className="pip-maker-action-button primary"
                  type="button"
                  onClick={() => void startPipTimerAndClose()}
                >
                  <Play size={15} />
                  PIP 시작
                </button>
              </>
            )}
          </div>
        </footer>
      </div>
    </MotionDialogFrame>
  );
});

function PipTimerSettingsPreview({
  config,
  theme,
}: {
  config: PipTimerConfig;
  theme: PipTimerAlertColorTheme;
}) {
  const isSpecialCoreMode = config.mode === "specialCore";
  return (
    <motion.div
      className={`pip-timer-inline-preview size-${config.size} emphasis-${config.emphasis}`}
      style={
        {
          "--pip-alert-color": theme.accent,
          "--pip-alert-rgb": theme.accentRgb,
          "--pip-alert-surface": theme.surface,
          "--pip-alert-surface-strong": theme.surfaceStrong,
          "--pip-alert-text": theme.text,
        } as CSSProperties
      }
      layout
    >
      <span className="pip-timer-inline-preview-label">
        {isSpecialCoreMode ? "특수코어 쿨타임" : "알림 미리보기"}
      </span>
      <div className="pip-timer-inline-preview-time">
        <strong>{isSpecialCoreMode ? "18" : "8"}</strong>
        <span>초</span>
      </div>
      <span className="pip-timer-inline-preview-status">
        {isSpecialCoreMode ? "곧 사용 가능" : "곧 알림"}
      </span>
    </motion.div>
  );
}

function PipTimerModeGroup({
  value,
  onSelect,
}: {
  value: PipTimerMode;
  onSelect: (value: PipTimerMode) => void;
}) {
  return (
    <section className="pip-timer-setting-section wide" aria-label="사용 모드">
      <p className="pip-timer-setting-title">사용 모드</p>
      <div className="pip-timer-setting-options">
        {PIP_TIMER_MODE_OPTIONS.map((option) => (
          <button
            className={`pip-timer-setting-option${option.value === value ? " selected" : ""}`}
            type="button"
            role="radio"
            aria-checked={option.value === value}
            key={option.value}
            onClick={() => onSelect(option.value)}
          >
            <span>
              <strong>{option.label}</strong>
              <small>{option.description}</small>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function PipTimerSettingGroup<T extends string>({
  title,
  options,
  value,
  onSelect,
  renderPrefix,
}: {
  title: string;
  options: Array<{ value: T; label: string; description: string }>;
  value: T;
  onSelect: (value: T) => void;
  renderPrefix?: (value: T) => ReactNode;
}) {
  return (
    <section className="pip-timer-setting-section" aria-label={title}>
      <p className="pip-timer-setting-title">{title}</p>
      <div className="pip-timer-setting-options">
        {options.map((option) => (
          <button
            className={`pip-timer-setting-option${
              option.value === value ? " selected" : ""
            }`}
            type="button"
            role="radio"
            aria-checked={option.value === value}
            key={option.value}
            onClick={() => onSelect(option.value)}
          >
            {renderPrefix?.(option.value)}
            <span>
              <strong>{option.label}</strong>
              <small>{option.description}</small>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function PipTimerColorSwatch({ color }: { color: PipTimerAlertColor }) {
  const theme = getPipTimerAlertColorTheme(color);
  return (
    <span
      className="pip-timer-color-swatch"
      aria-hidden="true"
      style={{ "--pip-timer-swatch-color": theme.accent } as CSSProperties}
    />
  );
}

function PipTimerItemAlertColorsGroup({
  value,
  onChange,
}: {
  value: PipTimerItemAlertColors;
  onChange: (itemKey: keyof PipTimerItemAlertColors, color: PipTimerAlertColor) => void;
}) {
  return (
    <section className="pip-timer-setting-section" aria-label="항목별 색상">
      <p className="pip-timer-setting-title">항목별 색상</p>
      <div className="pip-timer-item-color-list">
        {PIP_TIMER_VISIBLE_ITEM_OPTIONS.map((itemOption) => (
          <div className="pip-timer-item-color-row" key={itemOption.value}>
            <div>
              <strong>{itemOption.label}</strong>
              <small>{itemOption.description}</small>
            </div>
            <div className="pip-timer-item-color-options">
              {PIP_TIMER_ALERT_COLOR_OPTIONS.map((colorOption) => {
                const isSelected = value[itemOption.value] === colorOption.value;
                return (
                  <button
                    className={`pip-timer-color-choice${isSelected ? " selected" : ""}`}
                    type="button"
                    aria-label={`${itemOption.label} 강조 색 ${colorOption.label}`}
                    aria-pressed={isSelected}
                    key={colorOption.value}
                    onClick={() => onChange(itemOption.value, colorOption.value)}
                  >
                    <PipTimerColorSwatch color={colorOption.value} />
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function PipTimerVisibleItemsGroup({
  value,
  onChange,
}: {
  value: PipTimerVisibleItems;
  onChange: (value: PipTimerVisibleItems) => void;
}) {
  return (
    <section className="pip-timer-setting-section" aria-label="표시 항목">
      <p className="pip-timer-setting-title">표시 항목</p>
      <div className="pip-timer-setting-options">
        {PIP_TIMER_VISIBLE_ITEM_OPTIONS.map((option) => {
          const isSelected = value[option.value];
          return (
            <button
              className={`pip-timer-setting-option${isSelected ? " selected" : ""}`}
              type="button"
              role="checkbox"
              aria-checked={isSelected}
              key={option.value}
              onClick={() => onChange({ ...value, [option.value]: !isSelected })}
            >
              <span>
                <strong>{option.label}</strong>
                <small>{option.description}</small>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function PipTimerScreenPreviewGroup({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <section className="pip-timer-setting-section wide" aria-label="공유 화면">
      <p className="pip-timer-setting-title">공유 화면</p>
      <div className="pip-timer-setting-options">
        <div
          className={`pip-timer-setting-option pip-timer-switch-option${value ? " selected" : ""}`}
          data-astryx-theme="neutral"
        >
          <Switch
            className="pip-timer-setting-switch"
            label="공유 화면 함께 보기"
            description="현재 공유 중인 화면을 PiP 창 배경에 함께 표시합니다."
            labelPosition="start"
            labelSpacing="spread"
            value={value}
            width="100%"
            onChange={(checked) => onChange(checked)}
          />
        </div>
      </div>
    </section>
  );
}

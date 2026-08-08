import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence } from "motion/react";
import type { SkillReportTimeline } from "./alertTypes";
import { AppFooter } from "./features/app-shell/AppFooter";
import { AppHeader } from "./features/app-shell/AppHeader";
import { AppToaster } from "./features/app-shell/AppToast";
import { OperationalNoticePanel } from "./features/app-shell/OperationalNoticePanel";
import { RuntimeAssetNoticePanel } from "./features/app-shell/RuntimeAssetNoticePanel";
import { SupporterThanksRail } from "./features/app-shell/SupporterThanksRail";
import { MonitoringWorkspace } from "./app/monitoring/MonitoringWorkspace";
import { browserProfileRepository } from "./app/profile/browserProfileRepository";
import { CaptureVideoHost } from "./features/capture/CaptureVideoHost";
import { ScreenShareHeaderControl } from "./features/capture/ScreenShareHeaderControl";
import { PatchNotesPanel } from "./features/app-shell/PatchNotesPanel";
import { CustomSoundsProvider } from "./features/custom-sounds/CustomSoundsContext";
import { useAlertDisableSnapshot } from "./features/alerts/shared/useAlertDisableSnapshot";
import { useAlertControlsController } from "./features/alerts/shared/useAlertControlsController";
import { useAlertPlaybackController } from "./features/alerts/shared/useAlertPlaybackController";
import { useAlertReports } from "./features/reports/useAlertReports";
import { useAppModalController } from "./features/app-shell/useAppModalController";
import { useBoosterExpiryRuntimeState } from "./features/alerts/runtime/useBoosterExpiryRuntimeState";
import { useBuffExpiryRuntimeState } from "./features/alerts/runtime/useBuffExpiryRuntimeState";
import { useCaptureActions } from "./features/capture/useCaptureActions";
import { useCaptureStream } from "./features/capture/useCaptureStream";
import { useGameViewportCalibrationController } from "./features/capture/useGameViewportCalibrationController";
import { useHuntStallRuntimeState } from "./features/alerts/runtime/useHuntStallRuntimeState";
import { useIssueReportController } from "./features/reports/useIssueReportController";
import { useMonitoringLoop } from "./features/alerts/runtime/useMonitoringLoop";
import { useRuntimeReportEvidenceCoordinator } from "./application/reporting/runtimeReportEvidenceCoordinator";
import { createAlertIncidentJournal } from "./application/reporting/alertIncidentJournal";
import { submitPrecisionParserDiagnosticReport } from "./application/reporting/precisionParserDiagnosticReporter";
import type { ResolvedGameViewport } from "./contracts/geometry/frameSource";
import { buildPrecisionParserRuntimeReport } from "./contracts/reporting/precisionParserRuntimeReport";
import type { ReportFrameSourceContext } from "./contracts/reporting/frameSourceDiagnostics";
import { useProfileState } from "./features/profile/useProfileState";
import { useRuneRuntimeState } from "./features/alerts/runtime/useRuneRuntimeState";
import { useUltimaRaidEquipmentRuntimeState } from "./features/alerts/runtime/useUltimaRaidEquipmentRuntimeState";
import { useSpecialCoreAlertScheduler } from "./features/alerts/runtime/useSpecialCoreAlertScheduler";
import { useSpecialCoreRuntimeState } from "./features/alerts/runtime/useSpecialCoreRuntimeState";
import { useRegionPickerController } from "./features/region-picker/useRegionPickerController";
import { useSettingsPresetController } from "./features/settings/useSettingsPresetController";
import { useSkillRuntimeState } from "./features/alerts/skill/useSkillRuntimeState";
import { useThemePreference } from "./features/app-shell/useThemePreference";
import { useToastMessage } from "./features/app-shell/useToastMessage";
import { RemoteRecognitionControl } from "./features/remote-recognition/RemoteRecognitionControl";
import { useRemoteRecognitionSessionController } from "./app/remote-recognition/useRemoteRecognitionSessionController";
import {
  DEFAULT_PRECISION_PARSER_INPUT_TRANSPORT,
  PRECISION_PARSER_INPUT_TRANSPORT_VP8_PREVIEW,
  type PrecisionParserInputTransport,
} from "./contracts/recognition/precisionParserInputTransport";
import { useCustomSoundLibrary } from "./features/custom-sounds/useCustomSoundLibrary";
import { createCustomAlertSoundId } from "./lib/customSoundIds";
import type { BuffExpiryPrecisionPreloadStatus } from "./platform/runtime-workers/buff-expiry/buffExpiryPrecisionWorkerClient";
import { replaceCustomAlertSoundReferences } from "./lib/customSoundReferences";
import { migrateProfileRegionsToGameViewport } from "./lib/gameViewportRegionMigration";
import { getGameViewportStateRevision } from "./lib/gameViewport";
import { captureSizeToLayoutKey } from "./lib/regions";
import { trackThemeChanged } from "./lib/analyticsEvents";
import { getMemoryDiagnosticsMode } from "./lib/memoryDiagnostics";
import {
  createDefaultGeneralTimer,
  createDefaultBuffExpiryAlert,
  createDefaultBoosterExpiryAlert,
  createDefaultHuntStallAlert,
  createDefaultPipTimerConfig,
  createDefaultRuneAlert,
  createDefaultSpecialCoreAlert,
  createDefaultUltimaRaidEquipmentAlert,
} from "./lib/storage";

const AppModalHost = lazy(() =>
  import("./app/modals/AppModalHost").then((module) => ({ default: module.AppModalHost })),
);
const CustomSoundManagerDialog = lazy(() =>
  import("./features/custom-sounds/CustomSoundManagerDialog").then((module) => ({
    default: module.CustomSoundManagerDialog,
  })),
);
const OperationalStatusPage = lazy(() =>
  import("./features/app-shell/OperationalStatusPage").then((module) => ({
    default: module.OperationalStatusPage,
  })),
);
const PrivacyNoticePage = lazy(() =>
  import("./features/app-shell/PrivacyNotice").then((module) => ({
    default: module.PrivacyNoticePage,
  })),
);
const SettingsManagerDialog = lazy(() =>
  import("./features/settings/SettingsManagerDialog").then((module) => ({
    default: module.SettingsManagerDialog,
  })),
);
const SettingsWorkflowDialogs = lazy(() =>
  import("./features/settings/SettingsWorkflowDialogs").then((module) => ({
    default: module.SettingsWorkflowDialogs,
  })),
);
const UsageGuidePage = lazy(() =>
  import("./features/app-shell/UsageGuide").then((module) => ({
    default: module.UsageGuidePage,
  })),
);
const MemoryDiagnosticsPanel = lazy(() =>
  import("./features/diagnostics/MemoryDiagnosticsPanel").then((module) => ({
    default: module.MemoryDiagnosticsPanel,
  })),
);

function App() {
  const memoryDiagnosticsMode = getMemoryDiagnosticsMode(__APP_BUILD_INFO__);

  if (typeof window !== "undefined" && window.location.pathname === "/privacy") {
    return (
      <Suspense fallback={null}>
        <PrivacyNoticePage />
      </Suspense>
    );
  }
  if (typeof window !== "undefined" && window.location.pathname === "/guide") {
    return (
      <Suspense fallback={null}>
        <UsageGuidePage />
      </Suspense>
    );
  }
  if (typeof window !== "undefined" && window.location.pathname === "/status") {
    return (
      <Suspense fallback={null}>
        <OperationalStatusPage />
      </Suspense>
    );
  }

  const {
    profile,
    setProfile,
    profileRef,
    updateProfile,
    updateSkill,
    updateRuneAlert,
    updateUltimaRaidEquipmentAlert,
    updateHuntStallAlert,
    updateBuffExpiryAlert,
    updateBoosterExpiryAlert,
    updateSpecialCoreAlert,
    updatePipTimer,
    addGeneralTimer,
    updateGeneralTimer,
    removeGeneralTimer,
  } = useProfileState(browserProfileRepository);
  const [buffExpiryPrecisionPreloadStatus, setBuffExpiryPrecisionPreloadStatus] =
    useState<BuffExpiryPrecisionPreloadStatus>("idle");
  const {
    isFeedbackOpen,
    isResponsibilityNoticeOpen,
    isOnboardingOpen,
    isUsageGuideOpen,
    isPrivacyOpen,
    isDonationOpen,
    isDiscordLaunchCampaignOpen,
    openFeedback,
    closeFeedback,
    openUsageGuide,
    closeUsageGuide,
    openPrivacy,
    closePrivacy,
    openDonation,
    closeDonation,
    recordDiscordLaunchCampaignVisible,
    dismissDiscordLaunchCampaign,
    openDiscordFromLaunchCampaign,
    confirmResponsibilityNotice,
    dismissResponsibilityNotice,
    closeOnboarding,
    openGuideFromOnboarding,
    dismissOnboarding,
  } = useAppModalController();
  const {
    alertDisableSnapshot,
    alertDisableSnapshotRef,
    activateAlertDisableSnapshot,
    clearAlertDisableSnapshotState,
  } = useAlertDisableSnapshot();
  const {
    selectedSkillId,
    setSelectedSkillId,
    selectedSkill,
    expandedSkillIds,
    runtimeStates,
    setRuntimeStates,
    runtimeRef,
    skillIncidentRecorderRef,
    snapshots,
    setSnapshots,
    addSkill,
    removeSkill,
    selectRegionPickerSkill,
    toggleExpandedSkill,
    resetSkillRuntime,
  } = useSkillRuntimeState({
    profile,
    profileRef,
    alertDisableSnapshotRef,
    updateProfile,
  });
  const {
    runeRuntime,
    setRuneRuntime,
    runeRuntimeRef,
    runeSnapshot,
    setRuneSnapshot,
    runeSnapshotRef,
    resetRuneDetection,
  } = useRuneRuntimeState();
  const {
    ultimaRaidEquipmentRuntime,
    setUltimaRaidEquipmentRuntime,
    ultimaRaidEquipmentRuntimeRef,
    ultimaRaidEquipmentSnapshot,
    setUltimaRaidEquipmentSnapshot,
    ultimaRaidEquipmentSnapshotRef,
    ultimaRaidEquipmentIncidentArchiveRef,
    resetUltimaRaidEquipmentDetection,
  } = useUltimaRaidEquipmentRuntimeState();
  const {
    huntStallRuntime,
    setHuntStallRuntime,
    huntStallRuntimeRef,
    huntStallSnapshot,
    setHuntStallSnapshot,
    huntStallSnapshotRef,
    huntStallIncidentRecorderRef,
    resetHuntStallDetection,
  } = useHuntStallRuntimeState();
  const {
    buffExpiryRuntime,
    setBuffExpiryRuntime,
    buffExpiryRuntimeRef,
    buffExpirySnapshot,
    setBuffExpirySnapshot,
    buffExpirySnapshotRef,
    buffExpiryIncidentRecorderRef,
    resetBuffExpiryDetection,
  } = useBuffExpiryRuntimeState();
  const {
    boosterExpiryRuntime,
    setBoosterExpiryRuntime,
    boosterExpiryRuntimeRef,
    boosterExpirySnapshot,
    setBoosterExpirySnapshot,
    boosterExpirySnapshotRef,
    boosterExpiryIncidentRecorderRef,
    resetBoosterExpiryDetection,
  } = useBoosterExpiryRuntimeState();
  const {
    specialCoreRuntime,
    setSpecialCoreRuntime,
    specialCoreRuntimeRef,
    specialCoreSnapshot,
    setSpecialCoreSnapshot,
    specialCoreSnapshotRef,
    specialCoreIncidentRecorderRef,
    resetSpecialCoreDetection,
    retimeSpecialCoreDetection,
  } = useSpecialCoreRuntimeState();
  const { themePreference, setThemePreference } = useThemePreference();
  const { setMessage } = useToastMessage();
  const [isCustomSoundManagerOpen, setCustomSoundManagerOpen] = useState(false);
  const [isRemoteRecognitionSetupOpen, setRemoteRecognitionSetupOpen] =
    useState(false);
  const [precisionParserInputTransport, setPrecisionParserInputTransport] =
    useState<PrecisionParserInputTransport>(
      DEFAULT_PRECISION_PARSER_INPUT_TRANSPORT,
    );
  const [screenShareAttentionKey, setScreenShareAttentionKey] = useState(0);
  const { customSounds, refreshCustomSounds } = useCustomSoundLibrary({ onMessage: setMessage });
  const customAlertSoundIds = useMemo(
    () => customSounds.map((sound) => createCustomAlertSoundId(sound.id)),
    [customSounds],
  );
  const {
    lastAlertErrorRef,
    playGeneralTimerAlert,
    previewSound,
    previewMasterVolume,
  } = useAlertPlaybackController({
    profileRef,
    setMessage,
  });
  const skillReportTimelineRef = useRef<Record<string, SkillReportTimeline>>({});
  const runtimeReportEvidenceCoordinator = useRuntimeReportEvidenceCoordinator();
  const alertIncidentJournal = useMemo(createAlertIncidentJournal, []);
  const showDebugColumns =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("debug") === "1";

  const {
    videoRef,
    stream,
    captureStatus,
    captureSize,
    startCapture,
    changeCapture,
    handleMetadata,
  } = useCaptureStream({ onMessage: setMessage });
  const { startCaptureWithAnalytics, changeCaptureWithAnalytics } = useCaptureActions({
    captureStatus,
    captureSize,
    stream,
    startCapture,
    changeCapture,
  });
  const handleGameViewportCalibrationApplied = useCallback(
    (viewport: ResolvedGameViewport) => {
      updateProfile((current) =>
        migrateProfileRegionsToGameViewport({
          captureLayoutKey: captureSizeToLayoutKey(viewport.sourceSize),
          profile: current,
          viewport,
        }),
      );
    },
    [updateProfile],
  );
  const {
    state: gameViewportState,
    resolvedViewport: resolvedGameViewport,
    verificationStatus: gameViewportVerification,
    isSetupOpen: isGameViewportSetupOpen,
    openSetup: openGameViewportSetup,
    closeSetup: closeGameViewportSetup,
    applyCalibration: applyGameViewportCalibration,
    useLegacyPassthrough: useFullCaptureAsGameViewport,
  } = useGameViewportCalibrationController({
    captureSize,
    onCalibrationApplied: handleGameViewportCalibrationApplied,
    stream,
  });
  const remoteRecognitionSession = useRemoteRecognitionSessionController({
    gameViewport: resolvedGameViewport,
    stream,
  });
  useEffect(() => {
    if (
      (remoteRecognitionSession.snapshot.phase !== "ready" ||
        !remoteRecognitionSession.snapshot.parserProvider.active) &&
      precisionParserInputTransport !== DEFAULT_PRECISION_PARSER_INPUT_TRANSPORT
    ) {
      setPrecisionParserInputTransport(DEFAULT_PRECISION_PARSER_INPUT_TRANSPORT);
    }
  }, [
    precisionParserInputTransport,
    remoteRecognitionSession.snapshot.parserProvider.active,
    remoteRecognitionSession.snapshot.phase,
  ]);
  const handleRemoteParserConsentChange = useCallback(
    (consented: boolean) => {
      if (!consented) {
        setPrecisionParserInputTransport(
          DEFAULT_PRECISION_PARSER_INPUT_TRANSPORT,
        );
      }
      remoteRecognitionSession.setParserProviderConsent(consented);
    },
    [remoteRecognitionSession],
  );
  const handleVp8ParserPreviewChange = useCallback(
    (enabled: boolean) => {
      if (!enabled) {
        setPrecisionParserInputTransport(
          DEFAULT_PRECISION_PARSER_INPUT_TRANSPORT,
        );
        remoteRecognitionSession.setParserProviderEnabled(false);
        return;
      }
      remoteRecognitionSession.setParserProviderEnabled(true);
      setPrecisionParserInputTransport(
        PRECISION_PARSER_INPUT_TRANSPORT_VP8_PREVIEW,
      );
    },
    [remoteRecognitionSession],
  );
  const handleRemoteParserUnavailable = useCallback(
    (error: unknown, sampledAt: number) => {
      window.setTimeout(() => {
        setPrecisionParserInputTransport(
          DEFAULT_PRECISION_PARSER_INPUT_TRANSPORT,
        );
        void remoteRecognitionSession.failParserProvider(error, sampledAt);
        setMessage("원격 처리를 사용할 수 없어 로컬 처리로 돌아갔습니다.");
      }, 0);
    },
    [remoteRecognitionSession.failParserProvider, setMessage],
  );
  const requestScreenShareAttention = useCallback(() => {
    if (stream) {
      return;
    }

    setScreenShareAttentionKey((current) => current + 1);
  }, [stream]);

  const currentLayoutKey = useMemo(() => captureSizeToLayoutKey(captureSize), [captureSize]);
  const currentGameLayoutKey = resolvedGameViewport?.layoutKey ?? null;
  const gameViewportRevision = getGameViewportStateRevision(gameViewportState);
  const reportFrameSourceContext = useMemo<ReportFrameSourceContext>(
    () => ({
      captureLayoutKey: currentLayoutKey,
      gameLayoutKey: currentGameLayoutKey,
      gameViewport: resolvedGameViewport,
      gameViewportState,
      gameViewportVerification,
    }),
    [
      currentGameLayoutKey,
      currentLayoutKey,
      gameViewportVerification,
      gameViewportState,
      resolvedGameViewport,
    ],
  );
  const {
    isRuneDebugSubmitting,
    isRuneFalsePositiveSubmitting,
    isUltimaRaidEquipmentIssueSubmitting,
    isUltimaRaidBossIssueSubmitting,
    isHuntStallDebugSubmitting,
    isHuntStallIssueSubmitting,
    isBuffExpiryIssueSubmitting,
    isBoosterExpiryIssueSubmitting,
    isSpecialCoreIssueSubmitting,
    submittingSkillMisreadId,
    submitRuneDebugSample,
    submitRuneIssueReport,
    freezeRuneIssueReportEvidence,
    clearRuneIssueReportEvidence,
    submitUltimaRaidEquipmentIssueReport,
    submitUltimaRaidBossIssueReport,
    freezeUltimaRaidEquipmentIssueReportEvidence,
    freezeUltimaRaidBossIssueReportEvidence,
    clearUltimaRaidEquipmentIssueReportEvidence,
    freezeBuffExpiryIssueReportEvidence,
    clearBuffExpiryIssueReportEvidence,
    freezeSkillIssueReportEvidence,
    clearSkillIssueReportEvidence,
    freezeHuntStallIssueReportEvidence,
    clearHuntStallIssueReportEvidence,
    submitSkillIssueReport,
    submitHuntStallDebugSample,
    submitHuntStallIssueReport,
    submitBuffExpiryIssueReport,
    submitBoosterExpiryIssueReport,
    freezeBoosterExpiryIssueReportEvidence,
    clearBoosterExpiryIssueReportEvidence,
    submitSpecialCoreIssueReport,
    freezeSpecialCoreIssueReportEvidence,
    clearSpecialCoreIssueReportEvidence,
  } = useAlertReports({
    videoRef,
    profileRef,
    runtimeRef,
    skillIncidentRecorderRef,
    runeRuntimeRef,
    runeSnapshotRef,
    ultimaRaidEquipmentRuntimeRef,
    ultimaRaidEquipmentSnapshotRef,
    ultimaRaidEquipmentIncidentArchiveRef,
    huntStallRuntimeRef,
    huntStallIncidentRecorderRef,
    huntStallSnapshotRef,
    buffExpiryRuntimeRef,
    buffExpirySnapshotRef,
    buffExpiryIncidentRecorderRef,
    boosterExpiryRuntimeRef,
    boosterExpirySnapshotRef,
    boosterExpiryIncidentRecorderRef,
    specialCoreRuntimeRef,
    specialCoreSnapshotRef,
    specialCoreIncidentRecorderRef,
    skillReportTimelineRef,
    snapshots,
    reportFrameSourceContext,
    runtimeReportEvidenceCoordinator,
    onMessage: setMessage,
  });
  const {
    issueReportTarget,
    openSkillIssueReport,
    openRuneIssueReport,
    openUltimaRaidEquipmentIssueReport,
    openUltimaRaidBossIssueReport,
    openHuntStallIssueReport,
    openBuffExpiryIssueReport,
    openBoosterExpiryIssueReport,
    openSpecialCoreIssueReport,
    closeIssueReport,
    submitIssueReport,
  } = useIssueReportController({
    profileRef,
    submitRuneIssueReport,
    submitUltimaRaidEquipmentIssueReport,
    submitUltimaRaidBossIssueReport,
    submitSkillIssueReport,
    submitHuntStallIssueReport,
    submitBuffExpiryIssueReport,
    submitBoosterExpiryIssueReport,
    submitSpecialCoreIssueReport,
    freezeRuneIssueReportEvidence,
    clearRuneIssueReportEvidence,
    freezeUltimaRaidEquipmentIssueReportEvidence,
    freezeUltimaRaidBossIssueReportEvidence,
    clearUltimaRaidEquipmentIssueReportEvidence,
    freezeBuffExpiryIssueReportEvidence,
    clearBuffExpiryIssueReportEvidence,
    freezeSkillIssueReportEvidence,
    clearSkillIssueReportEvidence,
    freezeHuntStallIssueReportEvidence,
    clearHuntStallIssueReportEvidence,
    freezeBoosterExpiryIssueReportEvidence,
    clearBoosterExpiryIssueReportEvidence,
    freezeSpecialCoreIssueReportEvidence,
    clearSpecialCoreIssueReportEvidence,
    isGloballyDisabled: Boolean(alertDisableSnapshot),
    alertIncidentJournal,
    setMessage,
  });

  const runeAlert = profile.runeAlert ?? createDefaultRuneAlert();
  const ultimaRaidEquipmentAlert =
    profile.ultimaRaidEquipmentAlert ??
    createDefaultUltimaRaidEquipmentAlert();
  const huntStallAlert = profile.huntStallAlert ?? createDefaultHuntStallAlert();
  const buffExpiryAlert = profile.buffExpiryAlert ?? createDefaultBuffExpiryAlert();
  const boosterExpiryAlert =
    profile.boosterExpiryAlert ?? createDefaultBoosterExpiryAlert();
  const specialCoreAlert =
    profile.specialCoreAlert ?? createDefaultSpecialCoreAlert();
  const pipTimer = profile.pipTimer ?? createDefaultPipTimerConfig();
  const generalTimers =
    profile.generalTimers
      ? profile.generalTimers
      : [createDefaultGeneralTimer()];
  const hasActiveAlerts =
    profile.skills.some((skill) => skill.enabled) ||
    runeAlert.enabled ||
    ultimaRaidEquipmentAlert.enabled ||
    ultimaRaidEquipmentAlert.bossAlert.enabled ||
    huntStallAlert.enabled ||
    buffExpiryAlert.enabled ||
    boosterExpiryAlert.enabled ||
    specialCoreAlert.enabled ||
    generalTimers.some((timer) => timer.enabled);
  const changeSkillInitialJitterEnabled = useCallback(
    (enabled: boolean) => {
      updateProfile((current) => ({
        ...current,
        skillAlertInitialJitterEnabled: enabled,
      }));
    },
    [updateProfile],
  );

  const {
    updateMasterVolume,
    updateDefaultAlertVolume,
    changeSkill,
    changeRuneAlert,
    changeUltimaRaidEquipmentAlert,
    changeHuntStallAlert,
    changeBuffExpiryAlert,
    changeBoosterExpiryAlert,
    changeSpecialCoreAlert,
    changeGeneralTimer,
    setAllAlertsDisabled,
  } = useAlertControlsController({
    profileRef,
    alertDisableSnapshotRef,
    activateAlertDisableSnapshot,
    clearAlertDisableSnapshotState,
    updateProfile,
    updateSkill,
    updateRuneAlert,
    updateUltimaRaidEquipmentAlert,
    updateHuntStallAlert,
    updateBuffExpiryAlert,
    updateBoosterExpiryAlert,
    updateSpecialCoreAlert,
    updateGeneralTimer,
    runtimeRef,
    setRuntimeStates,
    setSnapshots,
    resetRuneDetection,
    resetUltimaRaidEquipmentDetection,
    resetHuntStallDetection,
    resetBuffExpiryDetection,
    resetBoosterExpiryDetection,
    resetSpecialCoreDetection,
    retimeSpecialCoreDetection,
    setMessage,
  });

  const {
    isSkillRegionPickerOpen,
    selectedSkillRegion,
    isRuneRegionPickerOpen,
    runeRegion,
    isUltimaRaidEquipmentRegionPickerOpen,
    ultimaRaidEquipmentRegion,
    isHuntStallRegionPickerOpen,
    huntStallRegion,
    openSkillRegionPicker,
    closeSkillRegionPicker,
    openRuneRegionPicker,
    closeRuneRegionPicker,
    openUltimaRaidEquipmentRegionPicker,
    closeUltimaRaidEquipmentRegionPicker,
    openHuntStallRegionPicker,
    closeHuntStallRegionPicker,
    closeRegionPickers,
    applySkillRegion,
    applyRuneRegion,
    applyUltimaRaidEquipmentRegion,
    applyHuntStallRegion,
    resumePendingGameViewportPicker,
    cancelPendingGameViewportPicker,
    requestGameViewportForHuntStallPicker,
  } = useRegionPickerController({
    isGameViewportReady: Boolean(resolvedGameViewport),
    onRequireGameViewport: openGameViewportSetup,
    selectedSkill,
    currentCaptureLayoutKey: currentLayoutKey,
    currentGameLayoutKey,
    runeAlert,
    ultimaRaidEquipmentAlert,
    huntStallAlert,
    selectSkillRegionTarget: selectRegionPickerSkill,
    changeSkill,
    updateRuneAlert,
    updateUltimaRaidEquipmentAlert,
    updateHuntStallAlert,
    resetRuneDetection,
    resetUltimaRaidEquipmentDetection,
    resetHuntStallDetection,
  });
  const handleOpenGameViewportSetup = useCallback(() => {
    cancelPendingGameViewportPicker();
    openGameViewportSetup();
  }, [cancelPendingGameViewportPicker, openGameViewportSetup]);
  const handleCloseGameViewportSetup = useCallback(() => {
    cancelPendingGameViewportPicker();
    closeGameViewportSetup();
  }, [cancelPendingGameViewportPicker, closeGameViewportSetup]);
  const handleApplyGameViewport = useCallback(
    (value: Parameters<typeof applyGameViewportCalibration>[0]) => {
      applyGameViewportCalibration(value);
      resumePendingGameViewportPicker();
    },
    [applyGameViewportCalibration, resumePendingGameViewportPicker],
  );
  const handleUseFullCaptureAsGameViewport = useCallback(() => {
    useFullCaptureAsGameViewport();
    resumePendingGameViewportPicker();
  }, [
    resumePendingGameViewportPicker,
    useFullCaptureAsGameViewport,
  ]);

  const {
    isSettingsManagerOpen,
    settingsManagerDialogProps,
    pendingSettingsPresetImport,
    pendingSettingsReplacementAction,
    isUnsavedSettingsSavePromptOpen,
    pendingSettingsApply,
    openSettingsManager,
    cancelSettingsPresetImport,
    confirmSettingsPresetImport,
    selectAllImportedSettingsPresets,
    clearImportedSettingsPresetSelection,
    toggleImportedSettingsPreset,
    cancelUnsavedSettingsReplacement,
    confirmUnsavedSettingsReplacement,
    openUnsavedSettingsSavePrompt,
    closeUnsavedSettingsSavePrompt,
    saveCurrentSettingsBeforeReplacement,
    cancelSettingsApply,
    confirmSettingsApply,
  } = useSettingsPresetController({
    profile,
    profileRef,
    setProfile,
    resetSkillRuntime,
    clearAlertDisableSnapshotState,
    resetRuneDetection,
    resetHuntStallDetection,
    resetBuffExpiryDetection,
    resetBoosterExpiryDetection,
    resetSpecialCoreDetection,
    closeRegionPickers,
    setMessage,
    lastAlertErrorRef,
    availableCustomSoundIds: customAlertSoundIds,
  });

  const openCustomSoundManager = useCallback(() => {
    setCustomSoundManagerOpen(true);
  }, []);

  const changeThemePreference = useCallback(
    (preference: typeof themePreference) => {
      trackThemeChanged(preference);
      setThemePreference(preference);
    },
    [setThemePreference],
  );

  const closeCustomSoundManager = useCallback(() => {
    setCustomSoundManagerOpen(false);
  }, []);

  const handleCustomSoundDeleted = useCallback(
    (customSoundId: string) => {
      let profileReplacedCount = 0;
      updateProfile((current) => {
        const result = replaceCustomAlertSoundReferences(current, customSoundId);
        profileReplacedCount = result.replacedCount;
        return result.profile;
      });
      return profileReplacedCount;
    },
    [updateProfile],
  );

  const {
    precisionParserReadiness,
    precisionParserRuntimeSelection,
    precisionParserCpuFallback,
    retryPrecisionParser,
    startPrecisionParserCpuFallback,
    cancelPrecisionParserCpuFallbackBenchmark,
    stopPrecisionParserCpuFallback,
    precisionParserInputTransportDiagnostics,
  } = useMonitoringLoop({
    stream,
    gameViewport: resolvedGameViewport,
    gameViewportRevision,
    videoRef,
    profileRef,
    runtimeRef,
    skillIncidentRecorderRef,
    runeRuntimeRef,
    runeSnapshotRef,
    ultimaRaidEquipmentRuntimeRef,
    ultimaRaidEquipmentSnapshotRef,
    ultimaRaidEquipmentIncidentArchiveRef,
    huntStallRuntimeRef,
    huntStallIncidentRecorderRef,
    buffExpiryRuntimeRef,
    buffExpirySnapshotRef,
    buffExpiryIncidentRecorderRef,
    boosterExpiryRuntimeRef,
    boosterExpiryIncidentRecorderRef,
    specialCoreRuntimeRef,
    specialCoreIncidentRecorderRef,
    skillReportTimelineRef,
    lastAlertErrorRef,
    showDebugColumns,
    handleMetadata,
    setRuntimeStates,
    setSnapshots,
    setRuneRuntime,
    setRuneSnapshot,
    setUltimaRaidEquipmentRuntime,
    setUltimaRaidEquipmentSnapshot,
    setHuntStallRuntime,
    setHuntStallSnapshot,
    setBuffExpiryRuntime,
    setBuffExpirySnapshot,
    setBuffExpiryPrecisionPreloadStatus,
    setBoosterExpiryRuntime,
    setBoosterExpirySnapshot,
    setSpecialCoreRuntime,
    setSpecialCoreSnapshot,
    onMessage: setMessage,
    onNoStream: closeRegionPickers,
    runtimeReportEvidenceCoordinator,
    alertIncidentJournal,
    precisionParserInputTransport,
    remoteParserProvider: remoteRecognitionSession.analyzeParserFrame,
    onRemoteParserUnavailable: handleRemoteParserUnavailable,
    onMonitoringFrame: remoteRecognitionSession.acceptMonitoringFrame,
  });

  const precisionParserRuntimeReport = useMemo(
    () =>
      buildPrecisionParserRuntimeReport(
        precisionParserRuntimeSelection,
        precisionParserCpuFallback,
        remoteRecognitionSession.isAvailable
          ? {
              phase: remoteRecognitionSession.snapshot.phase,
              active:
                remoteRecognitionSession.snapshot.parserProvider.active,
              consentVersion:
                remoteRecognitionSession.snapshot.parserProvider
                  .consentVersion,
              generation:
                remoteRecognitionSession.snapshot.parserProvider.generation,
              parserFrames: remoteRecognitionSession.snapshot.parserFrames,
              failure: remoteRecognitionSession.snapshot.failure,
            }
          : null,
      ),
    [
      precisionParserCpuFallback,
      precisionParserRuntimeSelection,
      remoteRecognitionSession.isAvailable,
      remoteRecognitionSession.snapshot,
    ],
  );

  useSpecialCoreAlertScheduler({
    stream,
    gameViewportRevision,
    config: specialCoreAlert,
    profileRef,
    specialCoreRuntime,
    specialCoreRuntimeRef,
    specialCoreIncidentRecorderRef,
    alertIncidentJournal,
    lastAlertErrorRef,
    setSpecialCoreRuntime,
    onMessage: setMessage,
  });

  const hasSettingsWorkflowDialog = Boolean(
    pendingSettingsPresetImport ||
      pendingSettingsReplacementAction ||
      isUnsavedSettingsSavePromptOpen ||
      pendingSettingsApply,
  );
  const hasExternalAppModalOpen = Boolean(
    isSettingsManagerOpen || hasSettingsWorkflowDialog || isCustomSoundManagerOpen,
  );
  const isAnyAppModalOpen = Boolean(
    isGameViewportSetupOpen ||
      isSkillRegionPickerOpen ||
      isRuneRegionPickerOpen ||
      isUltimaRaidEquipmentRegionPickerOpen ||
      isHuntStallRegionPickerOpen ||
      isFeedbackOpen ||
      isPrivacyOpen ||
      isDonationOpen ||
      isUsageGuideOpen ||
      isResponsibilityNoticeOpen ||
      isOnboardingOpen ||
      isDiscordLaunchCampaignOpen ||
      isRemoteRecognitionSetupOpen ||
      issueReportTarget,
  );

  return (
    <CustomSoundsProvider
      customSounds={customSounds}
      openCustomSoundManager={openCustomSoundManager}
    >
      <AppToaster themePreference={themePreference} />
      <main className="app-shell">
        <SupporterThanksRail
          themePreference={themePreference}
          onOpenDonation={openDonation}
          onThemePreferenceChange={changeThemePreference}
        />
        <AppHeader
          skills={profile.skills}
          states={runtimeStates}
          runeAlert={runeAlert}
          runeRuntime={runeRuntime}
          generalTimers={generalTimers}
          huntStallAlert={huntStallAlert}
          huntStallRuntime={huntStallRuntime}
          buffExpiryAlert={buffExpiryAlert}
          buffExpiryRuntime={buffExpiryRuntime}
          specialCoreAlert={specialCoreAlert}
          specialCoreRuntime={specialCoreRuntime}
          pipTimer={pipTimer}
          screenShareControl={
            <ScreenShareHeaderControl
              stream={stream}
              captureStatus={captureStatus}
              captureSize={captureSize}
              gameViewportState={gameViewportState}
              gameViewportVerification={gameViewportVerification}
              attentionKey={screenShareAttentionKey}
              onStartCapture={startCaptureWithAnalytics}
              onChangeCapture={changeCaptureWithAnalytics}
              onOpenGameViewportSetup={handleOpenGameViewportSetup}
              onUseFullCaptureAsGameViewport={
                handleUseFullCaptureAsGameViewport
              }
            />
          }
          screenPreviewStream={stream}
          screenPreviewSize={captureSize}
          isAllAlertsDisabled={Boolean(alertDisableSnapshot)}
          hasActiveAlerts={hasActiveAlerts}
          masterVolume={profile.masterVolume}
          onPipTimerChange={updatePipTimer}
          onToggleAllAlertsDisabled={setAllAlertsDisabled}
          onMasterVolumeChange={updateMasterVolume}
          onMessage={setMessage}
          onOpenGuide={openUsageGuide}
          onOpenFeedback={openFeedback}
          onOpenDonation={openDonation}
          onOpenCustomSounds={openCustomSoundManager}
          onOpenSettingsManager={openSettingsManager}
        />
        <RuntimeAssetNoticePanel />
        <OperationalNoticePanel />

        <MonitoringWorkspace
          isAllAlertsDisabled={Boolean(alertDisableSnapshot)}
          onToggleAllAlertsDisabled={setAllAlertsDisabled}
          masterVolume={profile.masterVolume}
          onMasterVolumeChange={updateMasterVolume}
          onPreviewMasterVolume={previewMasterVolume}
          onRequestScreenShareAttention={requestScreenShareAttention}
          onOpenGameViewportSetup={handleOpenGameViewportSetup}
          onUseFullCaptureAsGameViewport={
            handleUseFullCaptureAsGameViewport
          }
          gameViewportVerification={gameViewportVerification}
          precisionParserReadiness={precisionParserReadiness}
          precisionParserCpuFallback={precisionParserCpuFallback}
          onRetryPrecisionParser={retryPrecisionParser}
          onStartPrecisionParserCpuFallback={startPrecisionParserCpuFallback}
          onCancelPrecisionParserCpuFallbackBenchmark={cancelPrecisionParserCpuFallbackBenchmark}
          onStopPrecisionParserCpuFallback={stopPrecisionParserCpuFallback}
          onSubmitPrecisionParserDiagnostics={(readiness) =>
            submitPrecisionParserDiagnosticReport(readiness, {
              precisionParserRuntime: precisionParserRuntimeReport,
            })
          }
          remoteRecognitionControl={
            remoteRecognitionSession.isAvailable ? (
              <RemoteRecognitionControl
                readiness={remoteRecognitionSession.readiness}
                snapshot={remoteRecognitionSession.snapshot}
                parserInputTransport={precisionParserInputTransport}
                onOpenSetup={() => setRemoteRecognitionSetupOpen(true)}
                onStop={remoteRecognitionSession.stop}
              />
            ) : undefined
          }
          skillDashboardProps={{
          skills: profile.skills,
          states: runtimeStates,
          snapshots,
          selectedSkillId,
          expandedSkillIds,
          hasStream: Boolean(stream),
          isGameViewportReady: Boolean(resolvedGameViewport),
          canPickRegion: Boolean(stream && captureSize),
          currentLayoutKey: currentGameLayoutKey,
          showDebugColumns,
          isGloballyDisabled: Boolean(alertDisableSnapshot),
          initialAlertJitterEnabled: profile.skillAlertInitialJitterEnabled === true,
          alertVolume: profile.alertDefaults.volume,
          onSelectSkill: setSelectedSkillId,
          onToggleExpandedSkill: toggleExpandedSkill,
          onAddSkill: addSkill,
          onInitialAlertJitterEnabledChange: changeSkillInitialJitterEnabled,
          onChangeSkill: changeSkill,
          onAlertVolumeChange: updateDefaultAlertVolume,
          onDeleteSkill: removeSkill,
          onOpenRegionPicker: openSkillRegionPicker,
          onPreviewSound: previewSound,
          onSubmitMisreadReport: openSkillIssueReport,
          submittingMisreadSkillId: submittingSkillMisreadId,
        }}
        runeAlertPanelProps={{
          config: runeAlert,
          state: runeRuntime,
          snapshot: runeSnapshot,
          hasStream: Boolean(stream),
          canPickRegion: Boolean(stream && captureSize),
          currentLayoutKey,
          showDebug: showDebugColumns,
          isGloballyDisabled: Boolean(alertDisableSnapshot),
          onChange: changeRuneAlert,
          onOpenRegionPicker: openRuneRegionPicker,
          onResetDetection: resetRuneDetection,
          alertVolume: profile.alertDefaults.volume,
          onAlertVolumeChange: updateDefaultAlertVolume,
          onPreviewSound: previewSound,
          onSubmitDebugSample: () => void submitRuneDebugSample(),
          isSubmittingDebugSample: isRuneDebugSubmitting,
          onSubmitFalsePositive: openRuneIssueReport,
          isSubmittingFalsePositive: isRuneFalsePositiveSubmitting,
        }}
        ultimaRaidEquipmentAlertPanelProps={{
          config: ultimaRaidEquipmentAlert,
          state: ultimaRaidEquipmentRuntime,
          snapshot: ultimaRaidEquipmentSnapshot,
          hasStream: Boolean(stream),
          canPickRegion: Boolean(stream && captureSize),
          currentLayoutKey,
          isGloballyDisabled: Boolean(alertDisableSnapshot),
          onChange: changeUltimaRaidEquipmentAlert,
          onOpenRegionPicker: openUltimaRaidEquipmentRegionPicker,
          onPreviewSound: previewSound,
          onSubmitIssueReport: openUltimaRaidEquipmentIssueReport,
          onSubmitBossIssueReport: openUltimaRaidBossIssueReport,
          isSubmittingIssueReport:
            isUltimaRaidEquipmentIssueSubmitting,
          isSubmittingBossIssueReport:
            isUltimaRaidBossIssueSubmitting,
        }}
        huntStallPanelProps={{
          config: huntStallAlert,
          state: huntStallRuntime,
          snapshot: huntStallSnapshot,
          hasStream: Boolean(stream),
          isGameViewportReady: Boolean(resolvedGameViewport),
          canPickRegion: Boolean(stream && captureSize),
          currentLayoutKey: currentGameLayoutKey,
          showDebug: showDebugColumns,
          isGloballyDisabled: Boolean(alertDisableSnapshot),
          onChange: changeHuntStallAlert,
          onOpenRegionPicker: openHuntStallRegionPicker,
          onResetDetection: resetHuntStallDetection,
          onPreviewSound: previewSound,
          onSubmitDebugSample: () => void submitHuntStallDebugSample(),
          onSubmitIssueReport: openHuntStallIssueReport,
          isSubmittingDebugSample: isHuntStallDebugSubmitting,
          isSubmittingIssueReport: isHuntStallIssueSubmitting,
        }}
        buffExpiryPanelProps={{
          config: buffExpiryAlert,
          state: buffExpiryRuntime,
          snapshot: buffExpirySnapshot,
          precisionEnginePreloadStatus: buffExpiryPrecisionPreloadStatus,
          hasStream: Boolean(stream),
          isGameViewportReady: Boolean(resolvedGameViewport),
          showDebug: showDebugColumns,
          isGloballyDisabled: Boolean(alertDisableSnapshot),
          onChange: changeBuffExpiryAlert,
          onResetDetection: resetBuffExpiryDetection,
          onPreviewSound: previewSound,
          onSubmitIssueReport: openBuffExpiryIssueReport,
          isSubmittingIssueReport: isBuffExpiryIssueSubmitting,
        }}
        specialCorePanelProps={{
          config: specialCoreAlert,
          state: specialCoreRuntime,
          snapshot: specialCoreSnapshot,
          hasStream: Boolean(stream),
          isGameViewportReady: Boolean(resolvedGameViewport),
          showDebug: showDebugColumns,
          isGloballyDisabled: Boolean(alertDisableSnapshot),
          onChange: changeSpecialCoreAlert,
          onResetDetection: resetSpecialCoreDetection,
          onPreviewSound: previewSound,
          onSubmitIssueReport: openSpecialCoreIssueReport,
          isSubmittingIssueReport: isSpecialCoreIssueSubmitting,
        }}
        boosterExpiryPanelProps={{
          config: boosterExpiryAlert,
          state: boosterExpiryRuntime,
          snapshot: boosterExpirySnapshot,
          hasStream: Boolean(stream),
          isGameViewportReady: Boolean(resolvedGameViewport),
          showDebug: showDebugColumns,
          isGloballyDisabled: Boolean(alertDisableSnapshot),
          onChange: changeBoosterExpiryAlert,
          onResetDetection: resetBoosterExpiryDetection,
          onPreviewSound: previewSound,
          onSubmitIssueReport: openBoosterExpiryIssueReport,
          isSubmittingIssueReport: isBoosterExpiryIssueSubmitting,
        }}
        generalTimerPanelProps={{
          timers: generalTimers,
          isGloballyDisabled: Boolean(alertDisableSnapshot),
          onAddTimer: addGeneralTimer,
          onChangeTimer: changeGeneralTimer,
          onRemoveTimer: removeGeneralTimer,
          onPreviewSound: previewSound,
          onTimerAlert: playGeneralTimerAlert,
        }}
      />

      <CaptureVideoHost videoRef={videoRef} onMetadata={handleMetadata} />

      <PatchNotesPanel />

      <AppFooter onOpenPrivacy={openPrivacy} />

      {isAnyAppModalOpen && (
        <Suspense fallback={null}>
          <AppModalHost
            isRegionPickerOpen={isSkillRegionPickerOpen}
            selectedSkill={selectedSkill}
            selectedSkillRegion={selectedSkillRegion}
            isRuneRegionPickerOpen={isRuneRegionPickerOpen}
            runeRegion={runeRegion}
            isUltimaRaidEquipmentRegionPickerOpen={
              isUltimaRaidEquipmentRegionPickerOpen
            }
            ultimaRaidEquipmentRegion={ultimaRaidEquipmentRegion}
            isHuntStallRegionPickerOpen={isHuntStallRegionPickerOpen}
            huntStallRegion={huntStallRegion}
            stream={stream}
            captureSize={captureSize}
            isGameViewportSetupOpen={isGameViewportSetupOpen}
            gameViewport={resolvedGameViewport}
            gameViewportState={gameViewportState}
            gameViewportVerification={gameViewportVerification}
            isFeedbackOpen={isFeedbackOpen}
            isPrivacyOpen={isPrivacyOpen}
            isDonationOpen={isDonationOpen}
            isUsageGuideOpen={isUsageGuideOpen}
            isResponsibilityNoticeOpen={isResponsibilityNoticeOpen}
            isOnboardingOpen={isOnboardingOpen}
            isDiscordLaunchCampaignOpen={isDiscordLaunchCampaignOpen}
            isRemoteRecognitionSetupOpen={isRemoteRecognitionSetupOpen}
            hasExternalModalOpen={hasExternalAppModalOpen}
            issueReportTarget={issueReportTarget}
            isIssueReportSubmitting={
              issueReportTarget?.kind === "rune"
                ? isRuneFalsePositiveSubmitting
                : issueReportTarget?.kind === "ultima-raid-equipment"
                  ? isUltimaRaidEquipmentIssueSubmitting
                : issueReportTarget?.kind === "ultima-raid-boss"
                  ? isUltimaRaidBossIssueSubmitting
                : issueReportTarget?.kind === "skill"
                  ? submittingSkillMisreadId === issueReportTarget.skillId
                  : issueReportTarget?.kind === "hunt-stall"
                    ? isHuntStallIssueSubmitting
                    : issueReportTarget?.kind === "buff-expiry"
                      ? isBuffExpiryIssueSubmitting
                    : issueReportTarget?.kind === "booster-expiry"
                      ? isBoosterExpiryIssueSubmitting
                    : issueReportTarget?.kind === "special-core"
                      ? isSpecialCoreIssueSubmitting
                  : false
            }
            profile={profile}
            runtimeStates={runtimeStates}
            snapshots={snapshots}
            runeSnapshot={runeSnapshot}
            ultimaRaidEquipmentRuntime={ultimaRaidEquipmentRuntime}
            ultimaRaidEquipmentSnapshot={ultimaRaidEquipmentSnapshot}
            huntStallRuntime={huntStallRuntime}
            huntStallSnapshot={huntStallSnapshot}
            buffExpiryRuntime={buffExpiryRuntime}
            buffExpirySnapshot={buffExpirySnapshot}
            boosterExpiryRuntime={boosterExpiryRuntime}
            boosterExpirySnapshot={boosterExpirySnapshot}
            specialCoreRuntime={specialCoreRuntime}
            specialCoreSnapshot={specialCoreSnapshot}
            videoRef={videoRef}
            currentLayoutKey={currentLayoutKey}
            currentGameLayoutKey={currentGameLayoutKey}
            precisionParserRuntime={precisionParserRuntimeReport}
            onApplySkillRegion={applySkillRegion}
            onCloseSkillRegionPicker={closeSkillRegionPicker}
            onApplyRuneRegion={applyRuneRegion}
            onCloseRuneRegionPicker={closeRuneRegionPicker}
            onApplyUltimaRaidEquipmentRegion={
              applyUltimaRaidEquipmentRegion
            }
            onCloseUltimaRaidEquipmentRegionPicker={
              closeUltimaRaidEquipmentRegionPicker
            }
            onApplyHuntStallRegion={applyHuntStallRegion}
            onCloseHuntStallRegionPicker={closeHuntStallRegionPicker}
            onApplyGameViewport={handleApplyGameViewport}
            onCloseGameViewportSetup={handleCloseGameViewportSetup}
            onUseFullCaptureAsGameViewport={
              handleUseFullCaptureAsGameViewport
            }
            onRequestHuntStallGameViewportSetup={
              requestGameViewportForHuntStallPicker
            }
            onCloseFeedback={closeFeedback}
            onFeedbackSubmitted={setMessage}
            onClosePrivacy={closePrivacy}
            onCloseDonation={closeDonation}
            onCloseUsageGuide={closeUsageGuide}
            onCloseIssueReport={closeIssueReport}
            onSubmitIssueReport={submitIssueReport}
            onConfirmResponsibilityNotice={confirmResponsibilityNotice}
            onDismissResponsibilityNotice={dismissResponsibilityNotice}
            onCloseOnboarding={closeOnboarding}
            onOpenGuideFromOnboarding={openGuideFromOnboarding}
            onDismissOnboarding={dismissOnboarding}
            onDiscordLaunchCampaignVisible={recordDiscordLaunchCampaignVisible}
            onDismissDiscordLaunchCampaign={dismissDiscordLaunchCampaign}
            onOpenDiscordLaunchCampaign={openDiscordFromLaunchCampaign}
            remoteRecognitionSnapshot={remoteRecognitionSession.snapshot}
            remoteRecognitionReadiness={remoteRecognitionSession.readiness}
            precisionParserInputTransport={precisionParserInputTransport}
            precisionParserInputTransportDiagnostics={
              precisionParserInputTransportDiagnostics
            }
            onStartRemoteRecognitionSetup={remoteRecognitionSession.start}
            onStopRemoteRecognitionSession={remoteRecognitionSession.stop}
            onRemoteParserConsentChange={handleRemoteParserConsentChange}
            onVp8ParserPreviewChange={handleVp8ParserPreviewChange}
            onCloseRemoteRecognitionSetup={() =>
              setRemoteRecognitionSetupOpen(false)
            }
          />
        </Suspense>
      )}

      <Suspense fallback={null}>
        <AnimatePresence>
          {isSettingsManagerOpen && (
            <SettingsManagerDialog key="settings-manager" {...settingsManagerDialogProps} />
          )}
        </AnimatePresence>
      </Suspense>

      {hasSettingsWorkflowDialog && (
        <Suspense fallback={null}>
          <SettingsWorkflowDialogs
            pendingSettingsPresetImport={pendingSettingsPresetImport}
            pendingSettingsReplacementAction={pendingSettingsReplacementAction}
            isUnsavedSettingsSavePromptOpen={isUnsavedSettingsSavePromptOpen}
            pendingSettingsApply={pendingSettingsApply}
            onCancelSettingsPresetImport={cancelSettingsPresetImport}
            onConfirmSettingsPresetImport={confirmSettingsPresetImport}
            onSelectAllImportedSettingsPresets={selectAllImportedSettingsPresets}
            onClearImportedSettingsPresetSelection={clearImportedSettingsPresetSelection}
            onToggleImportedSettingsPreset={toggleImportedSettingsPreset}
            onCancelUnsavedSettingsReplacement={cancelUnsavedSettingsReplacement}
            onConfirmUnsavedSettingsReplacement={confirmUnsavedSettingsReplacement}
            onOpenUnsavedSettingsSavePrompt={openUnsavedSettingsSavePrompt}
            onCloseUnsavedSettingsSavePrompt={closeUnsavedSettingsSavePrompt}
            onSaveCurrentSettingsBeforeReplacement={saveCurrentSettingsBeforeReplacement}
            onCancelSettingsApply={cancelSettingsApply}
            onConfirmSettingsApply={confirmSettingsApply}
          />
        </Suspense>
      )}
      <Suspense fallback={null}>
        <AnimatePresence>
          {isCustomSoundManagerOpen && (
            <CustomSoundManagerDialog
              key="custom-sound-manager"
              customSounds={customSounds}
              onClose={closeCustomSoundManager}
              onChanged={refreshCustomSounds}
              onSoundDeleted={handleCustomSoundDeleted}
              onMessage={setMessage}
            />
          )}
        </AnimatePresence>
      </Suspense>
      {memoryDiagnosticsMode !== "off" && (
        <Suspense fallback={null}>
          <MemoryDiagnosticsPanel
            mode={memoryDiagnosticsMode}
            buildInfo={__APP_BUILD_INFO__}
            precisionParserReadiness={precisionParserReadiness}
            precisionParserRuntimeSelection={precisionParserRuntimeSelection}
            precisionParserCpuFallback={precisionParserCpuFallback}
          />
        </Suspense>
      )}
      </main>
    </CustomSoundsProvider>
  );
}

export default App;

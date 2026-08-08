import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HuntStallRuntimeState, RuneRuntimeState } from "../../alertTypes";
import type { GameViewportVerificationStatus } from "../../contracts/geometry/frameSource";
import { SUPPORTED_BUFF_EXPIRY_BUFF_IDS } from "../../lib/buffExpiry/buffExpiryCatalog";
import type { BuffExpiryRuntimeState } from "../../lib/buffExpiry/buffExpiryTypes";
import { createBoosterExpiryRuntimeState } from "../../lib/boosterExpiry/boosterExpiryRuntime";
import { createSpecialCoreRuntimeState } from "../../lib/specialCore";
import {
  createDefaultHuntStallAlert,
  createDefaultSpecialCoreAlert,
  createDefaultUltimaRaidEquipmentAlert,
} from "../../lib/storage";
import { createRuntimeState } from "../../lib/timer";
import { createUltimaRaidEquipmentRuntimeState } from "../../runtime/ultima-raid-equipment/ultimaRaidEquipmentAlertState";
import { setSliderValue } from "../../test/slider";
import type { GeneralTimerConfig, RuneAlertConfig, SkillConfig } from "../../types";
import { MonitoringWorkspace } from "./MonitoringWorkspace";
import { MONITORING_SECTION_COLLAPSE_STORAGE_KEY } from "./monitoringSectionCollapse";

const skill: SkillConfig = {
  id: "skill-1",
  name: "야누스",
  presetId: "sol-janus-dawn-2min",
  countdownSource: "cooldown",
  durationSeconds: 120,
  alertThresholdSeconds: 10,
  recognitionStartSeconds: 60,
  region: null,
  recognitionMode: "digit-template",
  soundId: "띵동띵동",
  volume: 0.8,
  enabled: true,
};

const runeConfig: RuneAlertConfig = {
  enabled: true,
  region: null,
  regionsByLayout: {},
  soundId: "미스터리",
  volume: 0.75,
};

const runeState: RuneRuntimeState = {
  status: "no-region",
  confidence: 0,
  stableCount: 0,
  firstDetectedAt: null,
  lastDetectedAt: null,
  lastFoundAt: null,
  alertedAt: null,
  lastRepeatedAlertAt: null,
  repeatedAlertCount: 0,
  lastAlertedAt: null,
  candidateCount: 0,
};

const huntStallState: HuntStallRuntimeState = {
  status: "paused",
  lastChangedAt: null,
  lastSampledAt: null,
  lastReadableAt: null,
  lastReadFailureAt: null,
  unreadableSinceAt: null,
  alertedAt: null,
  lastRepeatedAlertAt: null,
  repeatedAlertCount: 0,
  lastAlertedAt: null,
  stableSampleCount: 0,
  unchangedSeconds: 0,
  fingerprint: null,
  recognizedText: null,
  alertedRecognizedText: null,
  pendingRecognizedText: null,
  pendingRecognizedCount: 0,
  lastRejectedRecognizedText: null,
  lastReadFailureReason: null,
  lastDecision: "idle",
  hasObservedExperienceChange: false,
  hasObservedCooldownPresence: false,
  cooldownLastDetectedAt: null,
  cooldownMissingSinceAt: null,
  cooldownMissingSeconds: 0,
  cooldownConsecutiveReadableCount: 0,
  confidence: 0,
  changeScore: 0,
};

const buffExpiryState: BuffExpiryRuntimeState = {
  status: "paused",
  tracks: [],
  pendingTracks: [],
  lastSampledAt: null,
  lastDetectedAt: null,
  lastAlertedAt: null,
  boxCount: 0,
  acceptedMatchCount: 0,
  unsupportedReason: null,
  performance: null,
};

const generalTimer: GeneralTimerConfig = {
  id: "timer-1",
  presetId: "30m",
  soundId: "띵동띵동",
  volume: 0.8,
  enabled: true,
  startedAt: null,
  endsAt: null,
  remainingSecondsAtPause: null,
  alertedAt: null,
};

function renderMonitoringWorkspace({
  onRequestScreenShareAttention = () => undefined,
  onOpenGameViewportSetup = () => undefined,
  onUseFullCaptureAsGameViewport = () => undefined,
  hasStaleGameViewport = false,
  hasStream: hasStreamOverride,
  gameViewportVerification: gameViewportVerificationOverride,
}: {
  onRequestScreenShareAttention?: () => void;
  onOpenGameViewportSetup?: () => void;
  onUseFullCaptureAsGameViewport?: () => void;
  hasStaleGameViewport?: boolean;
  hasStream?: boolean;
  gameViewportVerification?: GameViewportVerificationStatus;
} = {}) {
  const hasStream = hasStreamOverride ?? hasStaleGameViewport;
  const gameViewportVerification =
    gameViewportVerificationOverride ??
    (hasStaleGameViewport ? "stale" : "known-capture");
  const isGameViewportReady =
    gameViewportVerification !== "unavailable" &&
    gameViewportVerification !== "unverified" &&
    gameViewportVerification !== "stale";
  return render(
    <MonitoringWorkspace
      isAllAlertsDisabled={false}
      onToggleAllAlertsDisabled={() => undefined}
      masterVolume={0.8}
      onMasterVolumeChange={() => undefined}
      onPreviewMasterVolume={() => undefined}
      onRequestScreenShareAttention={onRequestScreenShareAttention}
      onOpenGameViewportSetup={onOpenGameViewportSetup}
      onUseFullCaptureAsGameViewport={onUseFullCaptureAsGameViewport}
      gameViewportVerification={gameViewportVerification}
      skillDashboardProps={{
        skills: [skill],
        states: { [skill.id]: createRuntimeState(skill.id) },
        snapshots: {},
        selectedSkillId: skill.id,
        expandedSkillIds: [],
        hasStream,
        isGameViewportReady,
        canPickRegion: false,
        currentLayoutKey: null,
        showDebugColumns: false,
        alertVolume: 0.8,
        onSelectSkill: () => undefined,
        onToggleExpandedSkill: () => undefined,
        onAddSkill: () => undefined,
        onChangeSkill: () => undefined,
        onAlertVolumeChange: () => undefined,
        onDeleteSkill: () => undefined,
        onOpenRegionPicker: () => undefined,
        onPreviewSound: () => undefined,
        onSubmitMisreadReport: () => undefined,
        submittingMisreadSkillId: null,
      }}
      runeAlertPanelProps={{
        config: runeConfig,
        state: runeState,
        snapshot: null,
        hasStream: false,
        canPickRegion: false,
        currentLayoutKey: null,
        showDebug: false,
        onChange: () => undefined,
        onOpenRegionPicker: () => undefined,
        onResetDetection: () => undefined,
        alertVolume: 0.8,
        onAlertVolumeChange: () => undefined,
        onPreviewSound: () => undefined,
        onSubmitDebugSample: () => undefined,
        isSubmittingDebugSample: false,
        onSubmitFalsePositive: () => undefined,
        isSubmittingFalsePositive: false,
      }}
      ultimaRaidEquipmentAlertPanelProps={{
        config: createDefaultUltimaRaidEquipmentAlert(),
        state: createUltimaRaidEquipmentRuntimeState(),
        snapshot: null,
        hasStream: false,
        canPickRegion: false,
        currentLayoutKey: null,
        onChange: () => undefined,
        onOpenRegionPicker: () => undefined,
        onPreviewSound: () => undefined,
      }}
      huntStallPanelProps={{
        config: {
          ...createDefaultHuntStallAlert(),
          enabled: false,
          stallThresholdSeconds: 10,
          soundId: "띵동띵동",
          volume: 0.8,
        },
        state: huntStallState,
        snapshot: null,
        hasStream: false,
        canPickRegion: false,
        currentLayoutKey: null,
        onOpenRegionPicker: () => undefined,
        showDebug: false,
        onChange: () => undefined,
        onResetDetection: () => undefined,
        onPreviewSound: () => undefined,
        onSubmitDebugSample: () => undefined,
        onSubmitIssueReport: () => undefined,
        isSubmittingDebugSample: false,
        isSubmittingIssueReport: false,
      }}
      buffExpiryPanelProps={{
        config: {
          enabled: false,
          alertLeadSeconds: 30,
          selectedBuffIds: [...SUPPORTED_BUFF_EXPIRY_BUFF_IDS],
          soundId: "띵동띵동",
          volume: 0.8,
        },
        state: buffExpiryState,
        snapshot: null,
        hasStream: false,
        showDebug: false,
        onChange: () => undefined,
        onResetDetection: () => undefined,
        onPreviewSound: () => undefined,
        onSubmitIssueReport: () => undefined,
        isSubmittingIssueReport: false,
      }}
      specialCorePanelProps={{
        config: createDefaultSpecialCoreAlert(),
        state: createSpecialCoreRuntimeState(),
        snapshot: null,
        hasStream: false,
        showDebug: false,
        onChange: () => undefined,
        onResetDetection: () => undefined,
        onPreviewSound: () => undefined,
        onSubmitIssueReport: () => undefined,
        isSubmittingIssueReport: false,
      }}
      boosterExpiryPanelProps={{
        config: {
          enabled: false,
          alertLeadSeconds: 10,
          soundId: "띵동띵동",
          volume: 0.8,
        },
        state: createBoosterExpiryRuntimeState(),
        snapshot: null,
        hasStream: false,
        showDebug: false,
        onChange: () => undefined,
        onResetDetection: () => undefined,
        onPreviewSound: () => undefined,
        onSubmitIssueReport: () => undefined,
        isSubmittingIssueReport: false,
      }}
      generalTimerPanelProps={{
        timers: [generalTimer],
        onAddTimer: () => undefined,
        onChangeTimer: () => undefined,
        onRemoveTimer: () => undefined,
        onPreviewSound: () => undefined,
        onTimerAlert: () => undefined,
      }}
    />,
  );
}

describe("MonitoringWorkspace", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(cleanup);

  it("keeps every monitoring feature composed in one workspace", () => {
    const onToggleAllAlertsDisabled = vi.fn();
    const onMasterVolumeChange = vi.fn();
    const onPreviewMasterVolume = vi.fn();
    const { container } = render(
      <MonitoringWorkspace
        isAllAlertsDisabled={false}
        onToggleAllAlertsDisabled={onToggleAllAlertsDisabled}
        masterVolume={0.8}
        onMasterVolumeChange={onMasterVolumeChange}
        onPreviewMasterVolume={onPreviewMasterVolume}
        gameViewportVerification="unavailable"
        skillDashboardProps={{
          skills: [skill],
          states: { [skill.id]: createRuntimeState(skill.id) },
          snapshots: {},
          selectedSkillId: skill.id,
          expandedSkillIds: [],
          hasStream: false,
          canPickRegion: false,
          currentLayoutKey: null,
          showDebugColumns: false,
          alertVolume: 0.8,
          onSelectSkill: () => undefined,
          onToggleExpandedSkill: () => undefined,
          onAddSkill: () => undefined,
          onChangeSkill: () => undefined,
          onAlertVolumeChange: () => undefined,
          onDeleteSkill: () => undefined,
          onOpenRegionPicker: () => undefined,
          onPreviewSound: () => undefined,
          onSubmitMisreadReport: () => undefined,
          submittingMisreadSkillId: null,
        }}
        runeAlertPanelProps={{
          config: runeConfig,
          state: runeState,
          snapshot: null,
          hasStream: false,
          canPickRegion: false,
          currentLayoutKey: null,
          showDebug: false,
          onChange: () => undefined,
          onOpenRegionPicker: () => undefined,
          onResetDetection: () => undefined,
          alertVolume: 0.8,
          onAlertVolumeChange: () => undefined,
          onPreviewSound: () => undefined,
          onSubmitDebugSample: () => undefined,
          isSubmittingDebugSample: false,
          onSubmitFalsePositive: () => undefined,
          isSubmittingFalsePositive: false,
        }}
        ultimaRaidEquipmentAlertPanelProps={{
          config: createDefaultUltimaRaidEquipmentAlert(),
          state: createUltimaRaidEquipmentRuntimeState(),
          snapshot: null,
          hasStream: false,
          canPickRegion: false,
          currentLayoutKey: null,
          onChange: () => undefined,
          onOpenRegionPicker: () => undefined,
          onPreviewSound: () => undefined,
        }}
        huntStallPanelProps={{
          config: {
            ...createDefaultHuntStallAlert(),
            enabled: false,
            stallThresholdSeconds: 10,
            soundId: "띵동띵동",
            volume: 0.8,
          },
          state: huntStallState,
          snapshot: null,
          hasStream: false,
          canPickRegion: false,
          currentLayoutKey: null,
          onOpenRegionPicker: () => undefined,
          showDebug: false,
          onChange: () => undefined,
          onResetDetection: () => undefined,
          onPreviewSound: () => undefined,
          onSubmitDebugSample: () => undefined,
          onSubmitIssueReport: () => undefined,
          isSubmittingDebugSample: false,
          isSubmittingIssueReport: false,
        }}
        buffExpiryPanelProps={{
          config: {
            enabled: false,
          alertLeadSeconds: 30,
            selectedBuffIds: [...SUPPORTED_BUFF_EXPIRY_BUFF_IDS],
            soundId: "띵동띵동",
            volume: 0.8,
          },
          state: buffExpiryState,
          snapshot: null,
          hasStream: false,
          showDebug: false,
          onChange: () => undefined,
          onResetDetection: () => undefined,
          onPreviewSound: () => undefined,
          onSubmitIssueReport: () => undefined,
          isSubmittingIssueReport: false,
        }}
        specialCorePanelProps={{
          config: createDefaultSpecialCoreAlert(),
          state: createSpecialCoreRuntimeState(),
          snapshot: null,
          hasStream: false,
          showDebug: false,
          onChange: () => undefined,
          onResetDetection: () => undefined,
          onPreviewSound: () => undefined,
          onSubmitIssueReport: () => undefined,
          isSubmittingIssueReport: false,
        }}
        boosterExpiryPanelProps={{
          config: {
            enabled: false,
            alertLeadSeconds: 10,
            soundId: "띵동띵동",
            volume: 0.8,
          },
          state: createBoosterExpiryRuntimeState(),
          snapshot: null,
          hasStream: false,
          showDebug: false,
          onChange: () => undefined,
          onResetDetection: () => undefined,
          onPreviewSound: () => undefined,
          onSubmitIssueReport: () => undefined,
          isSubmittingIssueReport: false,
        }}
        generalTimerPanelProps={{
          timers: [generalTimer],
          onAddTimer: () => undefined,
          onChangeTimer: () => undefined,
          onRemoveTimer: () => undefined,
          onPreviewSound: () => undefined,
          onTimerAlert: () => undefined,
        }}
      />,
    );

    expect(container.querySelector(".alerts-panel")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "알림" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "스킬 알림" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "룬 알림" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "울티마 스쿼드 알림" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "사냥 멈춤 알림" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "버프 종료 알림" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "특수 코어 알림" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "부스터 종료 알림" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "일반 타이머" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "특수 코어 알림 안내" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "특수 코어 알림 베타 안내" })).toBeInTheDocument();
    expect(screen.queryByText("1개 켜짐")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /마스터 볼륨/ }));
    expect(screen.getByRole("dialog", { name: "마스터 볼륨 설정" })).toBeInTheDocument();
    expect(screen.getAllByText("80%")).toHaveLength(2);
    setSliderValue(screen.getByLabelText("마스터 볼륨"), 55);
    expect(onMasterVolumeChange).toHaveBeenCalledWith(0.55);
    fireEvent.click(screen.getByRole("button", { name: "미리 듣기" }));
    expect(onPreviewMasterVolume).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByLabelText("전체 비활성화"));
    expect(onToggleAllAlertsDisabled).toHaveBeenCalledWith(true);

    const infoButton = screen.getByRole("button", { name: "저장 방식 안내" });
    expect(infoButton).toHaveTextContent("저장 방식");
    fireEvent.focus(infoButton);
    expect(screen.getByText("설정은 이 브라우저에만 저장됩니다.")).toBeInTheDocument();
    expect(screen.getByText("로그인 없이 사용되며 서버에 저장되지 않습니다.")).toBeInTheDocument();
  });

  it("restores saved collapsed sections on initial render", () => {
    localStorage.setItem(
      MONITORING_SECTION_COLLAPSE_STORAGE_KEY,
      JSON.stringify({ skills: true, rune: false, hunt: true, timers: false }),
    );

    renderMonitoringWorkspace();

    expect(screen.getByRole("button", { name: "스킬 알림 패널 펼치기" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "룬 알림 패널 접기" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "울티마 스쿼드 알림 패널 접기" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "사냥 멈춤 알림 패널 펼치기" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "버프 종료 알림 패널 접기" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "특수 코어 알림 패널 접기" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "일반 타이머 패널 접기" })).toBeInTheDocument();
  });

  it("falls back to expanded sections when stored collapsed state is malformed", () => {
    localStorage.setItem(MONITORING_SECTION_COLLAPSE_STORAGE_KEY, "{");

    renderMonitoringWorkspace();

    expect(screen.getByRole("button", { name: "스킬 알림 패널 접기" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "룬 알림 패널 접기" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "울티마 스쿼드 알림 패널 접기" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "사냥 멈춤 알림 패널 접기" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "버프 종료 알림 패널 접기" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "특수 코어 알림 패널 접기" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "일반 타이머 패널 접기" })).toBeInTheDocument();
  });

  it("requests attention for the header screen share control when a no-stream status is clicked", () => {
    const onRequestScreenShareAttention = vi.fn();
    renderMonitoringWorkspace({ onRequestScreenShareAttention });

    const noStreamStatus = screen
      .getAllByText("화면 공유 필요")
      .find((element) => element.closest(".no-stream"));

    expect(noStreamStatus).toBeDefined();
    fireEvent.click(noStreamStatus as Element);

    expect(onRequestScreenShareAttention).toHaveBeenCalledTimes(1);
  });

  it("offers calibration and full-frame actions when an active alert is paused by a stale viewport", () => {
    const onOpenGameViewportSetup = vi.fn();
    const onUseFullCaptureAsGameViewport = vi.fn();
    renderMonitoringWorkspace({
      hasStaleGameViewport: true,
      onOpenGameViewportSetup,
      onUseFullCaptureAsGameViewport,
    });

    expect(
      screen.getByText(
        "공유 화면 크기가 바뀌었습니다. 게임 화면을 다시 맞추거나 전체 화면 사용을 확인해주세요.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "게임 화면 맞추기" }),
    ).toHaveClass("game-viewport-action-button", "is-primary");
    fireEvent.click(
      screen.getByRole("button", { name: "게임 화면 맞추기" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "공유 화면 그대로 사용" }),
    );

    expect(onOpenGameViewportSetup).toHaveBeenCalledOnce();
    expect(onUseFullCaptureAsGameViewport).toHaveBeenCalledOnce();
  });

  it("does not flash the confirmation banner while capture metadata is loading", () => {
    renderMonitoringWorkspace({
      hasStream: true,
      gameViewportVerification: "unavailable",
      onOpenGameViewportSetup: vi.fn(),
    });

    expect(
      screen.queryByRole("button", { name: "게임 화면 맞추기" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/일반적인 게임 화면 크기가 아닙니다/),
    ).not.toBeInTheDocument();
  });

  it("shows the confirmation banner after an unusual capture is classified", () => {
    renderMonitoringWorkspace({
      hasStream: true,
      gameViewportVerification: "unverified",
      onOpenGameViewportSetup: vi.fn(),
    });

    expect(
      screen.getByRole("button", { name: "게임 화면 맞추기" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "일반적인 게임 화면 크기가 아닙니다. 확장 UI라면 ‘게임 화면 맞추기’를, 아니라면 ‘공유 화면 그대로 사용’을 눌러주세요.",
      ),
    ).toBeInTheDocument();
  });

  it("collapses alert sections and persists the collapsed state", () => {
    render(
      <MonitoringWorkspace
        isAllAlertsDisabled={false}
        onToggleAllAlertsDisabled={() => undefined}
        masterVolume={0.8}
        onMasterVolumeChange={() => undefined}
        onPreviewMasterVolume={() => undefined}
        gameViewportVerification="unavailable"
        skillDashboardProps={{
          skills: [skill],
          states: { [skill.id]: createRuntimeState(skill.id) },
          snapshots: {},
          selectedSkillId: skill.id,
          expandedSkillIds: [],
          hasStream: false,
          canPickRegion: false,
          currentLayoutKey: null,
          showDebugColumns: false,
          alertVolume: 0.8,
          onSelectSkill: () => undefined,
          onToggleExpandedSkill: () => undefined,
          onAddSkill: () => undefined,
          onChangeSkill: () => undefined,
          onAlertVolumeChange: () => undefined,
          onDeleteSkill: () => undefined,
          onOpenRegionPicker: () => undefined,
          onPreviewSound: () => undefined,
          onSubmitMisreadReport: () => undefined,
          submittingMisreadSkillId: null,
        }}
        runeAlertPanelProps={{
          config: runeConfig,
          state: runeState,
          snapshot: null,
          hasStream: false,
          canPickRegion: false,
          currentLayoutKey: null,
          showDebug: false,
          onChange: () => undefined,
          onOpenRegionPicker: () => undefined,
          onResetDetection: () => undefined,
          alertVolume: 0.8,
          onAlertVolumeChange: () => undefined,
          onPreviewSound: () => undefined,
          onSubmitDebugSample: () => undefined,
          isSubmittingDebugSample: false,
          onSubmitFalsePositive: () => undefined,
          isSubmittingFalsePositive: false,
        }}
        ultimaRaidEquipmentAlertPanelProps={{
          config: createDefaultUltimaRaidEquipmentAlert(),
          state: createUltimaRaidEquipmentRuntimeState(),
          snapshot: null,
          hasStream: false,
          canPickRegion: false,
          currentLayoutKey: null,
          onChange: () => undefined,
          onOpenRegionPicker: () => undefined,
          onPreviewSound: () => undefined,
        }}
        huntStallPanelProps={{
          config: {
            ...createDefaultHuntStallAlert(),
            enabled: false,
            stallThresholdSeconds: 10,
            soundId: "띵동띵동",
            volume: 0.8,
          },
          state: huntStallState,
          snapshot: null,
          hasStream: false,
          canPickRegion: false,
          currentLayoutKey: null,
          onOpenRegionPicker: () => undefined,
          showDebug: false,
          onChange: () => undefined,
          onResetDetection: () => undefined,
          onPreviewSound: () => undefined,
          onSubmitDebugSample: () => undefined,
          onSubmitIssueReport: () => undefined,
          isSubmittingDebugSample: false,
          isSubmittingIssueReport: false,
        }}
        buffExpiryPanelProps={{
          config: {
            enabled: false,
          alertLeadSeconds: 30,
            selectedBuffIds: [...SUPPORTED_BUFF_EXPIRY_BUFF_IDS],
            soundId: "띵동띵동",
            volume: 0.8,
          },
          state: buffExpiryState,
          snapshot: null,
          hasStream: false,
          showDebug: false,
          onChange: () => undefined,
          onResetDetection: () => undefined,
          onPreviewSound: () => undefined,
          onSubmitIssueReport: () => undefined,
          isSubmittingIssueReport: false,
        }}
        specialCorePanelProps={{
          config: createDefaultSpecialCoreAlert(),
          state: createSpecialCoreRuntimeState(),
          snapshot: null,
          hasStream: false,
          showDebug: false,
          onChange: () => undefined,
          onResetDetection: () => undefined,
          onPreviewSound: () => undefined,
          onSubmitIssueReport: () => undefined,
          isSubmittingIssueReport: false,
        }}
        boosterExpiryPanelProps={{
          config: {
            enabled: false,
            alertLeadSeconds: 10,
            soundId: "띵동띵동",
            volume: 0.8,
          },
          state: createBoosterExpiryRuntimeState(),
          snapshot: null,
          hasStream: false,
          showDebug: false,
          onChange: () => undefined,
          onResetDetection: () => undefined,
          onPreviewSound: () => undefined,
          onSubmitIssueReport: () => undefined,
          isSubmittingIssueReport: false,
        }}
        generalTimerPanelProps={{
          timers: [generalTimer],
          onAddTimer: () => undefined,
          onChangeTimer: () => undefined,
          onRemoveTimer: () => undefined,
          onPreviewSound: () => undefined,
          onTimerAlert: () => undefined,
        }}
      />,
    );

    fireEvent.click(screen.getByRole("heading", { name: "룬 알림" }));

    expect(
      screen.getByRole("button", { name: "룬 알림 패널 펼치기" }).closest(".alert-section-controls"),
    ).not.toHaveTextContent("켜짐");
    expect(screen.getByRole("button", { name: "룬 알림 안내" })).toBeInTheDocument();
    expect(
      JSON.parse(localStorage.getItem(MONITORING_SECTION_COLLAPSE_STORAGE_KEY) ?? "{}"),
    ).toMatchObject(
      { rune: true },
    );

    fireEvent.click(screen.getByRole("button", { name: "룬 알림 패널 펼치기" }));

    expect(screen.getByRole("button", { name: "룬 알림 패널 접기" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "룬 알림 안내" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "룬 알림 패널 접기" }));

    expect(screen.getByRole("button", { name: "룬 알림 패널 펼치기" })).toBeInTheDocument();
  });
});

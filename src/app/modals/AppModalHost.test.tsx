import { createRef } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultHuntStallAlert, createDefaultProfile } from "../../lib/storage";
import { createHuntStallRuntimeState } from "../../lib/huntStall";
import { createBuffExpiryRuntimeState } from "../../lib/buffExpiry/buffExpiryRuntimeState";
import { createBoosterExpiryRuntimeState } from "../../lib/boosterExpiry/boosterExpiryRuntime";
import { createSpecialCoreRuntimeState } from "../../lib/specialCore";
import { APP_MODAL_HOST_KEYS, AppModalHost } from "./AppModalHost";
import { buildPrecisionParserRuntimeReport } from "../../contracts/reporting/precisionParserRuntimeReport";
import {
  createInitialParserFrameDiagnostics,
  createInitialParserProviderSnapshot,
} from "../../application/remote-recognition/remoteRecognitionSessionController";
import {
  createPrecisionParserInputTransportDiagnostics,
  DEFAULT_PRECISION_PARSER_INPUT_TRANSPORT,
} from "../../contracts/recognition/precisionParserInputTransport";

const PRECISION_PARSER_RUNTIME = buildPrecisionParserRuntimeReport(
  { executionProvider: "webgpu", selectionSource: "default" },
  { status: "idle" },
);

function renderAppModalHost({
  isResponsibilityNoticeOpen = false,
  isOnboardingOpen = false,
  isDiscordLaunchCampaignOpen = false,
  isPrivacyOpen = false,
  isRemoteRecognitionSetupOpen = false,
  hasExternalModalOpen = false,
  isRegionPickerOpen = false,
  selectedSkill = null,
  selectedSkillRegion = null,
  isRuneRegionPickerOpen = false,
  runeRegion = null,
  isUltimaRaidEquipmentRegionPickerOpen = false,
  ultimaRaidEquipmentRegion = null,
  isHuntStallRegionPickerOpen = false,
  huntStallRegion = null,
  stream = null,
  captureSize = null,
  isGameViewportSetupOpen = false,
  gameViewport,
  onApplyRuneRegion = () => undefined,
  profile = createDefaultProfile(),
}: {
  isResponsibilityNoticeOpen?: boolean;
  isOnboardingOpen?: boolean;
  isDiscordLaunchCampaignOpen?: boolean;
  isPrivacyOpen?: boolean;
  isRemoteRecognitionSetupOpen?: boolean;
  hasExternalModalOpen?: boolean;
  isRegionPickerOpen?: boolean;
  selectedSkill?: Parameters<typeof AppModalHost>[0]["selectedSkill"];
  selectedSkillRegion?: Parameters<typeof AppModalHost>[0]["selectedSkillRegion"];
  isRuneRegionPickerOpen?: boolean;
  runeRegion?: Parameters<typeof AppModalHost>[0]["runeRegion"];
  isUltimaRaidEquipmentRegionPickerOpen?: boolean;
  ultimaRaidEquipmentRegion?: Parameters<
    typeof AppModalHost
  >[0]["ultimaRaidEquipmentRegion"];
  isHuntStallRegionPickerOpen?: boolean;
  huntStallRegion?: Parameters<typeof AppModalHost>[0]["huntStallRegion"];
  stream?: MediaStream | null;
  captureSize?: { width: number; height: number } | null;
  isGameViewportSetupOpen?: boolean;
  gameViewport?: Parameters<typeof AppModalHost>[0]["gameViewport"];
  onApplyRuneRegion?: Parameters<typeof AppModalHost>[0]["onApplyRuneRegion"];
  profile?: Parameters<typeof AppModalHost>[0]["profile"];
}) {
  const resolvedGameViewport =
    gameViewport === undefined && captureSize
      ? {
          mode: "legacy-passthrough" as const,
          sourceSize: captureSize,
          gameResolution: captureSize,
          region: {
            x: 0,
            y: 0,
            width: captureSize.width,
            height: captureSize.height,
          },
          layoutKey: `${captureSize.width}x${captureSize.height}`,
          revision: 0,
        }
      : gameViewport ?? null;

  return render(
    <AppModalHost
      isRegionPickerOpen={isRegionPickerOpen}
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
      gameViewportState={{
        status: "legacy-passthrough",
        revision: 0,
      }}
      gameViewportVerification="known-capture"
      isFeedbackOpen={false}
      isPrivacyOpen={isPrivacyOpen}
      isDonationOpen={false}
      isUsageGuideOpen={false}
      isResponsibilityNoticeOpen={isResponsibilityNoticeOpen}
      isOnboardingOpen={isOnboardingOpen}
      isDiscordLaunchCampaignOpen={isDiscordLaunchCampaignOpen}
      hasExternalModalOpen={hasExternalModalOpen}
      issueReportTarget={null}
      isIssueReportSubmitting={false}
      profile={profile}
      runtimeStates={{}}
      snapshots={{}}
      runeSnapshot={null}
      huntStallRuntime={createHuntStallRuntimeState()}
      huntStallSnapshot={null}
      buffExpiryRuntime={createBuffExpiryRuntimeState()}
      buffExpirySnapshot={null}
      boosterExpiryRuntime={createBoosterExpiryRuntimeState()}
      boosterExpirySnapshot={null}
      specialCoreRuntime={createSpecialCoreRuntimeState()}
      specialCoreSnapshot={null}
      videoRef={createRef<HTMLVideoElement>()}
      currentLayoutKey={null}
      precisionParserRuntime={PRECISION_PARSER_RUNTIME}
      onApplySkillRegion={() => undefined}
      onCloseSkillRegionPicker={() => undefined}
      onApplyRuneRegion={onApplyRuneRegion}
      onCloseRuneRegionPicker={() => undefined}
      onApplyUltimaRaidEquipmentRegion={() => undefined}
      onCloseUltimaRaidEquipmentRegionPicker={() => undefined}
      onApplyHuntStallRegion={() => undefined}
      onCloseHuntStallRegionPicker={() => undefined}
      onApplyGameViewport={() => undefined}
      onCloseGameViewportSetup={() => undefined}
      onUseFullCaptureAsGameViewport={() => undefined}
      onRequestHuntStallGameViewportSetup={() => undefined}
      onCloseFeedback={() => undefined}
      onFeedbackSubmitted={() => undefined}
      onClosePrivacy={() => undefined}
      onCloseDonation={() => undefined}
      onCloseUsageGuide={() => undefined}
      onCloseIssueReport={() => undefined}
      onSubmitIssueReport={async () => false}
      onConfirmResponsibilityNotice={() => undefined}
      onDismissResponsibilityNotice={() => undefined}
      onCloseOnboarding={() => undefined}
      onOpenGuideFromOnboarding={() => undefined}
      onDismissOnboarding={() => undefined}
      onDiscordLaunchCampaignVisible={() => undefined}
      onDismissDiscordLaunchCampaign={() => undefined}
      onOpenDiscordLaunchCampaign={() => undefined}
      isRemoteRecognitionSetupOpen={isRemoteRecognitionSetupOpen}
      remoteRecognitionSnapshot={{
        phase: "idle",
        identity: null,
        serviceState: null,
        probe: null,
        probeDiagnostics: null,
        session: null,
        parserProvider: createInitialParserProviderSnapshot(),
        parserFrames: createInitialParserFrameDiagnostics(),
        failure: null,
      }}
      remoteRecognitionReadiness="ready"
      precisionParserInputTransport={DEFAULT_PRECISION_PARSER_INPUT_TRANSPORT}
      precisionParserInputTransportDiagnostics={
        createPrecisionParserInputTransportDiagnostics(
          DEFAULT_PRECISION_PARSER_INPUT_TRANSPORT,
        )
      }
      onStartRemoteRecognitionSetup={async () => undefined}
      onStopRemoteRecognitionSession={async () => undefined}
      onRemoteParserConsentChange={() => undefined}
      onVp8ParserPreviewChange={() => undefined}
      onCloseRemoteRecognitionSetup={() => undefined}
    />,
  );
}

describe("AppModalHost", () => {
  beforeEach(() => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.setAttribute("open", "");
      },
    });
    Object.defineProperty(HTMLDialogElement.prototype, "close", {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.removeAttribute("open");
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows the responsibility notice before onboarding", () => {
    renderAppModalHost({
      isResponsibilityNoticeOpen: true,
      isOnboardingOpen: true,
      isDiscordLaunchCampaignOpen: true,
      isRemoteRecognitionSetupOpen: true,
    });

    expect(screen.getByRole("dialog", { name: "사용 전 확인해주세요" })).toBeInTheDocument();
    expect(
      screen.queryByRole("dialog", { name: "처음 설정은 이렇게 합니다" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("dialog", {
        name: "메이플 타이머 디스코드가 열렸습니다",
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("alertdialog", { name: "원격 처리 연결 준비" }),
    ).not.toBeInTheDocument();
  });

  it("shows onboarding after the responsibility notice is closed", () => {
    renderAppModalHost({
      isResponsibilityNoticeOpen: false,
      isOnboardingOpen: true,
      isDiscordLaunchCampaignOpen: true,
    });

    expect(screen.getByRole("dialog", { name: "처음 설정은 이렇게 합니다" })).toBeInTheDocument();
    expect(
      screen.queryByRole("dialog", {
        name: "메이플 타이머 디스코드가 열렸습니다",
      }),
    ).not.toBeInTheDocument();
  });

  it("shows the Discord campaign only when no other modal is active", () => {
    const { unmount } = renderAppModalHost({ isDiscordLaunchCampaignOpen: true });

    expect(
      screen.getByRole("dialog", {
        name: "메이플 타이머 디스코드가 열렸습니다",
      }),
    ).toBeInTheDocument();

    unmount();
    renderAppModalHost({
      isDiscordLaunchCampaignOpen: true,
      isPrivacyOpen: true,
    });

    expect(
      screen.queryByRole("dialog", {
        name: "메이플 타이머 디스코드가 열렸습니다",
      }),
    ).not.toBeInTheDocument();
  });

  it("keeps the Discord campaign behind dialogs rendered outside the host", () => {
    renderAppModalHost({
      isDiscordLaunchCampaignOpen: true,
      hasExternalModalOpen: true,
    });

    expect(
      screen.queryByRole("dialog", {
        name: "메이플 타이머 디스코드가 열렸습니다",
      }),
    ).not.toBeInTheDocument();
  });

  it("renders the user-requested remote setup ahead of the Discord campaign", () => {
    renderAppModalHost({
      isDiscordLaunchCampaignOpen: true,
      isRemoteRecognitionSetupOpen: true,
    });

    expect(
      screen.getByRole("alertdialog", { name: "원격 처리 연결 준비" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("dialog", {
        name: "메이플 타이머 디스코드가 열렸습니다",
      }),
    ).not.toBeInTheDocument();
  });

  it("shows the skill quickslot warning from the app modal path", () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    renderAppModalHost({
      isRegionPickerOpen: true,
      selectedSkill: createDefaultProfile().skills[0],
      selectedSkillRegion: { x: 0.7, y: 0.56, width: 0.05, height: 0.05 },
      stream: {} as MediaStream,
      captureSize: { width: 1920, height: 1080 },
      gameViewport: {
        mode: "legacy-passthrough",
        sourceSize: { width: 1920, height: 1080 },
        gameResolution: { width: 1920, height: 1080 },
        region: { x: 0, y: 0, width: 1920, height: 1080 },
        layoutKey: "1920x1080",
        revision: 0,
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "적용" }));

    expect(screen.getByRole("alertdialog", { name: "퀵슬롯 위치를 확인해주세요" })).toBeInTheDocument();
  });

  it("does not apply a placement warning to the rune crop", () => {
    const onApplyRuneRegion = vi.fn();
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    renderAppModalHost({
      isRuneRegionPickerOpen: true,
      runeRegion: { x: 0.08, y: 0.32, width: 0.18, height: 0.12 },
      stream: {} as MediaStream,
      captureSize: { width: 1920, height: 1080 },
      onApplyRuneRegion,
    });

    fireEvent.click(screen.getByRole("button", { name: "적용" }));

    expect(
      screen.queryByRole("alertdialog", {
        name: "미니맵 위치를 확인해주세요",
      }),
    ).not.toBeInTheDocument();
    expect(onApplyRuneRegion).toHaveBeenCalledWith(
      expect.objectContaining({
        x: 0.08,
        y: 0.32,
      }),
    );
  });

  it("applies an Ultima Squad screen crop without the quickslot placement warning", () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    renderAppModalHost({
      isUltimaRaidEquipmentRegionPickerOpen: true,
      ultimaRaidEquipmentRegion: {
        x: 0.08,
        y: 0.18,
        width: 0.2,
        height: 0.16,
      },
      stream: {} as MediaStream,
      captureSize: { width: 1920, height: 1080 },
      gameViewport: {
        mode: "legacy-passthrough",
        sourceSize: { width: 1920, height: 1080 },
        gameResolution: { width: 1920, height: 1080 },
        region: { x: 0, y: 0, width: 1920, height: 1080 },
        layoutKey: "1920x1080",
        revision: 0,
      },
    });

    expect(
      screen.getByRole("dialog", {
        name: "울티마 스쿼드 화면 영역 선택",
      }),
    ).toHaveTextContent("울티마 스쿼드 화면 전체를 선택하세요.");
    expect(
      screen.getByRole("dialog", {
        name: "울티마 스쿼드 화면 영역 선택",
      }),
    ).toHaveTextContent(
      "왼쪽 장비 가방의 수량 표시와 상단 가득 참 안내를 함께 확인해 알립니다.",
    );
    expect(
      screen.getByLabelText("울티마 스쿼드 화면 영역 선택 예시 영상"),
    ).toHaveAttribute(
      "src",
      "/media/ultima-raid-equipment-crop-guide.mp4",
    );

    fireEvent.click(screen.getByRole("button", { name: "적용" }));

    expect(
      screen.queryByRole("alertdialog", {
        name: "퀵슬롯 위치를 확인해주세요",
      }),
    ).not.toBeInTheDocument();
  });

  it("shows the manual experience band guide video from the app modal path", () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const baseProfile = createDefaultProfile();
    const profile = {
      ...baseProfile,
      huntStallAlert: {
        ...createDefaultHuntStallAlert(),
        mode: "manual-experience" as const,
      },
    };

    renderAppModalHost({
      isHuntStallRegionPickerOpen: true,
      huntStallRegion: null,
      stream: {} as MediaStream,
      captureSize: { width: 1920, height: 1080 },
      profile,
    });

    expect(screen.getByLabelText("경험치바 높이 선택 예시 영상")).toHaveAttribute(
      "src",
      "/media/manual-experience-band-guide.mp4",
    );
    expect(screen.getByLabelText("영역 선택 도움말")).toHaveTextContent(
      "경험치바 높이만 선택하세요",
    );
  });

  it("preserves the app modal identities", () => {
    expect(APP_MODAL_HOST_KEYS).toEqual({
      gameViewportSetup: "game-viewport-setup",
      skillRegionPicker: "skill-region-picker",
      runeRegionPicker: "rune-region-picker",
      ultimaRaidEquipmentRegionPicker: "ultima-raid-equipment-region-picker",
      huntStallRegionPicker: "hunt-stall-region-picker",
      feedback: "feedback",
      privacy: "privacy",
      donation: "donation",
      usageGuide: "usage-guide",
      issueReport: "issue-report",
      responsibility: "responsibility",
      onboarding: "onboarding",
      discordLaunchCampaign: "discord-launch-campaign",
      remoteRecognitionSetup: "remote-recognition-setup",
    });
  });
});

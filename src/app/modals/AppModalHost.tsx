import type { RefObject } from "react";
import { AnimatePresence } from "motion/react";
import type { AlertIssueReportTarget } from "../../application/reporting/alertIssueReportAvailability";
import type {
  HuntStallRuntimeState,
  HuntStallSnapshot,
  RuneSnapshot,
  SkillSnapshot,
} from "../../alertTypes";
import type {
  BuffExpiryRuntimeState,
  BuffExpirySnapshot,
} from "../../lib/buffExpiry/buffExpiryTypes";
import type {
  BoosterExpiryRuntimeState,
  BoosterExpirySnapshot,
} from "../../lib/boosterExpiry/boosterExpiryTypes";
import type {
  SpecialCoreRuntimeState,
  SpecialCoreSnapshot,
} from "../../lib/specialCore";
import type { UltimaRaidEquipmentRuntimeState } from "../../runtime/ultima-raid-equipment/ultimaRaidEquipmentAlertState";
import type { UltimaRaidEquipmentSnapshot } from "../../runtime/ultima-raid-equipment/ultimaRaidEquipmentSnapshot";
import type { AlertIssueReportDetails } from "../../features/reports/alertReportPayloads";
import type {
  GameViewportCalibrationState,
  GameViewportVerificationStatus,
  PixelSize,
  ResolvedGameViewport,
} from "../../contracts/geometry/frameSource";
import type { PrecisionParserRuntimeReport } from "../../contracts/reporting/precisionParserRuntimeReport";
import type { RemoteRecognitionSessionSnapshot } from "../../application/remote-recognition/remoteRecognitionSessionController";
import type { RemoteRecognitionFrameProbeReadiness } from "../../application/remote-recognition/remoteRecognitionFrameProbeSource";
import type {
  PrecisionParserInputTransport,
  PrecisionParserInputTransportDiagnostics,
} from "../../contracts/recognition/precisionParserInputTransport";
import type { REMOTE_RECOGNITION_READINESS_CONSENT_VERSION } from "../../contracts/remote-recognition/remoteRecognitionControlContract";
import {
  buildIssueReportContext,
  getFallbackIssueReportContext,
} from "../../features/reports/alertIssueReportContext";
import { saveOnboardingDismissed } from "../../lib/onboarding";
import type {
  HuntStallAlertConfig,
  Profile,
  RelativeRegion,
  RuneAlertConfig,
  SkillConfig,
  SkillRuntimeState,
  UltimaRaidEquipmentAlertConfig,
} from "../../types";
import { AlertIssueReportDialog } from "../../features/reports/AlertIssueReportDialog";
import { GameViewportSetupModal } from "../../features/capture/GameViewportSetupModal";
import { DonationModal } from "../../features/app-shell/DonationModal";
import { DiscordLaunchCampaignModal } from "../../features/app-shell/DiscordLaunchCampaignModal";
import { FeedbackModal } from "../../features/reports/FeedbackModal";
import { OnboardingModal } from "../../features/app-shell/OnboardingModal";
import { PrivacyNoticeModal } from "../../features/app-shell/PrivacyNotice";
import { ResponsibilityNoticeModal } from "../../features/app-shell/ResponsibilityNoticeModal";
import { UsageGuideModal } from "../../features/app-shell/UsageGuide";
import { CropSelectionModal } from "../../features/region-picker/CropSelectionModal";
import { RemoteRecognitionSetupDialog } from "../../features/remote-recognition/RemoteRecognitionSetupDialog";
import { getManualExperienceRegionValidationError } from "../../features/alerts/hunt-stall/manualExperienceRegionValidation";
import { alertIssueReportGuidance } from "../reporting/alertIssueReportGuidance";

type CaptureSize = { width: number; height: number };

export const APP_MODAL_HOST_KEYS = {
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
} as const;

export function AppModalHost({
  isRegionPickerOpen,
  selectedSkill,
  selectedSkillRegion,
  isRuneRegionPickerOpen,
  runeRegion,
  isUltimaRaidEquipmentRegionPickerOpen,
  ultimaRaidEquipmentRegion,
  isHuntStallRegionPickerOpen,
  huntStallRegion,
  stream,
  captureSize,
  isGameViewportSetupOpen,
  gameViewport,
  gameViewportState,
  gameViewportVerification,
  isFeedbackOpen,
  isPrivacyOpen,
  isDonationOpen,
  isUsageGuideOpen,
  isResponsibilityNoticeOpen,
  isOnboardingOpen,
  isDiscordLaunchCampaignOpen,
  isRemoteRecognitionSetupOpen,
  hasExternalModalOpen,
  issueReportTarget,
  isIssueReportSubmitting,
  profile,
  runtimeStates,
  snapshots,
  runeSnapshot,
  ultimaRaidEquipmentRuntime,
  ultimaRaidEquipmentSnapshot,
  huntStallRuntime,
  huntStallSnapshot,
  buffExpiryRuntime,
  buffExpirySnapshot,
  boosterExpiryRuntime,
  boosterExpirySnapshot,
  specialCoreRuntime,
  specialCoreSnapshot,
  videoRef,
  currentLayoutKey,
  currentGameLayoutKey,
  precisionParserRuntime,
  onApplySkillRegion,
  onCloseSkillRegionPicker,
  onApplyRuneRegion,
  onCloseRuneRegionPicker,
  onApplyUltimaRaidEquipmentRegion,
  onCloseUltimaRaidEquipmentRegionPicker,
  onApplyHuntStallRegion,
  onCloseHuntStallRegionPicker,
  onApplyGameViewport,
  onCloseGameViewportSetup,
  onUseFullCaptureAsGameViewport,
  onRequestHuntStallGameViewportSetup,
  onCloseFeedback,
  onFeedbackSubmitted,
  onClosePrivacy,
  onCloseDonation,
  onCloseUsageGuide,
  onCloseIssueReport,
  onSubmitIssueReport,
  onConfirmResponsibilityNotice,
  onDismissResponsibilityNotice,
  onCloseOnboarding,
  onOpenGuideFromOnboarding,
  onDismissOnboarding,
  onDiscordLaunchCampaignVisible,
  onDismissDiscordLaunchCampaign,
  onOpenDiscordLaunchCampaign,
  remoteRecognitionSnapshot,
  remoteRecognitionReadiness,
  precisionParserInputTransport,
  precisionParserInputTransportDiagnostics,
  onStartRemoteRecognitionSetup,
  onStopRemoteRecognitionSession,
  onRemoteParserConsentChange,
  onVp8ParserPreviewChange,
  onCloseRemoteRecognitionSetup,
}: {
  isRegionPickerOpen: boolean;
  selectedSkill: SkillConfig | null;
  selectedSkillRegion: SkillConfig["region"];
  isRuneRegionPickerOpen: boolean;
  runeRegion: RuneAlertConfig["region"];
  isUltimaRaidEquipmentRegionPickerOpen: boolean;
  ultimaRaidEquipmentRegion: UltimaRaidEquipmentAlertConfig["region"];
  isHuntStallRegionPickerOpen: boolean;
  huntStallRegion: HuntStallAlertConfig["cooldownRegion"];
  stream: MediaStream | null;
  captureSize: CaptureSize | null;
  isGameViewportSetupOpen: boolean;
  gameViewport: ResolvedGameViewport | null;
  gameViewportState: GameViewportCalibrationState;
  gameViewportVerification: GameViewportVerificationStatus;
  isFeedbackOpen: boolean;
  isPrivacyOpen: boolean;
  isDonationOpen: boolean;
  isUsageGuideOpen: boolean;
  isResponsibilityNoticeOpen: boolean;
  isOnboardingOpen: boolean;
  isDiscordLaunchCampaignOpen: boolean;
  isRemoteRecognitionSetupOpen: boolean;
  hasExternalModalOpen: boolean;
  issueReportTarget: AlertIssueReportTarget | null;
  isIssueReportSubmitting: boolean;
  profile: Profile;
  runtimeStates: Record<string, SkillRuntimeState>;
  snapshots: Record<string, SkillSnapshot>;
  runeSnapshot: RuneSnapshot | null;
  ultimaRaidEquipmentRuntime?: UltimaRaidEquipmentRuntimeState;
  ultimaRaidEquipmentSnapshot?: UltimaRaidEquipmentSnapshot | null;
  huntStallRuntime: HuntStallRuntimeState;
  huntStallSnapshot: HuntStallSnapshot | null;
  buffExpiryRuntime: BuffExpiryRuntimeState;
  buffExpirySnapshot: BuffExpirySnapshot | null;
  boosterExpiryRuntime: BoosterExpiryRuntimeState;
  boosterExpirySnapshot: BoosterExpirySnapshot | null;
  specialCoreRuntime: SpecialCoreRuntimeState;
  specialCoreSnapshot: SpecialCoreSnapshot | null;
  videoRef: RefObject<HTMLVideoElement | null>;
  currentLayoutKey: string | null;
  currentGameLayoutKey?: string | null;
  precisionParserRuntime: PrecisionParserRuntimeReport;
  onApplySkillRegion: (region: NonNullable<SkillConfig["region"]>) => void;
  onCloseSkillRegionPicker: () => void;
  onApplyRuneRegion: (region: NonNullable<RuneAlertConfig["region"]>) => void;
  onCloseRuneRegionPicker: () => void;
  onApplyUltimaRaidEquipmentRegion: (
    region: NonNullable<UltimaRaidEquipmentAlertConfig["region"]>,
  ) => void;
  onCloseUltimaRaidEquipmentRegionPicker: () => void;
  onApplyHuntStallRegion: (region: NonNullable<HuntStallAlertConfig["cooldownRegion"]>) => void;
  onCloseHuntStallRegionPicker: () => void;
  onApplyGameViewport: (value: {
    gameResolution: PixelSize;
    region: RelativeRegion;
  }) => void;
  onCloseGameViewportSetup: () => void;
  onUseFullCaptureAsGameViewport: () => void;
  onRequestHuntStallGameViewportSetup: () => void;
  onCloseFeedback: () => void;
  onFeedbackSubmitted: (message: string) => void;
  onClosePrivacy: () => void;
  onCloseDonation: () => void;
  onCloseUsageGuide: () => void;
  onCloseIssueReport: () => void;
  onSubmitIssueReport: (issue: AlertIssueReportDetails) => Promise<boolean>;
  onConfirmResponsibilityNotice: () => void;
  onDismissResponsibilityNotice: () => void;
  onCloseOnboarding: () => void;
  onOpenGuideFromOnboarding: () => void;
  onDismissOnboarding: () => void;
  onDiscordLaunchCampaignVisible: () => void;
  onDismissDiscordLaunchCampaign: () => void;
  onOpenDiscordLaunchCampaign: () => void;
  remoteRecognitionSnapshot: RemoteRecognitionSessionSnapshot;
  remoteRecognitionReadiness: RemoteRecognitionFrameProbeReadiness;
  precisionParserInputTransport: PrecisionParserInputTransport;
  precisionParserInputTransportDiagnostics: PrecisionParserInputTransportDiagnostics;
  onStartRemoteRecognitionSetup: (
    accessCode: string,
    readinessConsentVersion: typeof REMOTE_RECOGNITION_READINESS_CONSENT_VERSION,
  ) => Promise<void>;
  onStopRemoteRecognitionSession: () => Promise<void>;
  onRemoteParserConsentChange: (consented: boolean) => void;
  onVp8ParserPreviewChange: (enabled: boolean) => void;
  onCloseRemoteRecognitionSetup: () => void;
}) {
  const huntStallMode = profile.huntStallAlert?.mode ?? "manual-experience";
  const isManualHuntExperiencePicker = huntStallMode === "manual-experience";
  const issueReportContext = issueReportTarget
    ? buildIssueReportContext({
        target: issueReportTarget,
        guidance: alertIssueReportGuidance,
        profile,
        runtimeStates,
        snapshots,
        runeSnapshot,
        ultimaRaidEquipmentRuntime,
        ultimaRaidEquipmentSnapshot,
        huntStallRuntime,
        huntStallSnapshot,
        buffExpiryRuntime,
        buffExpirySnapshot,
        boosterExpiryRuntime,
        boosterExpirySnapshot,
        specialCoreRuntime,
        specialCoreSnapshot,
        stream,
        captureSize,
        videoRef,
        captureLayoutKey: currentLayoutKey,
        gameLayoutKey: currentGameLayoutKey ?? currentLayoutKey,
        gameViewport,
        gameViewportState,
      })
    : null;
  const hasBlockingModalForDiscordCampaign = Boolean(
    hasExternalModalOpen ||
      isGameViewportSetupOpen ||
      isRegionPickerOpen ||
      isRuneRegionPickerOpen ||
      isUltimaRaidEquipmentRegionPickerOpen ||
      isHuntStallRegionPickerOpen ||
      isFeedbackOpen ||
      isPrivacyOpen ||
      isDonationOpen ||
      isUsageGuideOpen ||
      issueReportTarget ||
      isResponsibilityNoticeOpen ||
      isOnboardingOpen ||
      isRemoteRecognitionSetupOpen,
  );
  const hasBlockingModalForRemoteRecognition = Boolean(
    hasExternalModalOpen ||
      isGameViewportSetupOpen ||
      isRegionPickerOpen ||
      isRuneRegionPickerOpen ||
      isUltimaRaidEquipmentRegionPickerOpen ||
      isHuntStallRegionPickerOpen ||
      isFeedbackOpen ||
      isPrivacyOpen ||
      isDonationOpen ||
      isUsageGuideOpen ||
      issueReportTarget ||
      isResponsibilityNoticeOpen ||
      isOnboardingOpen,
  );

  return (
    <>
      <AnimatePresence>
        {isGameViewportSetupOpen && stream && captureSize && (
          <GameViewportSetupModal
            key={APP_MODAL_HOST_KEYS.gameViewportSetup}
            captureSize={captureSize}
            state={gameViewportState}
            verificationStatus={gameViewportVerification}
            stream={stream}
            onApply={onApplyGameViewport}
            onClose={onCloseGameViewportSetup}
            onUseFullCapture={onUseFullCaptureAsGameViewport}
          />
        )}

        {isRegionPickerOpen &&
          selectedSkill &&
          stream &&
          captureSize &&
          gameViewport && (
          <CropSelectionModal
            key={APP_MODAL_HOST_KEYS.skillRegionPicker}
            captureSize={captureSize}
            region={selectedSkillRegion}
            sourceRegion={
              gameViewport.mode === "calibrated"
                ? gameViewport.region
                : null
            }
            stream={stream}
            onApply={onApplySkillRegion}
            onClose={onCloseSkillRegionPicker}
          />
        )}

        {isRuneRegionPickerOpen && stream && captureSize && (
          <CropSelectionModal
            key={APP_MODAL_HOST_KEYS.runeRegionPicker}
            captureSize={captureSize}
            region={runeRegion}
            stream={stream}
            shape="rectangle"
            title="미니맵 영역 선택"
            eyebrow="Rune Alert"
            helpText="미니맵의 내부 지도 영역을 직사각형으로 선택하세요."
            helpTooltipText={null}
            selectGuideText="영역 선택: 미니맵 드래그"
            emptySelectText="미니맵 내부 지도 영역을 드래그해서 선택"
            helperTitle="미니맵 내부 지도 영역을 선택하세요"
            helperDescription="미니맵의 헤더, 버튼, 필터 창은 빼고 룬 아이콘이 표시되는 지도 영역만 잡으면 오탐이 줄어듭니다."
            helperVideoSrc="/media/rune-minimap-crop-guide.mp4"
            helperVideoLabel="미니맵 crop 예시 영상"
            helperMediaVariant="portrait"
            helperSteps={[
              "영역 선택을 누르고 미니맵 내부 지도만 드래그합니다.",
              "화면 위치가 안 맞으면 이동으로 맞춥니다.",
              "룬은 보라색 마름모 후보가 안정적으로 보일 때 알림됩니다.",
            ]}
            placementWarning={false}
            onApply={onApplyRuneRegion}
            onClose={onCloseRuneRegionPicker}
          />
        )}

        {isUltimaRaidEquipmentRegionPickerOpen && stream && captureSize && (
          <CropSelectionModal
            key={APP_MODAL_HOST_KEYS.ultimaRaidEquipmentRegionPicker}
            captureSize={captureSize}
            region={ultimaRaidEquipmentRegion}
            stream={stream}
            shape="rectangle"
            title="울티마 스쿼드 화면 영역 선택"
            eyebrow="장비 알림 영역"
            helpText="울티마 스쿼드 화면 전체를 선택하세요."
            helpTooltipText={null}
            selectGuideText="영역 선택: 울티마 스쿼드 화면 드래그"
            emptySelectText="울티마 스쿼드 화면 전체를 드래그해서 선택"
            helperTitle="울티마 스쿼드 화면 전체를 선택하세요"
            helperDescription="왼쪽 장비 가방의 수량 표시와 상단 가득 참 안내를 함께 확인해 알립니다."
            helperVideoSrc="/media/ultima-raid-equipment-crop-guide.mp4"
            helperVideoLabel="울티마 스쿼드 화면 영역 선택 예시 영상"
            helperSteps={[
              "영역 선택을 누르고 울티마 스쿼드 화면의 바깥 테두리를 따라 드래그합니다.",
              "왼쪽 장비 가방과 상단 안내 영역이 모두 들어왔는지 확인합니다.",
              "해상도가 달라도 화면 전체 비율이 유지되도록 선택합니다.",
            ]}
            placementWarning={false}
            onApply={onApplyUltimaRaidEquipmentRegion}
            onClose={onCloseUltimaRaidEquipmentRegionPicker}
          />
        )}

        {isHuntStallRegionPickerOpen &&
          stream &&
          captureSize &&
          gameViewport && (
          <CropSelectionModal
            key={APP_MODAL_HOST_KEYS.huntStallRegionPicker}
            captureSize={captureSize}
            region={huntStallRegion}
            sourceRegion={
              gameViewport.mode === "calibrated"
                ? gameViewport.region
                : null
            }
            stream={stream}
            shape={isManualHuntExperiencePicker ? "horizontal-band" : "square"}
            title={isManualHuntExperiencePicker ? "경험치바 높이 선택" : "쿨타임 숫자 영역 선택"}
            eyebrow="Hunt Stall Alert"
            helpText={
              isManualHuntExperiencePicker
                ? "경험치바의 윗선을 한 번 클릭하세요."
                : "동꼽 확인에 사용할 스킬 쿨타임 숫자 영역을 선택하세요."
            }
            helpTooltipText={
              isManualHuntExperiencePicker
                ? "화면 중하단만 확대해서 보여주며, 가로 위치는 경험치바 중앙 영역으로 고정됩니다."
                : "숫자가 뜨는 퀵슬롯 아이콘 하나만 잡으면 숫자가 사라졌을 때 멈춤 여부를 더 안정적으로 판단합니다."
            }
            selectGuideText={
              isManualHuntExperiencePicker
                ? "경험치바 윗선 클릭"
                : "영역 선택: 쿨타임 아이콘 드래그"
            }
            emptySelectText={
              isManualHuntExperiencePicker
                ? "경험치바 윗선을 클릭"
                : "쿨타임 숫자가 뜨는 아이콘을 드래그해서 선택"
            }
            helperTitle={
              isManualHuntExperiencePicker
                ? "경험치바 높이만 선택하세요"
                : "쿨타임 숫자가 뜨는 스킬 아이콘을 선택하세요"
            }
            helperDescription={
              isManualHuntExperiencePicker
                ? "마우스를 경험치바 윗선에 맞춰 클릭하면 중앙 경험치바 영역이 저장됩니다."
                : "7초 쿨 스킬처럼 반복해서 숫자가 떠야 정상인 아이콘 하나를 선택하면, 숫자가 일정 시간 사라졌을 때 알림을 울립니다."
            }
            helperVideoSrc={
              isManualHuntExperiencePicker
                ? "/media/manual-experience-band-guide.mp4"
                : "/media/quickslot-crop-guide.mp4"
            }
            helperVideoLabel={
              isManualHuntExperiencePicker
                ? "경험치바 높이 선택 예시 영상"
                : "퀵슬롯 crop 예시 영상"
            }
            helperMediaVariant="wide"
            helperSteps={
              isManualHuntExperiencePicker
                ? [
                    "화면 중하단에서 경험치바 위치를 확인합니다.",
                    "경험치바 윗선을 한 번 클릭합니다.",
                    "해상도가 바뀌면 현재 해상도에서 다시 선택합니다.",
                  ]
                : [
                    "쿨타임 숫자가 표시되는 아이콘 하나를 드래그합니다.",
                    "숫자와 아이콘이 함께 들어가되 옆 아이콘은 넘치지 않게 잡습니다.",
                    "화면 해상도가 바뀌면 현재 해상도에서 다시 선택합니다.",
                  ]
            }
            placementWarning={isManualHuntExperiencePicker ? false : "skill-quickslot"}
            validateRegion={
              isManualHuntExperiencePicker
                ? getManualExperienceRegionValidationError
                : undefined
            }
            validationActionLabel={
              isManualHuntExperiencePicker
                ? "게임 화면 맞추기"
                : undefined
            }
            onValidationAction={
              isManualHuntExperiencePicker
                ? onRequestHuntStallGameViewportSetup
                : undefined
            }
            onApply={onApplyHuntStallRegion}
            onClose={onCloseHuntStallRegionPicker}
          />
        )}

        {isFeedbackOpen && (
          <FeedbackModal
            key={APP_MODAL_HOST_KEYS.feedback}
            profile={profile}
            states={runtimeStates}
            snapshots={snapshots}
            runeSnapshot={runeSnapshot}
            huntStallState={huntStallRuntime}
            huntStallSnapshot={huntStallSnapshot}
            videoRef={videoRef}
            stream={stream}
            captureSize={captureSize}
            currentLayoutKey={currentLayoutKey}
            frameSourceContext={{
              captureLayoutKey: currentLayoutKey,
              gameLayoutKey: currentGameLayoutKey ?? currentLayoutKey,
              gameViewport,
              gameViewportState,
              gameViewportVerification,
            }}
            precisionParserRuntime={precisionParserRuntime}
            onClose={onCloseFeedback}
            onSubmitted={onFeedbackSubmitted}
          />
        )}

        {isPrivacyOpen && (
          <PrivacyNoticeModal key={APP_MODAL_HOST_KEYS.privacy} onClose={onClosePrivacy} />
        )}

        {isDonationOpen && (
          <DonationModal key={APP_MODAL_HOST_KEYS.donation} onClose={onCloseDonation} />
        )}

        {isUsageGuideOpen && (
          <UsageGuideModal key={APP_MODAL_HOST_KEYS.usageGuide} onClose={onCloseUsageGuide} />
        )}

        {issueReportTarget && (
          <AlertIssueReportDialog
            key={APP_MODAL_HOST_KEYS.issueReport}
            target={issueReportTarget}
            context={
              issueReportContext ??
              getFallbackIssueReportContext(issueReportTarget, alertIssueReportGuidance)
            }
            isSubmitting={isIssueReportSubmitting}
            onClose={onCloseIssueReport}
            onSubmit={onSubmitIssueReport}
          />
        )}

        {isResponsibilityNoticeOpen && (
          <ResponsibilityNoticeModal
            key={APP_MODAL_HOST_KEYS.responsibility}
            onConfirm={onConfirmResponsibilityNotice}
            onDismissPermanently={onDismissResponsibilityNotice}
          />
        )}

        {!isResponsibilityNoticeOpen && isOnboardingOpen && (
          <OnboardingModal
            key={APP_MODAL_HOST_KEYS.onboarding}
            onClose={onCloseOnboarding}
            onOpenGuide={onOpenGuideFromOnboarding}
            onDismissPermanently={() => {
              saveOnboardingDismissed(true);
              onDismissOnboarding();
            }}
          />
        )}

        {isDiscordLaunchCampaignOpen && !hasBlockingModalForDiscordCampaign && (
          <DiscordLaunchCampaignModal
            key={APP_MODAL_HOST_KEYS.discordLaunchCampaign}
            onVisible={onDiscordLaunchCampaignVisible}
            onDismiss={onDismissDiscordLaunchCampaign}
            onOpenDiscord={onOpenDiscordLaunchCampaign}
          />
        )}

        {isRemoteRecognitionSetupOpen &&
          !hasBlockingModalForRemoteRecognition && (
            <RemoteRecognitionSetupDialog
              key={APP_MODAL_HOST_KEYS.remoteRecognitionSetup}
              isOpen
              readiness={remoteRecognitionReadiness}
              snapshot={remoteRecognitionSnapshot}
              parserInputTransport={precisionParserInputTransport}
              parserInputTransportDiagnostics={
                precisionParserInputTransportDiagnostics
              }
              onStart={onStartRemoteRecognitionSetup}
              onStop={onStopRemoteRecognitionSession}
              onParserProviderConsentChange={onRemoteParserConsentChange}
              onVp8ParserPreviewChange={onVp8ParserPreviewChange}
              onClose={onCloseRemoteRecognitionSetup}
            />
          )}
      </AnimatePresence>
    </>
  );
}

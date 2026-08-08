import { Banner } from "@astryxdesign/core/Banner";
import { type ComponentProps, type MouseEvent, type ReactNode } from "react";
import { Bell, BellOff, Check, MonitorCog } from "lucide-react";
import { m as motion, useReducedMotion } from "motion/react";
import { GeneralTimerPanel } from "../../features/general-timer/GeneralTimerPanel";
import { InfoTooltip, TooltipHelpContent } from "../../shared/components/FloatingTooltip";
import { MasterVolumeControl } from "../../shared/components/MasterVolumeControl";
import { BoosterExpiryPanel } from "../../features/alerts/booster-expiry/BoosterExpiryPanel";
import { BuffExpiryPanel } from "../../features/alerts/buff-expiry/BuffExpiryPanel";
import { HuntStallPanel } from "../../features/alerts/hunt-stall/HuntStallPanel";
import { RuneAlertPanel } from "../../features/alerts/rune/RuneAlertPanel";
import { UltimaRaidEquipmentAlertPanel } from "../../features/alerts/ultima-raid-equipment/UltimaRaidEquipmentAlertPanel";
import { SpecialCorePanel } from "../../features/alerts/special-core/SpecialCorePanel";
import { SkillDashboard } from "../../features/alerts/skill/SkillDashboard";
import { PrecisionParserRequirementBanner } from "../../features/alerts/shared/PrecisionParserRequirementBanner";
import type { PrecisionParserReadiness } from "../../lib/buffSlotParser/precisionParserAvailability";
import type {
  PrecisionParserDiagnosticSubmissionResult,
} from "../../contracts/reporting/precisionParserDiagnosticFeedback";
import type { PrecisionParserCpuFallbackState } from "../../contracts/recognition/precisionParserRuntime";
import type { GameViewportVerificationStatus } from "../../contracts/geometry/frameSource";
import { getSkillBuffDurationTargetForSkill } from "../../lib/skillBuffDuration/skillBuffDurationTargets";
import { CollapsibleMonitoringSection } from "./CollapsibleMonitoringSection";
import { useMonitoringSectionCollapseController } from "./useMonitoringSectionCollapseController";

type SkillDashboardProps = ComponentProps<typeof SkillDashboard>;
type RuneAlertPanelProps = ComponentProps<typeof RuneAlertPanel>;
type UltimaRaidEquipmentAlertPanelProps = ComponentProps<
  typeof UltimaRaidEquipmentAlertPanel
>;
type HuntStallPanelProps = ComponentProps<typeof HuntStallPanel>;
type BuffExpiryPanelProps = ComponentProps<typeof BuffExpiryPanel>;
type SpecialCorePanelProps = ComponentProps<typeof SpecialCorePanel>;
type BoosterExpiryPanelProps = ComponentProps<typeof BoosterExpiryPanel>;
type GeneralTimerPanelProps = ComponentProps<typeof GeneralTimerPanel>;

export function MonitoringWorkspace({
  skillDashboardProps,
  runeAlertPanelProps,
  ultimaRaidEquipmentAlertPanelProps,
  huntStallPanelProps,
  buffExpiryPanelProps,
  specialCorePanelProps,
  boosterExpiryPanelProps,
  generalTimerPanelProps,
  isAllAlertsDisabled,
  onToggleAllAlertsDisabled,
  masterVolume,
  onMasterVolumeChange,
  onPreviewMasterVolume,
  onRequestScreenShareAttention,
  onOpenGameViewportSetup,
  onUseFullCaptureAsGameViewport,
  gameViewportVerification,
  precisionParserReadiness,
  precisionParserCpuFallback,
  onRetryPrecisionParser,
  onStartPrecisionParserCpuFallback,
  onCancelPrecisionParserCpuFallbackBenchmark,
  onStopPrecisionParserCpuFallback,
  onSubmitPrecisionParserDiagnostics,
  remoteRecognitionControl,
}: {
  skillDashboardProps: SkillDashboardProps;
  runeAlertPanelProps: RuneAlertPanelProps;
  ultimaRaidEquipmentAlertPanelProps: UltimaRaidEquipmentAlertPanelProps;
  huntStallPanelProps: HuntStallPanelProps;
  buffExpiryPanelProps: BuffExpiryPanelProps;
  specialCorePanelProps: SpecialCorePanelProps;
  boosterExpiryPanelProps: BoosterExpiryPanelProps;
  generalTimerPanelProps: GeneralTimerPanelProps;
  isAllAlertsDisabled: boolean;
  onToggleAllAlertsDisabled: (disabled: boolean) => void;
  masterVolume: number;
  onMasterVolumeChange: (volume: number) => void;
  onPreviewMasterVolume: () => void;
  onRequestScreenShareAttention?: () => void;
  onOpenGameViewportSetup?: () => void;
  onUseFullCaptureAsGameViewport?: () => void;
  gameViewportVerification: GameViewportVerificationStatus;
  precisionParserReadiness?: PrecisionParserReadiness;
  precisionParserCpuFallback?: PrecisionParserCpuFallbackState;
  onRetryPrecisionParser?: () => void;
  onStartPrecisionParserCpuFallback?: () => Promise<void>;
  onCancelPrecisionParserCpuFallbackBenchmark?: () => void;
  onStopPrecisionParserCpuFallback?: () => void;
  onSubmitPrecisionParserDiagnostics?: (
    readiness: Extract<PrecisionParserReadiness, { status: "unavailable" }>,
  ) => Promise<PrecisionParserDiagnosticSubmissionResult>;
  remoteRecognitionControl?: ReactNode;
}) {
  const { collapsedSections, toggleSection } = useMonitoringSectionCollapseController();
  const shouldReduceMotion = useReducedMotion();
  const hasStream =
    skillDashboardProps.hasStream ||
    runeAlertPanelProps.hasStream ||
    ultimaRaidEquipmentAlertPanelProps.hasStream ||
    huntStallPanelProps.hasStream ||
    buffExpiryPanelProps.hasStream ||
    specialCorePanelProps.hasStream ||
    boosterExpiryPanelProps.hasStream;
  const hasActiveAlerts =
    skillDashboardProps.skills.some((skill) => skill.enabled) ||
    runeAlertPanelProps.config.enabled ||
    ultimaRaidEquipmentAlertPanelProps.config.enabled ||
    ultimaRaidEquipmentAlertPanelProps.config.bossAlert.enabled ||
    huntStallPanelProps.config.enabled ||
    buffExpiryPanelProps.config.enabled ||
    specialCorePanelProps.config.enabled ||
    boosterExpiryPanelProps.config.enabled ||
    generalTimerPanelProps.timers.some((timer) => timer.enabled);
  const enabledSkillCount = skillDashboardProps.skills.filter((skill) => skill.enabled).length;
  const enabledGeneralTimerCount = generalTimerPanelProps.timers.filter(
    (timer) => timer.enabled,
  ).length;
  const hasActivePrecisionAlerts =
    buffExpiryPanelProps.config.enabled ||
    specialCorePanelProps.config.enabled ||
    skillDashboardProps.skills.some(
      (skill) => skill.enabled && getSkillBuffDurationTargetForSkill(skill) !== null,
    );
  const hasActiveGameViewportAlerts =
    skillDashboardProps.skills.some((skill) => skill.enabled) ||
    huntStallPanelProps.config.enabled ||
    buffExpiryPanelProps.config.enabled ||
    specialCorePanelProps.config.enabled ||
    boosterExpiryPanelProps.config.enabled;
  const isGameViewportUnavailable =
    skillDashboardProps.isGameViewportReady === false ||
    huntStallPanelProps.isGameViewportReady === false ||
    buffExpiryPanelProps.isGameViewportReady === false ||
    specialCorePanelProps.isGameViewportReady === false ||
    boosterExpiryPanelProps.isGameViewportReady === false;
  const needsGameViewportConfirmation =
    gameViewportVerification === "unverified" ||
    gameViewportVerification === "stale";
  const shouldShowGameViewportRequirement =
    hasStream &&
    hasActiveGameViewportAlerts &&
    isGameViewportUnavailable &&
    needsGameViewportConfirmation &&
    Boolean(onOpenGameViewportSetup);
  const isGameViewportStale = gameViewportVerification === "stale";
  const handlePanelClickCapture = (event: MouseEvent<HTMLElement>) => {
    if (hasStream || !onRequestScreenShareAttention || !(event.target instanceof Element)) {
      return;
    }

    if (event.target.closest(".no-stream, [data-screen-share-required='true']")) {
      onRequestScreenShareAttention();
    }
  };

  return (
    <section
      className="alerts-panel"
      aria-labelledby="alerts-panel-title"
      onClickCapture={handlePanelClickCapture}
    >
      <div className="panel-heading compact alerts-heading">
        <div>
          <div className="dashboard-title-row">
            <h2 id="alerts-panel-title">알림</h2>
            <InfoTooltip
              id="alerts-storage-tooltip"
              label="저장 방식 안내"
              displayLabel="저장 방식"
              className="dashboard-info-button named-info-tooltip"
              content={
                <TooltipHelpContent
                  title="설정은 이 브라우저에만 저장됩니다."
                  items={[
                    "로그인 없이 사용되며 서버에 저장되지 않습니다.",
                    "다른 기기나 다른 브라우저와 자동으로 공유되지 않습니다.",
                    "브라우저 데이터를 지우면 설정도 초기화될 수 있습니다.",
                  ]}
                />
              }
              width={390}
            />
          </div>
        </div>
        <div className="alerts-heading-actions">
          <MasterVolumeControl
            volume={masterVolume}
            onChange={onMasterVolumeChange}
            onPreview={onPreviewMasterVolume}
          />
          <label className="alerts-disable-all-toggle">
            <input
              type="checkbox"
              checked={isAllAlertsDisabled}
              disabled={!isAllAlertsDisabled && !hasActiveAlerts}
              onChange={(event) => onToggleAllAlertsDisabled(event.target.checked)}
            />
            <motion.span
              key={isAllAlertsDisabled ? "disabled" : "enabled"}
              className="alerts-disable-all-icon"
              aria-hidden="true"
              initial={shouldReduceMotion ? false : { opacity: 0, rotate: -8, scale: 0.88 }}
              animate={shouldReduceMotion ? undefined : { opacity: 1, rotate: 0, scale: 1 }}
              transition={shouldReduceMotion ? undefined : { duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
            >
              {isAllAlertsDisabled ? <BellOff size={16} /> : <Bell size={16} />}
            </motion.span>
            <span>전체 비활성화</span>
          </label>
        </div>
      </div>

      <div className="alerts-section-stack">
        {remoteRecognitionControl}
        {shouldShowGameViewportRequirement ? (
          <Banner
            className="game-viewport-requirement-banner"
            status="warning"
            title={
              isGameViewportStale
                ? "공유 화면 크기가 바뀌었습니다. 게임 화면을 다시 맞추거나 전체 화면 사용을 확인해주세요."
                : "일반적인 게임 화면 크기가 아닙니다. 확장 UI라면 ‘게임 화면 맞추기’를, 아니라면 ‘공유 화면 그대로 사용’을 눌러주세요."
            }
            container="card"
            endContent={
              <span className="game-viewport-requirement-actions">
                <button
                  className="game-viewport-action-button is-primary"
                  type="button"
                  onClick={onOpenGameViewportSetup}
                >
                  <MonitorCog size={15} aria-hidden="true" />
                  게임 화면 맞추기
                </button>
                {onUseFullCaptureAsGameViewport ? (
                  <button
                    className="game-viewport-action-button"
                    type="button"
                    onClick={onUseFullCaptureAsGameViewport}
                  >
                    <Check size={15} aria-hidden="true" />
                    공유 화면 그대로 사용
                  </button>
                ) : null}
              </span>
            }
          />
        ) : null}
        {hasActivePrecisionAlerts && precisionParserReadiness && onRetryPrecisionParser ? (
          <PrecisionParserRequirementBanner
            readiness={precisionParserReadiness}
            cpuFallback={precisionParserCpuFallback}
            onRetry={onRetryPrecisionParser}
            onStartCpuFallback={onStartPrecisionParserCpuFallback}
            onCancelCpuFallbackBenchmark={onCancelPrecisionParserCpuFallbackBenchmark}
            onStopCpuFallback={onStopPrecisionParserCpuFallback}
            onSubmitDiagnostics={onSubmitPrecisionParserDiagnostics}
          />
        ) : null}
        <CollapsibleMonitoringSection
          id="skills"
          title="스킬 알림"
          isEnabled={enabledSkillCount > 0}
          isCollapsed={collapsedSections.skills}
          onToggle={toggleSection}
          renderExpanded={(headerAction, isSectionCollapsed) => (
            <SkillDashboard
              {...skillDashboardProps}
              embedded
              headerAction={headerAction}
              isSectionCollapsed={isSectionCollapsed}
            />
          )}
        />
        <CollapsibleMonitoringSection
          id="rune"
          title="룬 알림"
          isEnabled={runeAlertPanelProps.config.enabled}
          isCollapsed={collapsedSections.rune}
          onToggle={toggleSection}
          renderExpanded={(headerAction, isSectionCollapsed) => (
            <RuneAlertPanel
              {...runeAlertPanelProps}
              embedded
              headerAction={headerAction}
              isSectionCollapsed={isSectionCollapsed}
            />
          )}
        />
        <CollapsibleMonitoringSection
          id="ultimaRaidEquipment"
          title="울티마 스쿼드 알림"
          isEnabled={
            ultimaRaidEquipmentAlertPanelProps.config.enabled ||
            ultimaRaidEquipmentAlertPanelProps.config.bossAlert.enabled
          }
          isCollapsed={collapsedSections.ultimaRaidEquipment}
          onToggle={toggleSection}
          renderExpanded={(headerAction, isSectionCollapsed) => (
            <UltimaRaidEquipmentAlertPanel
              {...ultimaRaidEquipmentAlertPanelProps}
              embedded
              headerAction={headerAction}
              isSectionCollapsed={isSectionCollapsed}
            />
          )}
        />
        <CollapsibleMonitoringSection
          id="hunt"
          title="사냥 멈춤 알림"
          isEnabled={huntStallPanelProps.config.enabled}
          isCollapsed={collapsedSections.hunt}
          onToggle={toggleSection}
          renderExpanded={(headerAction, isSectionCollapsed) => (
            <HuntStallPanel
              {...huntStallPanelProps}
              embedded
              headerAction={headerAction}
              isSectionCollapsed={isSectionCollapsed}
            />
          )}
        />
        <CollapsibleMonitoringSection
          id="buffExpiry"
          title="버프 종료 알림"
          isEnabled={buffExpiryPanelProps.config.enabled}
          isCollapsed={collapsedSections.buffExpiry}
          onToggle={toggleSection}
          renderExpanded={(headerAction, isSectionCollapsed) => (
            <BuffExpiryPanel
              {...buffExpiryPanelProps}
              embedded
              headerAction={headerAction}
              isSectionCollapsed={isSectionCollapsed}
            />
          )}
        />
        <CollapsibleMonitoringSection
          id="specialCore"
          title="특수 코어 알림"
          isEnabled={specialCorePanelProps.config.enabled}
          isCollapsed={collapsedSections.specialCore}
          onToggle={toggleSection}
          renderExpanded={(headerAction, isSectionCollapsed) => (
            <SpecialCorePanel
              {...specialCorePanelProps}
              embedded
              headerAction={headerAction}
              isSectionCollapsed={isSectionCollapsed}
            />
          )}
        />
        <CollapsibleMonitoringSection
          id="boosterExpiry"
          title="부스터 종료 알림"
          isEnabled={boosterExpiryPanelProps.config.enabled}
          isCollapsed={collapsedSections.boosterExpiry}
          onToggle={toggleSection}
          renderExpanded={(headerAction, isSectionCollapsed) => (
            <BoosterExpiryPanel
              {...boosterExpiryPanelProps}
              embedded
              headerAction={headerAction}
              isSectionCollapsed={isSectionCollapsed}
            />
          )}
        />
        <CollapsibleMonitoringSection
          id="timers"
          title="일반 타이머"
          isEnabled={enabledGeneralTimerCount > 0}
          isCollapsed={collapsedSections.timers}
          onToggle={toggleSection}
          renderExpanded={(headerAction, isSectionCollapsed) => (
            <GeneralTimerPanel
              {...generalTimerPanelProps}
              embedded
              headerAction={headerAction}
              isSectionCollapsed={isSectionCollapsed}
            />
          )}
        />
      </div>
    </section>
  );
}

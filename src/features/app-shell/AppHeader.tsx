import { Heart, HelpCircle, Mail, Music, Settings } from "lucide-react";
import { m as motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import type { HuntStallRuntimeState, RuneRuntimeState } from "../../alertTypes";
import type { BuffExpiryRuntimeState } from "../../lib/buffExpiry/buffExpiryTypes";
import type { CaptureSize } from "../../lib/gameResolutions";
import type { SpecialCoreRuntimeState } from "../../lib/specialCore/specialCoreAlertTypes";
import type {
  BuffExpiryAlertConfig,
  GeneralTimerConfig,
  HuntStallAlertConfig,
  PipTimerConfig,
  RuneAlertConfig,
  SkillConfig,
  SkillRuntimeState,
  SpecialCoreAlertConfig,
} from "../../types";
import { PipTimerControl } from "./pip/PipTimerControl";
import { SiteAlertCountBadge } from "./SiteAlertCountBadge";
import { useSiteAlertCount } from "./useSiteAlertCount";
import { getSubtlePressMotion } from "../../shared/motionPresets";

export function AppHeader({
  skills,
  states,
  runeAlert,
  runeRuntime,
  generalTimers,
  huntStallAlert,
  huntStallRuntime,
  buffExpiryAlert,
  buffExpiryRuntime,
  specialCoreAlert,
  specialCoreRuntime,
  pipTimer,
  screenShareControl,
  screenPreviewStream,
  screenPreviewSize,
  isAllAlertsDisabled,
  hasActiveAlerts,
  masterVolume,
  onPipTimerChange,
  onToggleAllAlertsDisabled,
  onMasterVolumeChange,
  onMessage,
  onOpenGuide,
  onOpenFeedback,
  onOpenDonation,
  onOpenCustomSounds,
  onOpenSettingsManager,
}: {
  skills: SkillConfig[];
  states: Record<string, SkillRuntimeState>;
  runeAlert: RuneAlertConfig;
  runeRuntime: RuneRuntimeState;
  generalTimers: GeneralTimerConfig[];
  huntStallAlert: HuntStallAlertConfig;
  huntStallRuntime: HuntStallRuntimeState;
  buffExpiryAlert: BuffExpiryAlertConfig;
  buffExpiryRuntime: BuffExpiryRuntimeState;
  specialCoreAlert: SpecialCoreAlertConfig;
  specialCoreRuntime: SpecialCoreRuntimeState;
  pipTimer: PipTimerConfig;
  screenShareControl: ReactNode;
  screenPreviewStream: MediaStream | null;
  screenPreviewSize: CaptureSize | null;
  isAllAlertsDisabled: boolean;
  hasActiveAlerts: boolean;
  masterVolume: number;
  onPipTimerChange: (patch: Partial<PipTimerConfig>) => void;
  onToggleAllAlertsDisabled: (disabled: boolean) => void;
  onMasterVolumeChange: (volume: number) => void;
  onMessage: (message: string) => void;
  onOpenGuide: () => void;
  onOpenFeedback: () => void;
  onOpenDonation: () => void;
  onOpenCustomSounds: () => void;
  onOpenSettingsManager: () => void;
}) {
  const siteAlertCount = useSiteAlertCount();
  const siteAlertCountSnapshot =
    siteAlertCount.status === "ready" ? siteAlertCount.snapshot : null;
  const shouldReduceMotion = useReducedMotion();
  const pressMotion = getSubtlePressMotion(Boolean(shouldReduceMotion));

  return (
    <header className="app-header">
      <div className="header-brand">
        <h1>메이플 타이머</h1>
      </div>
      <SiteAlertCountBadge className="header-alert-count" snapshot={siteAlertCountSnapshot} />
      <div className="header-actions">
        <motion.button
          className="header-ghost-button help-button"
          type="button"
          data-header-tooltip="Maple Timer 사용 방법 보기"
          onClick={onOpenGuide}
          {...pressMotion}
        >
          <HelpCircle size={15} />
          사용 가이드
        </motion.button>
        <PipTimerControl
          skills={skills}
          states={states}
          runeConfig={runeAlert}
          runeState={runeRuntime}
          generalTimers={generalTimers}
          huntStallConfig={huntStallAlert}
          huntStallState={huntStallRuntime}
          buffExpiryConfig={buffExpiryAlert}
          buffExpiryState={buffExpiryRuntime}
          specialCoreConfig={specialCoreAlert}
          specialCoreState={specialCoreRuntime}
          config={pipTimer}
          screenPreviewStream={screenPreviewStream}
          screenPreviewSize={screenPreviewSize}
          isAllAlertsDisabled={isAllAlertsDisabled}
          hasActiveAlerts={hasActiveAlerts}
          masterVolume={masterVolume}
          onConfigChange={onPipTimerChange}
          onToggleAllAlertsDisabled={onToggleAllAlertsDisabled}
          onMasterVolumeChange={onMasterVolumeChange}
          onMessage={onMessage}
        />
        <motion.button
          className="secondary-button custom-sounds-button"
          type="button"
          data-header-tooltip="사용자 알림음 추가, 삭제, 편집"
          onClick={onOpenCustomSounds}
          {...pressMotion}
        >
          <Music size={16} />
          내 알림음
        </motion.button>
        <motion.button
          className="header-ghost-button feedback-button"
          type="button"
          data-header-tooltip="문의 또는 피드백 보내기"
          onClick={onOpenFeedback}
          {...pressMotion}
        >
          <Mail size={15} />
          문의/피드백
        </motion.button>
        <motion.button
          className="header-ghost-button donation-button"
          type="button"
          data-header-tooltip="Maple Timer 운영 후원"
          onClick={onOpenDonation}
          {...pressMotion}
        >
          <Heart size={15} />
          후원
        </motion.button>
        <motion.button
          className="secondary-button settings-manager-button"
          type="button"
          data-header-tooltip="프리셋 저장, 설정 백업, 설정 초기화"
          data-header-tooltip-align="end"
          onClick={onOpenSettingsManager}
          {...pressMotion}
        >
          <Settings size={16} />
          프리셋/백업
        </motion.button>
      </div>
      <div className="header-theme-row">
        {screenShareControl}
      </div>
    </header>
  );
}

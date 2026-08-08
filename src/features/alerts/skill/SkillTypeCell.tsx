import { useEffect, useRef, useState } from "react";
import { usePopover } from "@astryxdesign/core/Popover";
import {
  buildSkillPresetPatch,
  getSkillPreset,
  inferSkillPresetId,
  isErdaFountainPresetId,
  isSolJanusPresetId,
} from "../../../lib/skillPresets";
import { getSkillBuffDurationTargetForPresetId } from "../../../lib/skillBuffDuration/skillBuffDurationTargets";
import type { SkillConfig, SkillDetectionSource } from "../../../types";
import { DeferredNumberInput } from "../../../shared/components/DeferredNumberInput";
import {
  InfoTooltip,
  TooltipHelpContent,
} from "../../../shared/components/FloatingTooltip";
import { MapleHoverCard } from "../../../shared/components/MapleHoverCard";
import { MotionSegmentedControl } from "../../../shared/components/MotionSegmentedControl";
import { SkillPresetPicker } from "./SkillPresetPicker";
import {
  stopRowClick,
  TIMER_VALUE_MAX_SECONDS,
  TIMER_VALUE_MIN_SECONDS,
} from "./skillDashboardUtils";

export function getSkillTypeCellState(skill: SkillConfig) {
  const presetId = inferSkillPresetId(skill);
  const preset = getSkillPreset(presetId);
  return {
    presetId,
    shouldShowDuration: preset.durationEditable,
    shouldShowErdaNotice: isErdaFountainPresetId(presetId),
  };
}

function ClassInstallHelpContent() {
  return (
    <div className="class-install-help-content">
      <strong>직업 설치기는 시간을 직접 맞춥니다.</strong>
      <div className="class-install-help-grid">
        <span>
          <em>지속</em>
          설치기가 유지되는 시간입니다.
        </span>
        <span>
          <em>쿨</em>
          퀵슬롯에 처음 보이는 실제 재사용 대기시간입니다. 쿨감이 적용되면 줄어든 숫자를 입력하세요.
        </span>
      </div>
      <div className="class-install-warning-item">
        <span>노란색 계열 스킬 아이콘은 쿨타임 숫자와 색이 겹쳐 인식이 불안정할 수 있습니다.</span>
        <div
          className="yellow-skill-example-list"
          aria-label="인식이 불안정할 수 있는 노란색 계열 스킬 아이콘 예시"
        >
          <span>주의 예시</span>
          <img src="/skill-icons/yellow-skill-warning-1.png" alt="" width="24" height="24" />
          <img src="/skill-icons/yellow-skill-warning-2.png" alt="" width="24" height="24" />
        </div>
      </div>
      <p>목록에 필요한 스킬이 없으면 문의/피드백으로 요청해 주세요. 확인 후 추가하겠습니다.</p>
    </div>
  );
}

function SkillDetectionSourceToggle({
  value,
  onChange,
}: {
  value: SkillDetectionSource;
  onChange: (value: SkillDetectionSource) => void;
}) {
  return (
    <span className="skill-detection-source-toggle-wrap" onClick={stopRowClick}>
      <MotionSegmentedControl
        ariaLabel="스킬 감지 방식"
        className="skill-detection-source-toggle"
        optionClassName="skill-detection-source-option"
        value={value}
        onChange={onChange}
        options={[
          { value: "quickslot", label: "퀵슬롯" },
          { value: "buff-duration", label: "버프칸" },
        ]}
      />
    </span>
  );
}

const BUFF_DURATION_GUIDE_COPY = {
  janus: {
    tooltipId: "janus-buff-duration-guide-tooltip",
    chipLabel: "야누스",
    ariaLabel: "야누스 버프칸 모드 설정 예시",
    title: "야누스 버프칸 모드 설정",
    description: "솔 야누스: 새벽의 남은 시간이 버프칸에 보이도록 인게임 설정을 맞춰주세요.",
    videoSrc: "/media/janus-buff-duration-settings-guide.mp4",
  },
  fountain: {
    tooltipId: "fountain-buff-duration-guide-tooltip",
    chipLabel: "파운틴",
    ariaLabel: "파운틴 버프칸 모드 설정 예시",
    title: "파운틴 버프칸 모드 설정",
    description: "에르다 파운틴의 남은 시간이 버프칸에 보이도록 인게임 설정을 맞춰주세요.",
    videoSrc: "/media/erda-fountain-buff-duration-settings-guide.mp4",
  },
  yein: {
    tooltipId: "maehwa-yein-buff-duration-guide-tooltip",
    chipLabel: "예인",
    ariaLabel: "예인 버프칸 모드 설정 예시",
    title: "예인 버프칸 모드 설정",
    description: "매화검 3초식 : 예인 VI를 버프 즐겨찾기에서 제외해 남은 횟수가 버프칸에 보이게 해주세요.",
    videoSrc: "/media/maehwa-yein-buff-duration-settings-guide.mp4",
  },
  hologram: {
    tooltipId: "hologram-buff-duration-guide-tooltip",
    chipLabel: "역장",
    ariaLabel: "역장 버프칸 모드 설정 예시",
    title: "역장 버프칸 모드 설정",
    description: "홀로그램 그래피티: 역장 VI를 버프 즐겨찾기에서 제외해 남은 시간이 버프칸에 보이게 해주세요.",
    videoSrc: "/media/janus-buff-duration-settings-guide.mp4",
  },
} as const;

function BuffDurationGuideTooltip({
  variant,
}: {
  variant: keyof typeof BUFF_DURATION_GUIDE_COPY;
}) {
  const copy = BUFF_DURATION_GUIDE_COPY[variant];

  return (
    <MapleHoverCard
      className="buff-duration-guide-hover-card"
      content={
        <div className="janus-buff-duration-guide-content">
          <strong>{copy.title}</strong>
          <p>{copy.description}</p>
          <video
            aria-label={copy.ariaLabel}
            autoPlay
            loop
            muted
            playsInline
            preload="metadata"
            src={copy.videoSrc}
          />
        </div>
      }
      width={440}
    >
      <button
        aria-label={copy.ariaLabel}
        className="janus-buff-duration-guide-chip"
        type="button"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        {copy.chipLabel}
      </button>
    </MapleHoverCard>
  );
}

export function SkillTypeCell({
  skill,
  presetId,
  shouldShowDuration,
  shouldShowErdaNotice,
  onChangeSkill,
}: {
  skill: SkillConfig;
  presetId: string;
  shouldShowDuration: boolean;
  shouldShowErdaNotice: boolean;
  onChangeSkill: (skillId: string, patch: Partial<SkillConfig>) => void;
}) {
  const classInstallPopover = usePopover({
    dialogLabel: "직업 설치기 시간 설정",
    hasAutoFocus: false,
    hasCloseButton: false,
    hasLightDismiss: true,
  });
  const {
    hide: hideClassInstallPopover,
    isOpen: isClassInstallPopoverOpen,
    render: renderClassInstallPopover,
    toggle: toggleClassInstallPopover,
    triggerProps: classInstallTriggerProps,
    triggerRef: classInstallTriggerRef,
  } = classInstallPopover;
  const classInstallEditorRef = useRef<HTMLDivElement | null>(null);
  const cooldownSeconds = skill.cooldownDurationSeconds ?? skill.durationSeconds;
  const detectionSource = skill.detectionSource ?? "quickslot";
  const buffDurationTarget = getSkillBuffDurationTargetForPresetId(presetId);
  const canToggleDetectionSource = Boolean(buffDurationTarget?.quickslotSupported);
  const isBuffDurationSelected =
    Boolean(buffDurationTarget) &&
    (!buffDurationTarget?.quickslotSupported || detectionSource === "buff-duration");
  const skillPresetLabelOverride =
    isBuffDurationSelected && buffDurationTarget
      ? buffDurationTarget.displayName
      : undefined;
  const shouldShowDeepV2FountainGuide =
    presetId === "erda-fountain-deep-v2" && isBuffDurationSelected;
  const shouldShowMaehwaYeinGuide = presetId === "maehwa-yein-vi" && isBuffDurationSelected;
  const shouldShowHologramGuide =
    presetId === "hologram-graffiti-barrier-vi" && isBuffDurationSelected;

  useEffect(() => {
    if (!shouldShowDuration) {
      hideClassInstallPopover();
    }
  }, [hideClassInstallPopover, shouldShowDuration]);

  useEffect(() => {
    if (!isClassInstallPopoverOpen) {
      return;
    }

    const handleDocumentClick = (event: MouseEvent) => {
      if (
        event.target instanceof Node &&
        classInstallEditorRef.current?.contains(event.target)
      ) {
        return;
      }
      hideClassInstallPopover();
    };

    document.addEventListener("click", handleDocumentClick);
    return () => {
      document.removeEventListener("click", handleDocumentClick);
    };
  }, [hideClassInstallPopover, isClassInstallPopoverOpen]);

  return (
    <div className="skill-cell skill-type-cell" role="cell">
      <div
        className={[
          "skill-type-inline-control",
          shouldShowDuration ? "has-class-install-summary" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <SkillPresetPicker
          value={presetId}
          selectedLabelOverride={skillPresetLabelOverride}
          onChange={(nextPresetId) =>
            onChangeSkill(skill.id, buildSkillPresetPatch(nextPresetId, skill))
          }
        />
        {canToggleDetectionSource && (
          <SkillDetectionSourceToggle
            value={detectionSource}
            onChange={(nextDetectionSource) =>
              onChangeSkill(skill.id, { detectionSource: nextDetectionSource })
            }
          />
        )}
        {isSolJanusPresetId(presetId) && isBuffDurationSelected && (
          <BuffDurationGuideTooltip variant="janus" />
        )}
        {shouldShowDeepV2FountainGuide && (
          <BuffDurationGuideTooltip variant="fountain" />
        )}
        {shouldShowMaehwaYeinGuide && (
          <BuffDurationGuideTooltip variant="yein" />
        )}
        {shouldShowHologramGuide && (
          <BuffDurationGuideTooltip variant="hologram" />
        )}
        {shouldShowDuration && (
          <div
            className="class-install-time-editor"
            onClick={stopRowClick}
            ref={classInstallEditorRef}
          >
            <button
              {...classInstallTriggerProps}
              className="class-install-time-button"
              ref={classInstallTriggerRef}
              type="button"
              onClick={toggleClassInstallPopover}
            >
              <span className="class-install-time-button-label">시간</span>
              <span className="class-install-time-button-values">
                <span>지속 {skill.durationSeconds}</span>
                <span>쿨 {cooldownSeconds}</span>
              </span>
            </button>
            {renderClassInstallPopover(
              isClassInstallPopoverOpen ? (
                <div className="class-install-time-popover">
                  <span className="duration-editor">
                    <span className="duration-field">
                      <span className="duration-label">지속</span>
                      <span
                        className="duration-input-wrap"
                        data-range-hint={`${TIMER_VALUE_MIN_SECONDS}-${TIMER_VALUE_MAX_SECONDS}초`}
                      >
                        <DeferredNumberInput
                          ariaLabel="설치기 지속시간"
                          className="duration-input"
                          min={TIMER_VALUE_MIN_SECONDS}
                          max={TIMER_VALUE_MAX_SECONDS}
                          value={skill.durationSeconds}
                          onCommit={(value) =>
                            onChangeSkill(skill.id, {
                              countdownSource: "cooldown",
                              durationSeconds: value,
                            })
                          }
                        />
                      </span>
                      <span className="duration-unit">초</span>
                    </span>
                    <span className="duration-field">
                      <span className="duration-label">쿨</span>
                      <span
                        className="duration-input-wrap"
                        data-range-hint={`${TIMER_VALUE_MIN_SECONDS}-${TIMER_VALUE_MAX_SECONDS}초`}
                      >
                        <DeferredNumberInput
                          ariaLabel="설치기 쿨타임"
                          className="duration-input"
                          min={TIMER_VALUE_MIN_SECONDS}
                          max={TIMER_VALUE_MAX_SECONDS}
                          value={cooldownSeconds}
                          onCommit={(value) =>
                            onChangeSkill(skill.id, {
                              countdownSource: "cooldown",
                              cooldownDurationSeconds: value,
                            })
                          }
                        />
                      </span>
                      <span className="duration-unit">초</span>
                    </span>
                  </span>
                  <ClassInstallHelpContent />
                </div>
              ) : null,
              { placement: "below", alignment: "center" },
            )}
          </div>
        )}
        {shouldShowErdaNotice && !shouldShowDeepV2FountainGuide && (
          <InfoTooltip
            id={`erda-fountain-tooltip-${skill.id}`}
            label="에르다 파운틴 안내"
            displayLabel="주의"
            className="column-info-button erda-fountain-info-button named-info-tooltip warning-info-tooltip"
            iconSize={14}
            content={
              isBuffDurationSelected ? (
                <TooltipHelpContent
                  title="버프칸의 파운틴 남은 시간을 읽습니다."
                  items={[
                    "우상단 버프칸에 보이는 에르다 파운틴 남은 시간을 기준으로 알림을 계산합니다.",
                    "파운틴 버프 아이콘과 남은 시간이 가려지지 않게 유지해 주세요.",
                    "감지가 불안정하면 감지 제보를 보내주세요.",
                  ]}
                />
              ) : (
                <TooltipHelpContent
                  title="에르다 파운틴은 재사용 방식이 다릅니다."
                  items={[
                    "위치 이동 재사용 시 쿨타임이 다시 돌지 않아 자동 갱신되지 않습니다.",
                    "쿨타임이 실제로 돌아온 뒤 새 숫자가 시작될 때 갱신됩니다.",
                    "메르 쿨감 적용 시 0초로 맞추거나, 늦게 울리려면 음수로 설정해 주세요.",
                  ]}
                />
              )
            }
            width={430}
          />
        )}
      </div>
    </div>
  );
}

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SkillSnapshot } from "../../../alertTypes";
import { DEFAULT_ALERT_SOUND_ID, DEFAULT_PICKER_ALERT_SOUNDS } from "../../../lib/sounds";
import {
  ALERT_THRESHOLD_MAX_SECONDS,
  ALERT_THRESHOLD_MIN_SECONDS,
  CLASS_INSTALL_ALERT_THRESHOLD_MIN_SECONDS,
  createRuntimeState,
} from "../../../lib/timer";
import {
  REMAINING_COUNT_ALERT_THRESHOLD_MAX,
  REMAINING_COUNT_ALERT_THRESHOLD_MIN,
} from "../../../lib/skillPresets";
import { resetVolumeBoostWarningForTests } from "../../../lib/volume";
import { dragSliderToValue, releaseSlider, setSliderValue } from "../../../test/slider";
import type { SkillConfig, SkillRuntimeState } from "../../../types";
import { getSkillRowVisualState, SkillDashboard } from "./SkillDashboard";
import { getSkillStatusView } from "./skillDashboardUtils";

function makeSkill(partial: Partial<SkillConfig> = {}): SkillConfig {
  return {
    id: partial.id ?? "skill-1",
    name: partial.name ?? "새 스킬",
    presetId: partial.presetId,
    detectionSource: partial.detectionSource ?? "quickslot",
    countdownSource: partial.countdownSource ?? "duration",
    durationSeconds: partial.durationSeconds ?? 60,
    alertThresholdSeconds: partial.alertThresholdSeconds ?? 5,
    recognitionStartSeconds: partial.recognitionStartSeconds ?? 60,
    region:
      "region" in partial
        ? partial.region ?? null
        : { x: 0.1, y: 0.1, width: 0.04, height: 0.04 },
    recognitionMode: partial.recognitionMode ?? "digit-template",
    soundId: partial.soundId ?? DEFAULT_ALERT_SOUND_ID,
    volume: partial.volume ?? 0.85,
    repeatAlertEnabled: partial.repeatAlertEnabled ?? false,
    repeatAlertIntervalSeconds: partial.repeatAlertIntervalSeconds ?? 3,
    cooldownDurationSeconds: partial.cooldownDurationSeconds,
    repeat: partial.repeat,
    regionsByLayout: partial.regionsByLayout,
    enabled: partial.enabled ?? true,
  };
}

function makeSnapshot(partial: Partial<SkillSnapshot> = {}): SkillSnapshot {
  return {
    result: partial.result ?? { value: 5, confidence: 0.9 },
    sampledAt: partial.sampledAt ?? Date.now(),
    rawPreviewUrl: partial.rawPreviewUrl ?? "data:image/png;base64,raw",
    previewUrl: partial.previewUrl ?? "data:image/png;base64,preview",
    regionLabel: partial.regionLabel ?? "40x40",
    buffDuration: partial.buffDuration,
  };
}

function chooseSkillPreset(label: string) {
  fireEvent.click(screen.getByRole("button", { name: "스킬" }));
  fireEvent.click(screen.getByRole("option", { name: label }));
}

function getAlertThresholdButtons() {
  return screen.getAllByRole("button", { name: /스킬 알림 시점/ });
}

function makeCountdown(totalSeconds: number, text = String(totalSeconds)) {
  return {
    kind: "exact" as const,
    text,
    totalSeconds,
    format: totalSeconds >= 60 ? "minutes-seconds" as const : "seconds" as const,
    textRegion: "center" as const,
    confidence: 0.94,
    status: "high" as const,
    routerTarget: "center",
    routerConfidence: 0.95,
    routerStatus: "high",
  };
}

function openAlertThresholdInput(index = 0) {
  fireEvent.click(getAlertThresholdButtons()[index]);
  return screen.getByLabelText("스킬 알림 시점");
}

function openRemainingCountAlertThresholdInput() {
  fireEvent.click(screen.getByRole("button", { name: /스킬 알림 회수/ }));
  return screen.getByLabelText("스킬 알림 회수");
}

function StatefulDashboard() {
  const [skills, setSkills] = useState([makeSkill({ id: "skill-1" })]);
  const [selectedSkillId, setSelectedSkillId] = useState("skill-1");
  const [expandedSkillIds, setExpandedSkillIds] = useState<string[]>([]);

  return (
    <SkillDashboard
      skills={skills}
      states={Object.fromEntries(skills.map((skill) => [skill.id, createRuntimeState(skill.id)]))}
      snapshots={{}}
      selectedSkillId={selectedSkillId}
      expandedSkillIds={expandedSkillIds}
      hasStream={false}
      canPickRegion={false}
      alertVolume={0.85}
      onSelectSkill={setSelectedSkillId}
      onToggleExpandedSkill={(skillId) =>
        setExpandedSkillIds((current) =>
          current.includes(skillId)
            ? current.filter((id) => id !== skillId)
            : [...current, skillId],
        )
      }
      onAddSkill={() => {
        const next = makeSkill({ id: "skill-2", alertThresholdSeconds: 8 });
        setSkills((current) => [...current, next]);
        setSelectedSkillId(next.id);
        setExpandedSkillIds((current) => [...current, next.id]);
      }}
      onChangeSkill={() => undefined}
      onAlertVolumeChange={() => undefined}
      onDeleteSkill={() => undefined}
      onOpenRegionPicker={() => undefined}
      onPreviewSound={() => undefined}
    />
  );
}

describe("SkillDashboard", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    resetVolumeBoostWarningForTests();
  });

  it("does not show the old standalone storage tooltip", () => {
    render(<StatefulDashboard />);

    expect(screen.queryByRole("button", { name: "저장 방식 안내" })).not.toBeInTheDocument();
  });

  it("adds a new row and expands it from the add row", async () => {
    render(<StatefulDashboard />);

    fireEvent.click(screen.getByRole("button", { name: "스킬 추가" }));

    const alertButtons = await screen.findAllByRole("button", { name: /스킬 알림 시점/ });
    expect(alertButtons[1]).toHaveTextContent("8초 전");
  });

  it("toggles the initial alert random delay from the panel header", () => {
    const onInitialAlertJitterEnabledChange = vi.fn();
    render(
      <SkillDashboard
        skills={[makeSkill({ id: "skill-1" })]}
        states={{ "skill-1": createRuntimeState("skill-1") }}
        snapshots={{}}
        selectedSkillId="skill-1"
        expandedSkillIds={[]}
        hasStream={false}
        canPickRegion={false}
        alertVolume={0.85}
        initialAlertJitterEnabled={false}
        onSelectSkill={() => undefined}
        onToggleExpandedSkill={() => undefined}
        onAddSkill={() => undefined}
        onInitialAlertJitterEnabledChange={onInitialAlertJitterEnabledChange}
        onChangeSkill={() => undefined}
        onAlertVolumeChange={() => undefined}
        onDeleteSkill={() => undefined}
        onOpenRegionPicker={() => undefined}
        onPreviewSound={() => undefined}
      />,
    );

    const toggle = screen.getByRole("button", { name: "최초 알림 랜덤 지연 켜기" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(toggle).not.toHaveAttribute("title");

    fireEvent.focus(toggle);

    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent("최초 알림에만 랜덤 지연을 더합니다.");
    expect(tooltip).toHaveTextContent("매 사이클 0~2초 사이에서 늦춰 울립니다.");
    expect(tooltip).toHaveTextContent("지연 시간은 0.5초 단위로 새로 정합니다.");
    expect(tooltip).toHaveTextContent("반복 알림에는 적용되지 않습니다.");

    fireEvent.click(toggle);

    expect(onInitialAlertJitterEnabledChange).toHaveBeenCalledWith(true);
  });

  it("shows the base countdown and sampled delay separately", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const skill = makeSkill({
      id: "skill-1",
      alertThresholdSeconds: 5,
    });
    const state = {
      ...createRuntimeState(skill.id),
      observedAt: 1_000,
      observedRemainingSeconds: 9,
      estimatedExpiresAt: 10_000,
      confidence: 0.95,
      status: "running",
      lastAlertCycleStartedAt: 1_000,
      initialAlertDelaySeconds: 1.5,
      initialAlertDelayCycleStartedAt: 1_000,
    } satisfies SkillRuntimeState;

    const { container } = render(
      <SkillDashboard
        skills={[skill]}
        states={{ [skill.id]: state }}
        snapshots={{}}
        selectedSkillId={skill.id}
        expandedSkillIds={[]}
        hasStream
        canPickRegion={false}
        alertVolume={0.85}
        initialAlertJitterEnabled
        onSelectSkill={() => undefined}
        onToggleExpandedSkill={() => undefined}
        onAddSkill={() => undefined}
        onInitialAlertJitterEnabledChange={() => undefined}
        onChangeSkill={() => undefined}
        onAlertVolumeChange={() => undefined}
        onDeleteSkill={() => undefined}
        onOpenRegionPicker={() => undefined}
        onPreviewSound={() => undefined}
      />,
    );

    expect(container.querySelector(".skill-alert-countdown-with-delay")?.textContent).toBe(
      "4초+1.5초",
    );
    expect(container.querySelector(".skill-alert-countdown-delay-value")?.textContent).toBe(
      "1.5초",
    );
  });

  it("shows an empty state row when there are no skill alerts", () => {
    const onAddSkill = vi.fn();
    render(
      <SkillDashboard
        skills={[]}
        states={{}}
        snapshots={{}}
        selectedSkillId=""
        expandedSkillIds={[]}
        hasStream={false}
        canPickRegion={false}
        alertVolume={0.85}
        onSelectSkill={() => undefined}
        onToggleExpandedSkill={() => undefined}
        onAddSkill={onAddSkill}
        onChangeSkill={() => undefined}
        onAlertVolumeChange={() => undefined}
        onDeleteSkill={() => undefined}
        onOpenRegionPicker={() => undefined}
        onPreviewSound={() => undefined}
      />,
    );

    expect(screen.queryByLabelText("스킬 알림 0개")).not.toBeInTheDocument();
    expect(screen.getByText("등록된 스킬 알림이 없습니다")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "빈 스킬 알림 추가" }));
    expect(onAddSkill).toHaveBeenCalledTimes(1);
  });

  it("toggles clicked rows without closing other expanded rows", async () => {
    const skills = [
      makeSkill({ id: "skill-1", alertThresholdSeconds: 5 }),
      makeSkill({ id: "skill-2", alertThresholdSeconds: 9 }),
    ];
    const states: Record<string, SkillRuntimeState> = Object.fromEntries(
      skills.map((skill) => [skill.id, createRuntimeState(skill.id)]),
    );
    const onSelectSkill = vi.fn();
    const onToggleExpandedSkill = vi.fn();
    const { container, rerender } = render(
      <SkillDashboard
        skills={skills}
        states={states}
        snapshots={{}}
        selectedSkillId="skill-1"
        expandedSkillIds={[]}
        hasStream={false}
        canPickRegion={false}
        alertVolume={0.85}
        onSelectSkill={onSelectSkill}
        onToggleExpandedSkill={onToggleExpandedSkill}
        onAddSkill={() => undefined}
        onChangeSkill={() => undefined}
        onAlertVolumeChange={() => undefined}
        onDeleteSkill={() => undefined}
        onOpenRegionPicker={() => undefined}
        onPreviewSound={() => undefined}
      />,
    );

    fireEvent.click(container.querySelectorAll(".dashboard-row")[0]);
    expect(onToggleExpandedSkill).toHaveBeenLastCalledWith("skill-1");

    rerender(
      <SkillDashboard
        skills={skills}
        states={states}
        snapshots={{}}
        selectedSkillId="skill-1"
        expandedSkillIds={["skill-1", "skill-2"]}
        hasStream={false}
        canPickRegion={false}
        alertVolume={0.85}
        onSelectSkill={onSelectSkill}
        onToggleExpandedSkill={onToggleExpandedSkill}
        onAddSkill={() => undefined}
        onChangeSkill={() => undefined}
        onAlertVolumeChange={() => undefined}
        onDeleteSkill={() => undefined}
        onOpenRegionPicker={() => undefined}
        onPreviewSound={() => undefined}
      />,
    );
    const alertButtons = await screen.findAllByRole("button", { name: /스킬 알림 시점/ });
    expect(alertButtons).toHaveLength(2);
    expect(alertButtons[0]).toHaveTextContent("5초 전");
    expect(alertButtons[1]).toHaveTextContent("9초 전");

    fireEvent.click(container.querySelectorAll(".dashboard-row")[1]);
    expect(onToggleExpandedSkill).toHaveBeenLastCalledWith("skill-2");
  });

  it("expands a row from empty space in the alert threshold column", () => {
    const skill = makeSkill({ id: "skill-1", alertThresholdSeconds: 10 });
    const onToggleExpandedSkill = vi.fn();
    const { container } = render(
      <SkillDashboard
        skills={[skill]}
        states={{ [skill.id]: createRuntimeState(skill.id) }}
        snapshots={{}}
        selectedSkillId="skill-1"
        expandedSkillIds={[]}
        hasStream={false}
        canPickRegion={false}
        alertVolume={0.85}
        onSelectSkill={() => undefined}
        onToggleExpandedSkill={onToggleExpandedSkill}
        onAddSkill={() => undefined}
        onChangeSkill={() => undefined}
        onAlertVolumeChange={() => undefined}
        onDeleteSkill={() => undefined}
        onOpenRegionPicker={() => undefined}
        onPreviewSound={() => undefined}
      />,
    );

    const thresholdCell = container.querySelector(".threshold-cell");
    expect(thresholdCell).not.toBeNull();

    fireEvent.click(thresholdCell as Element);
    expect(onToggleExpandedSkill).toHaveBeenCalledWith("skill-1");

    onToggleExpandedSkill.mockClear();
    fireEvent.click(screen.getByRole("button", { name: /스킬 알림 시점/ }));
    expect(onToggleExpandedSkill).not.toHaveBeenCalled();
  });

  it("exposes expand state through the chevron control and keyboard row toggle", () => {
    const skill = makeSkill({ id: "skill-1", presetId: "sol-janus-dawn-2min" });
    const onSelectSkill = vi.fn();
    const onToggleExpandedSkill = vi.fn();
    const { container, rerender } = render(
      <SkillDashboard
        skills={[skill]}
        states={{ [skill.id]: createRuntimeState(skill.id) }}
        snapshots={{}}
        selectedSkillId="skill-1"
        expandedSkillIds={[]}
        hasStream={false}
        canPickRegion={false}
        alertVolume={0.85}
        onSelectSkill={onSelectSkill}
        onToggleExpandedSkill={onToggleExpandedSkill}
        onAddSkill={() => undefined}
        onChangeSkill={() => undefined}
        onAlertVolumeChange={() => undefined}
        onDeleteSkill={() => undefined}
        onOpenRegionPicker={() => undefined}
        onPreviewSound={() => undefined}
      />,
    );

    const row = container.querySelector(".dashboard-row");
    expect(row).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: "설정 펼치기" })).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(screen.getByRole("button", { name: "설정 펼치기" }));
    expect(onSelectSkill).toHaveBeenCalledWith("skill-1");
    expect(onToggleExpandedSkill).toHaveBeenCalledTimes(1);

    rerender(
      <SkillDashboard
        skills={[skill]}
        states={{ [skill.id]: createRuntimeState(skill.id) }}
        snapshots={{}}
        selectedSkillId="skill-1"
        expandedSkillIds={["skill-1"]}
        hasStream={false}
        canPickRegion={false}
        alertVolume={0.85}
        onSelectSkill={onSelectSkill}
        onToggleExpandedSkill={onToggleExpandedSkill}
        onAddSkill={() => undefined}
        onChangeSkill={() => undefined}
        onAlertVolumeChange={() => undefined}
        onDeleteSkill={() => undefined}
        onOpenRegionPicker={() => undefined}
        onPreviewSound={() => undefined}
      />,
    );

    const expandedRow = container.querySelector(".dashboard-row");
    expect(expandedRow).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "설정 접기" })).toHaveAttribute("aria-expanded", "true");

    fireEvent.keyDown(expandedRow as Element, { key: "Enter" });
    expect(onToggleExpandedSkill).toHaveBeenCalledTimes(2);
  });

  it("edits repeat alert settings from the main skill row without expanding it", () => {
    const skill = makeSkill({ id: "skill-1" });
    const onChangeSkill = vi.fn();
    const onToggleExpandedSkill = vi.fn();
    const { rerender } = render(
      <SkillDashboard
        skills={[skill]}
        states={{ [skill.id]: createRuntimeState(skill.id) }}
        snapshots={{}}
        selectedSkillId="skill-1"
        expandedSkillIds={[]}
        hasStream={false}
        canPickRegion={false}
        alertVolume={0.85}
        onSelectSkill={() => undefined}
        onToggleExpandedSkill={onToggleExpandedSkill}
        onAddSkill={() => undefined}
        onChangeSkill={onChangeSkill}
        onAlertVolumeChange={() => undefined}
        onDeleteSkill={() => undefined}
        onOpenRegionPicker={() => undefined}
        onPreviewSound={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "반복 알림 간격" }));
    fireEvent.click(screen.getByRole("option", { name: "3초 간격" }));
    expect(onChangeSkill).toHaveBeenCalledWith("skill-1", {
      repeatAlertEnabled: true,
      repeatAlertIntervalSeconds: 3,
      repeatAlertMaxCount: 3,
    });
    expect(onToggleExpandedSkill).not.toHaveBeenCalled();

    onChangeSkill.mockClear();
    rerender(
      <SkillDashboard
        skills={[{ ...skill, repeatAlertEnabled: true }]}
        states={{ [skill.id]: createRuntimeState(skill.id) }}
        snapshots={{}}
        selectedSkillId="skill-1"
        expandedSkillIds={[]}
        hasStream={false}
        canPickRegion={false}
        alertVolume={0.85}
        onSelectSkill={() => undefined}
        onToggleExpandedSkill={onToggleExpandedSkill}
        onAddSkill={() => undefined}
        onChangeSkill={onChangeSkill}
        onAlertVolumeChange={() => undefined}
        onDeleteSkill={() => undefined}
        onOpenRegionPicker={() => undefined}
        onPreviewSound={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "반복 알림 간격" }));
    fireEvent.click(screen.getByRole("option", { name: "5초 간격" }));
    expect(onChangeSkill).toHaveBeenCalledWith("skill-1", {
      repeatAlertEnabled: true,
      repeatAlertIntervalSeconds: 5,
      repeatAlertMaxCount: null,
    });
    expect(onToggleExpandedSkill).not.toHaveBeenCalled();

    onChangeSkill.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "반복 알림 간격" }));
    fireEvent.click(screen.getByRole("option", { name: "2회 반복" }));
    expect(onChangeSkill).toHaveBeenCalledWith("skill-1", {
      repeatAlertEnabled: true,
      repeatAlertIntervalSeconds: 3,
      repeatAlertMaxCount: 2,
    });
    expect(onToggleExpandedSkill).not.toHaveBeenCalled();

    onChangeSkill.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "반복 알림 간격" }));
    fireEvent.click(screen.getByRole("option", { name: "사용 안 함" }));
    expect(onChangeSkill).toHaveBeenCalledWith("skill-1", {
      repeatAlertEnabled: false,
    });
  });

  it("opens the region picker from an empty crop placeholder when capture is ready", () => {
    const skill = makeSkill({ id: "skill-1", region: null });
    const onSelectSkill = vi.fn();
    const onToggleExpandedSkill = vi.fn();
    const onOpenRegionPicker = vi.fn();
    render(
      <SkillDashboard
        skills={[skill]}
        states={{ [skill.id]: createRuntimeState(skill.id) }}
        snapshots={{}}
        selectedSkillId=""
        expandedSkillIds={[]}
        hasStream
        canPickRegion
        alertVolume={0.85}
        onSelectSkill={onSelectSkill}
        onToggleExpandedSkill={onToggleExpandedSkill}
        onAddSkill={() => undefined}
        onChangeSkill={() => undefined}
        onAlertVolumeChange={() => undefined}
        onDeleteSkill={() => undefined}
        onOpenRegionPicker={onOpenRegionPicker}
        onPreviewSound={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "스킬 영역 선택" }));

    expect(onSelectSkill).toHaveBeenCalledWith("skill-1");
    expect(onToggleExpandedSkill).toHaveBeenCalledWith("skill-1");
    expect(onOpenRegionPicker).toHaveBeenCalledWith("skill-1");
  });

  it("does not render disabled precision skills as missing region actions", () => {
    const skill = makeSkill({
      id: "skill-1",
      enabled: false,
      presetId: "erda-fountain-deep-v2",
      region: null,
    });

    render(
      <SkillDashboard
        skills={[skill]}
        states={{ [skill.id]: createRuntimeState(skill.id) }}
        snapshots={{}}
        selectedSkillId=""
        expandedSkillIds={[]}
        hasStream
        canPickRegion
        alertVolume={0.85}
        onSelectSkill={() => undefined}
        onToggleExpandedSkill={() => undefined}
        onAddSkill={() => undefined}
        onChangeSkill={() => undefined}
        onAlertVolumeChange={() => undefined}
        onDeleteSkill={() => undefined}
        onOpenRegionPicker={() => undefined}
        onPreviewSound={() => undefined}
      />,
    );

    expect(screen.queryByRole("button", { name: "중지" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "스킬 영역 선택" })).not.toBeInTheDocument();
    const precisionStopText = screen
      .getAllByText("중지")
      .find((element) => element.closest(".skill-buff-duration-description"));
    const precisionStopContainer = precisionStopText?.closest(".skill-buff-duration-description");
    expect(precisionStopContainer).toBeDefined();
    expect(precisionStopContainer).not.toHaveClass("crop-placeholder");
  });

  it("does not show the legacy buff-slot source toggle for fixed Sol Janus skills", () => {
    const skill = makeSkill({ id: "skill-1", presetId: "sol-janus-dawn-2min" });
    const onChangeSkill = vi.fn();
    render(
      <SkillDashboard
        skills={[skill]}
        states={{ [skill.id]: createRuntimeState(skill.id) }}
        snapshots={{}}
        selectedSkillId="skill-1"
        expandedSkillIds={[]}
        hasStream
        canPickRegion
        alertVolume={0.85}
        onSelectSkill={() => undefined}
        onToggleExpandedSkill={() => undefined}
        onAddSkill={() => undefined}
        onChangeSkill={onChangeSkill}
        onAlertVolumeChange={() => undefined}
        onDeleteSkill={() => undefined}
        onOpenRegionPicker={() => undefined}
        onPreviewSound={() => undefined}
      />,
    );

    expect(screen.queryByRole("group", { name: "스킬 감지 방식" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "퀵슬롯" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "버프칸" })).not.toBeInTheDocument();
    expect(onChangeSkill).not.toHaveBeenCalled();
  });

  it("shows the Janus guide tooltip only in buff slot detection mode", () => {
    const quickslotSkill = makeSkill({
      id: "skill-1",
      presetId: "sol-janus-dawn-2min",
      detectionSource: "quickslot",
    });
    const { rerender } = render(
      <SkillDashboard
        skills={[quickslotSkill]}
        states={{ [quickslotSkill.id]: createRuntimeState(quickslotSkill.id) }}
        snapshots={{}}
        selectedSkillId="skill-1"
        expandedSkillIds={[]}
        hasStream
        canPickRegion
        alertVolume={0.85}
        onSelectSkill={() => undefined}
        onToggleExpandedSkill={() => undefined}
        onAddSkill={() => undefined}
        onChangeSkill={() => undefined}
        onAlertVolumeChange={() => undefined}
        onDeleteSkill={() => undefined}
        onOpenRegionPicker={() => undefined}
        onPreviewSound={() => undefined}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "야누스 버프칸 모드 설정 예시" }),
    ).not.toBeInTheDocument();

    const buffDurationSkill = {
      ...quickslotSkill,
      presetId: "sol-janus-dawn-deep-v2" as const,
      detectionSource: "buff-duration" as const,
    };
    rerender(
      <SkillDashboard
        skills={[buffDurationSkill]}
        states={{ [buffDurationSkill.id]: createRuntimeState(buffDurationSkill.id) }}
        snapshots={{}}
        selectedSkillId="skill-1"
        expandedSkillIds={[]}
        hasStream
        canPickRegion
        alertVolume={0.85}
        onSelectSkill={() => undefined}
        onToggleExpandedSkill={() => undefined}
        onAddSkill={() => undefined}
        onChangeSkill={() => undefined}
        onAlertVolumeChange={() => undefined}
        onDeleteSkill={() => undefined}
        onOpenRegionPicker={() => undefined}
        onPreviewSound={() => undefined}
      />,
    );

    const guideButton = screen.getByRole("button", {
      name: "야누스 버프칸 모드 설정 예시",
    });
    expect(guideButton).toHaveTextContent("야누스");

    fireEvent.mouseEnter(guideButton);

    const hoverCard = screen.getByText("야누스 버프칸 모드 설정").closest(".maple-hover-card");
    expect(hoverCard).not.toBeNull();
    expect(within(hoverCard as HTMLElement).getByLabelText("야누스 버프칸 모드 설정 예시")).toHaveAttribute(
      "src",
      "/media/janus-buff-duration-settings-guide.mp4",
    );
  });

  it("renders the deep-v2 Sol Janus preset as a buff-slot only skill", () => {
    const skill = makeSkill({
      id: "skill-1",
      presetId: "sol-janus-dawn-deep-v2",
      detectionSource: "buff-duration",
      name: "솔 야누스 : 새벽",
      region: null,
    });
    render(
      <SkillDashboard
        skills={[skill]}
        states={{ [skill.id]: createRuntimeState(skill.id) }}
        snapshots={{}}
        selectedSkillId="skill-1"
        expandedSkillIds={[]}
        hasStream
        canPickRegion
        alertVolume={0.85}
        onSelectSkill={() => undefined}
        onToggleExpandedSkill={() => undefined}
        onAddSkill={() => undefined}
        onChangeSkill={() => undefined}
        onAlertVolumeChange={() => undefined}
        onDeleteSkill={() => undefined}
        onOpenRegionPicker={() => undefined}
        onPreviewSound={() => undefined}
      />,
    );

    expect(screen.getByRole("button", { name: "스킬" })).toHaveTextContent(
      "솔 야누스 : 새벽 (정밀)",
    );
    expect(screen.queryByRole("button", { name: "퀵슬롯" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "버프칸" })).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "야누스 버프칸 모드 설정 예시" }),
    ).toBeInTheDocument();
  });

  it("renders the deep-v2 Erda Fountain preset as a buff-slot only skill", () => {
    const skill = makeSkill({
      id: "skill-1",
      presetId: "erda-fountain-deep-v2",
      detectionSource: "buff-duration",
      name: "에르다 파운틴",
      region: null,
    });
    render(
      <SkillDashboard
        skills={[skill]}
        states={{ [skill.id]: createRuntimeState(skill.id) }}
        snapshots={{}}
        selectedSkillId="skill-1"
        expandedSkillIds={[]}
        hasStream
        canPickRegion
        alertVolume={0.85}
        onSelectSkill={() => undefined}
        onToggleExpandedSkill={() => undefined}
        onAddSkill={() => undefined}
        onChangeSkill={() => undefined}
        onAlertVolumeChange={() => undefined}
        onDeleteSkill={() => undefined}
        onOpenRegionPicker={() => undefined}
        onPreviewSound={() => undefined}
      />,
    );

    expect(screen.getByRole("button", { name: "스킬" })).toHaveTextContent(
      "에르다 파운틴 (정밀)",
    );
    expect(screen.queryByRole("button", { name: "퀵슬롯" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "버프칸" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "에르다 파운틴 안내" })).not.toBeInTheDocument();
    const guideButton = screen.getByRole("button", { name: "파운틴 버프칸 모드 설정 예시" });
    expect(guideButton).toHaveTextContent("파운틴");
    expect(
      screen.queryByRole("button", { name: "야누스 버프칸 모드 설정 예시" }),
    ).not.toBeInTheDocument();

    fireEvent.mouseEnter(guideButton);

    const hoverCard = screen.getByText("파운틴 버프칸 모드 설정").closest(".maple-hover-card");
    expect(hoverCard).not.toBeNull();
    expect(hoverCard).toHaveTextContent("에르다 파운틴의 남은 시간");
    expect(within(hoverCard as HTMLElement).getByLabelText("파운틴 버프칸 모드 설정 예시")).toHaveAttribute(
      "src",
      "/media/erda-fountain-buff-duration-settings-guide.mp4",
    );
  });

  it("renders the Maehwa Yein preset with its buff-slot guide chip", () => {
    const skill = makeSkill({
      id: "skill-1",
      presetId: "maehwa-yein-vi",
      detectionSource: "buff-duration",
      name: "매화검 3초식 : 예인 VI",
      region: null,
    });
    render(
      <SkillDashboard
        skills={[skill]}
        states={{ [skill.id]: createRuntimeState(skill.id) }}
        snapshots={{}}
        selectedSkillId="skill-1"
        expandedSkillIds={[]}
        hasStream
        canPickRegion
        alertVolume={0.85}
        onSelectSkill={() => undefined}
        onToggleExpandedSkill={() => undefined}
        onAddSkill={() => undefined}
        onChangeSkill={() => undefined}
        onAlertVolumeChange={() => undefined}
        onDeleteSkill={() => undefined}
        onOpenRegionPicker={() => undefined}
        onPreviewSound={() => undefined}
      />,
    );

    expect(screen.getByRole("button", { name: "스킬" })).toHaveTextContent(
      "매화검 3초식 : 예인 VI",
    );
    const guideButton = screen.getByRole("button", { name: "예인 버프칸 모드 설정 예시" });
    expect(guideButton).toHaveTextContent("예인");

    fireEvent.mouseEnter(guideButton);

    const hoverCard = screen.getByText("예인 버프칸 모드 설정").closest(".maple-hover-card");
    expect(hoverCard).not.toBeNull();
    expect(hoverCard).toHaveTextContent("버프 즐겨찾기에서 제외");
    expect(within(hoverCard as HTMLElement).getByLabelText("예인 버프칸 모드 설정 예시")).toHaveAttribute(
      "src",
      "/media/maehwa-yein-buff-duration-settings-guide.mp4",
    );
  });

  it("shows the realtime update chip only when a buff-slot skill exists", () => {
    const quickslotSkill = makeSkill({
      id: "skill-1",
      presetId: "sol-janus-dawn-2min",
      detectionSource: "quickslot",
    });
    const { rerender } = render(
      <SkillDashboard
        skills={[quickslotSkill]}
        states={{ [quickslotSkill.id]: createRuntimeState(quickslotSkill.id) }}
        snapshots={{}}
        selectedSkillId="skill-1"
        expandedSkillIds={[]}
        hasStream
        canPickRegion
        alertVolume={0.85}
        onSelectSkill={() => undefined}
        onToggleExpandedSkill={() => undefined}
        onAddSkill={() => undefined}
        onChangeSkill={() => undefined}
        onAlertVolumeChange={() => undefined}
        onDeleteSkill={() => undefined}
        onOpenRegionPicker={() => undefined}
        onPreviewSound={() => undefined}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "버프칸 스킬 감지 업데이트 안내" }),
    ).not.toBeInTheDocument();

    const buffDurationSkill = makeSkill({
      ...quickslotSkill,
      presetId: "hologram-graffiti-barrier-vi",
      detectionSource: "buff-duration",
    });
    rerender(
      <SkillDashboard
        skills={[buffDurationSkill]}
        states={{ [buffDurationSkill.id]: createRuntimeState(buffDurationSkill.id) }}
        snapshots={{}}
        selectedSkillId="skill-1"
        expandedSkillIds={[]}
        hasStream
        canPickRegion
        alertVolume={0.85}
        onSelectSkill={() => undefined}
        onToggleExpandedSkill={() => undefined}
        onAddSkill={() => undefined}
        onChangeSkill={() => undefined}
        onAlertVolumeChange={() => undefined}
        onDeleteSkill={() => undefined}
        onOpenRegionPicker={() => undefined}
        onPreviewSound={() => undefined}
      />,
    );

    const updateChip = screen.getByRole("button", {
      name: "버프칸 스킬 감지 업데이트 안내",
    });
    expect(updateChip).toHaveTextContent("실시간 업데이트 중");

    fireEvent.mouseEnter(updateChip);

    const hoverCard = screen.getByText("버프칸 스킬 감지는 계속 업데이트 중입니다.").closest(".maple-hover-card");
    expect(hoverCard).not.toBeNull();
    expect(hoverCard).toHaveTextContent("지원 스킬이 감지되지 않거나 잘못 잡히면 제보하기를 보내주세요.");
    expect(hoverCard).toHaveTextContent("최근 업데이트 : 6월 28일 17:02");
  });

  it("shows Sol Janus without duration only for the precision buff-slot preset", () => {
    const quickslotSkill = makeSkill({
      id: "skill-1",
      presetId: "sol-janus-dawn-80s",
      detectionSource: "quickslot",
    });
    const { rerender } = render(
      <SkillDashboard
        skills={[quickslotSkill]}
        states={{ [quickslotSkill.id]: createRuntimeState(quickslotSkill.id) }}
        snapshots={{}}
        selectedSkillId="skill-1"
        expandedSkillIds={[]}
        hasStream
        canPickRegion
        alertVolume={0.85}
        onSelectSkill={() => undefined}
        onToggleExpandedSkill={() => undefined}
        onAddSkill={() => undefined}
        onChangeSkill={() => undefined}
        onAlertVolumeChange={() => undefined}
        onDeleteSkill={() => undefined}
        onOpenRegionPicker={() => undefined}
        onPreviewSound={() => undefined}
      />,
    );

    expect(screen.getByRole("button", { name: "스킬" })).toHaveTextContent(
      "솔 야누스 : 새벽 (80초)",
    );

    const buffDurationSkill = {
      ...quickslotSkill,
      presetId: "sol-janus-dawn-deep-v2" as const,
      detectionSource: "buff-duration" as const,
    };
    rerender(
      <SkillDashboard
        skills={[buffDurationSkill]}
        states={{ [buffDurationSkill.id]: createRuntimeState(buffDurationSkill.id) }}
        snapshots={{}}
        selectedSkillId="skill-1"
        expandedSkillIds={[]}
        hasStream
        canPickRegion
        alertVolume={0.85}
        onSelectSkill={() => undefined}
        onToggleExpandedSkill={() => undefined}
        onAddSkill={() => undefined}
        onChangeSkill={() => undefined}
        onAlertVolumeChange={() => undefined}
        onDeleteSkill={() => undefined}
        onOpenRegionPicker={() => undefined}
        onPreviewSound={() => undefined}
      />,
    );

    expect(screen.getByRole("button", { name: "스킬" })).toHaveTextContent("솔 야누스 : 새벽");
    expect(screen.getByRole("button", { name: "스킬" })).not.toHaveTextContent("80초");

    rerender(
      <SkillDashboard
        skills={[quickslotSkill]}
        states={{ [quickslotSkill.id]: createRuntimeState(quickslotSkill.id) }}
        snapshots={{}}
        selectedSkillId="skill-1"
        expandedSkillIds={[]}
        hasStream
        canPickRegion
        alertVolume={0.85}
        onSelectSkill={() => undefined}
        onToggleExpandedSkill={() => undefined}
        onAddSkill={() => undefined}
        onChangeSkill={() => undefined}
        onAlertVolumeChange={() => undefined}
        onDeleteSkill={() => undefined}
        onOpenRegionPicker={() => undefined}
        onPreviewSound={() => undefined}
      />,
    );

    expect(screen.getByRole("button", { name: "스킬" })).toHaveTextContent(
      "솔 야누스 : 새벽 (80초)",
    );
  });

  it("does not show the legacy buff-slot source toggle for Erda Fountain quickslot skills", () => {
    const skill = makeSkill({ id: "skill-1", presetId: "erda-fountain" });
    const onChangeSkill = vi.fn();
    render(
      <SkillDashboard
        skills={[skill]}
        states={{ [skill.id]: createRuntimeState(skill.id) }}
        snapshots={{}}
        selectedSkillId="skill-1"
        expandedSkillIds={[]}
        hasStream
        canPickRegion
        alertVolume={0.85}
        onSelectSkill={() => undefined}
        onToggleExpandedSkill={() => undefined}
        onAddSkill={() => undefined}
        onChangeSkill={onChangeSkill}
        onAlertVolumeChange={() => undefined}
        onDeleteSkill={() => undefined}
        onOpenRegionPicker={() => undefined}
        onPreviewSound={() => undefined}
      />,
    );

    expect(screen.queryByRole("group", { name: "스킬 감지 방식" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "퀵슬롯" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "버프칸" })).not.toBeInTheDocument();
    expect(onChangeSkill).not.toHaveBeenCalled();
  });

  it("shows Hologram Graffiti as a buff-slot-only skill without the source toggle", () => {
    const skill = makeSkill({
      id: "skill-1",
      presetId: "hologram-graffiti-barrier-vi",
      detectionSource: "buff-duration",
      region: null,
    });
    render(
      <SkillDashboard
        skills={[skill]}
        states={{ [skill.id]: createRuntimeState(skill.id) }}
        snapshots={{}}
        selectedSkillId="skill-1"
        expandedSkillIds={["skill-1"]}
        hasStream
        canPickRegion
        alertVolume={0.85}
        onSelectSkill={() => undefined}
        onToggleExpandedSkill={() => undefined}
        onAddSkill={() => undefined}
        onChangeSkill={() => undefined}
        onAlertVolumeChange={() => undefined}
        onDeleteSkill={() => undefined}
        onOpenRegionPicker={() => undefined}
        onPreviewSound={() => undefined}
      />,
    );

    expect(screen.getByRole("button", { name: "스킬" })).toHaveTextContent(
      "홀로그램 그래피티: 역장 VI",
    );
    expect(screen.queryByRole("group", { name: "스킬 감지 방식" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "영역 선택" })).not.toBeInTheDocument();
    const guideButton = screen.getByRole("button", { name: "역장 버프칸 모드 설정 예시" });
    expect(guideButton).toHaveTextContent("역장");
    expect(screen.getByRole("status", { name: "모듈 로딩 중" })).toBeInTheDocument();

    fireEvent.mouseEnter(guideButton);

    const hoverCard = screen.getByText("역장 버프칸 모드 설정").closest(".maple-hover-card");
    expect(hoverCard).not.toBeNull();
    expect(hoverCard).toHaveTextContent("홀로그램 그래피티: 역장 VI");
    expect(hoverCard).toHaveTextContent("버프 즐겨찾기에서 제외");
    expect(within(hoverCard as HTMLElement).getByLabelText("역장 버프칸 모드 설정 예시")).toHaveAttribute(
      "src",
      "/media/janus-buff-duration-settings-guide.mp4",
    );
  });

  it("uses the crop column as a buff-slot description in buff duration mode", () => {
    const skill = makeSkill({
      id: "skill-1",
      presetId: "sol-janus-dawn-deep-v2",
      detectionSource: "buff-duration",
      region: null,
    });
    const onToggleExpandedSkill = vi.fn();
    const onOpenRegionPicker = vi.fn();
    render(
      <SkillDashboard
        skills={[skill]}
        states={{ [skill.id]: createRuntimeState(skill.id) }}
        snapshots={{}}
        selectedSkillId="skill-1"
        expandedSkillIds={[]}
        hasStream
        canPickRegion
        alertVolume={0.85}
        onSelectSkill={() => undefined}
        onToggleExpandedSkill={onToggleExpandedSkill}
        onAddSkill={() => undefined}
        onChangeSkill={() => undefined}
        onAlertVolumeChange={() => undefined}
        onDeleteSkill={() => undefined}
        onOpenRegionPicker={onOpenRegionPicker}
        onPreviewSound={() => undefined}
      />,
    );

    expect(screen.getByRole("status", { name: "모듈 로딩 중" })).toHaveClass(
      "skill-buff-duration-loading-metric",
    );
    expect(document.querySelector(".buff-expiry-precision-prep-spinner")).toBeInTheDocument();
    expect(document.querySelector(".buff-expiry-precision-prep-progress")).toBeInTheDocument();
    expect(screen.queryByText("버프칸 분석 준비 중")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "영역 선택" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("모듈 로딩 중"));
    expect(onToggleExpandedSkill).not.toHaveBeenCalled();
    expect(onOpenRegionPicker).not.toHaveBeenCalled();
  });

  it("shows a detected buff-slot icon only after a buff duration snapshot exists", () => {
    const skill = makeSkill({
      id: "skill-1",
      presetId: "sol-janus-dawn-deep-v2",
      detectionSource: "buff-duration",
      region: null,
    });
    render(
        <SkillDashboard
          skills={[skill]}
          states={{ [skill.id]: createRuntimeState(skill.id) }}
        snapshots={{
          [skill.id]: makeSnapshot({
            buffDuration: {
              detected: true,
              boxCount: 18,
              detectedCount: 1,
              score: 0.96,
              margin: 0.2,
              decisionReason: "matched",
              countdown: makeCountdown(65, "1:05"),
              countdownModelStatus: "ready",
              performanceMs: 12,
              error: null,
            },
          }),
        }}
        selectedSkillId="skill-1"
        expandedSkillIds={[]}
        hasStream
        canPickRegion
        alertVolume={0.85}
        onSelectSkill={() => undefined}
        onToggleExpandedSkill={() => undefined}
        onAddSkill={() => undefined}
        onChangeSkill={() => undefined}
        onAlertVolumeChange={() => undefined}
        onDeleteSkill={() => undefined}
        onOpenRegionPicker={() => undefined}
        onPreviewSound={() => undefined}
      />,
    );

    expect(screen.getByAltText("흐름 확인 중")).toHaveClass(
      "skill-buff-duration-summary-icon",
    );
    expect(screen.getByText("1:05 읽음")).toHaveClass("skill-buff-duration-summary-text");
    expect(screen.queryByText("버프칸 분석 준비 중")).not.toBeInTheDocument();
  });

  it("keeps the region picker available from the expanded skill editor", () => {
    const skill = makeSkill({ id: "skill-1" });
    const onOpenRegionPicker = vi.fn();
    render(
      <SkillDashboard
        skills={[skill]}
        states={{ [skill.id]: createRuntimeState(skill.id) }}
        snapshots={{}}
        selectedSkillId="skill-1"
        expandedSkillIds={["skill-1"]}
        hasStream
        canPickRegion
        alertVolume={0.85}
        onSelectSkill={() => undefined}
        onToggleExpandedSkill={() => undefined}
        onAddSkill={() => undefined}
        onChangeSkill={() => undefined}
        onAlertVolumeChange={() => undefined}
        onDeleteSkill={() => undefined}
        onOpenRegionPicker={onOpenRegionPicker}
        onPreviewSound={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "영역 선택" }));

    expect(onOpenRegionPicker).toHaveBeenCalledWith("skill-1");
  });

  it("hides the region picker from the expanded skill editor in buff slot mode", () => {
    const skill = makeSkill({
      id: "skill-1",
      presetId: "sol-janus-dawn-deep-v2",
      detectionSource: "buff-duration",
    });
    const onOpenRegionPicker = vi.fn();
    render(
      <SkillDashboard
        skills={[skill]}
        states={{ [skill.id]: createRuntimeState(skill.id) }}
        snapshots={{}}
        selectedSkillId="skill-1"
        expandedSkillIds={["skill-1"]}
        hasStream
        canPickRegion
        alertVolume={0.85}
        onSelectSkill={() => undefined}
        onToggleExpandedSkill={() => undefined}
        onAddSkill={() => undefined}
        onChangeSkill={() => undefined}
        onAlertVolumeChange={() => undefined}
        onDeleteSkill={() => undefined}
        onOpenRegionPicker={onOpenRegionPicker}
        onPreviewSound={() => undefined}
      />,
    );

    expect(screen.getByRole("slider", { name: "볼륨 85%" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "영역 선택" })).not.toBeInTheDocument();
    expect(onOpenRegionPicker).not.toHaveBeenCalled();
  });

  it("does not toggle the row from the empty crop placeholder before capture is ready", () => {
    const skill = makeSkill({ id: "skill-1", region: null });
    const onToggleExpandedSkill = vi.fn();
    const onOpenRegionPicker = vi.fn();
    render(
      <SkillDashboard
        skills={[skill]}
        states={{ [skill.id]: createRuntimeState(skill.id) }}
        snapshots={{}}
        selectedSkillId=""
        expandedSkillIds={[]}
        hasStream={false}
        canPickRegion={false}
        alertVolume={0.85}
        onSelectSkill={() => undefined}
        onToggleExpandedSkill={onToggleExpandedSkill}
        onAddSkill={() => undefined}
        onChangeSkill={() => undefined}
        onAlertVolumeChange={() => undefined}
        onDeleteSkill={() => undefined}
        onOpenRegionPicker={onOpenRegionPicker}
        onPreviewSound={() => undefined}
      />,
    );

    expect(screen.queryByRole("button", { name: "영역 선택" })).not.toBeInTheDocument();
    const cropPlaceholder = screen
      .getAllByText("화면 공유 필요")
      .find((element) => element.classList.contains("crop-unavailable-text"));
    expect(cropPlaceholder).toBeDefined();
    fireEvent.click(cropPlaceholder as HTMLElement);

    expect(onToggleExpandedSkill).not.toHaveBeenCalled();
    expect(onOpenRegionPicker).not.toHaveBeenCalled();
  });

  it("shows the active toggle in the collapsed row", () => {
    const skill = makeSkill({ id: "skill-1", enabled: true });
    const onChangeSkill = vi.fn();
    render(
      <SkillDashboard
        skills={[skill]}
        states={{ [skill.id]: createRuntimeState(skill.id) }}
        snapshots={{}}
        selectedSkillId="skill-1"
        expandedSkillIds={[]}
        hasStream={false}
        canPickRegion={false}
        alertVolume={0.85}
        onSelectSkill={() => undefined}
        onToggleExpandedSkill={() => undefined}
        onAddSkill={() => undefined}
        onChangeSkill={onChangeSkill}
        onAlertVolumeChange={() => undefined}
        onDeleteSkill={() => undefined}
        onOpenRegionPicker={() => undefined}
        onPreviewSound={() => undefined}
      />,
    );

    fireEvent.click(screen.getByLabelText("켜짐"));
    expect(onChangeSkill).toHaveBeenCalledWith("skill-1", { enabled: false });
  });

  it("keeps the skill name out of the collapsed row", async () => {
    const skill = makeSkill({ id: "skill-1", name: "야누스" });
    const onChangeSkill = vi.fn();
    const onToggleExpandedSkill = vi.fn();
    const { container } = render(
      <SkillDashboard
        skills={[skill]}
        states={{ [skill.id]: createRuntimeState(skill.id) }}
        snapshots={{}}
        selectedSkillId="skill-1"
        expandedSkillIds={[]}
        hasStream={false}
        canPickRegion={false}
        alertVolume={0.85}
        onSelectSkill={() => undefined}
        onToggleExpandedSkill={onToggleExpandedSkill}
        onAddSkill={() => undefined}
        onChangeSkill={onChangeSkill}
        onAlertVolumeChange={() => undefined}
        onDeleteSkill={() => undefined}
        onOpenRegionPicker={() => undefined}
        onPreviewSound={() => undefined}
      />,
    );

    expect(screen.queryByRole("columnheader", { name: "이름" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("이름")).not.toBeInTheDocument();

    fireEvent.click(container.querySelector(".dashboard-row") as Element);
    expect(onToggleExpandedSkill).toHaveBeenCalledWith("skill-1");
    expect(onChangeSkill).not.toHaveBeenCalled();
  });

  it("puts skill before the alert and status columns", () => {
    const skill = makeSkill({ id: "skill-1", name: "야누스", alertThresholdSeconds: 7 });
    const { container } = render(
      <SkillDashboard
        skills={[skill]}
        states={{ [skill.id]: createRuntimeState(skill.id) }}
        snapshots={{}}
        selectedSkillId="skill-1"
        expandedSkillIds={[]}
        hasStream={false}
        canPickRegion={false}
        alertVolume={0.85}
        onSelectSkill={() => undefined}
        onToggleExpandedSkill={() => undefined}
        onAddSkill={() => undefined}
        onChangeSkill={() => undefined}
        onAlertVolumeChange={() => undefined}
        onDeleteSkill={() => undefined}
        onOpenRegionPicker={() => undefined}
        onPreviewSound={() => undefined}
      />,
    );

    const cells = Array.from(container.querySelectorAll(".skill-summary-row > .skill-cell"));
    expect(cells[2]).toContainElement(screen.getByLabelText("스킬"));
    expect(cells[3]).toHaveTextContent("알림 시점");
    expect(cells[3]).toHaveTextContent("7초 전");
    expect(cells[4]).toHaveTextContent("알림까지");
    expect(cells[5]).toHaveTextContent("반복");
    expect(cells[6]).toHaveTextContent("화면 공유 필요");
    expect(screen.getByLabelText("스킬")).toHaveAttribute("data-preset-id", "class-install");
    expect(screen.getByRole("button", { name: "스킬 알림 시점: 7초 전" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "스킬 기준 안내" })).not.toBeInTheDocument();
    const alertInfoButton = screen.getByRole("button", { name: "알림 시점 안내" });
    expect(alertInfoButton).toBeInTheDocument();
    expect(alertInfoButton).toHaveTextContent("사용 안내");
    expect(screen.queryByText("스킬 종류에 맞춰 남은 시간을 계산합니다.")).not.toBeInTheDocument();

    fireEvent.focus(alertInfoButton);

    expect(screen.getByText("스킬 종류에 맞춰 남은 시간을 계산합니다.")).toBeInTheDocument();
    expect(
      screen.getByText("정밀 스킬은 우상단 버프칸의 아이콘과 남은 시간을 읽어 종료 시점을 계산합니다."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "자석펫으로 솔 야누스 시간이 연장되어도 버프칸 감지는 갱신된 남은 시간에 맞춰 알림을 보정합니다.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("알림 시점은 스킬이 끝나기 N초 전이며, 음수는 끝난 뒤 N초 후 알림입니다."),
    ).toBeInTheDocument();
  });

  it("keeps recognition and confidence hidden outside debug mode", () => {
    const skill = makeSkill({ id: "skill-1" });
    render(
      <SkillDashboard
        skills={[skill]}
        states={{ [skill.id]: createRuntimeState(skill.id) }}
        snapshots={{ [skill.id]: makeSnapshot({ result: { value: 12, confidence: 0.76 } }) }}
        selectedSkillId="skill-1"
        expandedSkillIds={["skill-1"]}
        hasStream={true}
        canPickRegion={false}
        showDebugColumns={false}
        alertVolume={0.85}
        onSelectSkill={() => undefined}
        onToggleExpandedSkill={() => undefined}
        onAddSkill={() => undefined}
        onChangeSkill={() => undefined}
        onAlertVolumeChange={() => undefined}
        onDeleteSkill={() => undefined}
        onOpenRegionPicker={() => undefined}
        onPreviewSound={() => undefined}
      />,
    );

    expect(screen.queryByText("인식")).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "신뢰도" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("신뢰도")).not.toBeInTheDocument();
    expect(screen.queryByText("12s")).not.toBeInTheDocument();
  });

  it("shows recognition and confidence in debug mode", () => {
    const skill = makeSkill({ id: "skill-1" });
    render(
      <SkillDashboard
        skills={[skill]}
        states={{ [skill.id]: createRuntimeState(skill.id) }}
        snapshots={{ [skill.id]: makeSnapshot({ result: { value: 12, confidence: 0.76 } }) }}
        selectedSkillId="skill-1"
        expandedSkillIds={["skill-1"]}
        hasStream={true}
        canPickRegion={false}
        showDebugColumns
        alertVolume={0.85}
        onSelectSkill={() => undefined}
        onToggleExpandedSkill={() => undefined}
        onAddSkill={() => undefined}
        onChangeSkill={() => undefined}
        onAlertVolumeChange={() => undefined}
        onDeleteSkill={() => undefined}
        onOpenRegionPicker={() => undefined}
        onPreviewSound={() => undefined}
      />,
    );

    expect(screen.getByText("인식")).toBeInTheDocument();
    expect(screen.getByText("12s")).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "신뢰도" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("신뢰도")).toHaveTextContent("76%");
  });

  it("exposes a misread report button when the expanded row has a crop snapshot", () => {
    const skill = makeSkill({ id: "skill-1" });
    const onSubmitMisreadReport = vi.fn();
    render(
      <SkillDashboard
        skills={[skill]}
        states={{ [skill.id]: createRuntimeState(skill.id) }}
        snapshots={{ [skill.id]: makeSnapshot({ result: { value: 12, confidence: 0.76 } }) }}
        selectedSkillId="skill-1"
        expandedSkillIds={["skill-1"]}
        hasStream={true}
        canPickRegion={false}
        alertVolume={0.85}
        onSelectSkill={() => undefined}
        onToggleExpandedSkill={() => undefined}
        onAddSkill={() => undefined}
        onChangeSkill={() => undefined}
        onAlertVolumeChange={() => undefined}
        onDeleteSkill={() => undefined}
        onOpenRegionPicker={() => undefined}
        onPreviewSound={() => undefined}
        onSubmitMisreadReport={onSubmitMisreadReport}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "감지 제보" }));

    expect(onSubmitMisreadReport).toHaveBeenCalledWith("skill-1");
  });

  it("shows time until alert instead of raw skill duration remaining", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);

    const skill = makeSkill({ id: "skill-1", alertThresholdSeconds: 5 });
    render(
      <SkillDashboard
        skills={[skill]}
        states={{
          [skill.id]: {
            ...createRuntimeState(skill.id),
            estimatedExpiresAt: 121_000,
            status: "running",
          },
        }}
        snapshots={{}}
        selectedSkillId="skill-1"
        expandedSkillIds={[]}
        hasStream={false}
        canPickRegion={false}
        alertVolume={0.85}
        onSelectSkill={() => undefined}
        onToggleExpandedSkill={() => undefined}
        onAddSkill={() => undefined}
        onChangeSkill={() => undefined}
        onAlertVolumeChange={() => undefined}
        onDeleteSkill={() => undefined}
        onOpenRegionPicker={() => undefined}
        onPreviewSound={() => undefined}
      />,
    );

    expect(screen.getByText("알림까지")).toBeInTheDocument();
    expect(screen.getByText("115초")).toBeInTheDocument();
  });

  it("hides time until alert while all alerts are disabled", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);

    const skill = makeSkill({ id: "skill-1", alertThresholdSeconds: 5 });
    render(
      <SkillDashboard
        skills={[skill]}
        states={{
          [skill.id]: {
            ...createRuntimeState(skill.id),
            estimatedExpiresAt: 121_000,
            status: "paused",
          },
        }}
        snapshots={{}}
        selectedSkillId="skill-1"
        expandedSkillIds={[]}
        hasStream={false}
        canPickRegion={false}
        isGloballyDisabled
        alertVolume={0.85}
        onSelectSkill={() => undefined}
        onToggleExpandedSkill={() => undefined}
        onAddSkill={() => undefined}
        onChangeSkill={() => undefined}
        onAlertVolumeChange={() => undefined}
        onDeleteSkill={() => undefined}
        onOpenRegionPicker={() => undefined}
        onPreviewSound={() => undefined}
      />,
    );

    expect(screen.getByText("알림까지")).toBeInTheDocument();
    expect(screen.queryByText("115s")).not.toBeInTheDocument();
  });

  it("selects a fixed Sol Janus duration from the collapsed row", () => {
    const skill = makeSkill({
      id: "skill-1",
      presetId: "sol-janus-dawn-2min",
      name: "솔 야누스 : 새벽",
      countdownSource: "cooldown",
      durationSeconds: 120,
      recognitionStartSeconds: 55,
    });
    const onChangeSkill = vi.fn();
    const onToggleExpandedSkill = vi.fn();
    render(
      <SkillDashboard
        skills={[skill]}
        states={{ [skill.id]: createRuntimeState(skill.id) }}
        snapshots={{}}
        selectedSkillId="skill-1"
        expandedSkillIds={["skill-1"]}
        hasStream={false}
        canPickRegion={false}
        alertVolume={0.85}
        onSelectSkill={() => undefined}
        onToggleExpandedSkill={onToggleExpandedSkill}
        onAddSkill={() => undefined}
        onChangeSkill={onChangeSkill}
        onAlertVolumeChange={() => undefined}
        onDeleteSkill={() => undefined}
        onOpenRegionPicker={() => undefined}
        onPreviewSound={() => undefined}
      />,
    );

    const typeSelect = screen.getByLabelText("스킬");
    expect(typeSelect).toHaveAttribute("data-preset-id", "sol-janus-dawn-2min");
    expect(screen.queryByLabelText("설치기 지속시간")).not.toBeInTheDocument();

    chooseSkillPreset("솔 야누스 : 새벽 (80초)");
    expect(onChangeSkill).toHaveBeenCalledWith("skill-1", {
      presetId: "sol-janus-dawn-80s",
      countdownSource: "cooldown",
      durationSeconds: 80,
      cooldownDurationSeconds: 56,
      alertThresholdSeconds: 5,
      detectionSource: "quickslot",
      name: "솔 야누스 : 새벽",
      soundId: "야누스 랜덤",
    });
  });

  it("keeps duration and cooldown editable for class install skills", () => {
    const skill = makeSkill({
      id: "skill-1",
      presetId: "class-install",
      name: "직업 설치기 1",
      countdownSource: "cooldown",
      durationSeconds: 60,
      cooldownDurationSeconds: 60,
      alertThresholdSeconds: -20,
    });
    const onChangeSkill = vi.fn();
    render(
      <SkillDashboard
        skills={[skill]}
        states={{ [skill.id]: createRuntimeState(skill.id) }}
        snapshots={{}}
        selectedSkillId="skill-1"
        expandedSkillIds={[]}
        hasStream={false}
        canPickRegion={false}
        alertVolume={0.85}
        onSelectSkill={() => undefined}
        onToggleExpandedSkill={() => undefined}
        onAddSkill={() => undefined}
        onChangeSkill={onChangeSkill}
        onAlertVolumeChange={() => undefined}
        onDeleteSkill={() => undefined}
        onOpenRegionPicker={() => undefined}
        onPreviewSound={() => undefined}
      />,
    );

    const timeButton = screen.getByRole("button", { name: "시간 지속 60 쿨 60" });
    expect(screen.queryByLabelText("설치기 지속시간")).not.toBeInTheDocument();

    fireEvent.click(timeButton);

    const input = screen.getByLabelText("설치기 지속시간");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "75" } });
    expect(onChangeSkill).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(onChangeSkill).toHaveBeenCalledWith("skill-1", {
      countdownSource: "cooldown",
      durationSeconds: 75,
    });

    onChangeSkill.mockClear();
    const cooldownInput = screen.getByLabelText("설치기 쿨타임");
    fireEvent.focus(cooldownInput);
    fireEvent.change(cooldownInput, { target: { value: "56" } });
    expect(onChangeSkill).not.toHaveBeenCalled();
    fireEvent.blur(cooldownInput);
    expect(onChangeSkill).toHaveBeenCalledWith("skill-1", {
      countdownSource: "cooldown",
      cooldownDurationSeconds: 56,
    });

    fireEvent.click(document.body);
    expect(screen.queryByLabelText("설치기 지속시간")).not.toBeInTheDocument();
  });

  it("expands a class install row from empty space in the skill column", () => {
    const skill = makeSkill({
      id: "skill-1",
      presetId: "class-install",
      name: "직업 설치기 1",
      countdownSource: "cooldown",
      durationSeconds: 60,
      cooldownDurationSeconds: 60,
    });
    const onToggleExpandedSkill = vi.fn();
    const { container } = render(
      <SkillDashboard
        skills={[skill]}
        states={{ [skill.id]: createRuntimeState(skill.id) }}
        snapshots={{}}
        selectedSkillId="skill-1"
        expandedSkillIds={[]}
        hasStream={false}
        canPickRegion={false}
        alertVolume={0.85}
        onSelectSkill={() => undefined}
        onToggleExpandedSkill={onToggleExpandedSkill}
        onAddSkill={() => undefined}
        onChangeSkill={() => undefined}
        onAlertVolumeChange={() => undefined}
        onDeleteSkill={() => undefined}
        onOpenRegionPicker={() => undefined}
        onPreviewSound={() => undefined}
      />,
    );

    const skillColumnInlineControl = container.querySelector(".skill-type-inline-control");
    expect(skillColumnInlineControl).not.toBeNull();

    fireEvent.click(skillColumnInlineControl as Element);

    expect(onToggleExpandedSkill).toHaveBeenCalledWith("skill-1");
  });

  it("describes class install duration, cooldown, and yellow icon limits", () => {
    const skill = makeSkill({
      id: "skill-1",
      presetId: "class-install",
      name: "직업 설치기 1",
      countdownSource: "cooldown",
      durationSeconds: 60,
      alertThresholdSeconds: -20,
    });
    render(
      <SkillDashboard
        skills={[skill]}
        states={{ [skill.id]: createRuntimeState(skill.id) }}
        snapshots={{}}
        selectedSkillId="skill-1"
        expandedSkillIds={[]}
        hasStream={false}
        canPickRegion={false}
        alertVolume={0.85}
        onSelectSkill={() => undefined}
        onToggleExpandedSkill={() => undefined}
        onAddSkill={() => undefined}
        onChangeSkill={() => undefined}
        onAlertVolumeChange={() => undefined}
        onDeleteSkill={() => undefined}
        onOpenRegionPicker={() => undefined}
        onPreviewSound={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "시간 지속 60 쿨 60" }));

    const dialog = screen.getByRole("dialog", { name: "직업 설치기 시간 설정" });
    expect(dialog).toHaveTextContent("설치기가 유지되는 시간");
    expect(dialog).toHaveTextContent("퀵슬롯에 처음 보이는 실제 재사용 대기시간");
    expect(dialog).toHaveTextContent("노란색 계열 스킬 아이콘");
    expect(dialog).toHaveTextContent("문의/피드백");
    expect(screen.getByLabelText("인식이 불안정할 수 있는 노란색 계열 스킬 아이콘 예시")).toBeInTheDocument();
  });

  it("selects a non-editable skill type from the collapsed row", () => {
    const skill = makeSkill({
      id: "skill-1",
      presetId: "class-install",
      name: "직업 설치기 1",
      countdownSource: "cooldown",
      durationSeconds: 60,
      alertThresholdSeconds: -20,
    });
    const onChangeSkill = vi.fn();
    const onToggleExpandedSkill = vi.fn();
    render(
      <SkillDashboard
        skills={[skill]}
        states={{ [skill.id]: createRuntimeState(skill.id) }}
        snapshots={{}}
        selectedSkillId="skill-1"
        expandedSkillIds={[]}
        hasStream={false}
        canPickRegion={false}
        alertVolume={0.85}
        onSelectSkill={() => undefined}
        onToggleExpandedSkill={onToggleExpandedSkill}
        onAddSkill={() => undefined}
        onChangeSkill={onChangeSkill}
        onAlertVolumeChange={() => undefined}
        onDeleteSkill={() => undefined}
        onOpenRegionPicker={() => undefined}
        onPreviewSound={() => undefined}
      />,
    );

    chooseSkillPreset("에르다 파운틴");
    expect(onToggleExpandedSkill).not.toHaveBeenCalled();
    expect(onChangeSkill).toHaveBeenCalledWith("skill-1", {
      presetId: "erda-fountain",
      detectionSource: "quickslot",
      countdownSource: "cooldown",
      durationSeconds: 60,
      cooldownDurationSeconds: 56,
      alertThresholdSeconds: -5,
      name: "에르다 파운틴",
      soundId: "파운틴 랜덤",
    });
  });

  it("shows the Erda Fountain notice only for Erda rows", () => {
    const erdaSkill = makeSkill({
      id: "skill-erda",
      presetId: "erda-fountain",
      name: "에르다 파운틴",
      countdownSource: "cooldown",
      durationSeconds: 60,
      cooldownDurationSeconds: 56,
    });
    const janusSkill = makeSkill({
      id: "skill-janus",
      presetId: "sol-janus-dawn-2min",
      name: "솔 야누스 : 새벽",
      countdownSource: "cooldown",
      durationSeconds: 120,
      cooldownDurationSeconds: 56,
    });

    render(
      <SkillDashboard
        skills={[erdaSkill, janusSkill]}
        states={{
          [erdaSkill.id]: createRuntimeState(erdaSkill.id),
          [janusSkill.id]: createRuntimeState(janusSkill.id),
        }}
        snapshots={{}}
        selectedSkillId="skill-erda"
        expandedSkillIds={[]}
        hasStream={false}
        canPickRegion={false}
        alertVolume={0.85}
        onSelectSkill={() => undefined}
        onToggleExpandedSkill={() => undefined}
        onAddSkill={() => undefined}
        onChangeSkill={() => undefined}
        onAlertVolumeChange={() => undefined}
        onDeleteSkill={() => undefined}
        onOpenRegionPicker={() => undefined}
        onPreviewSound={() => undefined}
      />,
    );

    const noticeButton = screen.getByRole("button", { name: "에르다 파운틴 안내" });
    expect(noticeButton).toBeInTheDocument();
    expect(noticeButton).toHaveTextContent("주의");
    expect(noticeButton).not.toHaveAttribute("title");

    fireEvent.mouseEnter(noticeButton);
    const hoverCard = screen
      .getByText("에르다 파운틴은 재사용 방식이 다릅니다.")
      .closest(".maple-hover-card");
    expect(hoverCard).not.toBeNull();
    expect(hoverCard).toHaveTextContent("위치 이동 재사용");
    expect(hoverCard).toHaveTextContent("늦게 울리려면 음수로 설정");
    expect(screen.getAllByLabelText("스킬")).toHaveLength(2);
  });

  it("describes Erda Fountain buff slot detection when that mode is selected", () => {
    const skill = makeSkill({
      id: "skill-erda",
      presetId: "erda-fountain-deep-v2",
      name: "에르다 파운틴",
      detectionSource: "buff-duration",
      countdownSource: "cooldown",
      durationSeconds: 60,
      cooldownDurationSeconds: 56,
    });

    render(
      <SkillDashboard
        skills={[skill]}
        states={{ [skill.id]: createRuntimeState(skill.id) }}
        snapshots={{}}
        selectedSkillId="skill-erda"
        expandedSkillIds={[]}
        hasStream={false}
        canPickRegion={false}
        alertVolume={0.85}
        onSelectSkill={() => undefined}
        onToggleExpandedSkill={() => undefined}
        onAddSkill={() => undefined}
        onChangeSkill={() => undefined}
        onAlertVolumeChange={() => undefined}
        onDeleteSkill={() => undefined}
        onOpenRegionPicker={() => undefined}
        onPreviewSound={() => undefined}
      />,
    );

    fireEvent.mouseEnter(screen.getByRole("button", { name: "파운틴 버프칸 모드 설정 예시" }));

    const hoverCard = screen.getByText("파운틴 버프칸 모드 설정").closest(".maple-hover-card");
    expect(hoverCard).not.toBeNull();
    expect(hoverCard).toHaveTextContent("남은 시간이 버프칸에 보이도록");
    expect(hoverCard).not.toHaveTextContent("위치 이동 재사용");
  });

  it("does not show the removed skill type tooltip", () => {
    const skill = makeSkill({ id: "skill-1" });
    render(
      <SkillDashboard
        skills={[skill]}
        states={{ [skill.id]: createRuntimeState(skill.id) }}
        snapshots={{}}
        selectedSkillId="skill-1"
        expandedSkillIds={[]}
        hasStream={false}
        canPickRegion={false}
        alertVolume={0.85}
        onSelectSkill={() => undefined}
        onToggleExpandedSkill={() => undefined}
        onAddSkill={() => undefined}
        onChangeSkill={() => undefined}
        onAlertVolumeChange={() => undefined}
        onDeleteSkill={() => undefined}
        onOpenRegionPicker={() => undefined}
        onPreviewSound={() => undefined}
      />,
    );

    expect(screen.queryByRole("button", { name: "스킬 기준 안내" })).not.toBeInTheDocument();
    expect(screen.queryByText("1분, 70초, 80초, 2분")).not.toBeInTheDocument();
  });

  it("shows recommended in-game settings in the checklist tooltip", () => {
    const skill = makeSkill({ id: "skill-1" });
    render(
      <SkillDashboard
        skills={[skill]}
        states={{ [skill.id]: createRuntimeState(skill.id) }}
        snapshots={{}}
        selectedSkillId="skill-1"
        expandedSkillIds={[]}
        hasStream={false}
        canPickRegion={false}
        alertVolume={0.85}
        onSelectSkill={() => undefined}
        onToggleExpandedSkill={() => undefined}
        onAddSkill={() => undefined}
        onChangeSkill={() => undefined}
        onAlertVolumeChange={() => undefined}
        onDeleteSkill={() => undefined}
        onOpenRegionPicker={() => undefined}
        onPreviewSound={() => undefined}
        isSectionCollapsed
      />,
    );

    fireEvent.mouseEnter(screen.getByRole("button", { name: "스킬 알림 체크리스트" }));

    const hoverCard = screen.getByText("스킬 알림 전 확인해주세요.").closest(".maple-hover-card");
    expect(hoverCard).not.toBeNull();
    expect(hoverCard).toHaveTextContent(
      "확장 UI를 사용한다면 화면 공유 메뉴에서 게임 영역을 설정해주세요.",
    );
    expect(hoverCard).toHaveTextContent(
      "인게임 설정 > UI > 퀵슬롯&버프 시간표시는 [중앙, 크게]를 권장합니다.",
    );
    expect(screen.getByAltText("퀵슬롯과 버프 시간 표시가 중앙, 크게로 설정된 예시")).toHaveAttribute(
      "src",
      "/media/quickslot-buff-time-large-center.png",
    );
    expect(hoverCard).toHaveTextContent(
      "인게임 설정 > UI > 버프 정렬 옵션을 모두 켜주세요.",
    );
    expect(
      screen.getByAltText("버프 표시 방식, 자동 정렬 적용, 버프 최소화 기능 사용 설정 예시"),
    ).toHaveAttribute("src", "/media/buff-sort-options.png");
    expect(hoverCard).toHaveTextContent(
      "인게임 설정 > UI > 퀵슬롯&버프표시방식은 [분 + 초]를 권장합니다.",
    );
  });

  it("shows class install sample guidance in the skill panel header", () => {
    const skill = makeSkill({ id: "skill-1" });
    render(
      <SkillDashboard
        skills={[skill]}
        states={{ [skill.id]: createRuntimeState(skill.id) }}
        snapshots={{}}
        selectedSkillId="skill-1"
        expandedSkillIds={[]}
        hasStream={false}
        canPickRegion={false}
        alertVolume={0.85}
        onSelectSkill={() => undefined}
        onToggleExpandedSkill={() => undefined}
        onAddSkill={() => undefined}
        onChangeSkill={() => undefined}
        onAlertVolumeChange={() => undefined}
        onDeleteSkill={() => undefined}
        onOpenRegionPicker={() => undefined}
        onPreviewSound={() => undefined}
      />,
    );

    const guideButton = screen.getByRole("button", { name: "내 직업 설치기 지원 안내" });
    expect(guideButton).toHaveTextContent("내 직업 설치기");

    fireEvent.mouseEnter(guideButton);

    const hoverCard = screen.getByText("내 직업 설치기도 지원하고 싶다면").closest(".maple-hover-card");
    expect(hoverCard).not.toBeNull();
    expect(hoverCard).toHaveTextContent("유튜브에 업로드한 뒤 링크를 보내주세요.");
    expect(hoverCard).toHaveTextContent("영상은 길수록 도움이 되며");
  });

  it("shows negative alert thresholds as seconds after expiry", () => {
    const skill = makeSkill({ id: "skill-1", name: "파운틴", alertThresholdSeconds: -2 });
    render(
      <SkillDashboard
        skills={[skill]}
        states={{ [skill.id]: createRuntimeState(skill.id) }}
        snapshots={{}}
        selectedSkillId="skill-1"
        expandedSkillIds={[]}
        hasStream={false}
        canPickRegion={false}
        alertVolume={0.85}
        onSelectSkill={() => undefined}
        onToggleExpandedSkill={() => undefined}
        onAddSkill={() => undefined}
        onChangeSkill={() => undefined}
        onAlertVolumeChange={() => undefined}
        onDeleteSkill={() => undefined}
        onOpenRegionPicker={() => undefined}
        onPreviewSound={() => undefined}
      />,
    );

    expect(screen.getByRole("button", { name: "스킬 알림 시점: 2초 후" })).toHaveTextContent(
      "2초 후",
    );
  });

  it("limits alert threshold input to the supported sub-minute range", async () => {
    const skill = makeSkill({ id: "skill-1", alertThresholdSeconds: 5 });
    const onChangeSkill = vi.fn();
    const onToggleExpandedSkill = vi.fn();
    render(
      <SkillDashboard
        skills={[skill]}
        states={{ [skill.id]: createRuntimeState(skill.id) }}
        snapshots={{}}
        selectedSkillId="skill-1"
        expandedSkillIds={[]}
        hasStream={false}
        canPickRegion={false}
        alertVolume={0.85}
        onSelectSkill={() => undefined}
        onToggleExpandedSkill={onToggleExpandedSkill}
        onAddSkill={() => undefined}
        onChangeSkill={onChangeSkill}
        onAlertVolumeChange={() => undefined}
        onDeleteSkill={() => undefined}
        onOpenRegionPicker={() => undefined}
        onPreviewSound={() => undefined}
      />,
    );

    const input = openAlertThresholdInput();
    expect(input).toHaveAttribute("min", String(ALERT_THRESHOLD_MIN_SECONDS));
    expect(input).toHaveAttribute("max", String(ALERT_THRESHOLD_MAX_SECONDS));
    expect(input.closest(".threshold-control")).toHaveAttribute(
      "data-range-hint",
      `${ALERT_THRESHOLD_MIN_SECONDS}-${ALERT_THRESHOLD_MAX_SECONDS}초`,
    );

    fireEvent.click(input);
    expect(onToggleExpandedSkill).not.toHaveBeenCalled();

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "999" } });
    expect(onChangeSkill).not.toHaveBeenCalled();
    expect(input).toHaveAttribute("aria-invalid", "true");
    await waitFor(() => expect(input).toHaveClass("number-input-draft-invalid-pulse"));
    fireEvent.blur(input);
    expect(onChangeSkill).toHaveBeenCalledWith("skill-1", {
      alertThresholdSeconds: ALERT_THRESHOLD_MAX_SECONDS,
    });
  });

  it("shows Maehwa Yein alert thresholds as remaining counts", () => {
    const skill = makeSkill({
      id: "skill-1",
      name: "매화검 3초식 : 예인 VI",
      presetId: "maehwa-yein-vi",
      detectionSource: "buff-duration",
      alertThresholdSeconds: 3,
      region: null,
    });
    render(
      <SkillDashboard
        skills={[skill]}
        states={{ [skill.id]: createRuntimeState(skill.id) }}
        snapshots={{}}
        selectedSkillId="skill-1"
        expandedSkillIds={[]}
        hasStream={false}
        canPickRegion={false}
        alertVolume={0.85}
        onSelectSkill={() => undefined}
        onToggleExpandedSkill={() => undefined}
        onAddSkill={() => undefined}
        onChangeSkill={() => undefined}
        onAlertVolumeChange={() => undefined}
        onDeleteSkill={() => undefined}
        onOpenRegionPicker={() => undefined}
        onPreviewSound={() => undefined}
      />,
    );

    expect(screen.getByRole("button", { name: "스킬 알림 회수: 3회 남음" })).toHaveTextContent(
      "3회 남음",
    );
    const input = openRemainingCountAlertThresholdInput();
    expect(input).toHaveAttribute("min", String(REMAINING_COUNT_ALERT_THRESHOLD_MIN));
    expect(input).toHaveAttribute("max", String(REMAINING_COUNT_ALERT_THRESHOLD_MAX));
    expect(input.closest(".threshold-control")).toHaveAttribute(
      "data-range-hint",
      `${REMAINING_COUNT_ALERT_THRESHOLD_MIN}-${REMAINING_COUNT_ALERT_THRESHOLD_MAX}회`,
    );
  });

  it("extends the after-expiry alert threshold only for class install skills", () => {
    const classInstallSkill = makeSkill({
      id: "skill-1",
      presetId: "class-install",
      alertThresholdSeconds: -20,
    });
    render(
      <SkillDashboard
        skills={[classInstallSkill]}
        states={{ [classInstallSkill.id]: createRuntimeState(classInstallSkill.id) }}
        snapshots={{}}
        selectedSkillId="skill-1"
        expandedSkillIds={[]}
        hasStream={false}
        canPickRegion={false}
        alertVolume={0.85}
        onSelectSkill={() => undefined}
        onToggleExpandedSkill={() => undefined}
        onAddSkill={() => undefined}
        onChangeSkill={() => undefined}
        onAlertVolumeChange={() => undefined}
        onDeleteSkill={() => undefined}
        onOpenRegionPicker={() => undefined}
        onPreviewSound={() => undefined}
      />,
    );

    const input = openAlertThresholdInput();
    expect(input).toHaveAttribute("min", String(CLASS_INSTALL_ALERT_THRESHOLD_MIN_SECONDS));
    expect(input).toHaveAttribute("max", String(ALERT_THRESHOLD_MAX_SECONDS));
    expect(input.closest(".threshold-control")).toHaveAttribute(
      "data-range-hint",
      `${CLASS_INSTALL_ALERT_THRESHOLD_MIN_SECONDS}-${ALERT_THRESHOLD_MAX_SECONDS}초`,
    );
  });

  it("lists bundled alert sounds and previews only from the play button", async () => {
    const skill = makeSkill({ id: "skill-1", soundId: DEFAULT_ALERT_SOUND_ID });
    const onChangeSkill = vi.fn();
    const onPreviewSound = vi.fn();
    const { rerender } = render(
      <SkillDashboard
        skills={[skill]}
        states={{ [skill.id]: createRuntimeState(skill.id) }}
        snapshots={{}}
        selectedSkillId="skill-1"
        expandedSkillIds={["skill-1"]}
        hasStream={false}
        canPickRegion={false}
        alertVolume={0.85}
        onSelectSkill={() => undefined}
        onToggleExpandedSkill={() => undefined}
        onAddSkill={() => undefined}
        onChangeSkill={onChangeSkill}
        onAlertVolumeChange={() => undefined}
        onDeleteSkill={() => undefined}
        onOpenRegionPicker={() => undefined}
        onPreviewSound={onPreviewSound}
      />,
    );

    const picker = await screen.findByLabelText("알림음");
    fireEvent.click(picker);
    const soundList = screen.getByRole("listbox", { name: "알림음" });
    expect(within(soundList).getAllByRole("option").map((option) => option.textContent)).toEqual(
      ["내 알림음 추가...", ...DEFAULT_PICKER_ALERT_SOUNDS.map((sound) => sound.label)],
    );

    fireEvent.click(screen.getByRole("option", { name: "[기타] 미스터리" }));
    expect(onChangeSkill).toHaveBeenCalledWith("skill-1", { soundId: "미스터리" });
    expect(onPreviewSound).not.toHaveBeenCalled();
    setSliderValue(screen.getByRole("slider", { name: "볼륨 85%" }), 0.4);
    expect(onChangeSkill).toHaveBeenCalledWith("skill-1", { volume: 0.4 });

    rerender(
      <SkillDashboard
        skills={[{ ...skill, soundId: "미스터리" }]}
        states={{ [skill.id]: createRuntimeState(skill.id) }}
        snapshots={{}}
        selectedSkillId="skill-1"
        expandedSkillIds={["skill-1"]}
        hasStream={false}
        canPickRegion={false}
        alertVolume={0.85}
        onSelectSkill={() => undefined}
        onToggleExpandedSkill={() => undefined}
        onAddSkill={() => undefined}
        onChangeSkill={onChangeSkill}
        onAlertVolumeChange={() => undefined}
        onDeleteSkill={() => undefined}
        onOpenRegionPicker={() => undefined}
        onPreviewSound={onPreviewSound}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "알림음 재생" }));
    expect(onPreviewSound).toHaveBeenCalledWith("미스터리", 0.85);
  });

  it("asks for confirmation before applying boosted volume", async () => {
    const skill = makeSkill({ id: "skill-1", soundId: DEFAULT_ALERT_SOUND_ID });
    const onChangeSkill = vi.fn();
    const onPreviewSound = vi.fn();
    render(
      <SkillDashboard
        skills={[skill]}
        states={{ [skill.id]: createRuntimeState(skill.id) }}
        snapshots={{}}
        selectedSkillId="skill-1"
        expandedSkillIds={["skill-1"]}
        hasStream={false}
        canPickRegion={false}
        alertVolume={0.85}
        onSelectSkill={() => undefined}
        onToggleExpandedSkill={() => undefined}
        onAddSkill={() => undefined}
        onChangeSkill={onChangeSkill}
        onAlertVolumeChange={() => undefined}
        onDeleteSkill={() => undefined}
        onOpenRegionPicker={() => undefined}
        onPreviewSound={onPreviewSound}
      />,
    );

    dragSliderToValue(screen.getByRole("slider", { name: "볼륨 85%" }), 1.5);

    expect(onChangeSkill).not.toHaveBeenCalledWith("skill-1", { volume: 1.5 });
    expect(
      screen.queryByRole("alertdialog", { name: "150% 볼륨을 확인해 주세요." }),
    ).not.toBeInTheDocument();

    releaseSlider(screen.getByRole("slider", { name: "볼륨 150%" }));

    expect(onChangeSkill).not.toHaveBeenCalledWith("skill-1", { volume: 1.5 });
    expect(
      screen.getByRole("alertdialog", { name: "150% 볼륨을 확인해 주세요." }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /미리 듣기/ }));
    expect(onPreviewSound).toHaveBeenCalledWith(DEFAULT_ALERT_SOUND_ID, 1.5);

    fireEvent.click(screen.getByRole("button", { name: "증폭 사용" }));
    expect(onChangeSkill).toHaveBeenCalledWith("skill-1", { volume: 1.5 });
  });

  it("places delete on the collapsed row and does not expand from delete click", () => {
    const skills = [makeSkill({ id: "skill-1" }), makeSkill({ id: "skill-2" })];
    const onDeleteSkill = vi.fn();
    const onToggleExpandedSkill = vi.fn();
    render(
      <SkillDashboard
        skills={skills}
        states={Object.fromEntries(skills.map((skill) => [skill.id, createRuntimeState(skill.id)]))}
        snapshots={{}}
        selectedSkillId="skill-1"
        expandedSkillIds={[]}
        hasStream={false}
        canPickRegion={false}
        alertVolume={0.85}
        onSelectSkill={() => undefined}
        onToggleExpandedSkill={onToggleExpandedSkill}
        onAddSkill={() => undefined}
        onChangeSkill={() => undefined}
        onAlertVolumeChange={() => undefined}
        onDeleteSkill={onDeleteSkill}
        onOpenRegionPicker={() => undefined}
        onPreviewSound={() => undefined}
      />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "삭제" })[0]);

    expect(onDeleteSkill).toHaveBeenCalledWith("skill-1");
    expect(onToggleExpandedSkill).not.toHaveBeenCalled();
  });

  it("allows deleting the final remaining row", () => {
    const skill = makeSkill({ id: "skill-1" });
    const onDeleteSkill = vi.fn();
    render(
      <SkillDashboard
        skills={[skill]}
        states={{ [skill.id]: createRuntimeState(skill.id) }}
        snapshots={{}}
        selectedSkillId="skill-1"
        expandedSkillIds={[]}
        hasStream={false}
        canPickRegion={false}
        alertVolume={0.85}
        onSelectSkill={() => undefined}
        onToggleExpandedSkill={() => undefined}
        onAddSkill={() => undefined}
        onChangeSkill={() => undefined}
        onAlertVolumeChange={() => undefined}
        onDeleteSkill={onDeleteSkill}
        onOpenRegionPicker={() => undefined}
        onPreviewSound={() => undefined}
      />,
    );

    const deleteButton = screen.getByRole("button", { name: "삭제" });
    expect(deleteButton).not.toBeDisabled();

    fireEvent.click(deleteButton);
    expect(onDeleteSkill).toHaveBeenCalledWith("skill-1");
  });

  it("keeps the add row available when every row has been deleted", () => {
    const onAddSkill = vi.fn();
    render(
      <SkillDashboard
        skills={[]}
        states={{}}
        snapshots={{}}
        selectedSkillId=""
        expandedSkillIds={[]}
        hasStream={false}
        canPickRegion={false}
        alertVolume={0.85}
        onSelectSkill={() => undefined}
        onToggleExpandedSkill={() => undefined}
        onAddSkill={onAddSkill}
        onChangeSkill={() => undefined}
        onAlertVolumeChange={() => undefined}
        onDeleteSkill={() => undefined}
        onOpenRegionPicker={() => undefined}
        onPreviewSound={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "스킬 추가" }));
    expect(onAddSkill).toHaveBeenCalledTimes(1);
  });

  it("only shows a thumbnail for a trusted snapshot", () => {
    const skill = makeSkill();
    const state = { ...createRuntimeState(skill.id), status: "running" as const };

    expect(getSkillRowVisualState(skill, state, makeSnapshot(), true)).toEqual({
      kind: "thumbnail",
      url: "data:image/png;base64,preview",
    });

    expect(
      getSkillRowVisualState(skill, state, makeSnapshot({ result: { value: 7, confidence: 0.3 } }), true),
    ).toEqual({ kind: "placeholder", label: "숫자 대기" });

    expect(getSkillRowVisualState(skill, state, makeSnapshot(), false)).toEqual({
      kind: "placeholder",
      label: "화면 공유 필요",
    });

    expect(getSkillRowVisualState({ ...skill, region: null }, state, undefined, false)).toEqual({
      kind: "placeholder",
      label: "화면 공유 필요",
    });

    expect(
      getSkillRowVisualState(
        {
          ...skill,
          presetId: "sol-janus-dawn-deep-v2",
          detectionSource: "buff-duration",
          region: null,
        },
        state,
        undefined,
        true,
      ),
    ).toEqual({
      kind: "placeholder",
      label: "버프칸 분석 준비 중",
      description: "모듈 로딩 중",
      variant: "buff-duration",
    });

    expect(
      getSkillRowVisualState(
        {
          ...skill,
          presetId: "sol-janus-dawn-deep-v2",
          detectionSource: "buff-duration",
          region: null,
        },
        state,
        undefined,
        false,
      ),
    ).toEqual({
      kind: "placeholder",
      label: "화면 공유 필요",
      variant: "buff-duration",
    });

    expect(
      getSkillRowVisualState(
        {
          ...skill,
          presetId: "sol-janus-dawn-deep-v2",
          detectionSource: "buff-duration",
          region: null,
        },
        state,
        makeSnapshot({
          buffDuration: {
            detected: true,
            boxCount: 18,
            detectedCount: 1,
            score: 0.96,
            margin: 0.2,
            decisionReason: "matched",
            countdown: makeCountdown(65, "1:05"),
            countdownModelStatus: "ready",
            performanceMs: 12,
            error: null,
          },
        }),
        true,
      ),
    ).toEqual({
      kind: "thumbnail",
      url: "data:image/png;base64,preview",
      variant: "buff-duration",
      label: "흐름 확인 중",
      description: "1:05 읽음",
      tone: "checking",
      tooltip: "버프칸에서 읽은 새벽 남은 시간입니다.",
    });

    expect(
      getSkillRowVisualState(
        {
          ...skill,
          presetId: "sol-janus-dawn-deep-v2",
          detectionSource: "buff-duration",
          region: null,
        },
        {
          ...state,
          status: "running",
          observedRemainingSeconds: 65,
          observedAt: 10_000,
          estimatedExpiresAt: 75_000,
        },
        makeSnapshot({
          buffDuration: {
            detected: true,
            boxCount: 18,
            detectedCount: 1,
            score: 0.96,
            margin: 0.2,
            decisionReason: "matched",
            countdown: makeCountdown(65, "1:05"),
            countdownModelStatus: "ready",
            performanceMs: 12,
            error: null,
          },
        }),
        true,
      ),
    ).toMatchObject({
      kind: "thumbnail",
      label: "새벽 감지",
      description: "1:05 읽음",
      tone: "detected",
    });

    expect(
      getSkillRowVisualState(
        {
          ...skill,
          presetId: "sol-janus-dawn-deep-v2",
          detectionSource: "buff-duration",
          region: null,
        },
        state,
        makeSnapshot({
          buffDuration: {
            detected: true,
            boxCount: 18,
            detectedCount: 1,
            score: 0.96,
            margin: 0.2,
            decisionReason: "matched",
            countdown: null,
            countdownModelStatus: "ready",
            performanceMs: 12,
            error: null,
          },
        }),
        true,
      ),
    ).toMatchObject({
      kind: "thumbnail",
      label: "흐름 확인 중",
      description: "시간 확인 중",
      tone: "checking",
    });

    expect(
      getSkillRowVisualState(
        {
          ...skill,
          presetId: "sol-janus-dawn-deep-v2",
          detectionSource: "buff-duration",
          region: null,
        },
        state,
        {
          ...makeSnapshot(),
          previewUrl: "data:image/png;base64,previous-janus",
          buffDuration: {
            detected: false,
            boxCount: 12,
            detectedCount: 0,
            displayStatus: "checking",
            displayLastSeenAt: 10_000,
            score: null,
            margin: null,
            decisionReason: null,
            performanceMs: 15,
            error: null,
          },
        },
        true,
      ),
    ).toEqual({
      kind: "thumbnail",
      url: "data:image/png;base64,previous-janus",
      variant: "buff-duration",
      label: "새벽 확인 중",
      description: "찾는 중",
      tone: "checking",
      badgeLabel: "확인 중",
      tooltip: "최근 감지 이미지를 잠시 유지하며 새벽 버프칸을 다시 확인합니다.",
    });

    expect(
      getSkillRowVisualState(
        {
          ...skill,
          presetId: "sol-janus-dawn-deep-v2",
          detectionSource: "buff-duration",
          region: null,
        },
        state,
        {
          ...makeSnapshot(),
          previewUrl: null,
          buffDuration: {
            detected: false,
            boxCount: 12,
            detectedCount: 0,
            score: null,
            margin: null,
            decisionReason: null,
            performanceMs: 15,
            error: null,
          },
        },
        true,
      ),
    ).toEqual({
      kind: "placeholder",
      label: "새벽 아이콘 매칭 대기",
      description: "새벽 감지 대기 중",
      tone: "searching",
      tooltip: "버프칸 12개 감지 · 새벽 매칭 0개",
      variant: "buff-duration",
    });

    expect(
      getSkillRowVisualState(
        {
          ...skill,
          presetId: "sol-janus-dawn-deep-v2",
          detectionSource: "buff-duration",
          region: null,
        },
        state,
        {
          ...makeSnapshot(),
          previewUrl: null,
          buffDuration: {
            detected: false,
            boxCount: 0,
            detectedCount: 0,
            score: null,
            margin: null,
            decisionReason: null,
            performanceMs: null,
            error: "skill-buff-duration-worker-timeout",
          },
        },
        true,
      ),
    ).toEqual({
      kind: "placeholder",
      label: "버프칸 감지 오류",
      description: "다시 시도 필요",
      tone: "error",
      tooltip: "skill-buff-duration-worker-timeout",
      variant: "buff-duration",
    });
  });

  it("summarizes a recent Sol Janus buff-duration extension in the crop column", () => {
    const skill = {
      ...makeSkill(),
      presetId: "sol-janus-dawn-deep-v2" as const,
      detectionSource: "buff-duration" as const,
      region: null,
    };
    const state: SkillRuntimeState = {
      ...createRuntimeState(skill.id),
      status: "running",
      observedRemainingSeconds: 45,
      observedAt: 15_000,
      estimatedExpiresAt: 60_000,
      buffDurationTimingEvent: { type: "extended", occurredAt: 15_000 },
    };

    expect(
      getSkillRowVisualState(
        skill,
        state,
        makeSnapshot({
          buffDuration: {
            detected: true,
            boxCount: 18,
            detectedCount: 1,
            score: 0.96,
            margin: 0.2,
            decisionReason: "matched",
            countdown: makeCountdown(45, "45"),
            countdownModelStatus: "ready",
            performanceMs: 12,
            error: null,
          },
        }),
        true,
        null,
        16_000,
      ),
    ).toEqual({
      kind: "thumbnail",
      url: "data:image/png;base64,preview",
      variant: "buff-duration",
      label: "갱신됨",
      description: "갱신됨",
      tone: "extended",
      tooltip: "버프칸에서 읽은 새벽 남은 시간입니다.",
    });
  });

  it("shows that screen sharing is required in the status column before capture starts", () => {
    const skill = makeSkill({ id: "skill-1" });
    const state = createRuntimeState(skill.id);

    expect(getSkillStatusView(skill, state, false)).toEqual({
      className: "no-stream",
      label: "화면 공유 필요",
    });

    render(
      <SkillDashboard
        skills={[skill]}
        states={{ [skill.id]: state }}
        snapshots={{}}
        selectedSkillId="skill-1"
        expandedSkillIds={[]}
        hasStream={false}
        canPickRegion={false}
        alertVolume={0.85}
        onSelectSkill={() => undefined}
        onToggleExpandedSkill={() => undefined}
        onAddSkill={() => undefined}
        onChangeSkill={() => undefined}
        onAlertVolumeChange={() => undefined}
        onDeleteSkill={() => undefined}
        onOpenRegionPicker={() => undefined}
        onPreviewSound={() => undefined}
      />,
    );

    expect(
      screen.getAllByText("화면 공유 필요").some((element) => element.classList.contains("no-stream")),
    ).toBe(true);
  });

  it("shows that game viewport calibration is required while capture remains connected", () => {
    const skill = makeSkill({ id: "skill-1" });
    const state = createRuntimeState(skill.id);

    expect(getSkillStatusView(skill, state, true, false, false)).toEqual({
      className: "warning",
      label: "게임 영역 설정 필요",
    });
    expect(
      getSkillRowVisualState(
        skill,
        state,
        undefined,
        true,
        null,
        null,
        false,
      ),
    ).toEqual({
      kind: "placeholder",
      label: "게임 영역 설정 필요",
      description: "화면 공유 메뉴에서 설정",
      tone: "error",
    });
  });

  it("keeps rows visible but marks missing regions for the current resolution", () => {
    const skill = makeSkill({
      region: null,
      regionsByLayout: {
        "1920x1080": { x: 0.1, y: 0.1, width: 0.04, height: 0.04 },
      },
    });
    const state = createRuntimeState(skill.id);

    expect(getSkillRowVisualState(skill, state, undefined, true, "2560x1440")).toEqual({
      kind: "placeholder",
      label: "스킬 영역 다시 선택",
      tooltip: "화면 해상도가 바뀌면 기존 crop 위치가 달라질 수 있어 해상도별로 영역을 저장합니다.",
    });

    render(
      <SkillDashboard
        skills={[skill]}
        states={{ [skill.id]: state }}
        snapshots={{}}
        selectedSkillId="skill-1"
        expandedSkillIds={[]}
        hasStream
        canPickRegion
        currentLayoutKey="2560x1440"
        alertVolume={0.85}
        onSelectSkill={() => undefined}
        onToggleExpandedSkill={() => undefined}
        onAddSkill={() => undefined}
        onChangeSkill={() => undefined}
        onAlertVolumeChange={() => undefined}
        onDeleteSkill={() => undefined}
        onOpenRegionPicker={() => undefined}
        onPreviewSound={() => undefined}
      />,
    );

    const missingRegionButton = screen.getByRole("button", {
      name: "스킬 영역 다시 선택",
    });
    expect(missingRegionButton).toBeInTheDocument();
    expect(missingRegionButton).toHaveAttribute(
      "aria-describedby",
      `crop-region-tooltip-${skill.id}`,
    );
    const tooltipText =
      "화면 해상도가 바뀌면 기존 crop 위치가 달라질 수 있어 해상도별로 영역을 저장합니다.";
    expect(screen.queryByText(tooltipText)).not.toBeInTheDocument();

    fireEvent.focus(missingRegionButton);

    expect(screen.getByText(tooltipText)).toHaveClass("floating-tooltip");
    expect(screen.queryByText("다시 선택 필요")).not.toBeInTheDocument();
  });
});

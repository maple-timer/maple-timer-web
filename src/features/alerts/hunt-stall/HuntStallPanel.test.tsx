import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HuntStallRuntimeState, HuntStallSnapshot } from "../../../alertTypes";
import type { HuntStallAlertConfig } from "../../../types";
import { HuntStallPanel } from "./HuntStallPanel";

const config: HuntStallAlertConfig = {
  enabled: true,
  mode: "manual-experience",
  stallThresholdSeconds: 10,
  manualExperienceRegion: { x: 0.33, y: 0.96, width: 0.34, height: 0.01 },
  manualExperienceRegionsByLayout: {},
  cooldownRegion: null,
  cooldownRegionsByLayout: {},
  cooldownMissingThresholdSeconds: 7,
  soundId: "띵동띵동",
  volume: 0.8,
};

const state: HuntStallRuntimeState = {
  status: "active",
  lastChangedAt: 1,
  lastSampledAt: 2,
  lastReadableAt: 2,
  lastReadFailureAt: null,
  unreadableSinceAt: null,
  alertedAt: null,
  lastRepeatedAlertAt: null,
  repeatedAlertCount: 0,
  lastAlertedAt: null,
  stableSampleCount: 3,
  unchangedSeconds: 0,
  fingerprint: "101",
  recognizedText: "1,530,768,605,709 [11.120%]",
  alertedRecognizedText: null,
  pendingRecognizedText: null,
  pendingRecognizedCount: 0,
  lastRejectedRecognizedText: null,
  lastReadFailureReason: null,
  lastDecision: "stable",
  hasObservedExperienceChange: true,
  hasObservedCooldownPresence: false,
  cooldownLastDetectedAt: null,
  cooldownMissingSinceAt: null,
  cooldownMissingSeconds: 0,
  cooldownConsecutiveReadableCount: 0,
  confidence: 0.98,
  changeScore: 0,
};

const snapshot: HuntStallSnapshot = {
  sampledAt: 3,
  rawPreviewUrl: "data:image/png;base64,raw",
  displayPreviewUrl: "data:image/png;base64,display",
  processedPreviewUrl: "data:image/png;base64,processed",
  mode: "manual-experience",
  regionLabel: "220x17",
  recognizedText: "1,530,768,605,709 [11.120%]",
  debugText: "1.530.768.605.709[11120%]",
  confidence: 0.98,
  foregroundRatio: 0.07,
  changeScore: 0,
  performance: {
    totalMs: 15.4,
    barEstimateMs: 2.1,
    candidateCount: 2,
    candidateMs: 13.2,
    selectedCandidateMs: 6.7,
    selectedFrameReadMs: 1.3,
    selectedOcrMs: 4.8,
    selectedPreviewMs: 0.4,
    fullFramePreviewMs: null,
    loopMs: 17.5,
  },
};

function renderPanel(partial: Partial<Parameters<typeof HuntStallPanel>[0]> = {}) {
  return render(
    <HuntStallPanel
      config={config}
      state={state}
      snapshot={snapshot}
      hasStream
      canPickRegion
      currentLayoutKey={null}
      showDebug={false}
      onChange={vi.fn()}
      onOpenRegionPicker={vi.fn()}
      onResetDetection={vi.fn()}
      onPreviewSound={vi.fn()}
      onSubmitDebugSample={vi.fn()}
      onSubmitIssueReport={vi.fn()}
      isSubmittingDebugSample={false}
      isSubmittingIssueReport={false}
      {...partial}
    />,
  );
}

describe("HuntStallPanel", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("shows repeat and last alert columns in experience mode", () => {
    vi.useFakeTimers();
    vi.setSystemTime(15_000);
    const onChange = vi.fn();
    const { container } = renderPanel({
      config: {
        ...config,
        mode: "manual-experience",
        manualExperienceRegion: { x: 0.33, y: 0.96, width: 0.34, height: 0.01 },
        repeatAlertEnabled: true,
        repeatAlertIntervalSeconds: 3,
        repeatAlertMaxCount: 2,
      },
      state: {
        ...state,
        lastChangedAt: 10_000,
        lastSampledAt: 15_000,
        lastAlertedAt: 12_000,
      },
      snapshot: {
        ...snapshot,
        mode: "manual-experience",
      },
      onChange,
    });

    expect(screen.getAllByText("멈춤 기준")).toHaveLength(2);
    expect(screen.getAllByText("반복")).toHaveLength(2);
    expect(screen.getAllByText("마지막 경험치 변화")).toHaveLength(2);
    expect(screen.getAllByText("마지막 알림")).toHaveLength(2);
    const headers = Array.from(container.querySelectorAll("thead th")).map((header) =>
      header.textContent?.trim() ?? "",
    );
    expect(headers.indexOf("마지막 경험치 변화")).toBeLessThan(headers.indexOf("멈춤 기준"));
    expect(headers.indexOf("멈춤 기준")).toBeLessThan(headers.indexOf("반복"));
    expect(headers.indexOf("반복")).toBeLessThan(headers.indexOf("마지막 알림"));
    expect(screen.getByRole("button", { name: "사냥 멈춤 반복 알림 간격" })).toHaveTextContent(
      "3초 · 2회",
    );
    expect(screen.getAllByLabelText("3초 전")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "사냥 멈춤 반복 알림 간격" }));
    fireEvent.click(screen.getByRole("option", { name: "사용 안 함" }));

    expect(onChange).toHaveBeenCalledWith({ repeatAlertEnabled: false });
  });

  it("labels manual experience debug values as signal-based baselines", () => {
    renderPanel({
      showDebug: true,
      config: {
        ...config,
        mode: "manual-experience",
        manualExperienceRegion: { x: 0.33, y: 0.96, width: 0.34, height: 0.01 },
      },
      state: {
        ...state,
        lastDecision: "pending",
        pendingRecognizedText: "1,530,768,605,710 [11.121%]",
        pendingRecognizedCount: 1,
        changeScore: 0.18,
      },
      snapshot: {
        ...snapshot,
        mode: "manual-experience",
        changeScore: 0.18,
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "사냥 멈춤 알림 설정 펼치기" }));

    expect(screen.getByLabelText("사냥 멈춤 디버그 패널")).toBeInTheDocument();
    expect(screen.getByText("기준값")).toBeInTheDocument();
    expect(screen.getAllByText("변화 후보").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText("상세 진단"));
    expect(screen.getByText("변화 신호")).toBeInTheDocument();
  });

  it("shows the accepted manual experience baseline instead of the latest raw sample", () => {
    renderPanel({
      showDebug: true,
      config: {
        ...config,
        mode: "manual-experience",
        manualExperienceRegion: { x: 0.33, y: 0.96, width: 0.34, height: 0.01 },
      },
      state: {
        ...state,
        recognizedText: "1,100 [11.000%]",
      },
      snapshot: {
        ...snapshot,
        mode: "manual-experience",
        recognizedText: "1,200 [12.000%]",
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "사냥 멈춤 알림 설정 펼치기" }));

    expect(screen.getByText("기준값")).toBeInTheDocument();
    const debugSummary = screen.getByLabelText("사냥 멈춤 핵심 진단값");
    expect(within(debugSummary).getByText("1,100 [11.000%]")).toBeInTheDocument();
    expect(within(debugSummary).queryByText("1,200 [12.000%]")).not.toBeInTheDocument();
  });

  it("keeps the manual experience info tooltip concise", () => {
    renderPanel({
      config: {
        ...config,
        mode: "manual-experience",
        manualExperienceRegion: { x: 0.33, y: 0.96, width: 0.34, height: 0.01 },
      },
      snapshot: {
        ...snapshot,
        mode: "manual-experience",
      },
    });

    const infoTooltip = screen.getByRole("button", { name: "사냥 멈춤 알림 안내" });
    expect(infoTooltip).toHaveTextContent("사용 안내");

    expect(screen.queryByRole("button", { name: "경험치 인식 로직 테스트 안내" })).not.toBeInTheDocument();

    fireEvent.focus(infoTooltip);

    expect(screen.getByText("화면 중하단에서 경험치바 윗선을 한 번 클릭해 높이를 지정합니다.")).toBeInTheDocument();
    expect(
      screen.getByText("정확한 경험치 숫자보다 전처리된 숫자 영역의 모양이 바뀌었는지를 우선 봅니다."),
    ).toBeInTheDocument();
    expect(screen.queryByText("같은 새 숫자 모양이 반복 확인될 때만 사냥 중으로 확정합니다.")).not.toBeInTheDocument();
    expect(
      screen.queryByText("읽기 실패는 멈춤 시간으로 세지 않아 인식 흔들림으로 인한 오탐을 줄입니다."),
    ).not.toBeInTheDocument();
  });

  it("shows the region picker in the expanded manual experience settings", () => {
    const onOpenRegionPicker = vi.fn();
    renderPanel({
      config: {
        ...config,
        mode: "manual-experience",
        manualExperienceRegion: { x: 0.33, y: 0.96, width: 0.34, height: 0.01 },
      },
      snapshot: {
        ...snapshot,
        mode: "manual-experience",
      },
      onOpenRegionPicker,
    });

    fireEvent.click(screen.getByRole("button", { name: "사냥 멈춤 알림 설정 펼치기" }));
    fireEvent.click(screen.getByRole("button", { name: "영역 선택" }));

    expect(onOpenRegionPicker).toHaveBeenCalledTimes(1);
  });

  it("starts manual experience height selection from the collapsed status detail when no region is set", () => {
    const onOpenRegionPicker = vi.fn();
    renderPanel({
      config: {
        ...config,
        mode: "manual-experience",
        manualExperienceRegion: null,
        manualExperienceRegionsByLayout: {},
      },
      snapshot: null,
      onOpenRegionPicker,
    });

    fireEvent.click(screen.getByRole("button", { name: "경험치바 높이 선택" }));

    expect(onOpenRegionPicker).toHaveBeenCalledTimes(1);
  });

  it("does not render disabled hunt stall missing region states as actions", () => {
    const { unmount } = renderPanel({
      config: {
        ...config,
        enabled: false,
        mode: "manual-experience",
        manualExperienceRegion: null,
        manualExperienceRegionsByLayout: {},
      },
      snapshot: null,
    });

    expect(screen.queryByRole("button", { name: "경험치바 높이 선택" })).not.toBeInTheDocument();

    unmount();

    renderPanel({
      config: {
        ...config,
        enabled: false,
        mode: "cooldown-presence",
        cooldownRegion: null,
        cooldownRegionsByLayout: {},
      },
      snapshot: null,
    });

    expect(screen.queryByRole("button", { name: "쿨타임 영역 선택" })).not.toBeInTheDocument();
  });

  it("shows the selected manual experience band as a full-width original crop preview", () => {
    const onOpenRegionPicker = vi.fn();
    const { container } = renderPanel({
      config: {
        ...config,
        mode: "manual-experience",
        manualExperienceRegion: { x: 0.33, y: 0.96, width: 0.34, height: 0.01 },
      },
      snapshot: {
        ...snapshot,
        mode: "manual-experience",
      },
      onOpenRegionPicker,
    });

    expect(screen.getAllByText("상태 설명")).toHaveLength(1);
    expect(screen.getByText("경험치 변화 감시 중")).toBeInTheDocument();

    const cropPreviewButton = screen.getByRole("button", { name: "경험치바 확인" });
    const cropPreview = cropPreviewButton.querySelector("img");
    expect(cropPreview).toHaveAttribute("src", snapshot.displayPreviewUrl);
    expect(cropPreviewButton.querySelector(".manual-experience-row-preview-frame")).toBeInTheDocument();
    expect(cropPreviewButton.closest(".hunt-stall-manual-preview-row")).toBeInTheDocument();
    expect(
      container.querySelector(".hunt-crop-preview .manual-experience-row-preview-frame"),
    ).not.toBeInTheDocument();

    const rowOrder = Array.from(container.querySelectorAll("tbody tr")).map((row) => row.className);
    expect(rowOrder[0]).toContain("hunt-stall-row");
    expect(rowOrder[1]).toContain("hunt-stall-manual-preview-row");
    expect(rowOrder[2]).toContain("hunt-stall-editor-row");

    expect(
      container.querySelector(".manual-experience-status-detail .status-detail-metric-value"),
    ).toHaveTextContent("경험치 변화 감시 중");

    expect(cropPreviewButton.closest(".manual-experience-row-preview")).not.toHaveTextContent(
      "경험치바 Crop",
    );

    fireEvent.click(cropPreviewButton);

    expect(onOpenRegionPicker).toHaveBeenCalledTimes(1);
  });

  it("renders live manual experience previews with canvas image data when available", () => {
    const snapshotWithImageData: HuntStallSnapshot = {
      ...snapshot,
      displayPreviewImageData: createImageSnapshot(),
      rawPreviewImageData: createImageSnapshot(),
      processedPreviewImageData: createImageSnapshot(),
    };

    const { container } = renderPanel({
      showDebug: true,
      snapshot: snapshotWithImageData,
    });

    expect(
      container.querySelector(".manual-experience-row-preview-frame canvas"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "사냥 멈춤 알림 설정 펼치기" }));
    expect(screen.getByRole("img", { name: "경험치바 감지 영역" }).tagName).toBe("CANVAS");
    expect(screen.getByRole("img", { name: "경험치 숫자 전처리 디버그" }).tagName).toBe(
      "CANVAS",
    );
  });

  it("renders manual experience crop previews from image data without requiring a data url", () => {
    const snapshotWithImageDataOnly: HuntStallSnapshot = {
      ...snapshot,
      displayPreviewUrl: null,
      rawPreviewUrl: null,
      displayPreviewImageData: createImageSnapshot(),
      rawPreviewImageData: null,
    };
    const { container } = renderPanel({
      snapshot: snapshotWithImageDataOnly,
    });

    expect(screen.getByRole("button", { name: "경험치바 확인" })).toBeInTheDocument();
    expect(
      container.querySelector(".manual-experience-row-preview-frame canvas"),
    ).toBeInTheDocument();
  });

  it("shows the issue report button in the expanded settings strip", () => {
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "사냥 멈춤 알림 설정 펼치기" }));

    expect(screen.getByText("알림음")).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "볼륨 80%" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "감지 제보" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "영역 선택" })).toBeInTheDocument();
  });

  it("toggles the hunt stall editor controls from the row action", () => {
    const { container } = renderPanel();

    expect(screen.queryByRole("button", { name: "감지 제보" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "사냥 멈춤 알림 설정 펼치기" }));
    expect(screen.getByRole("button", { name: "감지 제보" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "사냥 멈춤 알림 설정 접기" }));
    const editorShell = container.querySelector(".hunt-stall-editor-row .inline-editor-shell");
    expect(editorShell).toBeInTheDocument();
    fireEvent.transitionEnd(editorShell as Element, { propertyName: "max-height" });

    expect(screen.queryByRole("button", { name: "감지 제보" })).not.toBeInTheDocument();
  });

  it("keeps the hunt crop preview only in debug mode", () => {
    const { container } = renderPanel({ snapshot: null });

    fireEvent.click(screen.getByRole("button", { name: "사냥 멈춤 알림 설정 펼치기" }));

    expect(container.querySelector(".hunt-editor-crop-preview")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("사냥 멈춤 디버그 패널")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "디버그 전송" })).not.toBeInTheDocument();

    cleanup();
    const debugRender = renderPanel({ snapshot: null, showDebug: true });
    fireEvent.click(screen.getByRole("button", { name: "사냥 멈춤 알림 설정 펼치기" }));
    expect(screen.getAllByText("경험치바 확인").length).toBeGreaterThan(0);
    expect(debugRender.container.querySelector(".hunt-editor-crop-preview .crop-placeholder")).toBeInTheDocument();
  });

  it("renders the hunt stall debug diagnostics from the latest snapshot", () => {
    renderPanel({ showDebug: true });

    fireEvent.click(screen.getByRole("button", { name: "사냥 멈춤 알림 설정 펼치기" }));

    expect(screen.getByLabelText("사냥 멈춤 디버그 패널")).toBeInTheDocument();
    expect(screen.getByText("Debug")).toBeInTheDocument();
    expect(screen.getByText("안정값 유지")).toBeInTheDocument();
    expect(screen.getByLabelText("전송될 화면")).toBeInTheDocument();
    expect(screen.getByAltText("경험치바 감지 영역")).toHaveAttribute("src", snapshot.rawPreviewUrl);
    expect(screen.getByAltText("경험치 숫자 전처리 디버그")).toHaveAttribute("src", snapshot.processedPreviewUrl);
    expect(screen.getByLabelText("사냥 멈춤 핵심 진단값")).toBeInTheDocument();

    fireEvent.click(screen.getByText("상세 진단"));
    expect(screen.getByLabelText("사냥 멈춤 상세 진단값")).toBeInTheDocument();
    expect(screen.getByText("처리")).toBeInTheDocument();
    expect(screen.getByText("17.5ms")).toBeInTheDocument();
    expect(screen.getByText("프레임")).toBeInTheDocument();
    expect(screen.getByText("1.3ms")).toBeInTheDocument();
    expect(screen.getByText("인식")).toBeInTheDocument();
    expect(screen.getByText("4.8ms")).toBeInTheDocument();
  });

  it("submits a hunt stall debug sample only when a payload is available", () => {
    const onSubmitDebugSample = vi.fn();
    renderPanel({ showDebug: true, onSubmitDebugSample });

    fireEvent.click(screen.getByRole("button", { name: "사냥 멈춤 알림 설정 펼치기" }));
    fireEvent.click(screen.getByRole("button", { name: "디버그 전송" }));

    expect(onSubmitDebugSample).toHaveBeenCalledTimes(1);

    cleanup();
    renderPanel({ snapshot: null, showDebug: true, onSubmitDebugSample });

    fireEvent.click(screen.getByRole("button", { name: "사냥 멈춤 알림 설정 펼치기" }));

    expect(screen.getByRole("button", { name: "디버그 전송" })).toBeDisabled();
  });

  it("shows hunt stall guidance in the tooltip", () => {
    renderPanel();

    fireEvent.focus(screen.getByRole("button", { name: "사냥 멈춤 알림 안내" }));

    expect(screen.getByText("직접 선택한 경험치바 높이에서 경험치 변화를 감시합니다.")).toBeInTheDocument();
    expect(screen.getByText("화면 중하단에서 경험치바 윗선을 한 번 클릭해 높이를 지정합니다.")).toBeInTheDocument();
    expect(screen.getByText("경험치 변화가 설정 시간 동안 없으면 사냥이 멈춘 것으로 보고 알림을 울립니다.")).toBeInTheDocument();
    expect(screen.queryByText("솔 헤카테가 꺼져 있는지 확인해주세요.")).not.toBeInTheDocument();
  });

  it("shows cooldown-specific hunt stall guidance in cooldown mode", () => {
    renderPanel({
      config: {
        ...config,
        mode: "cooldown-presence",
        cooldownRegion: { x: 10, y: 20, width: 40, height: 40 },
      },
    });

    const cooldownModeButton = screen.getByRole("button", { name: "쿨타임 인식" });
    expect(cooldownModeButton.querySelector(".hunt-mode-beta-badge")).not.toBeInTheDocument();
    fireEvent.focus(screen.getByRole("button", { name: "사냥 멈춤 알림 안내" }));

    expect(screen.getByText("선택한 쿨타임 아이콘의 숫자와 화면 변화를 감시합니다.")).toBeInTheDocument();
    expect(screen.getByText("쿨타임 숫자가 계속 바뀌는 짧은 쿨타임 스킬에 사용합니다.")).toBeInTheDocument();
    expect(screen.getByText("선택한 Crop에서 쿨타임 숫자를 먼저 안정적으로 확인합니다.")).toBeInTheDocument();
    expect(screen.getByText("숫자와 Crop 화면 변화가 모두 멈추면 사냥이 멈춘 것으로 판단합니다.")).toBeInTheDocument();
    expect(screen.getByText("노란색 계열 아이콘이나 숫자와 배경의 대비가 낮은 스킬은 감지가 불안정할 수 있습니다.")).toBeInTheDocument();
  });

  it("shows the UI size guidance in the checklist tooltip", () => {
    renderPanel({ isSectionCollapsed: true });

    fireEvent.focus(screen.getByRole("button", { name: "사냥 멈춤 알림 체크리스트" }));

    expect(screen.getByText("사냥 멈춤 알림 전 확인해주세요.")).toBeInTheDocument();
    expect(
      screen.getByText(
        "확장 UI를 사용한다면 화면 공유 메뉴에서 게임 영역을 설정해주세요.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("솔 헤카테가 꺼져 있는지 확인해주세요.")).toBeInTheDocument();
    expect(screen.getByText("UI 크기가 [최적 비율]인지 확인해주세요.")).toBeInTheDocument();
    expect(screen.getByAltText("UI 크기가 최적 비율로 설정된 예시")).toHaveAttribute(
      "src",
      "/media/ui-size-optimal-ratio.png",
    );
  });

  it("does not show launch badges for manual experience detection", () => {
    renderPanel({
      config: {
        ...config,
        mode: "manual-experience",
      },
      snapshot: {
        ...snapshot,
        mode: "manual-experience",
      },
    });

    const manualModeButton = screen.getByRole("button", { name: "경험치 인식" });
    expect(manualModeButton.querySelector(".hunt-mode-new-badge")).toBeNull();
    expect(screen.queryByRole("button", { name: "경험치 인식 로직 테스트 안내" })).not.toBeInTheDocument();
    expect(screen.queryByText("로직 테스트 중")).not.toBeInTheDocument();
  });

  it("can switch the hunt stall detection mode to cooldown numbers", () => {
    const onChange = vi.fn();
    renderPanel({ onChange });

    expect(screen.getByRole("button", { name: "경험치 인식" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "쿨타임 인식" })).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(screen.getByRole("button", { name: "쿨타임 인식" }));

    expect(onChange).toHaveBeenCalledWith({
      mode: "cooldown-presence",
    });
  });

  it("shows cooldown region selection when cooldown mode has no region", () => {
    const onOpenRegionPicker = vi.fn();
    renderPanel({
      config: {
        ...config,
        mode: "cooldown-presence",
        cooldownRegion: null,
      },
      snapshot: null,
      canPickRegion: true,
      onOpenRegionPicker,
    });

    expect(screen.getByRole("button", { name: "쿨타임 인식" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Crop")).toBeInTheDocument();
    expect(screen.getAllByText("판독값")).toHaveLength(2);
    expect(screen.getByLabelText("쿨타임 판독값 영역 필요")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "쿨타임 영역 선택" }));

    expect(onOpenRegionPicker).toHaveBeenCalledTimes(1);
  });

  it("uses a compact detection value cell instead of the experience bar in cooldown mode", () => {
    vi.useFakeTimers();
    vi.setSystemTime(23_000);
    const { container } = renderPanel({
      config: {
        ...config,
        mode: "cooldown-presence",
        cooldownRegion: { x: 10, y: 20, width: 40, height: 40 },
      },
      state: {
        ...state,
        lastChangedAt: 20_000,
        lastSampledAt: 23_000,
        recognizedText: "7",
        unchangedSeconds: 3,
        hasObservedCooldownPresence: true,
        cooldownConsecutiveReadableCount: 2,
        lastDecision: "cooldown-readable",
      },
      snapshot: {
        ...snapshot,
        mode: "cooldown-presence",
        recognizedText: "7",
      },
    });

    expect(screen.getAllByText("판독값")).toHaveLength(2);
    expect(screen.getByLabelText("쿨타임 판독값 7")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "쿨타임 숫자 감지 영역" })).toBeInTheDocument();
    expect(screen.getAllByText("마지막 변화")).toHaveLength(2);
    expect(screen.getByLabelText("3초 전")).toBeInTheDocument();
    expect(screen.queryByText("확인 중 2회")).not.toBeInTheDocument();
  });

  it("does not reuse experience previews or show a region action when cooldown region exists", () => {
    const { container } = renderPanel({
      config: {
        ...config,
        mode: "cooldown-presence",
        cooldownRegion: { x: 10, y: 20, width: 40, height: 40 },
      },
      snapshot: {
        ...snapshot,
        mode: "manual-experience",
        rawPreviewUrl: "data:image/png;base64,manual-raw",
        displayPreviewUrl: "data:image/png;base64,manual-display",
      },
      canPickRegion: true,
    });

    expect(screen.queryByRole("img", { name: "쿨타임 숫자 감지 영역" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "쿨타임 확인" })).not.toBeInTheDocument();
    expect(screen.getByText("쿨타임 확인")).toBeInTheDocument();
    expect(container.querySelector(".hunt-crop-preview .crop-placeholder")).not.toBeInTheDocument();
    expect(container.querySelector(".hunt-crop-preview .crop-unavailable-text")).toBeInTheDocument();
  });

  it("keeps alerted cooldown status compact", () => {
    vi.useFakeTimers();
    vi.setSystemTime(24_000);
    renderPanel({
      config: {
        ...config,
        mode: "cooldown-presence",
        cooldownRegion: { x: 10, y: 20, width: 40, height: 40 },
      },
      state: {
        ...state,
        status: "alerted",
        lastSampledAt: 24_000,
        lastChangedAt: 20_000,
        alertedAt: 10_000,
        recognizedText: "7",
        alertedRecognizedText: "7",
        unchangedSeconds: 0,
        hasObservedCooldownPresence: true,
        lastDecision: "cooldown-alerted",
      },
      snapshot: {
        ...snapshot,
        mode: "cooldown-presence",
        recognizedText: "7",
      },
    });

    expect(screen.getAllByText("마지막 변화")).toHaveLength(2);
    expect(screen.getByLabelText("4초 전")).toBeInTheDocument();
    expect(screen.queryByText("마지막 판독값")).not.toBeInTheDocument();
    expect(screen.getByText("알림 완료")).toBeInTheDocument();
    expect(screen.queryByText("알림 후 14초")).not.toBeInTheDocument();
    expect(screen.queryByText("0초 변화 없음")).not.toBeInTheDocument();
  });

  it("does not show rejected cooldown OCR text as a detected value", () => {
    renderPanel({
      config: {
        ...config,
        mode: "cooldown-presence",
        cooldownRegion: { x: 10, y: 20, width: 40, height: 40 },
      },
      state: {
        ...state,
        recognizedText: "7",
        hasObservedCooldownPresence: true,
        cooldownUsedVisualActivity: true,
        lastRejectedRecognizedText: "19",
        lastDecision: "cooldown-visual-active",
      },
      snapshot: {
        ...snapshot,
        mode: "cooldown-presence",
        recognizedText: "19",
      },
    });

    expect(screen.getByLabelText("쿨타임 판독값 화면 변화")).toBeInTheDocument();
    expect(screen.queryByText("19")).not.toBeInTheDocument();
    expect(screen.queryByText("숫자 불안정")).not.toBeInTheDocument();
  });

  it("explains the cooldown missing threshold in cooldown mode", () => {
    renderPanel({
      config: {
        ...config,
        mode: "cooldown-presence",
        cooldownRegion: { x: 10, y: 20, width: 40, height: 40 },
      },
    });

    const thresholdTooltip = screen.getByRole("button", { name: "쿨타임 변화 없음 기준 안내" });
    expect(thresholdTooltip).toHaveTextContent("판정 기준");
    fireEvent.focus(thresholdTooltip);

    expect(screen.getByText("숫자와 화면 변화가 모두 멈춘 시간이 멈춤 기준입니다.")).toBeInTheDocument();
    expect(screen.getByText("선택한 Crop에서 쿨타임 숫자를 먼저 안정적으로 확인합니다.")).toBeInTheDocument();
    expect(screen.getByText("이후 숫자가 바뀌거나 Crop 화면에 변화가 있으면 정상 활동으로 봅니다.")).toBeInTheDocument();
    expect(screen.getByText("숫자와 화면 변화가 모두 멈춘 시간이 멈춤 기준 이상 이어지면 알림을 울립니다.")).toBeInTheDocument();
    expect(screen.getByText("한 번 알림이 울리면 자동 반복하지 않으며, 다시 감시하려면 초기화해 주세요.")).toBeInTheDocument();
  });

  it("shows that hunt stall monitoring is waiting until experience first increases", () => {
    renderPanel({
      state: {
        ...state,
        status: "watching",
        unchangedSeconds: 8,
        hasObservedExperienceChange: false,
      },
    });

    expect(screen.getByText("시작 대기")).toBeInTheDocument();
    expect(screen.getAllByText("마지막 경험치 변화")).toHaveLength(2);
    expect(screen.getAllByText("--").length).toBeGreaterThan(0);
  });

  it("shows active monitoring as monitoring after experience changes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(24_000);
    renderPanel({
      state: {
        ...state,
        lastChangedAt: 20_000,
        lastSampledAt: 24_000,
        status: "active",
        unchangedSeconds: 4,
        hasObservedExperienceChange: true,
      },
    });

    expect(screen.getByText("감시 중")).toBeInTheDocument();
    expect(screen.getAllByText("마지막 경험치 변화")).toHaveLength(2);
    expect(screen.getByLabelText("4초 전")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    expect(screen.getByLabelText("5초 전")).toBeInTheDocument();
  });

  it("commits the stall threshold only after editing is finished", () => {
    const onChange = vi.fn();
    renderPanel({ onChange });

    const trigger = screen.getByRole("button", { name: /사냥 멈춤 기준/ });
    expect(trigger).toHaveTextContent("10초 무변동");
    fireEvent.click(trigger);

    const input = screen.getByLabelText("사냥 멈춤 기준");
    expect(input.closest(".threshold-control")).toHaveAttribute("data-range-hint", "5-120초");

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "999" } });

    expect(onChange).not.toHaveBeenCalled();
    expect(input).toHaveAttribute("aria-invalid", "true");

    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith({ stallThresholdSeconds: 120 });
  });
});

function createImageSnapshot() {
  return {
    width: 2,
    height: 2,
    data: new Uint8ClampedArray(2 * 2 * 4),
  };
}

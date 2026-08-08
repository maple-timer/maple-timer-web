import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RuneRuntimeState, RuneSnapshot } from "../../../alertTypes";
import { DEFAULT_ALERT_SOUND_ID } from "../../../lib/sounds";
import { setSliderValue } from "../../../test/slider";
import type { RuneAlertConfig } from "../../../types";
import { RuneAlertPanel } from "./RuneAlertPanel";

const config: RuneAlertConfig = {
  enabled: true,
  region: { x: 0.05, y: 0.15, width: 0.2, height: 0.1 },
  regionsByLayout: {},
  soundId: DEFAULT_ALERT_SOUND_ID,
  volume: 0.8,
};

const state: RuneRuntimeState = {
  status: "waiting",
  confidence: 0.72,
  stableCount: 0,
  firstDetectedAt: null,
  lastDetectedAt: null,
  lastFoundAt: null,
  alertedAt: null,
  lastRepeatedAlertAt: null,
  repeatedAlertCount: 0,
  lastAlertedAt: null,
  candidateCount: 1,
};

const snapshot: RuneSnapshot = {
  sampledAt: Date.now(),
  rawPreviewUrl: "data:image/png;base64,raw",
  maskPreviewUrl: "data:image/png;base64,mask",
  candidatePreviewUrl: "data:image/png;base64,candidate",
  candidateRawPreviewUrl: "data:image/png;base64,candidateRaw",
  candidateMaskPreviewUrl: "data:image/png;base64,candidateMask",
  candidateRegionLabel: "12x12",
  candidateSampledAt: Date.now(),
  candidate: { x: 10, y: 12, width: 12, height: 12, confidence: 0.72 },
  detected: false,
  confidence: 0.72,
  candidateCount: 1,
};

function renderPanel(
  showDebug = false,
  options: { config?: RuneAlertConfig; isGloballyDisabled?: boolean } = {},
) {
  return render(
    <RuneAlertPanel
      config={options.config ?? config}
      state={state}
      snapshot={snapshot}
      hasStream
      canPickRegion
      currentLayoutKey={null}
      showDebug={showDebug}
      isGloballyDisabled={options.isGloballyDisabled}
      onChange={() => undefined}
      onOpenRegionPicker={() => undefined}
      onResetDetection={() => undefined}
      alertVolume={0.8}
      onAlertVolumeChange={() => undefined}
      onPreviewSound={() => undefined}
      onSubmitDebugSample={() => undefined}
      isSubmittingDebugSample={false}
      onSubmitFalsePositive={() => undefined}
      isSubmittingFalsePositive={false}
    />,
  );
}

describe("RuneAlertPanel", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("hides the debug submit button outside debug mode", () => {
    renderPanel(false);

    expect(screen.queryByRole("button", { name: "디버그 전송" })).not.toBeInTheDocument();
  });

  it("shows screen sharing required before capture starts", () => {
    const { container } = render(
      <RuneAlertPanel
        config={{ ...config, region: null }}
        state={state}
        snapshot={null}
        hasStream={false}
        canPickRegion={false}
        currentLayoutKey={null}
        showDebug={false}
        onChange={() => undefined}
        onOpenRegionPicker={() => undefined}
        onResetDetection={() => undefined}
        alertVolume={0.8}
        onAlertVolumeChange={() => undefined}
        onPreviewSound={() => undefined}
        onSubmitDebugSample={() => undefined}
        isSubmittingDebugSample={false}
        onSubmitFalsePositive={() => undefined}
        isSubmittingFalsePositive={false}
      />,
    );

    expect(screen.queryByRole("button", { name: "미니맵 영역 선택" })).not.toBeInTheDocument();
    expect(screen.getAllByText("화면 공유 필요").length).toBeGreaterThan(0);
    const cropStatus = Array.from(container.querySelectorAll(".crop-unavailable-text")).find(
      (element) => element.textContent === "--",
    );
    expect(cropStatus).toBeDefined();
    expect(cropStatus).not.toHaveClass("crop-placeholder");
  });

  it("does not render rune waiting text inside the black crop placeholder", () => {
    render(
      <RuneAlertPanel
        config={config}
        state={state}
        snapshot={null}
        hasStream
        canPickRegion
        currentLayoutKey={null}
        showDebug={false}
        onChange={() => undefined}
        onOpenRegionPicker={() => undefined}
        onResetDetection={() => undefined}
        alertVolume={0.8}
        onAlertVolumeChange={() => undefined}
        onPreviewSound={() => undefined}
        onSubmitDebugSample={() => undefined}
        isSubmittingDebugSample={false}
        onSubmitFalsePositive={() => undefined}
        isSubmittingFalsePositive={false}
      />,
    );

    const runeWaitingText = screen
      .getAllByText("룬 대기")
      .find((element) => element.classList.contains("crop-unavailable-text"));
    expect(runeWaitingText).toBeDefined();
    expect(runeWaitingText as HTMLElement).toHaveClass("crop-unavailable-text");
    expect(runeWaitingText as HTMLElement).not.toHaveClass("crop-placeholder");
  });

  it("prioritizes the disabled status over missing screen share", () => {
    render(
      <RuneAlertPanel
        config={{ ...config, enabled: false }}
        state={state}
        snapshot={null}
        hasStream={false}
        canPickRegion={false}
        currentLayoutKey={null}
        showDebug={false}
        onChange={() => undefined}
        onOpenRegionPicker={() => undefined}
        onResetDetection={() => undefined}
        alertVolume={0.8}
        onAlertVolumeChange={() => undefined}
        onPreviewSound={() => undefined}
        onSubmitDebugSample={() => undefined}
        isSubmittingDebugSample={false}
        onSubmitFalsePositive={() => undefined}
        isSubmittingFalsePositive={false}
      />,
    );

    expect(screen.getByText("알림 꺼짐")).toBeInTheDocument();
    expect(screen.queryByText("화면 공유 후 미니맵 확인")).not.toBeInTheDocument();
  });

  it("shows a rune detector loading state while the worker is preparing", () => {
    render(
      <RuneAlertPanel
        config={config}
        state={{ ...state, status: "loading" }}
        snapshot={null}
        hasStream
        canPickRegion
        currentLayoutKey={null}
        showDebug={false}
        onChange={() => undefined}
        onOpenRegionPicker={() => undefined}
        onResetDetection={() => undefined}
        alertVolume={0.8}
        onAlertVolumeChange={() => undefined}
        onPreviewSound={() => undefined}
        onSubmitDebugSample={() => undefined}
        isSubmittingDebugSample={false}
        onSubmitFalsePositive={() => undefined}
        isSubmittingFalsePositive={false}
      />,
    );

    expect(screen.getByText("룬 감지 모듈 로딩 중")).toBeInTheDocument();
    expect(screen.getByText("로딩 중")).toBeInTheDocument();
  });

  it("does not render disabled rune crop states as region actions", () => {
    render(
      <RuneAlertPanel
        config={{ ...config, enabled: false }}
        state={state}
        snapshot={null}
        hasStream
        canPickRegion
        currentLayoutKey={null}
        showDebug={false}
        onChange={() => undefined}
        onOpenRegionPicker={() => undefined}
        onResetDetection={() => undefined}
        alertVolume={0.8}
        onAlertVolumeChange={() => undefined}
        onPreviewSound={() => undefined}
        onSubmitDebugSample={() => undefined}
        isSubmittingDebugSample={false}
        onSubmitFalsePositive={() => undefined}
        isSubmittingFalsePositive={false}
      />,
    );

    expect(screen.queryByRole("button", { name: "룬 대기" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "미니맵 영역 선택" })).not.toBeInTheDocument();
  });

it("shows debug controls only in debug mode", () => {
    renderPanel(true);

    fireEvent.click(screen.getByRole("button", { name: "룬 설정 펼치기" }));

    expect(screen.getByRole("button", { name: "디버그 전송" })).toBeInTheDocument();
    expect(screen.getByLabelText("룬 신뢰도")).toHaveTextContent("72%");
    expect(screen.getByAltText("룬 감지 마스크 디버그")).toBeInTheDocument();
  });

  it("renders live rune previews with canvas image data when available", () => {
    const snapshotWithImageData: RuneSnapshot = {
      ...snapshot,
      rawPreviewImageData: createImageSnapshot(),
      maskPreviewImageData: createImageSnapshot(),
      candidatePreviewImageData: createImageSnapshot(),
    };

    render(
      <RuneAlertPanel
        config={config}
        state={state}
        snapshot={snapshotWithImageData}
        hasStream
        canPickRegion
        currentLayoutKey={null}
        showDebug
        onChange={() => undefined}
        onOpenRegionPicker={() => undefined}
        onResetDetection={() => undefined}
        alertVolume={0.8}
        onAlertVolumeChange={() => undefined}
        onPreviewSound={() => undefined}
        onSubmitDebugSample={() => undefined}
        isSubmittingDebugSample={false}
        onSubmitFalsePositive={() => undefined}
        isSubmittingFalsePositive={false}
      />,
    );

    expect(screen.getByRole("img", { name: "룬 감지 미니맵 미리보기" }).tagName).toBe(
      "CANVAS",
    );
    expect(screen.getByRole("img", { name: "최근 감지된 룬 후보" }).tagName).toBe(
      "CANVAS",
    );

    fireEvent.click(screen.getByRole("button", { name: "룬 설정 펼치기" }));
    expect(screen.getByRole("img", { name: "룬 감지 마스크 디버그" }).tagName).toBe(
      "CANVAS",
    );
  });

  it("toggles the rune editor controls from the row action", () => {
    const { container } = renderPanel(false);

    expect(screen.queryByRole("button", { name: "감지 제보" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "룬 설정 펼치기" }));
    expect(screen.getByRole("button", { name: "영역 선택" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "감지 제보" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "룬 설정 접기" }));
    const editorShell = container.querySelector(".rune-editor-row .inline-editor-shell");
    expect(editorShell).toBeInTheDocument();
    fireEvent.transitionEnd(editorShell as Element, { propertyName: "max-height" });

    expect(screen.queryByRole("button", { name: "감지 제보" })).not.toBeInTheDocument();
  });

  it.each([
    { name: "rune alert is off", config: { ...config, enabled: false }, isGloballyDisabled: false },
    { name: "all alerts are off", config, isGloballyDisabled: true },
  ])("disables reporting when $name", ({ config: panelConfig, isGloballyDisabled }) => {
    renderPanel(false, { config: panelConfig, isGloballyDisabled });

    fireEvent.click(screen.getByRole("button", { name: "룬 설정 펼치기" }));

    expect(screen.getByRole("button", { name: "감지 제보" })).toBeDisabled();
  });

  it("describes that rune alert can be unstable", () => {
    renderPanel(false);

    const infoButton = screen.getByRole("button", { name: "룬 알림 안내" });
    expect(infoButton).toBeInTheDocument();
    expect(infoButton).toHaveTextContent("사용 안내");
    expect(screen.queryByText("선택한 미니맵 영역에서 룬 아이콘을 감지합니다.")).not.toBeInTheDocument();

    fireEvent.focus(infoButton);

    expect(screen.getByText("선택한 미니맵 영역에서 룬 아이콘을 감지합니다.")).toBeInTheDocument();
    expect(screen.getByText("미니맵 내부 지도 영역만 선택하면 오탐이 줄어듭니다.")).toBeInTheDocument();
    expect(screen.getByText("캐릭터와 룬이 겹쳐 있으면 감지되지 않을 수 있습니다.")).toBeInTheDocument();
  });

  it("shows the rune realtime update badge", () => {
    renderPanel(false);

    const updateBadge = screen.getByRole("button", { name: "룬 감지 업데이트 안내" });
    expect(updateBadge).toHaveTextContent("실시간 업데이트 중");

    fireEvent.focus(updateBadge);

    expect(screen.getByText("룬 감지는 계속 업데이트 중입니다.")).toBeInTheDocument();
    expect(screen.getByText(/룬 미감지나 오인식 제보를 바탕으로/)).toBeInTheDocument();
    expect(screen.getByText(/감지 제보를 보내주세요/)).toBeInTheDocument();
    expect(screen.getByText("최근 업데이트 : 8월 6일 13:30")).toBeInTheDocument();
  });

  it("updates rune volume through rune config", () => {
    const onChange = vi.fn();
    render(
      <RuneAlertPanel
        config={config}
        state={state}
        snapshot={snapshot}
        hasStream
        canPickRegion
        currentLayoutKey={null}
        showDebug={false}
        onChange={onChange}
        onOpenRegionPicker={() => undefined}
        onResetDetection={() => undefined}
        alertVolume={0.2}
        onAlertVolumeChange={() => undefined}
        onPreviewSound={() => undefined}
        onSubmitDebugSample={() => undefined}
        isSubmittingDebugSample={false}
        onSubmitFalsePositive={() => undefined}
        isSubmittingFalsePositive={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "룬 설정 펼치기" }));
    setSliderValue(screen.getByRole("slider", { name: "볼륨 80%" }), 0.45);

    expect(onChange).toHaveBeenCalledWith({ volume: 0.45 });
  });

  it("edits rune repeat alert settings from the main row", () => {
    const onChange = vi.fn();
    render(
      <RuneAlertPanel
        config={config}
        state={state}
        snapshot={snapshot}
        hasStream
        canPickRegion
        currentLayoutKey={null}
        showDebug={false}
        onChange={onChange}
        onOpenRegionPicker={() => undefined}
        onResetDetection={() => undefined}
        alertVolume={0.8}
        onAlertVolumeChange={() => undefined}
        onPreviewSound={() => undefined}
        onSubmitDebugSample={() => undefined}
        isSubmittingDebugSample={false}
        onSubmitFalsePositive={() => undefined}
        isSubmittingFalsePositive={false}
      />,
    );

    const repeatIntervalButton = screen.getByRole("button", { name: "룬 반복 알림 간격" });

    expect(repeatIntervalButton).toHaveTextContent("사용 안 함");

    fireEvent.click(repeatIntervalButton);
    expect(
      screen
        .getAllByRole("option")
        .filter((option) => option.getAttribute("aria-selected") === "true"),
    ).toHaveLength(1);
    fireEvent.click(screen.getByRole("option", { name: "3초 간격" }));
    expect(onChange).toHaveBeenCalledWith({
      repeatAlertEnabled: true,
      repeatAlertIntervalSeconds: 3,
      repeatAlertMaxCount: 3,
    });

    cleanup();
    onChange.mockClear();
    render(
      <RuneAlertPanel
        config={{ ...config, repeatAlertEnabled: true, repeatAlertIntervalSeconds: 3 }}
        state={state}
        snapshot={snapshot}
        hasStream
        canPickRegion
        currentLayoutKey={null}
        showDebug={false}
        onChange={onChange}
        onOpenRegionPicker={() => undefined}
        onResetDetection={() => undefined}
        alertVolume={0.8}
        onAlertVolumeChange={() => undefined}
        onPreviewSound={() => undefined}
        onSubmitDebugSample={() => undefined}
        isSubmittingDebugSample={false}
        onSubmitFalsePositive={() => undefined}
        isSubmittingFalsePositive={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "룬 반복 알림 간격" }));
    fireEvent.click(screen.getByRole("option", { name: "사용 안 함" }));
    expect(onChange).toHaveBeenCalledWith({ repeatAlertEnabled: false });

    onChange.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "룬 반복 알림 간격" }));
    fireEvent.click(screen.getByRole("option", { name: "5초 간격" }));
    expect(onChange).toHaveBeenCalledWith({
      repeatAlertEnabled: true,
      repeatAlertIntervalSeconds: 5,
      repeatAlertMaxCount: null,
    });

    onChange.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "룬 반복 알림 간격" }));
    fireEvent.click(screen.getByRole("option", { name: "2회 반복" }));
    expect(onChange).toHaveBeenCalledWith({
      repeatAlertEnabled: true,
      repeatAlertIntervalSeconds: 3,
      repeatAlertMaxCount: 2,
    });
  });

  it("shows the latest detected rune candidate and exposes false positive reporting", () => {
    renderPanel(false);

    expect(screen.getByText("최근 감지")).toBeInTheDocument();
    expect(screen.getByAltText("최근 감지된 룬 후보")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "룬 설정 펼치기" }));

    expect(screen.getByRole("button", { name: "감지 제보" })).toBeEnabled();
    const infoButton = screen.getByRole("button", { name: "룬 감지 제보 안내" });
    fireEvent.focus(infoButton);
    expect(screen.getByText("감지가 이상하면 샘플을 보내주세요.")).toBeInTheDocument();
    expect(screen.getByText(/실제 룬 알림이 울린 후보만/)).toBeInTheDocument();
    expect(screen.getByText(/룬이 떴는데 감지가 안 되거나/)).toBeInTheDocument();
    expect(screen.getByText(/보내주신 샘플을 확인해/)).toHaveTextContent("빠르게 수정하겠습니다");
    expect(screen.queryByText(/1시간에 최대 10회/)).not.toBeInTheDocument();
  });

  it("shows the latest confirmed rune found time in the rune detection column", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);

    const { container } = render(
      <RuneAlertPanel
        config={config}
        state={{
          ...state,
          status: "waiting",
          alertedAt: null,
          firstDetectedAt: null,
          lastFoundAt: 4_000,
          lastRepeatedAlertAt: null,
          lastAlertedAt: 5_000,
          lastDetectedAt: null,
        }}
        snapshot={{ ...snapshot, candidateSampledAt: 8_000 }}
        hasStream
        canPickRegion
        currentLayoutKey={null}
        showDebug={false}
        onChange={() => undefined}
        onOpenRegionPicker={() => undefined}
        onResetDetection={() => undefined}
        alertVolume={0.8}
        onAlertVolumeChange={() => undefined}
        onPreviewSound={() => undefined}
        onSubmitDebugSample={() => undefined}
        isSubmittingDebugSample={false}
        onSubmitFalsePositive={() => undefined}
        isSubmittingFalsePositive={false}
      />,
    );

    expect(screen.getAllByText("룬 감지")).toHaveLength(2);
    expect(container.querySelectorAll('[aria-label="6초 전"]')).toHaveLength(1);
    expect(screen.queryByText("5초 전")).not.toBeInTheDocument();
    expect(screen.queryByText("2초 전")).not.toBeInTheDocument();
  });

  it("allows reporting even when the latest rune candidate is empty", () => {
    render(
      <RuneAlertPanel
        config={config}
        state={state}
        snapshot={null}
        hasStream
        canPickRegion
        currentLayoutKey={null}
        showDebug={false}
        onChange={() => undefined}
        onOpenRegionPicker={() => undefined}
        onResetDetection={() => undefined}
        alertVolume={0.8}
        onAlertVolumeChange={() => undefined}
        onPreviewSound={() => undefined}
        onSubmitDebugSample={() => undefined}
        isSubmittingDebugSample={false}
        onSubmitFalsePositive={() => undefined}
        isSubmittingFalsePositive={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "룬 설정 펼치기" }));

    expect(screen.getByRole("button", { name: "감지 제보" })).toBeEnabled();
  });
});

function createImageSnapshot() {
  return {
    width: 2,
    height: 2,
    data: new Uint8ClampedArray(2 * 2 * 4),
  };
}

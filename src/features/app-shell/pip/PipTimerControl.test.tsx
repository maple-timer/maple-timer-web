import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  trackPipTimerConfigChanged,
  trackPipTimerSettingsOpen,
  trackPipTimerToggle,
} from "../../../lib/analyticsEvents";
import type { RuneRuntimeState } from "../../../alertTypes";
import { createSpecialCoreRuntimeState } from "../../../lib/specialCore";
import { DEFAULT_PIP_TIMER_CONFIG } from "../../../lib/pipTimerSettings";
import { createDefaultSpecialCoreAlert } from "../../../lib/storage";
import type { PipTimerConfig } from "../../../types";
import { PipTimerControl } from "./PipTimerControl";

vi.mock("../../../lib/analyticsEvents", () => ({
  trackPipTimerConfigChanged: vi.fn(),
  trackPipTimerSettingsOpen: vi.fn(),
  trackPipTimerToggle: vi.fn(),
}));

const trackPipTimerConfigChangedMock = vi.mocked(trackPipTimerConfigChanged);
const trackPipTimerSettingsOpenMock = vi.mocked(trackPipTimerSettingsOpen);
const trackPipTimerToggleMock = vi.mocked(trackPipTimerToggle);

const runeState: RuneRuntimeState = {
  status: "waiting",
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

function renderPipTimerControl({
  config = DEFAULT_PIP_TIMER_CONFIG,
  isAllAlertsDisabled = false,
  hasActiveAlerts = true,
  masterVolume = 0.8,
  onConfigChange = vi.fn(),
  onToggleAllAlertsDisabled = vi.fn(),
  onMasterVolumeChange = vi.fn(),
  onMessage = vi.fn(),
}: {
  config?: PipTimerConfig;
  isAllAlertsDisabled?: boolean;
  hasActiveAlerts?: boolean;
  masterVolume?: number;
  onConfigChange?: (patch: Partial<PipTimerConfig>) => void;
  onToggleAllAlertsDisabled?: (disabled: boolean) => void;
  onMasterVolumeChange?: (volume: number) => void;
  onMessage?: (message: string) => void;
} = {}) {
  render(
    <PipTimerControl
      skills={[]}
      states={{}}
      runeConfig={null}
      runeState={runeState}
      generalTimers={[]}
      huntStallConfig={null}
      huntStallState={null}
      buffExpiryConfig={null}
      buffExpiryState={null}
      specialCoreConfig={createDefaultSpecialCoreAlert()}
      specialCoreState={createSpecialCoreRuntimeState()}
      config={config}
      isAllAlertsDisabled={isAllAlertsDisabled}
      hasActiveAlerts={hasActiveAlerts}
      masterVolume={masterVolume}
      onConfigChange={onConfigChange}
      onToggleAllAlertsDisabled={onToggleAllAlertsDisabled}
      onMasterVolumeChange={onMasterVolumeChange}
      onMessage={onMessage}
    />,
  );

  return {
    onConfigChange,
    onToggleAllAlertsDisabled,
    onMasterVolumeChange,
    onMessage,
  };
}

function removeDocumentPictureInPicture() {
  Object.defineProperty(window, "documentPictureInPicture", {
    value: undefined,
    configurable: true,
  });
}

function installDocumentPictureInPictureMock() {
  const pipDocument = document.implementation.createHTMLDocument("pip");
  const pipWindowMock = {
    closed: false,
    document: pipDocument,
    addEventListener: vi.fn(),
    close: vi.fn(() => {
      pipWindowMock.closed = true;
    }),
    resizeTo: vi.fn(),
  };
  const pipWindow = pipWindowMock as unknown as Window;
  const requestWindow = vi.fn().mockResolvedValue(pipWindow);

  Object.defineProperty(window, "documentPictureInPicture", {
    value: { requestWindow },
    configurable: true,
  });

  return { pipWindow, requestWindow };
}

function openPipMakerFinalStep() {
  fireEvent.click(screen.getByRole("button", { name: "PIP 타이머 표시 설정" }));
  fireEvent.click(screen.getByRole("button", { name: "다음" }));
  fireEvent.click(screen.getByRole("button", { name: "다음" }));
}

describe("PipTimerControl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    removeDocumentPictureInPicture();
  });

  it("reports unsupported browsers when the PiP button is pressed without document PiP", () => {
    removeDocumentPictureInPicture();
    const { onMessage } = renderPipTimerControl();

    fireEvent.click(screen.getByRole("button", { name: "PIP 타이머" }));

    expect(onMessage).toHaveBeenCalledWith(
      expect.stringContaining("이 브라우저는 PIP 타이머를 지원하지 않습니다."),
    );
    expect(trackPipTimerToggleMock).toHaveBeenCalledWith("unsupported");
  });

  it("emits a visible item patch from the maker content step", () => {
    const { onConfigChange } = renderPipTimerControl();

    fireEvent.click(screen.getByRole("button", { name: "PIP 타이머 표시 설정" }));
    fireEvent.click(screen.getByRole("button", { name: "다음" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /스킬/ }));

    expect(trackPipTimerSettingsOpenMock).toHaveBeenCalledTimes(1);
    expect(trackPipTimerConfigChangedMock).toHaveBeenCalledWith("visible_item", {
      item: "skills",
      value: false,
    });
    expect(onConfigChange).toHaveBeenCalledWith({
      visibleItems: {
        ...DEFAULT_PIP_TIMER_CONFIG.visibleItems,
        skills: false,
      },
    });
  });

  it("emits a shared screen preview patch from the maker content step", () => {
    const { onConfigChange } = renderPipTimerControl();

    fireEvent.click(screen.getByRole("button", { name: "PIP 타이머 표시 설정" }));
    fireEvent.click(screen.getByRole("button", { name: "다음" }));
    fireEvent.click(screen.getByRole("switch", { name: /공유 화면 함께 보기/ }));

    expect(trackPipTimerConfigChangedMock).toHaveBeenCalledWith("screen_preview", {
      value: true,
    });
    expect(onConfigChange).toHaveBeenCalledWith({ showScreenPreview: true });
  });

  it("preserves hunting-only preview options when switching to special core mode", () => {
    const { onConfigChange } = renderPipTimerControl({
      config: {
        ...DEFAULT_PIP_TIMER_CONFIG,
        showScreenPreview: true,
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "PIP 타이머 표시 설정" }));
    fireEvent.click(screen.getByRole("radio", { name: /보스용 특수코어/ }));

    expect(trackPipTimerConfigChangedMock).toHaveBeenCalledWith("mode", {
      value: "specialCore",
    });
    expect(onConfigChange).toHaveBeenCalledWith({
      mode: "specialCore",
    });
    expect(trackPipTimerConfigChangedMock).not.toHaveBeenCalledWith("screen_preview", {
      value: false,
    });
  });

  it("uses one-based maker steps and keeps back navigation available after the first step", () => {
    renderPipTimerControl();

    fireEvent.click(screen.getByRole("button", { name: "PIP 타이머 표시 설정" }));

    expect(screen.getByText("1 / 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1 사용 모드" })).toHaveAttribute(
      "aria-current",
      "step",
    );

    fireEvent.click(screen.getByRole("button", { name: "다음" }));

    expect(screen.getByText("2 / 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "이전" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2 표시 항목" })).toHaveAttribute(
      "aria-current",
      "step",
    );

    fireEvent.click(screen.getByRole("button", { name: "다음" }));

    expect(screen.getByText("3 / 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "3 화면 모양" })).toHaveAttribute(
      "aria-current",
      "step",
    );
    expect(screen.getByRole("button", { name: "PIP로 미리보기" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "PIP 시작" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "이전" }));

    expect(screen.getByText("2 / 3")).toBeInTheDocument();
  });

  it("emits appearance patches and tries to open PiP from the maker preview action", async () => {
    removeDocumentPictureInPicture();
    const { onConfigChange, onMessage } = renderPipTimerControl();

    fireEvent.click(screen.getByRole("button", { name: "PIP 타이머 표시 설정" }));
    fireEvent.click(screen.getByRole("button", { name: "다음" }));
    fireEvent.click(screen.getByRole("button", { name: "다음" }));
    fireEvent.click(screen.getByRole("radio", { name: /매우 큼/ }));
    fireEvent.click(screen.getByRole("button", { name: "PIP로 미리보기" }));

    expect(trackPipTimerConfigChangedMock).toHaveBeenCalledWith("maker_step", {
      value: "appearance",
    });
    expect(trackPipTimerConfigChangedMock).toHaveBeenCalledWith("size", {
      value: "focus",
    });
    expect(onConfigChange).toHaveBeenCalledWith({ size: "focus" });
    await waitFor(() => {
      expect(onMessage).toHaveBeenCalledWith(
        expect.stringContaining("이 브라우저는 PIP 타이머를 지원하지 않습니다."),
      );
    });
  });

  it("closes the maker after starting PiP successfully", async () => {
    const { requestWindow } = installDocumentPictureInPictureMock();
    renderPipTimerControl();

    openPipMakerFinalStep();
    fireEvent.click(screen.getByRole("button", { name: "PIP 시작" }));

    await waitFor(() => expect(requestWindow).toHaveBeenCalled());
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "PIP 창 메이커" })).not.toBeInTheDocument();
    });
  });

  it("keeps the maker open when PiP start fails", async () => {
    removeDocumentPictureInPicture();
    const { onMessage } = renderPipTimerControl();

    openPipMakerFinalStep();
    fireEvent.click(screen.getByRole("button", { name: "PIP 시작" }));

    await waitFor(() => {
      expect(onMessage).toHaveBeenCalledWith(
        expect.stringContaining("이 브라우저는 PIP 타이머를 지원하지 않습니다."),
      );
    });
    expect(screen.getByRole("dialog", { name: "PIP 창 메이커" })).toBeInTheDocument();
  });
});

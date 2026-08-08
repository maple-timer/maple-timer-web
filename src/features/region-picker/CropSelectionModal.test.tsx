import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RelativeRegion } from "../../types";
import { CropSelectionModal } from "./CropSelectionModal";

describe("CropSelectionModal", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("starts in pan mode when no region exists", () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);

    render(
      <CropSelectionModal
        captureSize={{ width: 1920, height: 1080 }}
        region={null}
        stream={{} as MediaStream}
        onApply={() => undefined}
        onClose={() => undefined}
      />,
    );

    expect(screen.getByRole("button", { name: "이동" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "영역 선택" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByLabelText("영역 선택 조작 안내")).toHaveTextContent(
      "영역 선택: 아이콘 드래그",
    );
    expect(screen.getByLabelText("영역 선택 조작 안내")).toHaveTextContent(
      "휠/트랙패드: 확대·축소",
    );
    expect(screen.getByLabelText("영역 선택 조작 안내")).toHaveTextContent(
      "이동: 화면/상자 조정",
    );
    expect(
      screen.getByRole("heading", { name: "스킬 아이콘 하나를 정사각형으로 선택하세요" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "인게임 설정 > UI > 퀵슬롯&버프 시간표시가 [중앙, 크게]인지 확인해주세요.",
      ),
    ).toBeInTheDocument();
    fireEvent.mouseEnter(screen.getByRole("button", { name: "쿨타임 표시 설정 안내" }));
    const hoverCard = screen
      .getByText("측면/보통은 숫자가 작아 인식이 불안정할 수 있습니다.")
      .closest(".maple-hover-card");
    expect(hoverCard).not.toBeNull();
    expect(screen.getByLabelText("영역 선택 도움말")).toHaveTextContent(
      "퀵슬롯의 스킬 아이콘을 선택하세요",
    );
    expect(screen.getByLabelText("퀵슬롯 crop 예시 영상")).toHaveAttribute(
      "src",
      "/media/quickslot-crop-guide.mp4",
    );
    expect(screen.queryByText("영역 미선택")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "영역 선택" }));

    expect(screen.getByRole("button", { name: "이동" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "영역 선택" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText("스킬 아이콘을 드래그해서 선택")).toBeInTheDocument();
  });

  it("hides the center start hint after the user starts interacting with the stage", () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const setPointerCapture = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
      configurable: true,
      value: setPointerCapture,
    });

    const { container } = render(
      <CropSelectionModal
        captureSize={{ width: 1920, height: 1080 }}
        region={null}
        stream={{} as MediaStream}
        onApply={() => undefined}
        onClose={() => undefined}
      />,
    );

    expect(screen.getByText("영역 선택을 누르고 시작")).toBeInTheDocument();

    const stage = container.querySelector(".crop-stage");
    expect(stage).not.toBeNull();

    fireEvent.pointerDown(stage as Element, { clientX: 500, clientY: 500, pointerId: 1 });

    expect(setPointerCapture).toHaveBeenCalled();
    expect(screen.queryByText("영역 선택을 누르고 시작")).not.toBeInTheDocument();
  });

  it("starts in pan mode when an existing region is being edited", () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);

    render(
      <CropSelectionModal
        captureSize={{ width: 1920, height: 1080 }}
        region={{ x: 0.7, y: 0.7, width: 0.05, height: 0.05 }}
        stream={{} as MediaStream}
        onApply={() => undefined}
        onClose={() => undefined}
      />,
    );

    expect(screen.getByRole("button", { name: "이동" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "영역 선택" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("uses a custom helper video when provided", () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);

    render(
      <CropSelectionModal
        captureSize={{ width: 1920, height: 1080 }}
        region={null}
        stream={{} as MediaStream}
        helperVideoSrc="/media/rune-minimap-crop-guide.mp4"
        helperVideoLabel="미니맵 crop 예시 영상"
        onApply={() => undefined}
        onClose={() => undefined}
      />,
    );

    expect(screen.getByLabelText("미니맵 crop 예시 영상")).toHaveAttribute(
      "src",
      "/media/rune-minimap-crop-guide.mp4",
    );
  });

  it("warns before applying a skill region outside the lower quickslot area", () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const onApply = vi.fn();
    const outsideRegion: RelativeRegion = {
      x: 0.72,
      y: 0.58,
      width: 0.05,
      height: 0.05,
    };

    render(
      <CropSelectionModal
        captureSize={{ width: 1920, height: 1080 }}
        region={outsideRegion}
        stream={{} as MediaStream}
        onApply={onApply}
        onClose={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "적용" }));

    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog", { name: "퀵슬롯 위치를 확인해주세요" })).toBeInTheDocument();
    expect(screen.getByRole("alertdialog", { name: "퀵슬롯 위치를 확인해주세요" })).toHaveTextContent(
      "버프 즐겨찾기 창이나 우상단 버프창",
    );
    expect(screen.getByRole("alertdialog", { name: "퀵슬롯 위치를 확인해주세요" })).toHaveTextContent(
      "여백 없이 스킬 아이콘 부분만 선택",
    );
    expect(screen.queryByText("특수한 UI 배치를 사용 중이라면 그대로 적용할 수 있습니다.")).not.toBeInTheDocument();
    expect(screen.getByLabelText("퀵슬롯 crop 좋은 예시와 나쁜 예시 영상")).toHaveAttribute(
      "src",
      "/media/quickslot-crop-guide.mp4",
    );

    fireEvent.click(screen.getByRole("button", { name: "그래도 적용" }));

    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({ x: outsideRegion.x, y: outsideRegion.y }),
    );
  });

  it("warns right after drawing a skill region outside the lower quickslot area", () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1000,
      bottom: 1000,
      width: 1000,
      height: 1000,
      toJSON: () => undefined,
    });
    const setPointerCapture = vi.fn();
    const releasePointerCapture = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
      configurable: true,
      value: setPointerCapture,
    });
    Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", {
      configurable: true,
      value: releasePointerCapture,
    });
    Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", {
      configurable: true,
      value: () => true,
    });

    const { container } = render(
      <CropSelectionModal
        captureSize={{ width: 1920, height: 1080 }}
        region={null}
        stream={{} as MediaStream}
        onApply={() => undefined}
        onClose={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "영역 선택" }));
    const editor = container.querySelector(".region-editor");
    expect(editor).not.toBeNull();

    fireEvent.pointerDown(editor as Element, { clientX: 700, clientY: 560, pointerId: 1 });
    fireEvent.pointerMove(editor as Element, { clientX: 760, clientY: 620, pointerId: 1 });
    fireEvent.pointerUp(editor as Element, { clientX: 760, clientY: 620, pointerId: 1 });

    expect(setPointerCapture).toHaveBeenCalled();
    expect(releasePointerCapture).toHaveBeenCalled();
    expect(screen.getByRole("alertdialog", { name: "퀵슬롯 위치를 확인해주세요" })).toBeInTheDocument();
  });

  it("does not enforce a capture-relative placement warning for rune regions", () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const onApply = vi.fn();
    const outsideRegion: RelativeRegion = {
      x: 0.08,
      y: 0.32,
      width: 0.18,
      height: 0.12,
    };

    render(
      <CropSelectionModal
        captureSize={{ width: 1920, height: 1080 }}
        region={outsideRegion}
        stream={{} as MediaStream}
        shape="rectangle"
        placementWarning={false}
        onApply={onApply}
        onClose={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "적용" }));

    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({
        x: outsideRegion.x,
        y: outsideRegion.y,
      }),
    );
    expect(
      screen.queryByRole("alertdialog", {
        name: "미니맵 위치를 확인해주세요",
      }),
    ).not.toBeInTheDocument();
  });

  it("blocks an invalid region and offers the configured recovery action", () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const onApply = vi.fn();
    const onValidationAction = vi.fn();
    const invalidRegion: RelativeRegion = {
      x: 0.33,
      y: 0.8,
      width: 0.34,
      height: 0.2,
    };

    render(
      <CropSelectionModal
        captureSize={{ width: 2762, height: 1358 }}
        region={invalidRegion}
        stream={{} as MediaStream}
        shape="horizontal-band"
        placementWarning={false}
        validateRegion={(candidate) =>
          candidate.height > 0.08
            ? "경험치바 아래에 확장 UI가 포함되어 있습니다."
            : null
        }
        validationActionLabel="게임 화면 맞추기"
        onValidationAction={onValidationAction}
        onApply={onApply}
        onClose={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "적용" }));

    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByText("선택 영역을 확인해주세요")).toBeInTheDocument();
    expect(
      screen.getByText("경험치바 아래에 확장 UI가 포함되어 있습니다."),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "게임 화면 맞추기" }),
    );
    expect(onValidationAction).toHaveBeenCalledOnce();
  });

  it("shows only the calibrated game viewport for game-space crops", () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);

    const { container } = render(
      <CropSelectionModal
        captureSize={{ width: 1766, height: 968 }}
        sourceRegion={{ x: 200, y: 100, width: 1366, height: 768 }}
        region={null}
        stream={{} as MediaStream}
        onApply={() => undefined}
        onClose={() => undefined}
      />,
    );

    const scene = container.querySelector<HTMLElement>(".crop-scene");
    const video = container.querySelector<HTMLVideoElement>(
      ".crop-source-viewport video",
    );

    expect(scene).toHaveStyle({ aspectRatio: "1366 / 768" });
    expect(video).toHaveStyle({
      width: `${(1766 / 1366) * 100}%`,
      height: `${(968 / 768) * 100}%`,
      left: `${(-200 / 1366) * 100}%`,
      top: `${(-100 / 768) * 100}%`,
    });
  });
});

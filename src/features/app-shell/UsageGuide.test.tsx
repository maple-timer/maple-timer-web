import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UsageGuideModal, UsageGuidePage } from "./UsageGuide";

describe("UsageGuide", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the full guide page", () => {
    render(<UsageGuidePage />);

    expect(screen.getByRole("heading", { name: "사용 가이드", level: 1 })).toBeInTheDocument();
    expect(screen.getByText("기본 사용 순서")).toBeInTheDocument();
    expect(screen.getByText("설정은 이렇게 맞춰주세요")).toBeInTheDocument();
    expect(screen.getByText("스킬 알림은 자동/정밀 감지를 먼저 사용합니다")).toBeInTheDocument();
    expect(screen.getByText("퀵슬롯 방식은 자동 감지가 맞지 않을 때 사용합니다")).toBeInTheDocument();
    expect(screen.getByText("룬 감지는 미니맵 내부 지도 영역을 잡습니다")).toBeInTheDocument();
    expect(screen.getByText("울티마 스쿼드 화면 전체를 선택하세요")).toBeInTheDocument();
    expect(screen.getByText("기능마다 보는 기준이 다릅니다")).toBeInTheDocument();
    expect(
      screen.getAllByText(/울티마 스쿼드 장비 알림/).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText(/UI 크기 옵션/)).toBeInTheDocument();
    expect(screen.getByAltText("인게임 UI 권장 설정 예시")).toHaveAttribute(
      "src",
      "/media/ingame-ui-settings-guide.png",
    );
    expect(screen.getAllByText(/퀵슬롯&버프 시간표시/).length).toBeGreaterThan(0);
    expect(
      screen.getByText((_content, element) =>
        Boolean(
          element?.textContent ===
            "맵마다 미니맵 UI 크기가 다르므로 마을에서 미리 영역을 지정하지 말고 실제 사냥터에서 잡아주세요.",
        ),
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/Chrome이나 네이버 웨일/)).toBeInTheDocument();
    expect(screen.getByText(/Windows 10에서 입력이 느려지면/)).toBeInTheDocument();
    expect(screen.getByText("Discord")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "타이머로 돌아가기" })).toHaveAttribute("href", "/");
  });

  it("moves through guide sections in the modal", () => {
    render(<UsageGuideModal onClose={() => undefined} />);

    expect(screen.getByRole("dialog", { name: "사용 가이드" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "기본 사용 순서" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "설정은 이렇게" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "정밀 감지" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "퀵슬롯 보조" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "룬 감지" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "울티마 스쿼드" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "기능별 기준" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "문제 해결" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "기본 사용 순서" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "확인할 것" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "주의할 것" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Maple Timer 빠른 시작 영상")).toHaveAttribute(
      "src",
      "/media/getting-started-guide.mp4",
    );
    expect(screen.getByLabelText("Maple Timer 빠른 시작 영상")).not.toHaveAttribute("controls");

    fireEvent.click(screen.getByRole("button", { name: /다음/ }));

    expect(screen.getByRole("heading", { name: "설정은 이렇게 맞춰주세요" })).toBeInTheDocument();
    expect(screen.getByAltText("인게임 UI 권장 설정 예시")).toHaveAttribute(
      "src",
      "/media/ingame-ui-settings-guide.png",
    );

    fireEvent.click(screen.getByRole("button", { name: /다음/ }));

    expect(
      screen.getByRole("heading", { name: "스킬 알림은 자동/정밀 감지를 먼저 사용합니다" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /다음/ }));

    expect(
      screen.getByRole("heading", { name: "퀵슬롯 방식은 자동 감지가 맞지 않을 때 사용합니다" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("퀵슬롯 스킬 아이콘 영역 선택 영상")).toHaveAttribute(
      "src",
      "/media/quickslot-crop-guide.mp4",
    );
    expect(screen.getByLabelText("퀵슬롯 스킬 아이콘 영역 선택 영상")).not.toHaveAttribute(
      "controls",
    );

    fireEvent.click(screen.getByRole("button", { name: "울티마 스쿼드" }));

    expect(
      screen.getByRole("heading", { name: "울티마 스쿼드 화면 전체를 선택하세요" }),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("울티마 스쿼드 화면 영역 선택 예시 영상"),
    ).toHaveAttribute("src", "/media/ultima-raid-equipment-crop-guide.mp4");
    expect(
      screen.getByText(
        "가방이 가득 찬 동안에는 한 번만 알리고, 가방을 비우면 다음 가득 참 알림을 다시 기다립니다.",
      ),
    ).toBeInTheDocument();
  });

  it("closes the modal on Escape", () => {
    const onClose = vi.fn();

    render(<UsageGuideModal onClose={onClose} />);

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

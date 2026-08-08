import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AlertIssueReportDialog,
  type AlertIssueReportContext,
} from "./AlertIssueReportDialog";

const DEFAULT_CONTEXT: AlertIssueReportContext = {
  previewUrl: "data:image/png;base64,preview",
  previewLabel: "현재 선택한 스킬 영역",
  emptyPreviewLabel: "스킬 영역 대기",
  statusText: "숫자를 읽고 알림 시간을 계산 중입니다.",
  checklist: [
    "확장 UI를 사용한다면 화면 공유 메뉴에서 게임 영역을 설정해주세요.",
    "퀵슬롯&버프 표시가 [중앙, 크게]인지 확인해주세요.",
    "스킬 아이콘 하나만 선택됐는지 확인해주세요.",
    "우하단 퀵슬롯 영역인지 확인해주세요.",
  ],
  guideVideoSrc: "/media/quickslot-crop-guide.mp4",
  guideVideoLabel: "퀵슬롯 스킬 아이콘 영역 선택 예시 영상",
  guideTitle: "퀵슬롯 선택 예시",
};

describe("AlertIssueReportDialog", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("submits the selected rune issue reason", async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    const onClose = vi.fn();

    render(
      <AlertIssueReportDialog
        target={{ kind: "rune" }}
        context={{
          ...DEFAULT_CONTEXT,
          previewLabel: "현재 선택한 미니맵 영역",
          guideTitle: "미니맵 선택 예시",
        }}
        isSubmitting={false}
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getByLabelText("다른 것을 룬으로 감지해요"));
    fireEvent.click(screen.getByRole("button", { name: "다음" }));
    fireEvent.click(screen.getByRole("button", { name: "보내기" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        reason: "rune-false-positive",
        label: "다른 것을 룬으로 감지해요",
        note: undefined,
        scenario: "wrong-target",
        occurrence: "recent",
        incidentId: expect.any(String),
      }));
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("requires a note when selecting other", async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);

    render(
      <AlertIssueReportDialog
        target={{ kind: "skill", skillId: "skill-1", skillName: "에르다 파운틴" }}
        context={DEFAULT_CONTEXT}
        isSubmitting={false}
        onClose={() => undefined}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getByLabelText("기타"));
    fireEvent.click(screen.getByRole("button", { name: "다음" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "기타를 선택한 경우 내용을 한 줄로 적어주세요.",
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits an operational category with other reports", async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);

    render(
      <AlertIssueReportDialog
        target={{ kind: "skill", skillId: "skill-1", skillName: "에르다 파운틴" }}
        context={DEFAULT_CONTEXT}
        isSubmitting={false}
        onClose={() => undefined}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getByLabelText("기타"));
    expect(
      screen.getByText(
        "제보를 누른 뒤 전송된 시각이 아니라, 실제 문제가 있었던 시점을 골라주세요.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("속도 저하나 오류"));
    fireEvent.change(screen.getByLabelText("상세 내용"), {
      target: { value: "정밀 감지가 오래 멈춰 있어요" },
    });
    fireEvent.click(screen.getByRole("button", { name: "다음" }));
    fireEvent.click(screen.getByRole("button", { name: "보내기" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: "other",
          scenario: "other",
          occurrence: "recent",
          otherCategory: "performance-error",
          otherCategoryLabel: "속도 저하나 오류",
          note: "정밀 감지가 오래 멈춰 있어요",
        }),
      );
    });
  });

  it("lets the step indicator navigate with the same validation as the footer buttons", async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);

    render(
      <AlertIssueReportDialog
        target={{ kind: "skill", skillId: "skill-1", skillName: "에르다 파운틴" }}
        context={DEFAULT_CONTEXT}
        isSubmitting={false}
        onClose={() => undefined}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getByLabelText("기타"));
    fireEvent.click(screen.getByRole("button", { name: "확인" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "기타를 선택한 경우 내용을 한 줄로 적어주세요.",
    );
    expect(screen.queryByAltText("현재 선택한 스킬 영역")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("상세 내용"), {
      target: { value: "숫자 인식이 흔들려요" },
    });
    fireEvent.click(screen.getByRole("button", { name: "확인" }));

    expect(screen.getByAltText("현재 선택한 스킬 영역")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "문제 선택" }));

    expect(screen.getByText("어떤 문제가 있었나요?")).toBeInTheDocument();
  });

  it("shows the current crop, example video, and checklist before submitting", () => {
    render(
      <AlertIssueReportDialog
        target={{ kind: "skill", skillId: "skill-1", skillName: "솔 야누스 : 새벽" }}
        context={DEFAULT_CONTEXT}
        isSubmitting={false}
        onClose={() => undefined}
        onSubmit={async () => true}
      />,
    );

    expect(screen.queryByAltText("현재 선택한 스킬 영역")).not.toBeInTheDocument();
    expect(screen.getByText("어떤 문제가 있었나요?")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "다음" }));
    expect(screen.getByAltText("현재 선택한 스킬 영역")).toHaveAttribute(
      "src",
      DEFAULT_CONTEXT.previewUrl,
    );
    expect(screen.getByText("전송될 화면")).toBeInTheDocument();
    expect(screen.getByText("제보 전 체크리스트")).toBeInTheDocument();
    expect(screen.getByText("감지가 안돼요")).toBeInTheDocument();
    expect(screen.getByText("숫자를 읽고 알림 시간을 계산 중입니다.")).toBeInTheDocument();
    expect(screen.getByText("퀵슬롯 선택 예시")).toBeInTheDocument();
    expect(
      screen.getByText(
        "확장 UI를 사용한다면 화면 공유 메뉴에서 게임 영역을 설정해주세요.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("스킬 아이콘 하나만 선택됐는지 확인해주세요."),
    ).toBeInTheDocument();
    expect(screen.getByText(/퀵슬롯&버프 표시/)).toBeInTheDocument();
  });

  it("shows the buff favorite guide video beside the buff-slot report preview", () => {
    const { container } = render(
      <AlertIssueReportDialog
        target={{ kind: "skill", skillId: "skill-1", skillName: "솔 야누스 : 새벽" }}
        context={{
          ...DEFAULT_CONTEXT,
          previewLabel: "현재 우상단 버프칸 분석 화면",
          guideVideoSrc: "/media/janus-buff-duration-settings-guide.mp4",
          guideVideoLabel: "버프 즐겨찾기 설정 예시 영상",
          guideTitle: "버프 즐겨찾기 확인",
        }}
        isSubmitting={false}
        onClose={() => undefined}
        onSubmit={async () => true}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "다음" }));

    expect(screen.getByText("전송될 화면")).toBeInTheDocument();
    expect(screen.getByText("버프 즐겨찾기 설정과 전송될 화면을 확인한 뒤 제보를 보내주세요.")).toBeInTheDocument();
    expect(screen.queryByText("현재 선택한 영역과 예시를 비교한 뒤 제보를 보내주세요.")).not.toBeInTheDocument();
    expect(screen.getByAltText("현재 우상단 버프칸 분석 화면")).toHaveAttribute(
      "src",
      DEFAULT_CONTEXT.previewUrl,
    );
    expect(screen.getByText("버프 즐겨찾기 확인")).toBeInTheDocument();
    expect(screen.getByLabelText("버프 즐겨찾기 설정 예시 영상")).toHaveAttribute(
      "src",
      "/media/janus-buff-duration-settings-guide.mp4",
    );
    expect(container.querySelector(".issue-report-compare-grid.no-guide")).not.toBeInTheDocument();
    const compareGrid = container.querySelector(
      ".issue-report-compare-grid.skill-buff-duration-review",
    );
    expect(compareGrid).toBeInTheDocument();
    expect(compareGrid?.children[0]).toHaveClass("issue-report-current-panel");
    expect(compareGrid?.children[1]).toHaveClass("issue-report-video-stage");
  });

  it("shows a buff-slot preflight check before reason selection without submitting", () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    render(
      <AlertIssueReportDialog
        target={{ kind: "skill", skillId: "skill-1", skillName: "솔 야누스 : 새벽" }}
        context={{
          ...DEFAULT_CONTEXT,
          previewLabel: "현재 우상단 버프칸 분석 화면",
          checklist: [
            "확장 UI를 사용한다면 화면 공유 메뉴에서 게임 영역을 설정해주세요.",
            "버프 정렬 옵션이 모두 켜져 있는지 확인해주세요.",
            "퀵슬롯&버프표시방식이 [분+초]인지 확인해주세요.",
            "새벽 아이콘과 시간이 보이는지 확인해주세요.",
          ],
          guideVideoSrc: "/media/janus-buff-duration-settings-guide.mp4",
          guideVideoLabel: "버프 즐겨찾기 설정 예시 영상",
          guideTitle: "버프 즐겨찾기 확인",
          preflight: {
            kind: "one-row-buff-slots",
            description:
              "버프 아이콘이 한 줄로 길게 보이면 필요한 버프를 읽지 못할 수 있습니다. 게임 설정을 확인한 뒤 계속 제보해주세요.",
          },
        }}
        isSubmitting={false}
        onClose={() => undefined}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.queryByLabelText("제보 단계")).not.toBeInTheDocument();
    expect(screen.queryByText("버프칸 표시를 먼저 확인해주세요")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "버프 아이콘이 한 줄로 길게 보이면 필요한 버프를 읽지 못할 수 있습니다. 게임 설정을 확인한 뒤 계속 제보해주세요.",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText("전송될 화면")).not.toBeInTheDocument();
    expect(screen.queryByAltText("현재 우상단 버프칸 분석 화면")).not.toBeInTheDocument();
    expect(screen.getByText("설정 예시")).toBeInTheDocument();
    expect(screen.getByAltText("퀵슬롯과 버프 시간 표시가 중앙, 크게로 설정된 예시")).toHaveAttribute(
      "src",
      "/media/quickslot-buff-time-large-center.png",
    );
    expect(screen.getByAltText("버프 표시 방식, 자동 정렬 적용, 버프 최소화 기능 사용 설정 예시")).toHaveAttribute(
      "src",
      "/media/buff-sort-options.png",
    );
    expect(screen.getByText("확인할 설정")).toBeInTheDocument();
    expect(screen.getByLabelText("버프 즐겨찾기 설정 예시 영상")).toBeInTheDocument();
    expect(screen.getByText("버프 정렬 옵션이 모두 켜져 있는지 확인해주세요.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "문제 선택하기" }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByLabelText("제보 단계")).toBeInTheDocument();
    expect(screen.getByText("어떤 문제가 있었나요?")).toBeInTheDocument();
  });

  it("shows hunt stall crop guidance before submitting", async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    const onClose = vi.fn();

    render(
      <AlertIssueReportDialog
        target={{ kind: "hunt-stall" }}
        context={{
          ...DEFAULT_CONTEXT,
          previewLabel: "현재 경험치바 감시 영역",
          checklist: [
            "확장 UI를 사용한다면 화면 공유 메뉴에서 게임 영역을 설정해주세요.",
            "경험치바 윗선 위치를 확인해주세요.",
            "해상도를 변경했다면 영역을 다시 선택했는지 확인해주세요.",
          ],
          guideVideoSrc: "/media/manual-experience-band-guide.mp4",
          guideVideoLabel: "경험치바 높이 선택 예시 영상",
          guideTitle: "경험치바 선택 예시",
        }}
        isSubmitting={false}
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByLabelText("제보 단계")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("사냥 중인데 알림이 울려요"));
    fireEvent.click(screen.getByRole("button", { name: "다음" }));

    expect(screen.getByText("전송될 화면")).toBeInTheDocument();
    expect(screen.getByText("경험치바 선택 예시")).toBeInTheDocument();
    expect(screen.getByText("제보 전 체크리스트")).toBeInTheDocument();
    expect(screen.getByAltText("현재 경험치바 감시 영역")).toHaveAttribute(
      "src",
      DEFAULT_CONTEXT.previewUrl,
    );
    expect(screen.getByText("경험치바 윗선 위치를 확인해주세요.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "보내기" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        reason: "hunt-stall-false-alert",
        label: "사냥 중인데 알림이 울려요",
        note: undefined,
        scenario: "wrong-target",
        occurrence: "recent",
        incidentId: expect.any(String),
      }));
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("shows booster expiry timer evidence before submitting", async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    const onClose = vi.fn();

    render(
      <AlertIssueReportDialog
        target={{ kind: "booster-expiry" }}
        context={{
          ...DEFAULT_CONTEXT,
          previewLabel: "현재 부스터 타이머 감지 영역",
          statusText: "부스터 타이머 판독 결과와 흐름 보정 상태를 함께 보낼 수 있습니다.",
          checklist: [
            "화면 중상단 타이머가 보이는지 확인해주세요.",
            "타이머가 UI에 가려지지 않는지 확인해주세요.",
            "판독값과 흐름 정보 전송을 확인해주세요.",
          ],
          guideVideoSrc: "",
          guideVideoLabel: "부스터 종료 감지 제보",
          guideTitle: "부스터 종료 감지 제보",
        }}
        isSubmitting={false}
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByLabelText("제보 단계")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("부스터 시간이 이상하게 감지돼요"));
    fireEvent.click(screen.getByRole("button", { name: "다음" }));

    expect(screen.getByText("전송될 화면")).toBeInTheDocument();
    expect(screen.getByText("전송될 화면을 확인한 뒤 제보를 보내주세요.")).toBeInTheDocument();
    expect(screen.getByAltText("현재 부스터 타이머 감지 영역")).toHaveAttribute(
      "src",
      DEFAULT_CONTEXT.previewUrl,
    );
    expect(screen.getByText("화면 중상단 타이머가 보이는지 확인해주세요.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "보내기" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        reason: "booster-expiry-reading",
        label: "부스터 시간이 이상하게 감지돼요",
        note: undefined,
        scenario: "wrong-target",
        occurrence: "recent",
        incidentId: expect.any(String),
      }));
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("shows buff expiry buff-slot evidence before submitting", async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    const onClose = vi.fn();

    render(
      <AlertIssueReportDialog
        target={{ kind: "buff-expiry" }}
        context={{
          ...DEFAULT_CONTEXT,
          previewLabel: "현재 우상단 버프 감지 영역",
          statusText: "버프칸 감지 결과와 추적 상태를 함께 보낼 수 있습니다.",
          checklist: [
            "우상단 버프칸이 보이는지 확인해주세요.",
            "버프 시간 표시가 [분+초]인지 확인해주세요.",
            "버프 정렬 옵션이 켜져 있는지 확인해주세요.",
            "버프칸이 UI에 가려지지 않는지 확인해주세요.",
          ],
          guideVideoSrc: "",
          guideVideoLabel: "버프 종료 감지 제보",
          guideTitle: "버프 종료 감지 제보",
        }}
        isSubmitting={false}
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByLabelText("제보 단계")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("버프 종료가 아닌데 알림이 울려요"));
    fireEvent.click(screen.getByRole("button", { name: "다음" }));

    expect(screen.getByText("전송될 화면")).toBeInTheDocument();
    expect(screen.getByAltText("현재 우상단 버프 감지 영역")).toHaveAttribute(
      "src",
      DEFAULT_CONTEXT.previewUrl,
    );
    expect(screen.getByText("우상단 버프칸이 보이는지 확인해주세요.")).toBeInTheDocument();
    expect(screen.getByText("버프 시간 표시가 [분+초]인지 확인해주세요.")).toBeInTheDocument();
    expect(screen.getByText("버프 정렬 옵션이 켜져 있는지 확인해주세요.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "보내기" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        reason: "buff-expiry-false-alert",
        label: "버프 종료가 아닌데 알림이 울려요",
        note: undefined,
        scenario: "wrong-target",
        occurrence: "recent",
        affectedTarget: { id: "unknown", label: "어떤 버프인지 모르겠어요" },
        incidentId: expect.any(String),
      }));
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("uses the compact no-guide review layout for special core reports", () => {
    const { container } = render(
      <AlertIssueReportDialog
        target={{ kind: "special-core" }}
        context={{
          ...DEFAULT_CONTEXT,
          previewLabel: "현재 우상단 버프칸 분석 화면",
          statusText: "최근 특수코어 감지 상태를 함께 보낼 수 있습니다.",
          checklist: [
            "우상단 버프칸이 보이는지 확인해주세요.",
            "특수코어가 실제로 발동한 상황인지 확인해주세요.",
            "버프칸이 UI에 가려지지 않는지 확인해주세요.",
          ],
          guideVideoSrc: "",
          guideVideoLabel: "특수코어 감지 제보",
          guideTitle: "특수코어 감지 제보",
        }}
        isSubmitting={false}
        onClose={() => undefined}
        onSubmit={async () => true}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "다음" }));

    const compareGrid = container.querySelector(".issue-report-compare-grid");
    expect(compareGrid).toHaveClass("no-guide");
    expect(compareGrid).toHaveClass("special-core-review");
    expect(screen.getByAltText("현재 우상단 버프칸 분석 화면")).toBeInTheDocument();
    expect(container.querySelector(".issue-report-video-stage")).not.toBeInTheDocument();
  });

  it("shows a progress indicator while an issue report is being uploaded", () => {
    render(
      <AlertIssueReportDialog
        target={{ kind: "hunt-stall" }}
        context={DEFAULT_CONTEXT}
        isSubmitting={true}
        onClose={() => undefined}
        onSubmit={async () => true}
      />,
    );

    expect(screen.getByRole("status", { name: "감지 제보 전송 중" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "전송 중" })).toBeDisabled();
  });
});

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { trackBuffExpiryTargetGroupChanged } from "../../../lib/analyticsEvents";
import {
  BUFF_EXPIRY_EXP_COUPON_GROUP_ID,
  SUPPORTED_BUFF_EXPIRY_BUFF_IDS,
} from "../../../lib/buffExpiry/buffExpiryCatalog";
import type {
  BuffExpiryBox,
  BuffExpiryRuntimeState,
  BuffExpirySnapshot,
} from "../../../lib/buffExpiry/buffExpiryTypes";
import { BuffExpiryPanel } from "./BuffExpiryPanel";

vi.mock("../../../lib/analyticsEvents", () => ({
  trackBuffExpiryTargetGroupChanged: vi.fn(),
}));

const trackBuffExpiryTargetGroupChangedMock = vi.mocked(trackBuffExpiryTargetGroupChanged);

const firstBox: BuffExpiryBox = {
  x: 100,
  y: 20,
  width: 32,
  height: 32,
  confidence: 0.96,
};

const secondBox: BuffExpiryBox = {
  x: 140,
  y: 20,
  width: 32,
  height: 32,
  confidence: 0.93,
};

const thirdBox: BuffExpiryBox = {
  x: 180,
  y: 20,
  width: 32,
  height: 32,
  confidence: 0.91,
};

const fourthBox: BuffExpiryBox = {
  x: 220,
  y: 20,
  width: 32,
  height: 32,
  confidence: 0.9,
};

const fifthBox: BuffExpiryBox = {
  x: 260,
  y: 20,
  width: 32,
  height: 32,
  confidence: 0.88,
};

const runtimeState: BuffExpiryRuntimeState = {
  status: "tracking",
  tracks: [
    {
      id: "mvp_exp_4x_coupon:100:20",
      buffId: BUFF_EXPIRY_EXP_COUPON_GROUP_ID,
      name: "경험치 쿠폰",
      box: firstBox,
      detectedSeconds: 45,
      detectedAt: 1_000,
      expiresAt: Date.now() + 45_000,
      lastSeenAt: 1_000,
      alertedAt: null,
      score: 0.98,
    },
  ],
  pendingTracks: [],
  lastSampledAt: 1_000,
  lastDetectedAt: 1_000,
  lastAlertedAt: null,
  boxCount: 2,
  acceptedMatchCount: 1,
  unsupportedReason: null,
  performance: null,
};

const snapshot: BuffExpirySnapshot = {
  sampledAt: 1_000,
  roi: { x: 90, y: 10, width: 120, height: 60 },
  rawPreviewUrl: "data:image/png;base64,bW9jaw==",
  processedPreviewUrl: null,
  fullFramePreviewUrl: null,
  boxes: [firstBox, secondBox],
  acceptedMatches: [
    {
      box: firstBox,
      buffId: BUFF_EXPIRY_EXP_COUPON_GROUP_ID,
      name: "경험치 쿠폰",
      seconds: 45,
      score: 0.98,
      buffMargin: 0.2,
      secondMargin: 0.2,
      reason: "accepted",
      strength: "strong",
      topMatches: [],
    },
  ],
  rejectedMatches: [
    {
      box: secondBox,
      candidateBuffId: BUFF_EXPIRY_EXP_COUPON_GROUP_ID,
      candidateName: "경험치 쿠폰",
      candidateSeconds: 45,
      score: 0.97,
      reason: "unselected-buff",
      topMatches: [],
    },
  ],
  tracks: runtimeState.tracks,
  pendingTracks: [],
  unsupportedReason: null,
  performance: null,
};

const defaultConfig = {
  enabled: true,
  alertLeadSeconds: 30,
  selectedBuffIds: [...SUPPORTED_BUFF_EXPIRY_BUFF_IDS],
  soundId: "띵동띵동",
  volume: 0.8,
};

type BuffExpiryPanelProps = ComponentProps<typeof BuffExpiryPanel>;
type BuffExpiryPanelTestOverrides = Partial<Omit<BuffExpiryPanelProps, "config">> & {
  config?: Partial<BuffExpiryPanelProps["config"]>;
};

function renderBuffExpiryPanel({
  config,
  ...overrides
}: BuffExpiryPanelTestOverrides = {}) {
  return render(createBuffExpiryPanelElement({ config, ...overrides }));
}

function createBuffExpiryPanelElement({
  config,
  ...overrides
}: BuffExpiryPanelTestOverrides = {}) {
  return (
    <BuffExpiryPanel
      config={{ ...defaultConfig, ...config }}
      state={runtimeState}
      snapshot={snapshot}
      hasStream
      showDebug={false}
      onChange={vi.fn()}
      onResetDetection={vi.fn()}
      onPreviewSound={vi.fn()}
      onSubmitIssueReport={vi.fn()}
      isSubmittingIssueReport={false}
      {...overrides}
    />
  );
}

describe("BuffExpiryPanel", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("starts with the buff detail controls collapsed and opens them from the row toggle", () => {
    const { container } = renderBuffExpiryPanel();

    expect(screen.getByRole("button", { name: "버프 종료 알림 설정 펼치기" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /지원 버프/ })).toBeInTheDocument();
    expect(screen.queryByText("지원 중인 사냥 버프")).not.toBeInTheDocument();
    expect(screen.queryByText("5개 지원 중")).not.toBeInTheDocument();
    expect(screen.queryByText("경험치 쿠폰")).not.toBeInTheDocument();
    expect(screen.queryByText("추가 경험치 쿠폰")).not.toBeInTheDocument();
    expect(screen.queryByText("추후 지원 예정 버프")).not.toBeInTheDocument();
    expect(screen.queryByText("익스트림 골드")).not.toBeInTheDocument();
    expect(screen.queryByText("추적 대상 버프")).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: /추적/ })).not.toBeInTheDocument();
    expect(container.querySelectorAll(".buff-expiry-selector-card input")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "버프 종료 알림 설정 펼치기" }));
    expect(screen.getByRole("button", { name: "버프 종료 알림 설정 접기" })).toBeInTheDocument();

    expect(container.querySelectorAll(".buff-expiry-detected-card.icon-only")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /현재 감지한 버프 아이콘/ })).not.toBeInTheDocument();
    expect(screen.queryByText("MVP 4배 쿠폰")).not.toBeInTheDocument();
    expect(screen.queryByText("경험치 4배 쿠폰")).not.toBeInTheDocument();
    expect(screen.queryByText("미선택")).not.toBeInTheDocument();
    expect(screen.queryByText("45초")).not.toBeInTheDocument();
  });

  it("does not render the removed buff expiry engine toggle", () => {
    renderBuffExpiryPanel({ isSectionCollapsed: true });

    expect(screen.queryByRole("group", { name: "버프 종료 감지 엔진" })).not.toBeInTheDocument();
  });

  it("limits the precision engine alert lead editor to the -5-20 second confirmation range", () => {
    renderBuffExpiryPanel();

    const trigger = screen.getByRole("button", { name: "버프 종료 알림 시점: 20초 전" });
    fireEvent.click(trigger);

    const input = screen.getByLabelText("버프 종료 알림 시점");
    expect(input).toHaveAttribute("min", "-5");
    expect(input).toHaveAttribute("max", "20");
    expect(input.closest(".threshold-control")).toHaveAttribute("data-range-hint", "-5-20초");
  });

  it("shows negative buff expiry alert leads as seconds after expiry", () => {
    renderBuffExpiryPanel({ config: { alertLeadSeconds: -3 } });

    expect(screen.getByRole("button", { name: "버프 종료 알림 시점: 3초 후" })).toHaveTextContent(
      "3초 후",
    );
  });

  it("shows precision engine preload progress in the outer panel before the first active sample", () => {
    renderBuffExpiryPanel({
      config: { enabled: true },
      state: { ...runtimeState, status: "paused", tracks: [], lastSampledAt: null },
      snapshot: null,
      precisionEnginePreloadStatus: "loading",
      hasStream: true,
      isSectionCollapsed: true,
    });

    expect(screen.getByText("정밀 감지 준비 중")).toBeInTheDocument();
    expect(screen.queryByText("알림 꺼짐")).not.toBeInTheDocument();
  });

  it("returns to the regular status detail after sampling starts even if the number model is loading", () => {
    renderBuffExpiryPanel({
      config: { enabled: true },
      state: { ...runtimeState, status: "tracking", tracks: [], lastSampledAt: 12_000, boxCount: 3 },
      snapshot: null,
      precisionEnginePreloadStatus: "loading",
      hasStream: true,
      isSectionCollapsed: true,
    });

    expect(screen.queryByText("정밀 감지 준비 중")).not.toBeInTheDocument();
    expect(screen.getByText("지원 버프를 찾는 중")).toBeInTheDocument();
  });

  it("does not show precision preload progress while buff expiry alerts are off", () => {
    renderBuffExpiryPanel({
      config: { enabled: false },
      state: { ...runtimeState, status: "paused", tracks: [] },
      snapshot: null,
      precisionEnginePreloadStatus: "loading",
      hasStream: true,
      isSectionCollapsed: true,
    });

    expect(screen.queryByText("정밀 감지 준비 중")).not.toBeInTheDocument();
    expect(screen.getByText("알림 꺼짐")).toBeInTheDocument();
  });

  it("lets users choose which precision target groups should trigger alerts", () => {
    const onChange = vi.fn();
    renderBuffExpiryPanel({ onChange });

    fireEvent.click(screen.getByRole("button", { name: "버프 종료 알림 설정 펼치기" }));

    expect(screen.getByText("알림 대상 그룹")).toBeInTheDocument();
    expect(screen.getByText("4개 사용")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "유니온의 부 알림 대상 사용 중" }));

    expect(onChange).toHaveBeenCalledWith({
      selectedPrecisionTargetGroups: ["unionLuck", "potion", "expCoupon"],
    });
    expect(trackBuffExpiryTargetGroupChangedMock).toHaveBeenCalledWith(
      "unionWealth",
      false,
      3,
    );
  });

  it("returns to the regular outer status detail after precision engine preload completes", () => {
    renderBuffExpiryPanel({
      config: { enabled: false },
      state: { ...runtimeState, status: "paused", tracks: [] },
      snapshot: null,
      precisionEnginePreloadStatus: "ready",
      hasStream: false,
      isSectionCollapsed: true,
    });

    expect(screen.queryByText("정밀 감지 준비 중")).not.toBeInTheDocument();
    expect(screen.getByText("알림 꺼짐")).toBeInTheDocument();
  });

  it("shows supported buff icons and names in the supported buff tooltip", () => {
    const { container } = renderBuffExpiryPanel({ isSectionCollapsed: true });

    const supportedChip = screen.getByRole("button", { name: /지원 버프/ });
    expect(supportedChip).toHaveTextContent("지원 버프");
    expect(container.querySelectorAll(".buff-expiry-supported-chip .buff-expiry-icon-stack")).toHaveLength(0);

    fireEvent.mouseEnter(supportedChip);

    const hoverCard = screen.getByText("현재 지원 중인 버프").closest(".maple-hover-card");
    expect(hoverCard).not.toBeNull();
    expect(hoverCard).toHaveTextContent("유니온의 부");
    expect(hoverCard).toHaveTextContent("유니온의 행운");
    expect(hoverCard).toHaveTextContent("소형 재물/경험 비약");
    expect(hoverCard).toHaveTextContent("경험치 쿠폰");
    expect(hoverCard).not.toHaveTextContent("추가 경험치 쿠폰");
    expect(hoverCard?.querySelectorAll(".buff-expiry-icon-stack")).toHaveLength(4);
  });

  it("shows four supported buff groups in the precision engine supported buff tooltip", () => {
    const { container } = renderBuffExpiryPanel({ isSectionCollapsed: true });

    const supportedChip = screen.getByRole("button", { name: /지원 버프/ });
    expect(container.querySelectorAll(".buff-expiry-supported-chip .buff-expiry-icon-stack")).toHaveLength(0);

    fireEvent.mouseEnter(supportedChip);

    const hoverCard = screen.getByText("현재 지원 중인 버프").closest(".maple-hover-card");
    expect(hoverCard).not.toBeNull();
    expect(hoverCard).toHaveTextContent("유니온의 부");
    expect(hoverCard).toHaveTextContent("유니온의 행운");
    expect(hoverCard).toHaveTextContent("소형 재물/경험 비약");
    expect(hoverCard).toHaveTextContent("경험치 쿠폰");
    expect(hoverCard).not.toHaveTextContent("추가 경험치 쿠폰");
    expect(hoverCard?.querySelectorAll(".buff-expiry-icon-stack")).toHaveLength(4);
  });

  it("shows recommended in-game settings in the checklist tooltip", () => {
    renderBuffExpiryPanel({ isSectionCollapsed: true });

    fireEvent.mouseEnter(screen.getByRole("button", { name: "버프 종료 알림 체크리스트" }));

    const hoverCard = screen.getByText("버프 종료 알림 전 확인해주세요.").closest(".maple-hover-card");
    expect(hoverCard).not.toBeNull();
    expect(hoverCard).toHaveTextContent(
      "확장 UI를 사용한다면 화면 공유 메뉴에서 게임 영역을 설정해주세요.",
    );
    expect(hoverCard).toHaveTextContent(
      "인게임 설정 > UI > 퀵슬롯&버프 시간표시는 [중앙, 크게]를 권장합니다.",
    );
    expect(
      screen.getByAltText("퀵슬롯과 버프 시간 표시가 중앙, 크게로 설정된 예시"),
    ).toHaveAttribute("src", "/media/quickslot-buff-time-large-center.png");
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

  it("explains that close buff expiry alerts are grouped within 15 seconds", () => {
    renderBuffExpiryPanel({
      config: { alertLeadSeconds: 15 },
      isSectionCollapsed: true,
    });

    const infoTooltip = screen.getByRole("button", { name: "버프 종료 알림 안내" });
    expect(infoTooltip).toHaveTextContent("사용 안내");
    fireEvent.mouseEnter(infoTooltip);

    const hoverCard = screen
      .getByText("지원 버프 아이콘과 남은 시간 흐름이 안정적으로 맞을 때 알림을 확정합니다.")
      .closest(".maple-hover-card");
    expect(hoverCard).not.toBeNull();
    expect(hoverCard).toHaveTextContent(
      "버프칸이 길라잡이 UI나 다른 창에 가려지면 감지하지 못할 수 있습니다.",
    );
  });

  it("shows precision engine notice tooltips", () => {
    renderBuffExpiryPanel({ isSectionCollapsed: true });

    const infoIndicator = screen.getByRole("button", { name: "버프 종료 알림 안내" });
    expect(screen.queryByRole("button", { name: "버프 종료 알림 계산량 안내" })).not.toBeInTheDocument();
    expect(screen.queryByText("지원 종료")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "버프 종료 알림 로직 테스트 안내" })).not.toBeInTheDocument();
    expect(screen.queryByText("로직 테스트 중")).not.toBeInTheDocument();

    fireEvent.mouseEnter(infoIndicator);

    const hoverCard = screen
      .getByText("잘못 울리거나 놓친 경우 감지 제보를 보내주세요.")
      .closest(".maple-hover-card");
    expect(hoverCard).not.toBeNull();
  });

  it("shows actual detected box thumbnails instead of catalog match icons", () => {
    const { container } = renderBuffExpiryPanel({
      snapshot: {
        ...snapshot,
        rawPreviewUrl: null,
        boxPreviewUrls: {
          [`${firstBox.x}:${firstBox.y}:${firstBox.width}:${firstBox.height}`]:
            "data:image/png;base64,Ym94",
        },
        boxPreviewImageData: {
          [`${firstBox.x}:${firstBox.y}:${firstBox.width}:${firstBox.height}`]: {
            width: 32,
            height: 32,
            data: new Uint8ClampedArray(32 * 32 * 4),
          },
        },
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "버프 종료 알림 설정 펼치기" }));

    const crop = container.querySelector<HTMLCanvasElement>(".buff-expiry-detected-crop");

    expect(crop).not.toBeNull();
    expect(crop?.tagName.toLowerCase()).toBe("canvas");
    expect(container.querySelector(".buff-expiry-detected-card img")).toBeNull();
  });

  it("does not fall back to recognized catalog icons when a detected box thumbnail is unavailable", () => {
    const { container } = renderBuffExpiryPanel({
      snapshot: {
        ...snapshot,
        rawPreviewUrl: null,
        boxPreviewUrls: {},
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "버프 종료 알림 설정 펼치기" }));

    expect(container.querySelector(".buff-expiry-detected-card img")).toBeNull();
    expect(container.querySelector(".buff-expiry-detected-placeholder")).not.toBeNull();
  });

  it("shows current detected boxes when display boxes are provided", () => {
    const { container } = renderBuffExpiryPanel({
      state: { ...runtimeState, boxCount: 1 },
      snapshot: { ...snapshot, displayBoxes: [firstBox] },
    });

    fireEvent.click(screen.getByRole("button", { name: "버프 종료 알림 설정 펼치기" }));

    expect(container.querySelectorAll(".buff-expiry-detected-card.icon-only")).toHaveLength(2);
  });

  it("shows the precision engine alert countdown from the earliest alert cluster due time", () => {
    renderBuffExpiryPanel({
      config: { alertLeadSeconds: 15 },
      state: {
        ...runtimeState,
        lastSampledAt: 10_000,
        tracks: [
          {
            ...runtimeState.tracks[0]!,
            id: "next:unionWealth:r0:c0",
            buffId: "next:unionWealth",
            name: "유니온의 부",
            expiresAt: 50_000,
            lastSeenAt: 10_000,
            alertedAt: null,
          },
        ],
      },
    });

    expect(screen.getByLabelText("25초")).toBeInTheDocument();
  });

  it("shows precision engine target discoveries separately from the full parser grid", () => {
    const nextBoxes = [firstBox, secondBox, thirdBox, fourthBox, fifthBox].map((box, index) => ({
      ...box,
      side: 32,
      row: 0,
      col: index,
    }));
    const { container } = renderBuffExpiryPanel({
      state: { ...runtimeState, boxCount: 5, acceptedMatchCount: 0, tracks: [] },
      snapshot: {
        ...snapshot,
        boxes: nextBoxes,
        displayBoxes: nextBoxes.map((box) => ({
          ...box,
          x: box.x + 1,
        })),
        acceptedMatches: [],
        rejectedMatches: [],
        tracks: [],
        nextIconObservations: [
          {
            id: "slot:0",
            boxIndex: 0,
            box: { x: firstBox.x, y: firstBox.y, size: 32, row: 0, col: 0, confidence: 0.96, score: 0.9 },
            identity: {
              kind: "target",
              group: "expCoupon",
              score: 0.98,
              margin: 0.12,
              decisionReason: "target-accepted",
              bestTargetName: "MVP 3배",
              bestExcludedName: null,
            },
            countdown: {
              kind: "exact",
              text: "59",
              totalSeconds: 59,
              format: "seconds",
              textRegion: "center",
              confidence: 0.95,
              status: "high",
              routerTarget: "center",
              routerConfidence: 0.95,
              routerStatus: "high",
            },
          },
          {
            id: "slot:1",
            boxIndex: 1,
            box: { x: secondBox.x, y: secondBox.y, size: 32, row: 0, col: 1, confidence: 0.93, score: 0.8 },
            identity: {
              kind: "excluded",
              group: null,
              score: 0.97,
              margin: 0.1,
              decisionReason: "excluded-accepted",
              bestTargetName: null,
              bestExcludedName: "VIP",
            },
          },
          {
            id: "slot:2",
            boxIndex: 2,
            box: { x: thirdBox.x, y: thirdBox.y, size: 32, row: 0, col: 2, confidence: 0.91, score: 0.86 },
            identity: {
              kind: "target",
              group: "potion",
              score: 0.93,
              margin: 0.09,
              decisionReason: "target-accepted",
              bestTargetName: "소형 재물 획득의 비약",
              bestExcludedName: null,
            },
            countdown: {
              kind: "exact",
              text: "1:01",
              totalSeconds: 61,
              format: "minutes-seconds",
              textRegion: "center",
              confidence: 0.95,
              status: "high",
              routerTarget: "center",
              routerConfidence: 0.95,
              routerStatus: "high",
            },
          },
          {
            id: "slot:3",
            boxIndex: 3,
            box: { x: fourthBox.x, y: fourthBox.y, size: 32, row: 0, col: 3, confidence: 0.9, score: 0.85 },
            identity: {
              kind: "target",
              group: "potion",
              score: 0.95,
              margin: 0.08,
              decisionReason: "target-accepted",
              bestTargetName: "소형 경험 축적의 비약",
              bestExcludedName: null,
            },
          },
          {
            id: "slot:4",
            boxIndex: 4,
            box: { x: fifthBox.x, y: fifthBox.y, size: 32, row: 0, col: 4, confidence: 0.88, score: 0.84 },
            identity: {
              kind: "target",
              group: "expCoupon",
              score: 0.9,
              margin: 0.05,
              decisionReason: "target-accepted",
              bestTargetName: "MVP 4배",
              bestExcludedName: null,
            },
          },
        ],
      },
      precisionEnginePreloadStatus: "ready",
    });

    const collapsedTargetPreview = screen.getByLabelText("알림 대상 후보 3개");
    expect(collapsedTargetPreview).toBeInTheDocument();
    expect(collapsedTargetPreview.querySelectorAll(".buff-expiry-detected-card.next-target")).toHaveLength(3);
    const collapsedTargetSlots = Array.from(
      collapsedTargetPreview.querySelectorAll(".buff-expiry-precision-collapsed-target-slot"),
    );
    expect(collapsedTargetSlots).toHaveLength(5);
    expect(collapsedTargetSlots.slice(0, 3).every((slot) => slot.querySelector(".buff-expiry-detected-card"))).toBe(
      true,
    );
    expect(collapsedTargetSlots.slice(3).every((slot) => slot.querySelector(".buff-expiry-detected-card") === null))
      .toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "버프 종료 알림 설정 펼치기" }));

    expect(container.querySelector(".buff-expiry-precision-collapsed-target-preview")).toBeNull();
    expect(screen.getByText("알림 대상 후보")).toBeInTheDocument();
    expect(screen.getByText("최근 알림")).toBeInTheDocument();
    expect(screen.getByText("전체 버프")).toBeInTheDocument();
    const targetBoard = screen.getByText("알림 대상 후보").closest(".buff-expiry-precision-target-board");
    const targetHelp = screen.getByRole("button", { name: "알림 대상 후보 안내" });

    expect(targetBoard).not.toBeNull();
    expect(targetHelp).toBeInTheDocument();
    const expCouponCell = within(targetBoard as HTMLElement)
      .getByText("경험치 쿠폰")
      .closest(".buff-expiry-precision-target-cell");
    const potionCell = within(targetBoard as HTMLElement)
      .getByText("비약")
      .closest(".buff-expiry-precision-target-cell");
    fireEvent.mouseEnter(targetHelp);
    const hoverCard = screen
      .getByText("정밀 감지가 알림 대상으로 보고 있는 버프입니다.")
      .closest(".maple-hover-card");
    expect(hoverCard).not.toBeNull();
    expect(hoverCard).toHaveTextContent(
      "지원 버프가 없을 때는 비슷한 버프가 일시적으로 후보에 보일 수 있습니다.",
    );
    expect(hoverCard).toHaveTextContent(
      "알림은 남은 시간 흐름까지 확인한 뒤 확정합니다.",
    );
    expect(hoverCard).toHaveTextContent(
      "잘못 잡힌 버프가 보이면 제보하기로 알려주세요.",
    );
    fireEvent.mouseLeave(targetHelp);
    expect(expCouponCell).not.toBeNull();
    expect(potionCell).not.toBeNull();
    expect(within(targetBoard as HTMLElement).getByText("3개")).toBeInTheDocument();
    expect(within(targetBoard as HTMLElement).queryByText("59초")).not.toBeInTheDocument();
    expect(within(targetBoard as HTMLElement).queryByText("1:01")).not.toBeInTheDocument();
    expect(within(targetBoard as HTMLElement).queryByText("61초")).not.toBeInTheDocument();
    expect(within(expCouponCell as HTMLElement).getByText("1 / 1")).toBeInTheDocument();
    expect(expCouponCell?.querySelectorAll(".buff-expiry-detected-card.next-target")).toHaveLength(1);
    expect(within(potionCell as HTMLElement).getByText("2 / 2")).toBeInTheDocument();
    expect(potionCell?.querySelectorAll(".buff-expiry-precision-target-slot")).toHaveLength(2);
    const potionCards = potionCell?.querySelectorAll(".buff-expiry-detected-card.next-target");
    expect(potionCards).toHaveLength(2);
    expect(potionCards?.[0]).toHaveAttribute("aria-label", expect.stringContaining("0.930"));
    expect(potionCards?.[1]).toHaveAttribute("aria-label", expect.stringContaining("0.950"));
    const fullParserGrid = screen.getByText("전체 버프").closest(".buff-expiry-precision-detected-group");
    expect(fullParserGrid).not.toBeNull();
    expect(within(fullParserGrid as HTMLElement).queryByText("59초")).not.toBeInTheDocument();
    expect(container.querySelectorAll(".buff-expiry-detected-card.next-target")).toHaveLength(7);
    expect(container.querySelectorAll(".buff-expiry-detected-card.next-excluded")).toHaveLength(1);
    expect(container.querySelectorAll(".buff-expiry-detected-card.icon-only")).toHaveLength(8);
  });

  it("filters precision target candidates by the selected alert groups without hiding full parser results", () => {
    const nextBoxes = [firstBox, secondBox].map((box, index) => ({
      ...box,
      side: 32,
      row: 0,
      col: index,
    }));
    renderBuffExpiryPanel({
      config: { selectedPrecisionTargetGroups: ["potion"] },
      state: { ...runtimeState, boxCount: 2, acceptedMatchCount: 1, tracks: [] },
      snapshot: {
        ...snapshot,
        boxes: nextBoxes,
        displayBoxes: nextBoxes,
        acceptedMatches: [],
        rejectedMatches: [],
        tracks: [],
        nextIconObservations: [
          {
            id: "slot:0",
            boxIndex: 0,
            box: { x: firstBox.x, y: firstBox.y, size: 32, row: 0, col: 0, confidence: 0.96, score: 0.9 },
            identity: {
              kind: "target",
              group: "unionWealth",
              score: 0.98,
              margin: 0.12,
              decisionReason: "target-accepted",
              bestTargetName: "유니온의 부",
              bestExcludedName: null,
            },
          },
          {
            id: "slot:1",
            boxIndex: 1,
            box: { x: secondBox.x, y: secondBox.y, size: 32, row: 0, col: 1, confidence: 0.93, score: 0.8 },
            identity: {
              kind: "target",
              group: "potion",
              score: 0.95,
              margin: 0.11,
              decisionReason: "target-accepted",
              bestTargetName: "소형 경험 축적의 비약",
              bestExcludedName: null,
            },
          },
        ],
      },
      precisionEnginePreloadStatus: "ready",
    });

    fireEvent.click(screen.getByRole("button", { name: "버프 종료 알림 설정 펼치기" }));

    const targetBoard = screen.getByText("알림 대상 후보").closest(".buff-expiry-precision-target-board");
    const fullParserGrid = screen.getByText("전체 버프").closest(".buff-expiry-precision-detected-group");
    const unionCell = within(targetBoard as HTMLElement)
      .getByText("유니온의 부")
      .closest(".buff-expiry-precision-target-cell");
    const potionCell = within(targetBoard as HTMLElement)
      .getByText("비약")
      .closest(".buff-expiry-precision-target-cell");

    expect(within(targetBoard as HTMLElement).getByText("1개")).toBeInTheDocument();
    expect(within(unionCell as HTMLElement).getByText("0 / 1")).toBeInTheDocument();
    expect(unionCell?.querySelectorAll(".buff-expiry-detected-card.next-target")).toHaveLength(0);
    expect(within(potionCell as HTMLElement).getByText("1 / 2")).toBeInTheDocument();
    expect(potionCell?.querySelectorAll(".buff-expiry-detected-card.next-target")).toHaveLength(1);
    expect(fullParserGrid?.querySelectorAll(".buff-expiry-detected-card.next-target")).toHaveLength(2);
  });

  it("shows the latest precision alert evidence in the detail panel", () => {
    const lastAlertEvidence = {
      alertedAt: 90_000,
      alertLeadSeconds: 30,
      clusterId: "next-cluster:120",
      dueAt: 90_000,
      triggeredTracks: [
        {
          id: "next:potion:r0:c0",
          buffId: "next:potion",
          name: "비약",
          box: firstBox,
          expiresAt: 120_000,
          remainingSeconds: 30,
          normalizedIconDataUrl: "data:image/png;base64,recent",
        },
      ],
    };

    renderBuffExpiryPanel({
      state: {
        ...runtimeState,
        tracks: [],
        pendingTracks: [],
        acceptedMatchCount: 0,
        boxCount: 1,
        lastAlertEvidence,
      },
      snapshot: {
        ...snapshot,
        sampledAt: 95_000,
        tracks: [],
        pendingTracks: [],
        acceptedMatches: [],
        rejectedMatches: [],
        nextIconObservations: [],
        lastAlertEvidence,
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "버프 종료 알림 설정 펼치기" }));

    const recentAlertGroup = screen.getByText("최근 알림").closest(".buff-expiry-precision-recent-alert");
    expect(recentAlertGroup).not.toBeNull();
    expect(within(recentAlertGroup as HTMLElement).getByText("5초 전")).toBeInTheDocument();
    expect(
      within(recentAlertGroup as HTMLElement).getByLabelText("비약 최근 알림 · 30초 기준으로 알림"),
    ).toBeInTheDocument();
    expect(within(recentAlertGroup as HTMLElement).getByText("30초")).toBeInTheDocument();
  });

  it("keeps a stable precision engine target visible while it is being reacquired", () => {
    const nextBox = {
      ...firstBox,
      side: 32,
      row: 0,
      col: 0,
    };
    const nextBoxPreviewKey = `${nextBox.x}:${nextBox.y}:${nextBox.width}:${nextBox.height}`;
    const makeObservation = () => ({
      id: "slot:0",
      boxIndex: 0,
      box: { x: nextBox.x, y: nextBox.y, size: 32, row: 0, col: 0, confidence: 0.96, score: 0.9 },
      identity: {
        kind: "target" as const,
        group: "expCoupon" as const,
        score: 0.98,
        margin: 0.12,
        decisionReason: "target-accepted",
        bestTargetName: "MVP 3배",
        bestExcludedName: null,
      },
      countdown: null,
    });
    const makeSnapshot = (
      sampledAt: number,
      hasTarget: boolean,
      tracks: BuffExpiryRuntimeState["tracks"] = [],
    ): BuffExpirySnapshot => ({
      ...snapshot,
      sampledAt,
      boxes: [nextBox],
      displayBoxes: hasTarget ? [nextBox] : [],
      acceptedMatches: [],
      rejectedMatches: [],
      tracks,
      pendingTracks: [],
      boxPreviewUrls: {
        [nextBoxPreviewKey]: "data:image/png;base64,Ym94",
      },
      nextIconObservations: hasTarget ? [makeObservation()] : [],
    });
    const makeState = (
      sampledAt: number,
      tracks: BuffExpiryRuntimeState["tracks"] = [],
    ): BuffExpiryRuntimeState => ({
      ...runtimeState,
      tracks,
      pendingTracks: [],
      acceptedMatchCount: 0,
      boxCount: 1,
      lastSampledAt: sampledAt,
    });
    const renderPanel = (
      nextSnapshot: BuffExpirySnapshot,
      config: BuffExpiryPanelTestOverrides["config"] = {},
    ) =>
      createBuffExpiryPanelElement({
        config,
        state: makeState(nextSnapshot.sampledAt, nextSnapshot.tracks),
        snapshot: nextSnapshot,
      });

    const { container, rerender } = render(renderPanel(makeSnapshot(1_000, true)));

    fireEvent.click(screen.getByRole("button", { name: "버프 종료 알림 설정 펼치기" }));
    rerender(renderPanel(makeSnapshot(2_000, false)));

    const targetBoard = screen.getByText("알림 대상 후보").closest(".buff-expiry-precision-target-board");

    expect(targetBoard).not.toBeNull();
    const expCouponCell = within(targetBoard as HTMLElement)
      .getByText("경험치 쿠폰")
      .closest(".buff-expiry-precision-target-cell");
    expect(within(targetBoard as HTMLElement).getByText("1개")).toBeInTheDocument();
    expect(within(expCouponCell as HTMLElement).getByText("1 / 1")).toBeInTheDocument();
    expect(within(targetBoard as HTMLElement).getByText("확인 중")).toBeInTheDocument();
    expect(container.querySelectorAll(".buff-expiry-detected-card.reacquiring")).toHaveLength(1);

    rerender(renderPanel(makeSnapshot(2_500, false), { selectedPrecisionTargetGroups: ["potion"] }));

    expect(within(targetBoard as HTMLElement).queryByText("확인 중")).not.toBeInTheDocument();
    expect(within(targetBoard as HTMLElement).getByText("0개")).toBeInTheDocument();
    expect(within(expCouponCell as HTMLElement).getByText("0 / 1")).toBeInTheDocument();
    expect(container.querySelectorAll(".buff-expiry-detected-card.reacquiring")).toHaveLength(0);

    rerender(renderPanel(makeSnapshot(3_000, true)));
    rerender(renderPanel(makeSnapshot(4_000, true)));
    rerender(renderPanel(makeSnapshot(5_000, true)));
    rerender(renderPanel(makeSnapshot(6_000, false)));

    expect(within(targetBoard as HTMLElement).getByText("1개")).toBeInTheDocument();
    expect(within(expCouponCell as HTMLElement).getByText("1 / 1")).toBeInTheDocument();
    expect(within(targetBoard as HTMLElement).getByText("확인 중")).toBeInTheDocument();
    expect(container.querySelectorAll(".buff-expiry-detected-card.reacquiring")).toHaveLength(1);

    const alertedTrack = {
      ...runtimeState.tracks[0]!,
      id: "next:expCoupon:100:20",
      buffId: "next:expCoupon",
      name: "경험치 쿠폰",
      box: nextBox,
      detectedAt: 5_000,
      lastSeenAt: 5_000,
      alertedAt: 6_100,
    };
    rerender(renderPanel(makeSnapshot(6_200, true, [alertedTrack])));

    expect(container.querySelectorAll(".buff-expiry-detected-card.reacquiring")).toHaveLength(0);
    expect(within(expCouponCell as HTMLElement).getByText("0 / 1")).toBeInTheDocument();
  });

  it("shows pending confirmation diagnostics in debug mode", () => {
    const pendingState: BuffExpiryRuntimeState = {
      ...runtimeState,
      status: "waiting",
      tracks: [],
      pendingTracks: [
        {
          id: "mvp_exp_4x_coupon:100:20",
          buffId: BUFF_EXPIRY_EXP_COUPON_GROUP_ID,
          name: "경험치 쿠폰",
          box: firstBox,
          firstSeenAt: 0,
          lastSeenAt: 1_000,
          observations: [
            { seconds: 45, observedAt: 0, score: 0.98, strength: "strong", reason: "accepted" },
            { seconds: 41, observedAt: 1_000, score: 0.97, strength: "strong", reason: "accepted" },
          ],
          score: 0.97,
        },
      ],
      lastSampledAt: 2_000,
    };

    renderBuffExpiryPanel({
      state: pendingState,
      snapshot: { ...snapshot, tracks: [], pendingTracks: pendingState.pendingTracks },
      showDebug: true,
    });

    fireEvent.click(screen.getByRole("button", { name: "버프 종료 알림 설정 펼치기" }));
    const debugPanel = screen.getByText("버프 종료 확인 상태").closest(".hunt-debug-panel");

    expect(debugPanel).not.toBeNull();
    expect(within(debugPanel as HTMLElement).getByText("경험치 쿠폰")).toBeInTheDocument();
    expect(within(debugPanel as HTMLElement).getByText(/2회 · 45초 -> 41초/)).toBeInTheDocument();
    expect(within(debugPanel as HTMLElement).getByText(/초 흔들림/)).toBeInTheDocument();
  });
});

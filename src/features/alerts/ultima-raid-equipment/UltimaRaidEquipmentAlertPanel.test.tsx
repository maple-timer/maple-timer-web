import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createDefaultUltimaRaidEquipmentAlert } from "../../../lib/storage";
import { createUltimaRaidEquipmentRuntimeState } from "../../../runtime/ultima-raid-equipment/ultimaRaidEquipmentAlertState";
import { UltimaRaidEquipmentAlertPanel } from "./UltimaRaidEquipmentAlertPanel";

describe("UltimaRaidEquipmentAlertPanel", () => {
  it("explains the shared crop and independent repeat alerts", () => {
    renderPanel();

    expect(screen.getByText("시험 운영")).toBeInTheDocument();

    fireEvent.mouseEnter(
      screen.getByRole("button", {
        name: "울티마 스쿼드 알림 안내",
      }),
    );

    expect(
      screen.getByText(
        "울티마 스쿼드 화면 전체를 한 번만 선택하면 두 알림이 같은 화면을 함께 확인합니다.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "하단 진행도가 100%로 바뀌며 보스가 등장하면 보스 알림을 재생합니다.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "반복을 켜면 첫 알림 뒤 설정한 간격과 횟수만큼 추가로 재생합니다.",
      ),
    ).toBeInTheDocument();
  });

  it("shows the combat UI transparency setting in the checklist", () => {
    const { container } = renderPanel();

    fireEvent.mouseEnter(
      within(container).getByRole("button", {
        name: "울티마 스쿼드 알림 체크리스트",
      }),
    );

    expect(
      screen.getByText(
        "인게임 설정 > UI > UI 투명도 > 전투 시 UI 투명도 적용 옵션을 꺼주세요.",
      ),
    ).toBeInTheDocument();
  });

  it("requests a crop when enabled without a saved region", () => {
    const onOpenRegionPicker = vi.fn();
    const { container } = renderPanel({
      config: {
        ...createDefaultUltimaRaidEquipmentAlert(),
        enabled: true,
      },
      onOpenRegionPicker,
    });

    fireEvent.click(
      within(container).getByRole("button", { name: "영역 선택" }),
    );

    expect(onOpenRegionPicker).toHaveBeenCalledTimes(1);
    expect(screen.getByText("울티마 스쿼드 화면 영역 선택 필요")).toBeInTheDocument();
  });

  it("aligns both alert rows to the same status columns", () => {
    const { container } = renderPanel({
      config: {
        ...createDefaultUltimaRaidEquipmentAlert(),
        enabled: true,
        region: { x: 0.2, y: 0.2, width: 0.2, height: 0.2 },
      },
      state: {
        ...createUltimaRaidEquipmentRuntimeState("alerted"),
        alertedForCurrentPresence: true,
        lastAlertedAt: Date.now(),
      },
    });

    const headers = Array.from(container.querySelectorAll("th")).map((header) =>
      header.textContent?.trim(),
    );

    expect(headers).toEqual([
      "활성",
      "알림",
      "상태 설명",
      "감지 상태",
      "반복",
      "마지막 알림",
      "상태",
      "",
    ]);
    expect(within(container).getAllByText("사용 안 함")).toHaveLength(2);
    expect(container).toHaveTextContent("장비 감지");
    expect(container).toHaveTextContent(
      "장비 가방을 비울 때까지 다음 알림 대기",
    );
  });

  it("keeps last-alert metrics anchored to the initial alert during repeats", () => {
    const now = new Date("2026-07-27T12:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    try {
      const state = createUltimaRaidEquipmentRuntimeState("alerted");
      renderPanel({
        state: {
          ...state,
          lastAlertedAt: now.getTime() - 12_000,
          lastPlaybackAt: now.getTime() - 2_000,
          boss: {
            ...state.boss,
            lastAlertedAt: now.getTime() - 18_000,
            lastPlaybackAt: now.getTime() - 1_000,
          },
        },
      });

      expect(screen.getByLabelText("12초 전")).toBeInTheDocument();
      expect(screen.getByLabelText("18초 전")).toBeInTheDocument();
      expect(screen.queryByLabelText("2초 전")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("1초 전")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("updates finite repeat settings independently for equipment and boss alerts", () => {
    const onChange = vi.fn();
    const config = createDefaultUltimaRaidEquipmentAlert();
    const { container } = renderPanel({ config, onChange });
    const panel = within(container);

    fireEvent.click(
      panel.getByRole("button", {
        name: "장비 가방 반복 알림 설정",
      }),
    );
    expect(screen.queryByText("계속 반복")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "2초 간격" }));

    expect(onChange).toHaveBeenCalledWith({
      repeatAlertEnabled: true,
      repeatAlertIntervalSeconds: 2,
      repeatAlertMaxCount: 3,
    });

    fireEvent.click(
      panel.getByRole("button", {
        name: "보스 등장 반복 알림 설정",
      }),
    );
    fireEvent.click(screen.getByRole("option", { name: "5회 반복" }));

    expect(onChange).toHaveBeenLastCalledWith({
      bossAlert: {
        ...config.bossAlert,
        repeatAlertEnabled: true,
        repeatAlertIntervalSeconds: 3,
        repeatAlertMaxCount: 5,
      },
    });
  });

  it("asks for the full raid screen when a legacy bag-only crop is detected", () => {
    renderPanel({
      config: {
        ...createDefaultUltimaRaidEquipmentAlert(),
        enabled: true,
        region: { x: 0.2, y: 0.2, width: 0.2, height: 0.2 },
      },
      state: createUltimaRaidEquipmentRuntimeState("invalid-region"),
    });

    expect(screen.getByText("영역 확인 필요")).toBeInTheDocument();
    expect(
      screen.getByText("울티마 스쿼드 화면 전체를 다시 선택해주세요"),
    ).toBeInTheDocument();
  });

  it("opens the issue report from an enabled alert with a selected region", () => {
    const onSubmitIssueReport = vi.fn();
    const { container } = renderPanel({
      config: {
        ...createDefaultUltimaRaidEquipmentAlert(),
        enabled: true,
        region: { x: 0.1, y: 0.1, width: 0.5, height: 0.3 },
      },
      onSubmitIssueReport,
    });
    const panel = within(container);

    fireEvent.click(
      panel.getByRole("button", { name: "장비 가방 설정 펼치기" }),
    );
    fireEvent.click(panel.getByRole("button", { name: "감지 제보" }));

    expect(onSubmitIssueReport).toHaveBeenCalledTimes(1);
  });

  it("uses the same crop selector when only the boss alert is enabled", () => {
    const onOpenRegionPicker = vi.fn();
    const { container } = renderPanel({
      config: {
        ...createDefaultUltimaRaidEquipmentAlert(),
        bossAlert: {
          ...createDefaultUltimaRaidEquipmentAlert().bossAlert,
          enabled: true,
        },
      },
      onOpenRegionPicker,
    });

    fireEvent.click(
      within(container).getByRole("button", { name: "영역 선택" }),
    );

    expect(onOpenRegionPicker).toHaveBeenCalledTimes(1);
    expect(
      within(container).getAllByText("울티마 스쿼드 화면 영역 선택 필요"),
    ).toHaveLength(1);
  });

  it("opens the boss issue report from the boss row", () => {
    const onSubmitBossIssueReport = vi.fn();
    const base = createDefaultUltimaRaidEquipmentAlert();
    const { container } = renderPanel({
      config: {
        ...base,
        region: { x: 0.1, y: 0.1, width: 0.5, height: 0.3 },
        bossAlert: {
          ...base.bossAlert,
          enabled: true,
        },
      },
      onSubmitBossIssueReport,
    });
    const panel = within(container);

    fireEvent.click(
      panel.getByRole("button", { name: "보스 등장 설정 펼치기" }),
    );
    fireEvent.click(panel.getByRole("button", { name: "감지 제보" }));

    expect(onSubmitBossIssueReport).toHaveBeenCalledTimes(1);
  });
});

function renderPanel({
  config = createDefaultUltimaRaidEquipmentAlert(),
  state = createUltimaRaidEquipmentRuntimeState(),
  onOpenRegionPicker = vi.fn(),
  onChange = vi.fn(),
  onSubmitIssueReport,
  onSubmitBossIssueReport,
}: {
  config?: ReturnType<typeof createDefaultUltimaRaidEquipmentAlert>;
  state?: ReturnType<typeof createUltimaRaidEquipmentRuntimeState>;
  onOpenRegionPicker?: () => void;
  onChange?: ReturnType<typeof vi.fn>;
  onSubmitIssueReport?: () => void;
  onSubmitBossIssueReport?: () => void;
} = {}) {
  return render(
    <UltimaRaidEquipmentAlertPanel
      config={config}
      state={state}
      snapshot={null}
      hasStream
      canPickRegion
      currentLayoutKey={null}
      onChange={onChange}
      onOpenRegionPicker={onOpenRegionPicker}
      onPreviewSound={vi.fn()}
      onSubmitIssueReport={onSubmitIssueReport}
      onSubmitBossIssueReport={onSubmitBossIssueReport}
    />,
  );
}

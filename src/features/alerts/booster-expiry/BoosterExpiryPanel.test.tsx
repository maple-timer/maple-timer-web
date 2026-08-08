import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBoosterExpiryRuntimeState } from "../../../lib/boosterExpiry/boosterExpiryRuntime";
import { createDefaultBoosterExpiryAlert } from "../../../lib/storage";
import { BoosterExpiryPanel } from "./BoosterExpiryPanel";

describe("BoosterExpiryPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("starts with the booster detail controls collapsed and opens them from the row toggle", () => {
    render(
      <BoosterExpiryPanel
        config={createDefaultBoosterExpiryAlert()}
        state={createBoosterExpiryRuntimeState()}
        snapshot={null}
        hasStream={false}
        showDebug={false}
        onChange={vi.fn()}
        onResetDetection={vi.fn()}
        onPreviewSound={vi.fn()}
        onSubmitIssueReport={vi.fn()}
        isSubmittingIssueReport={false}
      />,
    );

    expect(screen.getByRole("button", { name: "부스터 종료 알림 설정 펼치기" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "부스터 종료 알림 안내" })).toHaveTextContent(
      "사용 안내",
    );
    expect(screen.queryByRole("button", { name: "부스터 종료 알림 설정 접기" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "감지 제보" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "부스터 종료 알림 설정 펼치기" }));

    expect(screen.getByRole("button", { name: "부스터 종료 알림 설정 접기" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "감지 제보" })).toBeInTheDocument();
  });

  it("shows the current reading and alert countdown in separate metric columns", () => {
    const now = 100_000;

    const { container } = render(
      <BoosterExpiryPanel
        config={{ ...createDefaultBoosterExpiryAlert(), enabled: true, alertLeadSeconds: 10 }}
        state={{
          ...createBoosterExpiryRuntimeState(),
          status: "armed",
          lastSampledAt: now,
          displayText: "01:05",
          remainingSeconds: 65,
          alertAt: now + 20_000,
          locked: true,
        }}
        snapshot={null}
        hasStream
        showDebug={false}
        onChange={vi.fn()}
        onResetDetection={vi.fn()}
        onPreviewSound={vi.fn()}
        onSubmitIssueReport={vi.fn()}
        isSubmittingIssueReport={false}
      />,
    );

    const headers = Array.from(container.querySelectorAll("thead th")).map((header) =>
      header.textContent?.trim() ?? "",
    );

    expect(screen.getByText("상태 설명")).toBeInTheDocument();
    expect(screen.getByText("알림 시각 확보됨")).toBeInTheDocument();
    expect(screen.getAllByText("판독값")).toHaveLength(2);
    expect(screen.getAllByText("알림까지")).toHaveLength(2);
    expect(headers.indexOf("판독값")).toBeLessThan(headers.indexOf("알림 시점"));
    expect(headers.indexOf("알림 시점")).toBeLessThan(headers.indexOf("알림까지"));
    expect(headers.indexOf("알림까지")).toBeLessThan(headers.indexOf("마지막 알림"));
    expect(screen.getByLabelText("01:05")).toHaveTextContent("1:05");
    expect(screen.getByLabelText("20초 뒤")).toHaveTextContent("20초 뒤");
    expect(screen.queryByText("20초 뒤 알림")).not.toBeInTheDocument();
  });
});

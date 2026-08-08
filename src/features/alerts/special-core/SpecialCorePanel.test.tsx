import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  createSpecialCoreRuntimeState,
  type SpecialCoreCandidateIcon,
  type SpecialCoreSnapshot,
} from "../../../lib/specialCore";
import { createDefaultSpecialCoreAlert } from "../../../lib/storage";
import { SpecialCorePanel } from "./SpecialCorePanel";

describe("SpecialCorePanel", () => {
  it("keeps the confirmed activation icon in the status detail cell", () => {
    const confirmedIcon = createSpecialCoreCandidateIcon({ score: 4.25 });
    const latestSnapshotIcon = createSpecialCoreCandidateIcon({ score: 9.75, boxIndex: 1 });
    render(
      <SpecialCorePanel
        config={{ ...createDefaultSpecialCoreAlert(), enabled: true }}
        state={createSpecialCoreRuntimeState({
          status: "cooldown",
          lastSampledAt: 10_000,
          activationId: 1,
          activationStartedAt: 8_000,
          activationConfirmedAt: 9_000,
          activationLastSeenAt: 9_000,
          cooldownEndsAt: 38_000,
          alertDueAt: 33_000,
          lastDetectedIcon: latestSnapshotIcon,
          activationEvidence: {
            activationId: 1,
            activationStartedAt: 8_000,
            activationConfirmedAt: 9_000,
            confirmationIcons: [confirmedIcon],
          },
        })}
        snapshot={createSpecialCoreSnapshot(latestSnapshotIcon)}
        hasStream
        showDebug={false}
        onChange={() => undefined}
        onResetDetection={() => undefined}
        onPreviewSound={() => undefined}
        onSubmitIssueReport={() => undefined}
        isSubmittingIssueReport={false}
      />,
    );

    expect(screen.getByLabelText("특수코어 매칭 4.25 · 알림 예정")).toBeInTheDocument();
    expect(screen.queryByLabelText("특수코어 매칭 9.75 · 알림 예정")).not.toBeInTheDocument();
    expect(screen.getAllByText("남은 쿨타임").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("28초")).toBeInTheDocument();
    expect(screen.queryByText("알림까지")).not.toBeInTheDocument();
  });

  it("shows ready when the special core cooldown has ended", () => {
    render(
      <SpecialCorePanel
        config={{ ...createDefaultSpecialCoreAlert(), enabled: true }}
        state={createSpecialCoreRuntimeState({
          status: "alerted",
          lastSampledAt: 40_000,
          activationId: 1,
          activationStartedAt: 8_000,
          activationConfirmedAt: 9_000,
          activationLastSeenAt: 9_000,
          cooldownEndsAt: 38_000,
          alertDueAt: 33_000,
          alertedAt: 33_000,
          lastAlertedAt: 33_000,
        })}
        snapshot={null}
        hasStream
        showDebug={false}
        onChange={() => undefined}
        onResetDetection={() => undefined}
        onPreviewSound={() => undefined}
        onSubmitIssueReport={() => undefined}
        isSubmittingIssueReport={false}
      />,
    );

    expect(screen.getByText("준비됨")).toBeInTheDocument();
  });

  it("uses the special-core-specific favorite guide video", () => {
    const { container } = render(
      <SpecialCorePanel
        config={{ ...createDefaultSpecialCoreAlert(), enabled: true }}
        state={createSpecialCoreRuntimeState()}
        snapshot={null}
        hasStream
        showDebug={false}
        onChange={() => undefined}
        onResetDetection={() => undefined}
        onPreviewSound={() => undefined}
        onSubmitIssueReport={() => undefined}
        isSubmittingIssueReport={false}
      />,
    );

    const guideButton = within(container).getByRole("button", {
      name: "특수코어 즐겨찾기 제외 안내",
    });
    fireEvent.mouseEnter(guideButton);

    expect(screen.getByLabelText("특수코어 버프칸 설정 예시")).toHaveAttribute(
      "src",
      "/media/special-core-favorite-settings-guide.mp4",
    );
  });
});

function createSpecialCoreSnapshot(detectedIcon: SpecialCoreCandidateIcon): SpecialCoreSnapshot {
  return {
    sampledAt: 10_000,
    boxCount: 2,
    detectedCount: 1,
    detectedIcon,
    candidateIcons: [detectedIcon],
    performance: {
      totalMs: 2,
      detectMs: 1,
      matchMs: 1,
      boxCount: 2,
    },
  };
}

function createSpecialCoreCandidateIcon({
  score,
  boxIndex = 0,
}: {
  score: number;
  boxIndex?: number;
}): SpecialCoreCandidateIcon {
  return {
    boxIndex,
    box: {
      x: 100 + boxIndex * 40,
      y: 20,
      size: 32,
      confidence: 0.9,
      score: 12,
    },
    icon: {
      width: 32,
      height: 32,
      data: new Uint8ClampedArray(32 * 32 * 4),
    },
    match: {
      matched: true,
      targetId: "specialCore",
      bundleId: "special-core-deep-v2",
      modelId: "special-core-deep-v2",
      modelVersion: "special-core-20260711-v2",
      variantId: "test",
      gateVersion: 2,
      score,
      threshold: 0,
      margin: score,
      gateScore: 0.98,
      gateThreshold: 0.94,
      gateMargin: 0.04,
      rescueThreshold: 0.999,
      rescueMargin: -0.019,
      basePassed: true,
      positiveGatePassed: true,
      primaryPassed: true,
      rescuePassed: false,
      decisionReason: "base_and_positive_gate_passed",
      elapsedMs: 1,
    },
  };
}

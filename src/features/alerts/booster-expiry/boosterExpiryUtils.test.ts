import { describe, expect, it } from "vitest";
import { createBoosterExpiryRuntimeState } from "../../../lib/boosterExpiry/boosterExpiryRuntime";
import {
  getBoosterExpiryReadingLabel,
  getBoosterExpiryStatusView,
} from "./boosterExpiryUtils";

describe("boosterExpiryUtils", () => {
  it("asks for game viewport calibration when capture is still connected", () => {
    expect(
      getBoosterExpiryStatusView(
        createBoosterExpiryRuntimeState(),
        true,
        true,
        false,
      ),
    ).toEqual({
      label: "게임 영역 설정 필요",
      detail: "화면 공유 메뉴에서 게임 영역 설정",
      className: "warning",
    });
  });

  it("hides raw timer candidates until the runtime is locked", () => {
    const state = {
      ...createBoosterExpiryRuntimeState(),
      status: "confirming" as const,
      rawText: "19.00",
      rawRemainingSeconds: 19,
      locked: false,
      lastDecision: "raw-pending" as const,
    };

    expect(getBoosterExpiryReadingLabel(state)).toEqual({
      primary: "--",
      secondary: "타이머 대기",
    });
    expect(getBoosterExpiryStatusView(state, true, true)).toMatchObject({
      label: "시간 확인 중",
      detail: "타이머인지 확인 중",
    });
  });

  it("shows the timer only after the runtime has confirmed the timer flow", () => {
    const state = {
      ...createBoosterExpiryRuntimeState(),
      status: "armed" as const,
      displayText: "18.00",
      remainingSeconds: 18,
      locked: true,
      alertAt: 9_000,
      lastSampledAt: 6_000,
      lastDecision: "raw-locked" as const,
    };

    expect(getBoosterExpiryReadingLabel(state)).toEqual({
      primary: "18.00",
      secondary: "확정",
    });
    expect(getBoosterExpiryStatusView(state, true, true)).toMatchObject({
      label: "알림 대기",
      detail: "알림 시각 확보됨",
      alertCountdownSeconds: 3,
    });
  });

  it("does not show stale predicted text as the primary reading while raw is rejected", () => {
    const state = {
      ...createBoosterExpiryRuntimeState(),
      status: "confirming" as const,
      rawText: "58.66",
      displayText: "20:19",
      rawRemainingSeconds: 58.66,
      remainingSeconds: 1219,
      flowSource: "predicted-rejected-raw",
      locked: true,
      consecutiveRawDetections: 2,
      lastDecision: "raw-locked" as const,
    };

    expect(getBoosterExpiryReadingLabel(state)).toEqual({
      primary: "58.66",
      secondary: "시간 확인 중",
    });
  });

  it("shows next booster waiting after an alerted cycle has expired", () => {
    const state = {
      ...createBoosterExpiryRuntimeState(),
      status: "waiting" as const,
      displayText: "00.00",
      remainingSeconds: null,
      locked: true,
      alertedAt: 90_000,
      confirmedExpiresAt: 100_000,
      lastSampledAt: 101_000,
      lastDecision: "timer-waiting" as const,
    };

    expect(getBoosterExpiryReadingLabel(state)).toEqual({
      primary: "--",
      secondary: "다음 부스터 대기",
    });
    expect(getBoosterExpiryStatusView(state, true, true)).toMatchObject({
      label: "다음 부스터 대기",
      detail: "새 부스터 타이머 대기 중",
    });
  });

  it("keeps the alerted status detail independent from the last reading text", () => {
    const state = {
      ...createBoosterExpiryRuntimeState(),
      status: "alerted" as const,
      displayText: "00.05",
      remainingSeconds: 5,
      locked: true,
      alertedAt: 95_000,
      lastSampledAt: 96_000,
      lastDecision: "alerted" as const,
    };

    expect(getBoosterExpiryStatusView(state, true, true)).toMatchObject({
      label: "알림 완료",
      detail: "이번 부스터 알림 완료",
    });
  });
});

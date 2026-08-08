import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  BuffExpiryBox,
  BuffExpiryRuntimeState,
} from "../../../lib/buffExpiry/buffExpiryTypes";
import { BUFF_EXPIRY_EXP_COUPON_GROUP_ID } from "../../../lib/buffExpiry/buffExpiryCatalog";
import { createBuffExpiryRuntimeState } from "../../../lib/buffExpiry/buffExpiryRuntimeState";
import { getBuffExpiryStatusView } from "./buffExpiryUtils";

const box: BuffExpiryBox = {
  x: 100,
  y: 20,
  width: 32,
  height: 32,
  confidence: 0.96,
};

function makeState(patch: Partial<BuffExpiryRuntimeState>): BuffExpiryRuntimeState {
  return {
    ...createBuffExpiryRuntimeState(),
    status: "waiting",
    ...patch,
  };
}

describe("buffExpiryUtils", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a screen share hint while the buff expiry alert has no stream", () => {
    const view = getBuffExpiryStatusView(makeState({}), false, true);

    expect(view).toEqual({
      label: "화면 공유 필요",
      detail: "화면 공유 후 버프칸 확인",
      className: "no-stream",
    });
  });

  it("asks for game viewport calibration while keeping the alert enabled", () => {
    expect(getBuffExpiryStatusView(makeState({}), true, true, false)).toEqual({
      label: "게임 영역 설정 필요",
      detail: "화면 공유 메뉴에서 게임 영역 설정",
      className: "warning",
    });
  });

  it("shows when the last tracked buff alert fired instead of an internal completed count", () => {
    vi.spyOn(Date, "now").mockReturnValue(20_000);

    const view = getBuffExpiryStatusView(
      makeState({
        status: "alerted",
        lastAlertedAt: 15_000,
        tracks: [
          {
            id: "mvp_exp_4x_coupon:100:20",
            buffId: BUFF_EXPIRY_EXP_COUPON_GROUP_ID,
            name: "경험치 쿠폰",
            box,
            detectedSeconds: 45,
            detectedAt: 1_000,
            expiresAt: 45_000,
            lastSeenAt: 2_000,
            alertedAt: 15_000,
            score: 0.98,
          },
        ],
      }),
      true,
      true,
    );

    expect(view).toEqual({
      label: "알림 완료",
      detail: "다음 버프를 기다리는 중",
      className: "alerted",
    });
  });

  it("hides the internal pending observation count from the status detail", () => {
    vi.spyOn(Date, "now").mockReturnValue(2_000);

    const view = getBuffExpiryStatusView(
      makeState({
        status: "tracking",
        pendingTracks: [
          {
            id: "mvp_exp_4x_coupon:100:20",
            buffId: BUFF_EXPIRY_EXP_COUPON_GROUP_ID,
            name: "경험치 쿠폰",
            box,
            firstSeenAt: 1_000,
            lastSeenAt: 2_000,
            observations: [
              { seconds: 45, observedAt: 1_000, score: 0.98, strength: "strong", reason: "accepted" },
              { seconds: 44, observedAt: 2_000, score: 0.98, strength: "strong", reason: "accepted" },
            ],
            score: 0.98,
          },
        ],
      }),
      true,
      true,
    );

    expect(view).toEqual({
      label: "시간 확인 중",
      detail: "남은 시간 흐름 확인 중",
      className: "candidate",
    });
  });

  it("keeps one-off weak pending candidates out of the user-facing status", () => {
    vi.spyOn(Date, "now").mockReturnValue(2_000);

    const view = getBuffExpiryStatusView(
      makeState({
        status: "tracking",
        pendingTracks: [
          {
            id: "union_wealth:100:20",
            buffId: "union_wealth",
            name: "유니온의 부 III",
            box,
            firstSeenAt: 1_000,
            lastSeenAt: 1_000,
            observations: [
              { seconds: 39, observedAt: 1_000, score: 0.9229, strength: "weak", reason: "weak-countdown" },
            ],
            score: 0.9229,
          },
        ],
      }),
      true,
      true,
    );

    expect(view).toEqual({
      label: "감지 대기",
      detail: "버프칸 확인 중",
      className: "waiting",
    });
  });

  it("still shows a single strong pending candidate as checking", () => {
    vi.spyOn(Date, "now").mockReturnValue(2_000);

    const view = getBuffExpiryStatusView(
      makeState({
        status: "tracking",
        pendingTracks: [
          {
            id: "union_wealth:100:20",
            buffId: "union_wealth",
            name: "유니온의 부 III",
            box,
            firstSeenAt: 1_000,
            lastSeenAt: 1_000,
            observations: [
              { seconds: 39, observedAt: 1_000, score: 0.96, strength: "strong", reason: "accepted" },
            ],
            score: 0.96,
          },
        ],
      }),
      true,
      true,
    );

    expect(view).toEqual({
      label: "시간 확인 중",
      detail: "남은 시간 흐름 확인 중",
      className: "candidate",
    });
  });

  it("shows temporal or cluster confirmation candidates as checking", () => {
    vi.spyOn(Date, "now").mockReturnValue(2_000);

    const view = getBuffExpiryStatusView(
      makeState({
        status: "tracking",
        confirmationCandidateCount: 1,
        boxCount: 24,
      }),
      true,
      true,
    );

    expect(view).toEqual({
      label: "시간 확인 중",
      detail: "남은 시간 흐름 확인 중",
      className: "candidate",
    });
  });

  it("uses a countdown waiting message even when buff boxes are visible", () => {
    vi.spyOn(Date, "now").mockReturnValue(2_000);

    const view = getBuffExpiryStatusView(
      makeState({
        status: "waiting",
        boxCount: 8,
      }),
      true,
      true,
    );

    expect(view).toEqual({
      label: "감지 대기",
      detail: "지원 버프를 찾는 중",
      className: "waiting",
    });
  });

  it("exposes active countdown numbers for animated status rendering", () => {
    vi.spyOn(Date, "now").mockReturnValue(20_000);

    const view = getBuffExpiryStatusView(
      makeState({
        status: "tracking",
        tracks: [
          {
            id: "mvp_exp_4x_coupon:100:20",
            buffId: BUFF_EXPIRY_EXP_COUPON_GROUP_ID,
            name: "경험치 쿠폰",
            box,
            detectedSeconds: 45,
            detectedAt: 1_000,
            expiresAt: 45_000,
            lastSeenAt: 2_000,
            alertedAt: null,
            score: 0.98,
          },
        ],
      }),
      true,
      true,
    );

    expect(view).toEqual({
      label: "알림 대기",
      detail: "알림 예정",
      className: "active",
      activeTrackCount: 1,
      remainingSeconds: 25,
    });
  });

  it("explains when buff expiry detection is disabled", () => {
    const view = getBuffExpiryStatusView(makeState({ status: "paused" }), true, false);

    expect(view).toEqual({
      label: "중지",
      detail: "알림 꺼짐",
      className: "paused",
    });
  });
});

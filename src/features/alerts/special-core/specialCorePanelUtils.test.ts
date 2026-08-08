import { describe, expect, it } from "vitest";
import { createSpecialCoreRuntimeState } from "../../../lib/specialCore";
import { getSpecialCoreStatusView } from "./specialCorePanelUtils";

describe("getSpecialCoreStatusView", () => {
  it("asks for game viewport calibration without treating capture as missing", () => {
    expect(
      getSpecialCoreStatusView({
        state: createSpecialCoreRuntimeState(),
        hasStream: true,
        enabled: true,
        isGameViewportReady: false,
      }),
    ).toEqual({
      label: "게임 영역 설정 필요",
      detail: "화면 공유 메뉴에서 게임 영역 설정",
      className: "warning",
    });
  });

  it("shows an explicit loading state while the V2 matcher initializes", () => {
    const view = getSpecialCoreStatusView({
      state: createSpecialCoreRuntimeState({ status: "loading" }),
      hasStream: true,
      enabled: true,
    });

    expect(view).toEqual({
      label: "준비 중",
      detail: "특수코어 정밀 감지 준비 중",
      className: "loading",
    });
  });
});

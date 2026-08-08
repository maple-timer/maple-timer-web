import { describe, expect, it } from "vitest";
import { createGeneralTimer } from "../../domain/general-timer/generalTimers";
import {
  getCustomTimerParts,
  getGeneralTimerActionView,
  getGeneralTimerRowClassName,
  getGeneralTimerStatusView,
  isGeneralTimerInteractiveTarget,
  isGeneralTimerToggleKey,
} from "./generalTimerPanelViewModel";

describe("generalTimerPanelViewModel", () => {
  it("maps timer status to panel status chips", () => {
    expect(getGeneralTimerStatusView("disabled")).toEqual({
      label: "꺼짐",
      className: "paused",
    });
    expect(getGeneralTimerStatusView("running")).toEqual({
      label: "진행 중",
      className: "active",
    });
    expect(getGeneralTimerStatusView("paused")).toEqual({
      label: "일시정지",
      className: "paused",
    });
    expect(getGeneralTimerStatusView("done")).toEqual({
      label: "알림 완료",
      className: "alerted",
    });
    expect(getGeneralTimerStatusView("idle")).toEqual({
      label: "대기",
      className: "waiting",
    });
  });

  it("maps timer status to the primary row action", () => {
    expect(getGeneralTimerActionView("running")).toEqual({
      label: "일시정지",
      title: "일시정지",
      icon: "pause",
    });
    expect(getGeneralTimerActionView("paused")).toEqual({
      label: "재개",
      title: "재개",
      icon: "play",
    });
    expect(getGeneralTimerActionView("idle")).toEqual({
      label: "시작",
      title: "시작",
      icon: "play",
    });
    expect(getGeneralTimerActionView("done")).toEqual({
      label: "시작",
      title: "시작",
      icon: "play",
    });
  });

  it("builds timer row class names from enabled and expanded state", () => {
    expect(getGeneralTimerRowClassName({ isEnabled: true, isExpanded: false })).toBe(
      "dashboard-row general-timer-row",
    );
    expect(getGeneralTimerRowClassName({ isEnabled: false, isExpanded: true })).toBe(
      "dashboard-row general-timer-row is-disabled-row expanded-row",
    );
  });

  it("splits custom timer duration into minute and second inputs", () => {
    expect(
      getCustomTimerParts(
        createGeneralTimer({ presetId: "custom", customDurationSeconds: 125 }),
      ),
    ).toEqual({
      minutes: 2,
      seconds: 5,
    });
    expect(getCustomTimerParts(createGeneralTimer({ presetId: "custom" }))).toEqual({
      minutes: 30,
      seconds: 0,
    });
  });

  it("recognizes timer row toggle keys", () => {
    expect(isGeneralTimerToggleKey("Enter")).toBe(true);
    expect(isGeneralTimerToggleKey(" ")).toBe(true);
    expect(isGeneralTimerToggleKey("Escape")).toBe(false);
  });

  it("recognizes interactive targets inside a timer row", () => {
    const button = document.createElement("button");
    const wrapper = document.createElement("div");
    const customInteractive = document.createElement("span");
    customInteractive.dataset.interactive = "true";
    wrapper.append(button, customInteractive);

    expect(isGeneralTimerInteractiveTarget(button)).toBe(true);
    expect(isGeneralTimerInteractiveTarget(customInteractive)).toBe(true);
    expect(isGeneralTimerInteractiveTarget(wrapper)).toBe(false);
    expect(isGeneralTimerInteractiveTarget(null)).toBe(false);
  });
});

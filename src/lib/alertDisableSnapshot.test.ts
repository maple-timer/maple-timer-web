import { afterEach, describe, expect, it } from "vitest";
import {
  clearAlertDisableSnapshot,
  loadAlertDisableSnapshot,
  saveAlertDisableSnapshot,
} from "./alertDisableSnapshot";

describe("alertDisableSnapshot", () => {
  afterEach(() => {
    clearAlertDisableSnapshot();
  });

  it("restores enabled state from a stored snapshot", () => {
    saveAlertDisableSnapshot({
      skills: { skill_a: true, skill_b: false },
      runeEnabled: true,
      generalTimers: { timer_a: true, timer_b: false },
      generalTimerRunning: { timer_a: true },
      createdAt: 1_000,
    });

    const loaded = loadAlertDisableSnapshot();

    expect(loaded?.skills).toEqual({ skill_a: true, skill_b: false });
    expect(loaded?.runeEnabled).toBe(true);
    expect(loaded?.generalTimers).toEqual({ timer_a: true, timer_b: false });
    expect(loaded?.createdAt).toBe(1_000);
  });

  it("drops running general timers so a stored snapshot cannot restart them", () => {
    // A stored snapshot is always from an earlier page load. Re-enabling
    // alerts in a later session must not press play on last session's timers,
    // which would bypass the rule that refreshing never keeps timers running.
    saveAlertDisableSnapshot({
      skills: {},
      runeEnabled: false,
      generalTimers: { timer_a: true },
      generalTimerRunning: { timer_a: true },
      createdAt: 1_000,
    });

    expect(loadAlertDisableSnapshot()?.generalTimerRunning).toEqual({});
  });
});

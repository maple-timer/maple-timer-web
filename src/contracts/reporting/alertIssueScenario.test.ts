import { describe, expect, it } from "vitest";
import {
  ALERT_ISSUE_OTHER_CATEGORY_OPTIONS,
  ALERT_ISSUE_OCCURRENCE_OPTIONS,
  getAlertIssueScenarioOptions,
  getAlertIssueEvidenceRequirements,
} from "./alertIssueScenario";

const REASONS = [
  "rune-missed",
  "rune-false-positive",
  "ultima-raid-equipment-missed",
  "ultima-raid-equipment-false-alert",
  "ultima-raid-equipment-rearm",
  "ultima-raid-boss-missed",
  "ultima-raid-boss-false-alert",
  "ultima-raid-boss-rearm",
  "skill-not-detected",
  "skill-alert-timing",
  "hunt-stall-missed",
  "hunt-stall-false-alert",
  "hunt-stall-reading",
  "buff-expiry-missed",
  "buff-expiry-false-alert",
  "buff-expiry-reading",
  "booster-expiry-missed",
  "booster-expiry-false-alert",
  "booster-expiry-reading",
  "special-core-missed",
  "special-core-false-alert",
  "special-core-timing",
  "other",
] as const;

describe("alert issue scenarios", () => {
  it.each(REASONS)("provides structured scenarios for %s", (reason) => {
    const options = getAlertIssueScenarioOptions(reason);

    expect(options.length).toBeGreaterThan(0);
    expect(new Set(options.map((option) => option.scenario)).size).toBe(options.length);
    expect(options.every((option) => option.label.trim().length > 0)).toBe(true);
  });

  it("falls back to the other scenario for unknown legacy reasons", () => {
    expect(getAlertIssueScenarioOptions("removed-reason")).toEqual([
      { scenario: "other", label: "위 항목과 다른 문제예요" },
    ]);
  });

  it("keeps current, recent, and historical occurrence windows distinct", () => {
    expect(ALERT_ISSUE_OCCURRENCE_OPTIONS.map((option) => option.occurrence)).toEqual([
      "current",
      "recent",
      "historical",
    ]);
    expect(ALERT_ISSUE_OCCURRENCE_OPTIONS.map((option) => option.label)).toEqual([
      "제보 창을 열기 직전에도 문제였어요",
      "제보 창을 열기 전 1분 안에 있었어요",
      "제보 창을 열기 1분보다 전에 있었어요",
    ]);
  });

  it("keeps other reports operationally classifiable", () => {
    expect(ALERT_ISSUE_OTHER_CATEGORY_OPTIONS.map((option) => option.category)).toEqual([
      "status-display",
      "sound-volume",
      "settings-preset",
      "performance-error",
      "interaction",
      "other",
    ]);
  });
});

describe("getAlertIssueEvidenceRequirements", () => {
  it("requires temporal state and playback coverage for recognized alerts that stayed silent", () => {
    expect(getAlertIssueEvidenceRequirements("recognized-no-alert")).toEqual([
      "temporalTrace",
      "stateBeforeAfter",
      "decision",
      "playback",
    ]);
  });

  it("does not invent universal evidence requirements for other", () => {
    expect(getAlertIssueEvidenceRequirements("other")).toEqual([]);
  });
});

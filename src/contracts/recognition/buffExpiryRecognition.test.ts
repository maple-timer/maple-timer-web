import { describe, expect, it } from "vitest";
import {
  BUFF_EXPIRY_TARGET_GROUPS,
  isBuffExpiryTargetGroup,
  normalizeBuffExpiryTargetGroups,
} from "./buffExpiryRecognition";

describe("buff expiry recognition target groups", () => {
  it("keeps the canonical target order", () => {
    expect(BUFF_EXPIRY_TARGET_GROUPS).toEqual([
      "unionWealth",
      "unionLuck",
      "potion",
      "expCoupon",
    ]);
  });

  it("falls back to every target for missing or unusable selections", () => {
    expect(normalizeBuffExpiryTargetGroups(undefined)).toEqual(
      BUFF_EXPIRY_TARGET_GROUPS,
    );
    expect(normalizeBuffExpiryTargetGroups([])).toEqual(
      BUFF_EXPIRY_TARGET_GROUPS,
    );
    expect(normalizeBuffExpiryTargetGroups(["unknown", 1])).toEqual(
      BUFF_EXPIRY_TARGET_GROUPS,
    );
  });

  it("keeps valid selection order while removing invalid and duplicate values", () => {
    expect(
      normalizeBuffExpiryTargetGroups([
        "potion",
        "unionLuck",
        "potion",
        "unknown",
      ]),
    ).toEqual(["potion", "unionLuck"]);
  });

  it("recognizes only supported target group names", () => {
    expect(isBuffExpiryTargetGroup("expCoupon")).toBe(true);
    expect(isBuffExpiryTargetGroup("unknown")).toBe(false);
  });
});

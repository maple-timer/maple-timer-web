import { describe, expect, it } from "vitest";
import {
  clampBuffExpiryAlertLeadSeconds,
  DEFAULT_BUFF_EXPIRY_ALERT_LEAD_SECONDS,
  formatBuffExpiryAlertLeadSeconds,
  getBuffExpiryAlertLeadBounds,
  getBuffExpiryEffectiveAlertLeadSeconds,
} from "./alertLeadPolicy";

describe("buff expiry alert lead policy", () => {
  it("keeps the active precision bounds and default", () => {
    expect(getBuffExpiryAlertLeadBounds()).toEqual({ min: -5, max: 20 });
    expect(DEFAULT_BUFF_EXPIRY_ALERT_LEAD_SECONDS).toBe(20);
  });

  it("rounds and clamps persisted values", () => {
    expect(clampBuffExpiryAlertLeadSeconds(-99)).toBe(-5);
    expect(clampBuffExpiryAlertLeadSeconds(0.4)).toBe(0);
    expect(clampBuffExpiryAlertLeadSeconds(99)).toBe(20);
    expect(getBuffExpiryEffectiveAlertLeadSeconds({ alertLeadSeconds: 4.6 })).toBe(5);
  });

  it("formats before and after-expiry values without changing their meaning", () => {
    expect(formatBuffExpiryAlertLeadSeconds(7)).toEqual({
      value: 7,
      suffix: "초 전",
      label: "7초 전",
    });
    expect(formatBuffExpiryAlertLeadSeconds(-3)).toEqual({
      value: 3,
      suffix: "초 후",
      label: "3초 후",
    });
  });
});

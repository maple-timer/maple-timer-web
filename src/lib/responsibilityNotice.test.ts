import { afterEach, describe, expect, it } from "vitest";
import {
  hasDismissedResponsibilityNotice,
  saveResponsibilityNoticeDismissed,
  shouldShowResponsibilityNotice,
} from "./responsibilityNotice";

describe("responsibility notice storage", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("shows the responsibility notice by default", () => {
    expect(hasDismissedResponsibilityNotice()).toBe(false);
    expect(shouldShowResponsibilityNotice()).toBe(true);
  });

  it("persists the dismissed preference", () => {
    saveResponsibilityNoticeDismissed(true);

    expect(hasDismissedResponsibilityNotice()).toBe(true);
    expect(shouldShowResponsibilityNotice()).toBe(false);
  });

  it("can clear the dismissed preference", () => {
    saveResponsibilityNoticeDismissed(true);
    saveResponsibilityNoticeDismissed(false);

    expect(shouldShowResponsibilityNotice()).toBe(true);
  });
});

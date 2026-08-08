import { afterEach, describe, expect, it } from "vitest";
import {
  hasDismissedOnboarding,
  saveOnboardingDismissed,
  shouldShowOnboarding,
} from "./onboarding";

describe("onboarding storage", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("shows onboarding by default", () => {
    expect(hasDismissedOnboarding()).toBe(false);
    expect(shouldShowOnboarding()).toBe(true);
  });

  it("persists the dismissed preference", () => {
    saveOnboardingDismissed(true);

    expect(hasDismissedOnboarding()).toBe(true);
    expect(shouldShowOnboarding()).toBe(false);
  });

  it("can clear the dismissed preference", () => {
    saveOnboardingDismissed(true);
    saveOnboardingDismissed(false);

    expect(shouldShowOnboarding()).toBe(true);
  });
});

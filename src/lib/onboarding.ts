const ONBOARDING_STORAGE_KEY = "maple-hunt-timer.onboarding.dismissed.v1";

export function hasDismissedOnboarding(): boolean {
  if (typeof localStorage === "undefined") {
    return false;
  }

  return localStorage.getItem(ONBOARDING_STORAGE_KEY) === "1";
}

export function shouldShowOnboarding(): boolean {
  return !hasDismissedOnboarding();
}

export function saveOnboardingDismissed(dismissed: boolean): void {
  if (typeof localStorage === "undefined") {
    return;
  }

  if (dismissed) {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, "1");
    return;
  }

  localStorage.removeItem(ONBOARDING_STORAGE_KEY);
}

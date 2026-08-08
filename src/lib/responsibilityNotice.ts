const RESPONSIBILITY_NOTICE_STORAGE_KEY =
  "maple-hunt-timer.responsibility-notice.dismissed.v1";

export function hasDismissedResponsibilityNotice(): boolean {
  if (typeof localStorage === "undefined") {
    return false;
  }

  return localStorage.getItem(RESPONSIBILITY_NOTICE_STORAGE_KEY) === "1";
}

export function shouldShowResponsibilityNotice(): boolean {
  return !hasDismissedResponsibilityNotice();
}

export function saveResponsibilityNoticeDismissed(dismissed: boolean): void {
  if (typeof localStorage === "undefined") {
    return;
  }

  if (dismissed) {
    localStorage.setItem(RESPONSIBILITY_NOTICE_STORAGE_KEY, "1");
    return;
  }

  localStorage.removeItem(RESPONSIBILITY_NOTICE_STORAGE_KEY);
}

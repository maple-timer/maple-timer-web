export const WINDOWS_CAPTURE_NOTICE_STORAGE_KEY =
  "maple-timer.windows10-capture-notice.dismissed.v1";

export const WINDOWS_CAPTURE_NOTICE_TITLE = "Windows 10 장시간 화면공유 안내";

export const WINDOWS_CAPTURE_NOTICE_LINES = [
  "Windows 10 일부 환경에서 장시간 화면공유 후 시작 메뉴, 윈도우키, Alt+Tab, 작업 표시줄이 느려질 수 있습니다.",
  "문제가 생기면 화면공유를 종료한 뒤 Ctrl + Shift + Esc로 작업 관리자를 열고 Windows 탐색기(explorer.exe)를 다시 시작해주세요.",
];

export function isWindowsUserAgent(userAgent = getNavigatorUserAgent()): boolean {
  return /\bWindows\b/i.test(userAgent);
}

export function hasDismissedWindowsCaptureNotice(): boolean {
  if (typeof localStorage === "undefined") {
    return false;
  }

  return localStorage.getItem(WINDOWS_CAPTURE_NOTICE_STORAGE_KEY) === "1";
}

export function shouldShowWindowsCaptureNotice(userAgent?: string): boolean {
  return isWindowsUserAgent(userAgent) && !hasDismissedWindowsCaptureNotice();
}

export function saveWindowsCaptureNoticeDismissed(dismissed: boolean): void {
  if (typeof localStorage === "undefined") {
    return;
  }

  if (dismissed) {
    localStorage.setItem(WINDOWS_CAPTURE_NOTICE_STORAGE_KEY, "1");
    return;
  }

  localStorage.removeItem(WINDOWS_CAPTURE_NOTICE_STORAGE_KEY);
}

function getNavigatorUserAgent(): string {
  if (typeof navigator === "undefined") {
    return "";
  }

  return navigator.userAgent;
}

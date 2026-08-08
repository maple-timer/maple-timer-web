import { beforeEach, describe, expect, it } from "vitest";
import {
  hasDismissedWindowsCaptureNotice,
  isWindowsUserAgent,
  saveWindowsCaptureNoticeDismissed,
  shouldShowWindowsCaptureNotice,
  WINDOWS_CAPTURE_NOTICE_STORAGE_KEY,
} from "./windowsCaptureNotice";

describe("windowsCaptureNotice", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("detects Windows user agents", () => {
    expect(isWindowsUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe(true);
    expect(isWindowsUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe(false);
  });

  it("stores the dismiss state locally", () => {
    expect(shouldShowWindowsCaptureNotice("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe(
      true,
    );

    saveWindowsCaptureNoticeDismissed(true);

    expect(hasDismissedWindowsCaptureNotice()).toBe(true);
    expect(localStorage.getItem(WINDOWS_CAPTURE_NOTICE_STORAGE_KEY)).toBe("1");
    expect(shouldShowWindowsCaptureNotice("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe(
      false,
    );

    saveWindowsCaptureNoticeDismissed(false);

    expect(hasDismissedWindowsCaptureNotice()).toBe(false);
  });
});

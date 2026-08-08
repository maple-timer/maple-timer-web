import { useState } from "react";
import type { CaptureStatus } from "../../captureTypes";
import {
  saveWindowsCaptureNoticeDismissed,
  shouldShowWindowsCaptureNotice,
} from "./windowsCaptureNotice";

export function useWindowsCaptureNoticeController({
  isCollapsed,
  stream,
  captureStatus,
}: {
  isCollapsed: boolean;
  stream: MediaStream | null;
  captureStatus: CaptureStatus;
}) {
  const [isHiddenForSession, setHiddenForSession] = useState(false);
  const shouldShowNotice =
    !isCollapsed &&
    stream !== null &&
    captureStatus === "active" &&
    !isHiddenForSession &&
    shouldShowWindowsCaptureNotice();

  const hideNoticeForSession = () => {
    setHiddenForSession(true);
  };

  const dismissNoticePermanently = () => {
    saveWindowsCaptureNoticeDismissed(true);
    setHiddenForSession(true);
  };

  return {
    shouldShowNotice,
    hideNoticeForSession,
    dismissNoticePermanently,
  };
}

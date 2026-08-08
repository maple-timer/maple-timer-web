export type AlertPlaybackDiagnosticStatus =
  | "requested"
  | "started"
  | "finished"
  | "failed";

export type AlertPlaybackDiagnostic = {
  status: AlertPlaybackDiagnosticStatus;
  cycleId: string | null;
  soundId: string;
  requestedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  failedAt: number | null;
  error: string | null;
};

export function createAlertPlaybackRequested({
  cycleId,
  soundId,
  requestedAt,
}: {
  cycleId?: string | number | null;
  soundId: string;
  requestedAt: number;
}): AlertPlaybackDiagnostic {
  return {
    status: "requested",
    cycleId: cycleId === null || cycleId === undefined ? null : String(cycleId),
    soundId,
    requestedAt,
    startedAt: null,
    finishedAt: null,
    failedAt: null,
    error: null,
  };
}

export function markAlertPlaybackStarted(
  playback: AlertPlaybackDiagnostic,
  startedAt: number,
): AlertPlaybackDiagnostic {
  return {
    ...playback,
    status: "started",
    startedAt,
    error: null,
  };
}

export function markAlertPlaybackFinished(
  playback: AlertPlaybackDiagnostic,
  finishedAt: number,
): AlertPlaybackDiagnostic {
  return {
    ...playback,
    status: "finished",
    startedAt: playback.startedAt ?? playback.requestedAt,
    finishedAt,
    error: null,
  };
}

export function markAlertPlaybackFailed(
  playback: AlertPlaybackDiagnostic,
  failedAt: number,
  error: string,
): AlertPlaybackDiagnostic {
  return {
    ...playback,
    status: "failed",
    failedAt,
    error,
  };
}

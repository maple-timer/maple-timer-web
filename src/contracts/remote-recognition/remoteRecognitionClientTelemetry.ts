export const REMOTE_RECOGNITION_CLIENT_TELEMETRY_VERSION = 1 as const;
export const REMOTE_RECOGNITION_CLIENT_TELEMETRY_HEADER =
  "x-maple-timer-remote-client-telemetry";
export const REMOTE_RECOGNITION_CLIENT_TELEMETRY_MAX_HEADER_BYTES = 512;
export const REMOTE_RECOGNITION_CLIENT_TELEMETRY_MAX_COUNTER = 2_147_483_647;
export const REMOTE_RECOGNITION_CLIENT_TELEMETRY_MAX_TRANSPORT_E2E_MS =
  120_000;
export const REMOTE_RECOGNITION_CLIENT_TELEMETRY_MAX_RECENT_E2E_SAMPLES = 4;

/**
 * Client-reported parser transport timing. This covers VP8 encoding plus the
 * verified HTTP request/response round trip. It is not alert-application E2E.
 */
export type RemoteRecognitionClientTransportE2eSample = {
  frameSequence: number;
  transportE2eMs: number;
};

export type RemoteRecognitionClientTelemetryReport = {
  version: typeof REMOTE_RECOGNITION_CLIENT_TELEMETRY_VERSION;
  reportSequence: number;
  counters: {
    acceptedResults: number;
    unavailableSamples: number;
    pendingReplacements: number;
    retryableFailures: number;
    terminalFallbacks: number;
  };
  recentTransportE2e: RemoteRecognitionClientTransportE2eSample[];
};

/** Serializes transport E2E as bounded whole milliseconds for the wire. */
export function serializeRemoteRecognitionClientTelemetry(
  report: RemoteRecognitionClientTelemetryReport,
): string | null {
  if (
    report.version !== REMOTE_RECOGNITION_CLIENT_TELEMETRY_VERSION ||
    !isBoundedPositiveInteger(report.reportSequence)
  ) {
    return null;
  }
  const counters = report.counters;
  if (
    !isBoundedCounter(counters.acceptedResults) ||
    !isBoundedCounter(counters.unavailableSamples) ||
    !isBoundedCounter(counters.pendingReplacements) ||
    !isBoundedCounter(counters.retryableFailures) ||
    !isBoundedCounter(counters.terminalFallbacks) ||
    counters.pendingReplacements > counters.unavailableSamples ||
    counters.retryableFailures > counters.unavailableSamples ||
    counters.terminalFallbacks > 1 ||
    !Array.isArray(report.recentTransportE2e) ||
    report.recentTransportE2e.length >
      REMOTE_RECOGNITION_CLIENT_TELEMETRY_MAX_RECENT_E2E_SAMPLES
  ) {
    return null;
  }

  let previousFrameSequence = 0;
  const encodedSamples: string[] = [];
  for (const sample of report.recentTransportE2e) {
    if (
      !isBoundedPositiveInteger(sample.frameSequence) ||
      sample.frameSequence <= previousFrameSequence ||
      !Number.isFinite(sample.transportE2eMs) ||
      sample.transportE2eMs < 0 ||
      sample.transportE2eMs >
        REMOTE_RECOGNITION_CLIENT_TELEMETRY_MAX_TRANSPORT_E2E_MS
    ) {
      return null;
    }
    previousFrameSequence = sample.frameSequence;
    encodedSamples.push(
      `${sample.frameSequence}:${Math.round(sample.transportE2eMs)}`,
    );
  }

  const serialized = [
    `v=${REMOTE_RECOGNITION_CLIENT_TELEMETRY_VERSION}`,
    `r=${report.reportSequence}`,
    `a=${counters.acceptedResults}`,
    `u=${counters.unavailableSamples}`,
    `p=${counters.pendingReplacements}`,
    `rf=${counters.retryableFailures}`,
    `fb=${counters.terminalFallbacks}`,
    `e=${encodedSamples.join(",")}`,
  ].join(";");
  return new TextEncoder().encode(serialized).byteLength <=
    REMOTE_RECOGNITION_CLIENT_TELEMETRY_MAX_HEADER_BYTES
    ? serialized
    : null;
}

function isBoundedPositiveInteger(value: number): boolean {
  return isBoundedCounter(value) && value > 0;
}

function isBoundedCounter(value: number): boolean {
  return (
    Number.isInteger(value) &&
    value >= 0 &&
    value <= REMOTE_RECOGNITION_CLIENT_TELEMETRY_MAX_COUNTER
  );
}

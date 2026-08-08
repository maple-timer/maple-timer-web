import { describe, expect, it } from "vitest";
import {
  REMOTE_RECOGNITION_CLIENT_TELEMETRY_MAX_HEADER_BYTES,
  serializeRemoteRecognitionClientTelemetry,
  type RemoteRecognitionClientTelemetryReport,
} from "./remoteRecognitionClientTelemetry";

describe("remoteRecognitionClientTelemetry", () => {
  it("serializes one bounded versioned cumulative report", () => {
    const serialized = serializeRemoteRecognitionClientTelemetry(
      createReport({
        reportSequence: 7,
        counters: {
          acceptedResults: 6,
          unavailableSamples: 1,
          pendingReplacements: 0,
          retryableFailures: 1,
          terminalFallbacks: 0,
        },
        recentTransportE2e: [
          { frameSequence: 11, transportE2eMs: 442.44 },
          { frameSequence: 12, transportE2eMs: 609.6 },
        ],
      }),
    );

    expect(serialized).toBe(
      "v=1;r=7;a=6;u=1;p=0;rf=1;fb=0;e=11:442,12:610",
    );
    expect(new TextEncoder().encode(serialized ?? "").byteLength).toBeLessThanOrEqual(
      REMOTE_RECOGNITION_CLIENT_TELEMETRY_MAX_HEADER_BYTES,
    );
  });

  it("rejects unbounded counters, sample lists, durations, and ordering", () => {
    expect(
      serializeRemoteRecognitionClientTelemetry(
        createReport({
          counters: {
            acceptedResults: 0,
            unavailableSamples: 0,
            pendingReplacements: 1,
            retryableFailures: 0,
            terminalFallbacks: 0,
          },
        }),
      ),
    ).toBeNull();
    expect(
      serializeRemoteRecognitionClientTelemetry(
        createReport({
          recentTransportE2e: Array.from({ length: 5 }, (_, index) => ({
            frameSequence: index + 1,
            transportE2eMs: 100,
          })),
        }),
      ),
    ).toBeNull();
    expect(
      serializeRemoteRecognitionClientTelemetry(
        createReport({
          recentTransportE2e: [
            { frameSequence: 2, transportE2eMs: 100 },
            { frameSequence: 1, transportE2eMs: 120_001 },
          ],
        }),
      ),
    ).toBeNull();
  });
});

function createReport(
  overrides: Partial<RemoteRecognitionClientTelemetryReport> = {},
): RemoteRecognitionClientTelemetryReport {
  return {
    version: 1,
    reportSequence: 1,
    counters: {
      acceptedResults: 0,
      unavailableSamples: 0,
      pendingReplacements: 0,
      retryableFailures: 0,
      terminalFallbacks: 0,
    },
    recentTransportE2e: [],
    ...overrides,
  };
}

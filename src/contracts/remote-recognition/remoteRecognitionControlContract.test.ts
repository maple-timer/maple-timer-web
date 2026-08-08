import { describe, expect, it } from "vitest";
import {
  REMOTE_RECOGNITION_CONTROL_SCHEMA,
  RemoteRecognitionControlContractError,
  createRemoteRecognitionControlMarker,
  deriveRemoteRecognitionBetaAliasFromAccessCode,
  isValidRemoteRecognitionBetaAlias,
  isValidRemoteRecognitionClientUuid,
  parseRemoteRecognitionAdmissionResponse,
  parseRemoteRecognitionControlFailure,
  parseRemoteRecognitionFrameProbeResponse,
  parseRemoteRecognitionHeartbeatResponse,
  parseRemoteRecognitionProbeResponse,
  parseRemoteRecognitionParserFrameResponse,
  parseRemoteRecognitionReleaseResponse,
  parseRemoteRecognitionServiceStatusResponse,
  parseRemoteRecognitionSessionResponse,
} from "./remoteRecognitionControlContract";

describe("remoteRecognitionControlContract", () => {
  it("validates issued beta aliases without accepting ambiguous characters", () => {
    expect(isValidRemoteRecognitionBetaAlias("BETA-23AHK")).toBe(true);

    for (const value of [
      "beta-23ahk",
      "BETA-12345",
      "BETA-23AIO",
      "BETA-23AH",
      "BETA-23AHK7",
    ]) {
      expect(isValidRemoteRecognitionBetaAlias(value)).toBe(false);
    }
  });

  it("derives a fallback beta alias only from an allowed access-code suffix", () => {
    expect(
      deriveRemoteRecognitionBetaAliasFromAccessCode(" invite-23ahk "),
    ).toBe("BETA-23AHK");
    expect(
      deriveRemoteRecognitionBetaAliasFromAccessCode("invite-23aio"),
    ).toBeNull();
    expect(deriveRemoteRecognitionBetaAliasFromAccessCode("short")).toBeNull();
  });

  it("validates canonical cryptographic UUIDs for client and attempt identity", () => {
    expect(
      isValidRemoteRecognitionClientUuid(
        "11111111-1111-4111-8111-111111111111",
      ),
    ).toBe(true);
    expect(
      isValidRemoteRecognitionClientUuid(
        "11111111-1111-1111-8111-111111111111",
      ),
    ).toBe(false);
    expect(
      isValidRemoteRecognitionClientUuid(
        "11111111-1111-4111-7111-111111111111",
      ),
    ).toBe(false);
  });

  it("parses a low-detail available service status", () => {
    expect(
      parseRemoteRecognitionServiceStatusResponse({
        contract: createRemoteRecognitionControlMarker(),
        status: "ok",
        serviceState: "available",
        admissionAvailable: true,
        frameAnalysisEnabled: false,
        retryAfterMs: null,
      }),
    ).toMatchObject({
      serviceState: "available",
      admissionAvailable: true,
      frameAnalysisEnabled: false,
    });
  });

  it("rejects contradictory admission availability", () => {
    expect(() =>
      parseRemoteRecognitionServiceStatusResponse({
        contract: createRemoteRecognitionControlMarker(),
        status: "ok",
        serviceState: "full",
        admissionAvailable: true,
        frameAnalysisEnabled: false,
        retryAfterMs: 5_000,
      }),
    ).toThrowError(expect.objectContaining({ code: "invalid-response" }));
  });

  it("parses a bounded temporary admission", () => {
    expect(
      parseRemoteRecognitionAdmissionResponse({
        contract: createRemoteRecognitionControlMarker(),
        status: "ok",
        admissionId: "admission-1",
        admissionToken: "secret-admission-token",
        expiresAt: Date.now() + 15_000,
        probe: { requiredRounds: 5, intervalMs: 1_000 },
        capabilities: { frameAnalysisEnabled: false },
      }),
    ).toMatchObject({
      admissionId: "admission-1",
      betaAlias: null,
      connectionCode: null,
      capabilities: { entitlementLeaseVersion: null },
      probe: { requiredRounds: 5, intervalMs: 1_000 },
    });
  });

  it("accepts only entitlement lease capability version 1 when advertised", () => {
    expect(
      parseRemoteRecognitionAdmissionResponse(
        admissionResponse({
          capabilities: {
            frameAnalysisEnabled: true,
            entitlementLeaseVersion: 1,
          },
        }),
      ).capabilities.entitlementLeaseVersion,
    ).toBe(1);
    expect(() =>
      parseRemoteRecognitionSessionResponse(
        sessionResponse({
          capabilities: {
            frameAnalysisEnabled: true,
            entitlementLeaseVersion: 2,
          },
        }),
      ),
    ).toThrowError(expect.objectContaining({ code: "invalid-response" }));
  });

  it("accepts valid optional canonical aliases in admission and session", () => {
    expect(
      parseRemoteRecognitionAdmissionResponse(
        admissionResponse({ betaAlias: "BETA-23AHK" }),
      ).betaAlias,
    ).toBe("BETA-23AHK");
    expect(
      parseRemoteRecognitionSessionResponse(
        sessionResponse({ betaAlias: "BETA-23AHK" }),
      ).betaAlias,
    ).toBe("BETA-23AHK");
  });

  it("rejects malformed canonical aliases when present", () => {
    for (const betaAlias of ["", "beta-23ahk", "BETA-23AIO", 23_456]) {
      expect(() =>
        parseRemoteRecognitionAdmissionResponse(
          admissionResponse({ betaAlias }),
        ),
      ).toThrowError(expect.objectContaining({ code: "invalid-response" }));
      expect(() =>
        parseRemoteRecognitionSessionResponse(sessionResponse({ betaAlias })),
      ).toThrowError(expect.objectContaining({ code: "invalid-response" }));
    }
  });

  it("accepts the same valid connection code in admission and session responses", () => {
    const connectionCode = "7HJK-9MNP";

    expect(
      parseRemoteRecognitionAdmissionResponse(
        admissionResponse({ connectionCode }),
      ).connectionCode,
    ).toBe(connectionCode);
    expect(
      parseRemoteRecognitionSessionResponse(
        sessionResponse({ connectionCode }),
      ).connectionCode,
    ).toBe(connectionCode);
  });

  it("rejects malformed connection codes when the optional field is present", () => {
    for (const connectionCode of [
      "",
      "1234-5678",
      "7HJI-9MNP",
      "7hjk-9mnp",
      "7HJK9MNP",
      7_123_456,
    ]) {
      expect(() =>
        parseRemoteRecognitionAdmissionResponse(
          admissionResponse({ connectionCode }),
        ),
      ).toThrowError(expect.objectContaining({ code: "invalid-response" }));
      expect(() =>
        parseRemoteRecognitionSessionResponse(
          sessionResponse({ connectionCode }),
        ),
      ).toThrowError(expect.objectContaining({ code: "invalid-response" }));
    }
  });

  it("checks probe summary against its round list", () => {
    expect(
      parseRemoteRecognitionProbeResponse({
        contract: createRemoteRecognitionControlMarker(),
        status: "ok",
        admissionId: "admission-1",
        accepted: true,
        rounds: Array.from({ length: 5 }, (_, index) => ({
          round: index + 1,
          status: "ok",
          elapsedMs: 12 + index,
        })),
        summary: {
          completedRounds: 5,
          successfulRounds: 5,
          medianMs: 14,
          maxMs: 16,
          totalElapsedMs: 5_012,
        },
      }),
    ).toMatchObject({ accepted: true, summary: { successfulRounds: 5 } });

    expect(() =>
      parseRemoteRecognitionProbeResponse({
        contract: createRemoteRecognitionControlMarker(),
        status: "ok",
        admissionId: "admission-1",
        accepted: false,
        rounds: [{ round: 1, status: "error", elapsedMs: 20 }],
        summary: {
          completedRounds: 2,
          successfulRounds: 0,
          medianMs: 20,
          maxMs: 20,
          totalElapsedMs: 20,
        },
      }),
    ).toThrowError(expect.objectContaining({ code: "invalid-response" }));
  });

  it("parses one bounded native parser frame result, including zero boxes", () => {
    expect(
      parseRemoteRecognitionFrameProbeResponse(frameProbeResponse()),
    ).toMatchObject({
      accepted: false,
      round: {
        round: 1,
        parser: { boxCount: 0 },
      },
      summary: { completedRounds: 1, successfulRounds: 1 },
    });
  });

  it("parses a bounded VP8 parser frame with ordered coordinates", () => {
    expect(
      parseRemoteRecognitionParserFrameResponse({
        contract: createRemoteRecognitionControlMarker(),
        status: "ok",
        sessionId: "session-1",
        purpose: "parser-provider",
        expiresAt: Date.now() + 15_000,
        frame: {
          sequence: 7,
          sampledAt: 1_785_600_000_000,
          encodedBytes: 51_200,
          width: 683,
          height: 384,
          parser: {
            engine: "onnxruntime-native",
            modelId: "buff-detector-test",
            modelInputWidth: 544,
            modelInputHeight: 960,
            onnxRuntimeVersion: "1.24.4",
            executionProviders: ["CoreMLExecutionProvider"],
            boxCount: 1,
          },
          boxes: [
            { x: 604, y: 18, size: 31, confidence: 0.992, score: 992 },
          ],
          timings: {
            decodeMs: 3,
            preprocessMs: 9,
            inferenceMs: 42,
            postprocessMs: 4,
            serverTotalMs: 61,
          },
        },
      }),
    ).toMatchObject({
      sessionId: "session-1",
      purpose: "parser-provider",
      frame: {
        sequence: 7,
        parser: { boxCount: 1 },
        boxes: [{ x: 604, y: 18, size: 31 }],
      },
    });
  });

  it("rejects parser boxes outside the transmitted frame", () => {
    const response = {
      contract: createRemoteRecognitionControlMarker(),
      status: "ok",
      sessionId: "session-1",
      purpose: "parser-provider",
      expiresAt: Date.now() + 15_000,
      frame: {
        sequence: 1,
        sampledAt: 1_785_600_000_000,
        encodedBytes: 512,
        width: 100,
        height: 100,
        parser: {
          engine: "onnxruntime-native",
          modelId: "buff-detector-test",
          modelInputWidth: 544,
          modelInputHeight: 960,
          onnxRuntimeVersion: "1.24.4",
          executionProviders: ["CoreMLExecutionProvider"],
          boxCount: 1,
        },
        boxes: [
          { x: 90, y: 10, size: 20, confidence: 0.9, score: 900 },
        ],
        timings: {
          decodeMs: 1,
          preprocessMs: 1,
          inferenceMs: 1,
          postprocessMs: 1,
          serverTotalMs: 4,
        },
      },
    };
    expect(() => parseRemoteRecognitionParserFrameResponse(response)).toThrowError(
      expect.objectContaining({ code: "invalid-response" }),
    );
  });

  it("parses an active diagnostic-only session and heartbeat", () => {
    const session = parseRemoteRecognitionSessionResponse({
      contract: createRemoteRecognitionControlMarker(),
      status: "ok",
      sessionId: "session-1",
      sessionToken: "secret-session-token",
      expiresAt: Date.now() + 15_000,
      idleTimeoutMs: 15_000,
      heartbeatIntervalMs: 5_000,
      modelSetId: "studio-foundation-v1",
      capabilities: { frameAnalysisEnabled: false },
    });
    expect(session.capabilities.frameAnalysisEnabled).toBe(false);
    expect(session.capabilities.clientTelemetryVersion).toBeNull();
    expect(session.betaAlias).toBeNull();
    expect(session.connectionCode).toBeNull();
    expect(
      parseRemoteRecognitionHeartbeatResponse({
        contract: createRemoteRecognitionControlMarker(),
        status: "ok",
        sessionId: session.sessionId,
        expiresAt: Date.now() + 15_000,
      }),
    ).toMatchObject({ sessionId: "session-1" });

    expect(
      parseRemoteRecognitionReleaseResponse({
        contract: createRemoteRecognitionControlMarker(),
        status: "ok",
        released: true,
      }),
    ).toMatchObject({ released: true });
  });

  it("enables the supported client telemetry capability and ignores future optional versions", () => {
    expect(
      parseRemoteRecognitionSessionResponse({
        contract: createRemoteRecognitionControlMarker(),
        status: "ok",
        sessionId: "session-1",
        sessionToken: "secret-session-token",
        expiresAt: Date.now() + 15_000,
        idleTimeoutMs: 15_000,
        heartbeatIntervalMs: 5_000,
        modelSetId: "studio-foundation-v1",
        capabilities: {
          frameAnalysisEnabled: true,
          clientTelemetryVersion: 1,
        },
      }),
    ).toMatchObject({
      capabilities: { clientTelemetryVersion: 1 },
    });

    expect(
      parseRemoteRecognitionSessionResponse({
        contract: createRemoteRecognitionControlMarker(),
        status: "ok",
        sessionId: "session-1",
        sessionToken: "secret-session-token",
        expiresAt: Date.now() + 15_000,
        idleTimeoutMs: 15_000,
        heartbeatIntervalMs: 5_000,
        modelSetId: "studio-foundation-v1",
        capabilities: {
          frameAnalysisEnabled: true,
          clientTelemetryVersion: 2,
        },
      }),
    ).toMatchObject({
      capabilities: { clientTelemetryVersion: null },
    });
  });

  it("preserves structured entitlement and capacity failures", () => {
    const error = parseRemoteRecognitionControlFailure({
      contract: createRemoteRecognitionControlMarker(),
      status: "error",
      error: {
        code: "capacity-full",
        phase: "admission",
        retryable: true,
        retryAfterMs: 5_000,
        technicalMessage: "remote-recognition-capacity-full",
      },
    });
    expect(error).toBeInstanceOf(RemoteRecognitionControlContractError);
    expect(error).toMatchObject({
      code: "capacity-full",
      phase: "admission",
      retryable: true,
      retryAfterMs: 5_000,
    });
  });

  it("preserves a typed access-code-in-use failure", () => {
    expect(
      parseRemoteRecognitionControlFailure({
        contract: createRemoteRecognitionControlMarker(),
        status: "error",
        error: {
          code: "access-code-in-use",
          phase: "admission",
          retryable: true,
          retryAfterMs: 15_000,
          technicalMessage: "remote-recognition-access-code-in-use",
        },
      }),
    ).toMatchObject({
      code: "access-code-in-use",
      phase: "admission",
      retryable: true,
      retryAfterMs: 15_000,
    });
  });

  it("preserves a typed client-reconnect-busy failure", () => {
    expect(
      parseRemoteRecognitionControlFailure({
        contract: createRemoteRecognitionControlMarker(),
        status: "error",
        error: {
          code: "client-reconnect-busy",
          phase: "admission",
          retryable: true,
          retryAfterMs: 1_000,
          technicalMessage: "remote-recognition-client-reconnect-busy",
        },
      }),
    ).toMatchObject({
      code: "client-reconnect-busy",
      phase: "admission",
      retryable: true,
      retryAfterMs: 1_000,
    });
  });

  it("rejects a future control contract", () => {
    expect(() =>
      parseRemoteRecognitionServiceStatusResponse({
        contract: {
          schema: REMOTE_RECOGNITION_CONTROL_SCHEMA,
          version: 2,
        },
        status: "ok",
        serviceState: "available",
        admissionAvailable: true,
        frameAnalysisEnabled: false,
        retryAfterMs: null,
      }),
    ).toThrowError(expect.objectContaining({ code: "invalid-response" }));
  });
});

function frameProbeResponse() {
  return {
    contract: createRemoteRecognitionControlMarker(),
    status: "ok",
    admissionId: "admission-1",
    accepted: false,
    requiredRounds: 5,
    round: {
      round: 1,
      status: "ok",
      elapsedMs: 40,
      sampledAt: 1_785_600_000_000,
      encodedBytes: 512,
      width: 683,
      height: 384,
      parser: {
        engine: "onnxruntime-native",
        modelId: "buff-detector-test",
        executionProviders: ["CoreMLExecutionProvider"],
        boxCount: 0,
      },
      timings: {
        decodeMs: 1,
        preprocessMs: 4,
        inferenceMs: 33,
        postprocessMs: 2,
        serverTotalMs: 40,
      },
    },
    summary: {
      completedRounds: 1,
      successfulRounds: 1,
      medianMs: 40,
      maxMs: 40,
      totalElapsedMs: 40,
    },
  };
}

function admissionResponse(overrides: Record<string, unknown> = {}) {
  return {
    contract: createRemoteRecognitionControlMarker(),
    status: "ok",
    admissionId: "admission-1",
    admissionToken: "secret-admission-token",
    expiresAt: Date.now() + 15_000,
    probe: { requiredRounds: 5, intervalMs: 1_000 },
    capabilities: { frameAnalysisEnabled: false },
    ...overrides,
  };
}

function sessionResponse(overrides: Record<string, unknown> = {}) {
  return {
    contract: createRemoteRecognitionControlMarker(),
    status: "ok",
    sessionId: "session-1",
    sessionToken: "secret-session-token",
    expiresAt: Date.now() + 15_000,
    idleTimeoutMs: 15_000,
    heartbeatIntervalMs: 5_000,
    modelSetId: "studio-foundation-v1",
    capabilities: { frameAnalysisEnabled: false },
    ...overrides,
  };
}

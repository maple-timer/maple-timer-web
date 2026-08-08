import { afterEach, describe, expect, it, vi } from "vitest";
import {
  REMOTE_RECOGNITION_CONTROL_PIPELINE,
  RemoteRecognitionControlContractError,
  createRemoteRecognitionControlMarker,
  type RemoteRecognitionAdmissionRequest,
} from "../../contracts/remote-recognition/remoteRecognitionControlContract";
import type { RemoteRecognitionClientTelemetryReport } from "../../contracts/remote-recognition/remoteRecognitionClientTelemetry";
import { BrowserRemoteRecognitionControlClient } from "./remoteRecognitionControlClient";

const baseUrl = "https://api.example.test/v1/remote-recognition";

describe("BrowserRemoteRecognitionControlClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls the browser fetch API with its required global receiver", async () => {
    const browserFetch = vi.fn(function (this: typeof globalThis) {
      if (this !== globalThis) {
        throw new TypeError("Illegal invocation");
      }
      return Promise.resolve(jsonResponse(statusResponse()));
    });
    vi.stubGlobal("fetch", browserFetch);
    const client = new BrowserRemoteRecognitionControlClient({ baseUrl });

    await expect(client.getStatus()).resolves.toMatchObject({
      status: "ok",
      serviceState: "available",
    });
    expect(browserFetch).toHaveBeenCalledOnce();
  });

  it("sends access codes only on admission and lease tokens only in authorization", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(statusResponse()))
      .mockResolvedValueOnce(jsonResponse(admissionResponse(), 201))
      .mockResolvedValueOnce(jsonResponse(probeResponse()))
      .mockResolvedValueOnce(jsonResponse(sessionResponse(), 201))
      .mockResolvedValueOnce(jsonResponse(releaseResponse()));
    const client = new BrowserRemoteRecognitionControlClient({
      fetch: fetchMock,
      baseUrl,
    });

    await client.getStatus();
    const admission = await client.createAdmission(admissionRequest());
    await client.probeAdmission(admission.admissionId, admission.admissionToken);
    const session = await client.promoteAdmission(
      admission.admissionId,
      admission.admissionToken,
    );
    await client.stopSession(session.sessionId, session.sessionToken);

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `${baseUrl}/admissions`,
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"accessCode":"preview-code"'),
      }),
    );
    expect(fetchMock.mock.calls[1]?.[1]?.body).toContain(
      '"clientInstanceId":"11111111-1111-4111-8111-111111111111"',
    );
    expect(fetchMock.mock.calls[1]?.[1]?.body).toContain(
      '"admissionAttemptId":"22222222-2222-4222-8222-222222222222"',
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      `${baseUrl}/admissions/admission-1/probe`,
      expect.objectContaining({
        headers: { authorization: "Bearer admission-secret" },
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      `${baseUrl}/sessions/session-1`,
      expect.objectContaining({
        method: "DELETE",
        keepalive: true,
        headers: { authorization: "Bearer session-secret" },
      }),
    );
  });

  it("preserves typed gateway failures", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        {
          contract: createRemoteRecognitionControlMarker(),
          status: "error",
          error: {
            code: "capacity-full",
            phase: "admission",
            retryable: true,
            retryAfterMs: 5_000,
            technicalMessage: "remote-recognition-capacity-full",
          },
        },
        429,
      ),
    );
    const client = new BrowserRemoteRecognitionControlClient({
      fetch: fetchMock,
      baseUrl,
    });

    await expect(client.createAdmission(admissionRequest())).rejects.toMatchObject({
      code: "capacity-full",
      phase: "admission",
      retryable: true,
    });
  });

  it("preserves an access-code-in-use gateway failure", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        {
          contract: createRemoteRecognitionControlMarker(),
          status: "error",
          error: {
            code: "access-code-in-use",
            phase: "admission",
            retryable: true,
            retryAfterMs: 15_000,
            technicalMessage: "remote-recognition-access-code-in-use",
          },
        },
        409,
      ),
    );
    const client = new BrowserRemoteRecognitionControlClient({
      fetch: fetchMock,
      baseUrl,
    });

    await expect(client.createAdmission(admissionRequest())).rejects.toMatchObject({
      code: "access-code-in-use",
      phase: "admission",
      retryable: true,
      retryAfterMs: 15_000,
    });
  });

  it("sends one gzip RGBA frame with normalized probe metadata", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(frameProbeResponse()));
    const client = new BrowserRemoteRecognitionControlClient({
      fetch: fetchMock,
      baseUrl,
    });
    const encodedRgba = new Uint8Array([31, 139, 8, 0]).buffer;

    await expect(
      client.probeAdmissionFrame(
        "admission-1",
        "admission-secret",
        {
          sequence: 1,
          sampledAt: 1_785_600_000_000,
          width: 683,
          height: 384,
          encodedRgba,
        },
      ),
    ).resolves.toMatchObject({ round: { parser: { boxCount: 0 } } });

    expect(fetchMock).toHaveBeenCalledWith(
      `${baseUrl}/admissions/admission-1/frame-probe`,
      expect.objectContaining({
        method: "POST",
        body: encodedRgba,
        headers: expect.objectContaining({
          authorization: "Bearer admission-secret",
          "content-encoding": "gzip",
          "x-maple-timer-remote-frame-sequence": "1",
          "x-maple-timer-remote-frame-width": "683",
          "x-maple-timer-remote-frame-height": "384",
        }),
      }),
    );
  });

  it("sends one independent VP8 keyframe for parser coordinates", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(parserFrameResponse()));
    const client = new BrowserRemoteRecognitionControlClient({
      fetch: fetchMock,
      baseUrl,
    });
    const encodedVp8 = new Uint8Array([16, 0, 157, 1, 42]).buffer;

    await expect(
      client.analyzeSessionParserFrame("session-1", "session-secret", {
        sequence: 8,
        sampledAt: 1_785_600_000_008,
        width: 683,
        height: 384,
        encodedVp8,
      }),
    ).resolves.toMatchObject({
      purpose: "parser-provider",
      frame: { sequence: 8, parser: { boxCount: 1 } },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      `${baseUrl}/sessions/session-1/frames`,
      expect.objectContaining({
        method: "POST",
        body: encodedVp8,
        headers: expect.objectContaining({
          authorization: "Bearer session-secret",
          "content-type": "video/vp8",
          "x-maple-timer-remote-frame-purpose": "parser-provider",
          "x-maple-timer-remote-consent-version":
            "remote-recognition-parser-provider-preview-2026-08-02",
          "x-maple-timer-remote-frame-sequence": "8",
        }),
      }),
    );
    expect(
      vi.mocked(fetchMock).mock.calls[0]?.[1]?.headers,
    ).not.toHaveProperty("content-encoding");
  });

  it("adds bounded client telemetry only to authenticated session requests", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(parserFrameResponse()))
      .mockResolvedValueOnce(
        jsonResponse({
          contract: createRemoteRecognitionControlMarker(),
          status: "ok",
          sessionId: "session-1",
          expiresAt: Date.now() + 15_000,
        }),
      )
      .mockResolvedValueOnce(jsonResponse(releaseResponse()));
    const client = new BrowserRemoteRecognitionControlClient({
      fetch: fetchMock,
      baseUrl,
    });
    const clientTelemetry = telemetryReport();

    await client.analyzeSessionParserFrame(
      "session-1",
      "session-secret",
      {
        sequence: 8,
        sampledAt: 1_785_600_000_008,
        width: 683,
        height: 384,
        encodedVp8: new Uint8Array([16, 0, 157, 1, 42]).buffer,
      },
      { clientTelemetry },
    );
    await client.heartbeatSession("session-1", "session-secret", {
      clientTelemetry: { ...clientTelemetry, reportSequence: 2 },
    });
    await client.stopSession("session-1", "session-secret", {
      clientTelemetry: { ...clientTelemetry, reportSequence: 3 },
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `${baseUrl}/sessions/session-1/frames`,
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-maple-timer-remote-client-telemetry":
            "v=1;r=1;a=3;u=2;p=1;rf=1;fb=0;e=7:442",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `${baseUrl}/sessions/session-1/heartbeat`,
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-maple-timer-remote-client-telemetry": expect.stringContaining(
            "v=1;r=2;",
          ),
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      `${baseUrl}/sessions/session-1`,
      expect.objectContaining({
        keepalive: true,
        headers: expect.objectContaining({
          "x-maple-timer-remote-client-telemetry": expect.stringContaining(
            "v=1;r=3;",
          ),
        }),
      }),
    );
  });

  it("omits invalid telemetry instead of breaking the existing request", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(parserFrameResponse()));
    const client = new BrowserRemoteRecognitionControlClient({
      fetch: fetchMock,
      baseUrl,
    });

    await client.analyzeSessionParserFrame(
      "session-1",
      "session-secret",
      {
        sequence: 8,
        sampledAt: 1_785_600_000_008,
        width: 683,
        height: 384,
        encodedVp8: new Uint8Array([16, 0, 157, 1, 42]).buffer,
      },
      {
        clientTelemetry: {
          ...telemetryReport(),
          reportSequence: 0,
        },
      },
    );

    expect(vi.mocked(fetchMock).mock.calls[0]?.[1]?.headers).not.toHaveProperty(
      "x-maple-timer-remote-client-telemetry",
    );
  });

  it("maps timeouts and malformed responses to stable contract errors", async () => {
    const hangingFetch = vi.fn<typeof fetch>((_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      }),
    );
    const timedClient = new BrowserRemoteRecognitionControlClient({
      fetch: hangingFetch,
      baseUrl,
      requestTimeoutMs: 1,
    });

    await expect(timedClient.getStatus()).rejects.toMatchObject({
      code: "request-timeout",
      phase: "status",
    });

    const malformedClient = new BrowserRemoteRecognitionControlClient({
      fetch: vi
        .fn<typeof fetch>()
        .mockImplementation(async () => new Response("not-json", { status: 200 })),
      baseUrl,
    });
    await expect(malformedClient.getStatus()).rejects.toBeInstanceOf(
      RemoteRecognitionControlContractError,
    );
    await expect(
      malformedClient.probeAdmission("admission-1", "admission-secret"),
    ).rejects.toMatchObject({
      code: "invalid-response",
      phase: "probe",
    });
  });

  it("does not start a request when its external signal is already aborted", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const client = new BrowserRemoteRecognitionControlClient({
      fetch: fetchMock,
      baseUrl,
    });
    const abortController = new AbortController();
    abortController.abort();

    await expect(
      client.getStatus({ signal: abortController.signal }),
    ).rejects.toMatchObject({
      code: "network-error",
      phase: "status",
      retryable: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

function admissionRequest(): RemoteRecognitionAdmissionRequest {
  return {
    contract: createRemoteRecognitionControlMarker(),
    accessCode: "preview-code",
    client: {
      appBuild: "preview main@abc1234",
      channel: "preview",
      runtimeVersion: "browser-v1",
      clientInstanceId: "11111111-1111-4111-8111-111111111111",
      admissionAttemptId: "22222222-2222-4222-8222-222222222222",
    },
    requestedPipeline: REMOTE_RECOGNITION_CONTROL_PIPELINE,
    consent: {
      version: "remote-recognition-preview-2026-08-02",
      remoteFrameProcessing: true,
      normalFrameStorage: "none",
    },
  };
}

function telemetryReport(): RemoteRecognitionClientTelemetryReport {
  return {
    version: 1,
    reportSequence: 1,
    counters: {
      acceptedResults: 3,
      unavailableSamples: 2,
      pendingReplacements: 1,
      retryableFailures: 1,
      terminalFallbacks: 0,
    },
    recentTransportE2e: [
      { frameSequence: 7, transportE2eMs: 442.44 },
    ],
  };
}

function statusResponse() {
  return {
    contract: createRemoteRecognitionControlMarker(),
    status: "ok",
    serviceState: "available",
    admissionAvailable: true,
    frameAnalysisEnabled: false,
    retryAfterMs: null,
  };
}

function admissionResponse() {
  return {
    contract: createRemoteRecognitionControlMarker(),
    status: "ok",
    admissionId: "admission-1",
    admissionToken: "admission-secret",
    expiresAt: Date.now() + 15_000,
    probe: { requiredRounds: 5, intervalMs: 1_000 },
    capabilities: { frameAnalysisEnabled: false },
  };
}

function probeResponse() {
  return {
    contract: createRemoteRecognitionControlMarker(),
    status: "ok",
    admissionId: "admission-1",
    accepted: true,
    rounds: Array.from({ length: 5 }, (_, index) => ({
      round: index + 1,
      status: "ok",
      elapsedMs: 1,
    })),
    summary: {
      completedRounds: 5,
      successfulRounds: 5,
      medianMs: 1,
      maxMs: 1,
      totalElapsedMs: 5_001,
    },
  };
}

function sessionResponse() {
  return {
    contract: createRemoteRecognitionControlMarker(),
    status: "ok",
    sessionId: "session-1",
    sessionToken: "session-secret",
    expiresAt: Date.now() + 15_000,
    idleTimeoutMs: 15_000,
    heartbeatIntervalMs: 5_000,
    modelSetId: "studio-foundation-v1",
    capabilities: { frameAnalysisEnabled: false },
  };
}

function releaseResponse() {
  return {
    contract: createRemoteRecognitionControlMarker(),
    status: "ok",
    released: true,
  };
}

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
      encodedBytes: 4,
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

function parserFrameResponse() {
  return {
    contract: createRemoteRecognitionControlMarker(),
    status: "ok",
    sessionId: "session-1",
    purpose: "parser-provider",
    expiresAt: Date.now() + 15_000,
    frame: {
      sequence: 8,
      sampledAt: 1_785_600_000_008,
      encodedBytes: 5,
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
      boxes: [{ x: 600, y: 20, size: 30, confidence: 0.99, score: 990 }],
      timings: {
        decodeMs: 3,
        preprocessMs: 9,
        inferenceMs: 42,
        postprocessMs: 4,
        serverTotalMs: 61,
      },
    },
  };
}

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

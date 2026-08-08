import { describe, expect, it, vi } from "vitest";
import type {
  RemoteRecognitionControlPort,
  RemoteRecognitionParserFrameControlPort,
} from "./remoteRecognitionControlPort";
import type { RemoteRecognitionFrameProbeSource } from "./remoteRecognitionFrameProbeSource";
import { RemoteRecognitionSessionController } from "./remoteRecognitionSessionController";
import { createRemoteRecognitionV1ClientFaultDecorator } from "./remoteRecognitionV1ClientFaultDecorator";
import {
  REMOTE_RECOGNITION_READINESS_CONSENT_VERSION,
  RemoteRecognitionControlContractError,
  RemoteRecognitionParserFrameDroppedError,
  createRemoteRecognitionControlMarker,
} from "../../contracts/remote-recognition/remoteRecognitionControlContract";

const ACCESS_CODE = "preview-23AHK";
const CLIENT_INSTANCE_ID = "11111111-1111-4111-8111-111111111111";

describe("RemoteRecognitionSessionController", () => {
  it("refuses setup before the current readiness consent reaches the application boundary", async () => {
    const port = createPort();
    const controller = createController(port);

    await expect(controller.start(ACCESS_CODE, null)).rejects.toMatchObject({
      code: "invalid-request",
      phase: "admission",
    });
    expect(port.getStatus).not.toHaveBeenCalled();
    expect(port.createAdmission).not.toHaveBeenCalled();
  });

  it("refuses an invalid client identity before making a control request", async () => {
    const port = createPort();
    const controller = createController(port, {
      clientInstanceId: "not-a-client-uuid",
    });

    await expect(
      controller.start(
        ACCESS_CODE,
        REMOTE_RECOGNITION_READINESS_CONSENT_VERSION,
      ),
    ).rejects.toMatchObject({
      code: "invalid-request",
      phase: "admission",
      message: "remote-recognition-client-identity-invalid",
    });
    expect(port.getStatus).not.toHaveBeenCalled();
    expect(port.createAdmission).not.toHaveBeenCalled();
  });

  it("runs the ordered setup, keeps secrets out of snapshots, heartbeats, and releases", async () => {
    vi.useFakeTimers();
    const port = createPort();
    const controller = createController(port);
    const phases: string[] = [];
    controller.subscribe(() => phases.push(controller.getSnapshot().phase));

    await completeSetup(controller);

    expect(phases.filter((phase, index) => phase !== phases[index - 1])).toEqual([
      "checking",
      "reserving",
      "probing",
      "activating",
      "ready",
    ]);
    expect(controller.getSnapshot()).toMatchObject({
      phase: "ready",
      probeDiagnostics: {
        completedRounds: 5,
        parserModelId: "buff-detector-test",
        executionProviders: ["CoreMLExecutionProvider"],
        averageCaptureMs: 2,
        averageCompressionMs: 3,
        averageRoundTripMs: 40,
        averageEncodedBytes: 1,
        averageDecodeMs: 1,
        averagePreprocessMs: 4,
        averageInferenceMs: 28,
        averagePostprocessMs: 2,
        averageServerTotalMs: 35,
      },
      session: {
        frameAnalysisEnabled: true,
        modelSetId: "studio-parser-probe-v1",
      },
      parserProvider: {
        active: false,
        consentVersion: null,
      },
      identity: {
        betaAlias: "BETA-23AHK",
        connectionCode: "7HJK-9MNP",
      },
    });
    expect(JSON.stringify(controller.getSnapshot())).not.toContain("secret");
    expect(port.createAdmission).toHaveBeenCalledWith(
      expect.objectContaining({
        accessCode: ACCESS_CODE,
        client: expect.objectContaining({
          betaAlias: "BETA-23AHK",
          clientInstanceId: CLIENT_INSTANCE_ID,
          admissionAttemptId: admissionAttemptId(1),
        }),
      }),
      expect.anything(),
    );
    expect(port.probeAdmissionFrame).toHaveBeenCalledTimes(5);
    expect(port.probeAdmission).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5_000);
    expect(port.heartbeatSession).toHaveBeenCalledWith(
      "session-1",
      "session-secret",
    );

    await controller.stop();
    expect(port.stopSession).toHaveBeenCalledWith(
      "session-1",
      "session-secret",
    );
    expect(controller.getSnapshot().phase).toBe("idle");
    expect(controller.getSnapshot().identity).toEqual({
      betaAlias: "BETA-23AHK",
      connectionCode: "7HJK-9MNP",
    });
    expect(JSON.stringify(controller.getSnapshot())).not.toContain(
      CLIENT_INSTANCE_ID,
    );
    expect(JSON.stringify(controller.getSnapshot())).not.toContain(
      admissionAttemptId(1),
    );
    vi.useRealTimers();
  });

  it("replaces the recent identity only after a new admission succeeds", async () => {
    vi.useFakeTimers();
    const port = createPort();
    const controller = createController(port);
    await completeSetup(controller);
    await controller.stop();

    vi.mocked(port.createAdmission).mockResolvedValue({
      ...admissionResponse(),
      betaAlias: "BETA-23456",
      connectionCode: "3ABC-4DEF",
    });
    vi.mocked(port.promoteAdmission).mockResolvedValue({
      ...sessionResponse(),
      betaAlias: "BETA-23456",
      connectionCode: "3ABC-4DEF",
    });
    await completeSetup(controller, "preview-23456");

    expect(controller.getSnapshot().identity).toEqual({
      betaAlias: "BETA-23456",
      connectionCode: "3ABC-4DEF",
    });
    const admissionRequests = vi.mocked(port.createAdmission).mock.calls;
    expect(admissionRequests[0]?.[0].client).toMatchObject({
      clientInstanceId: CLIENT_INSTANCE_ID,
      admissionAttemptId: admissionAttemptId(1),
    });
    expect(admissionRequests[1]?.[0].client).toMatchObject({
      clientInstanceId: CLIENT_INSTANCE_ID,
      admissionAttemptId: admissionAttemptId(2),
    });
    vi.useRealTimers();
  });

  it("clears a previous identity when the next admission omits its connection code", async () => {
    vi.useFakeTimers();
    const port = createPort();
    const controller = createController(port);
    await completeSetup(controller);
    await controller.stop();

    vi.mocked(port.createAdmission).mockResolvedValue({
      ...admissionResponse(),
      betaAlias: null,
      connectionCode: null,
      capabilities: {
        frameAnalysisEnabled: true,
        entitlementLeaseVersion: null,
      },
    });
    vi.mocked(port.probeAdmissionFrame).mockImplementation(
      async (_admissionId, _token, frame) =>
        frameProbeResponse(frame.sequence, false),
    );
    await completeSetup(controller, "preview-23456");

    expect(controller.getSnapshot()).toMatchObject({
      phase: "failed",
      identity: null,
      failure: { code: "probe-failed" },
    });
    vi.useRealTimers();
  });

  it("rejects a promoted session whose connection code differs from admission", async () => {
    vi.useFakeTimers();
    const port = createPort();
    vi.mocked(port.promoteAdmission).mockResolvedValue({
      ...sessionResponse(),
      connectionCode: "3ABC-4DEF",
    });
    const controller = createController(port);

    await completeSetup(controller);

    expect(controller.getSnapshot()).toMatchObject({
      phase: "failed",
      identity: {
        betaAlias: "BETA-23AHK",
        connectionCode: "7HJK-9MNP",
      },
      failure: {
        code: "invalid-response",
        phase: "session",
        technicalMessage:
          "remote-recognition-session-connection-code-mismatch",
      },
    });
    expect(port.stopSession).toHaveBeenCalledWith(
      "session-1",
      "session-secret",
    );
    vi.useRealTimers();
  });

  it("keeps the admission identity when a legacy admission and session omit canonical correlation", async () => {
    vi.useFakeTimers();
    const port = createPort();
    vi.mocked(port.createAdmission).mockResolvedValue({
      ...admissionResponse(),
      betaAlias: null,
      capabilities: {
        frameAnalysisEnabled: true,
        entitlementLeaseVersion: null,
      },
    });
    vi.mocked(port.promoteAdmission).mockResolvedValue({
      ...sessionResponse(),
      betaAlias: null,
      connectionCode: null,
      capabilities: {
        frameAnalysisEnabled: true,
        entitlementLeaseVersion: null,
      },
    });
    const controller = createController(port);

    await completeSetup(controller);

    expect(controller.getSnapshot()).toMatchObject({
      phase: "ready",
      identity: {
        betaAlias: "BETA-23AHK",
        connectionCode: "7HJK-9MNP",
      },
    });
    vi.useRealTimers();
  });

  it("uses matching canonical aliases from admission and session", async () => {
    vi.useFakeTimers();
    const port = createPort();
    vi.mocked(port.createAdmission).mockResolvedValue({
      ...admissionResponse(),
      betaAlias: "BETA-23AHK",
    });
    vi.mocked(port.promoteAdmission).mockResolvedValue({
      ...sessionResponse(),
      betaAlias: "BETA-23AHK",
    });
    const controller = createController(port);

    await completeSetup(controller);

    expect(controller.getSnapshot()).toMatchObject({
      phase: "ready",
      identity: {
        betaAlias: "BETA-23AHK",
        connectionCode: "7HJK-9MNP",
      },
    });
    vi.useRealTimers();
  });

  it("rejects a canonical admission alias that disagrees with the access-code suffix", async () => {
    vi.useFakeTimers();
    const port = createPort();
    vi.mocked(port.createAdmission).mockResolvedValue({
      ...admissionResponse(),
      betaAlias: "BETA-23456",
    });
    const controller = createController(port);

    await completeSetup(controller);

    expect(controller.getSnapshot()).toMatchObject({
      phase: "failed",
      identity: null,
      failure: {
        code: "invalid-response",
        phase: "admission",
        technicalMessage: "remote-recognition-admission-beta-alias-mismatch",
      },
    });
    expect(port.cancelAdmission).toHaveBeenCalledWith(
      "admission-1",
      "admission-secret",
    );
    vi.useRealTimers();
  });

  it("keeps an app-first legacy rollout usable when no tester alias is available", async () => {
    vi.useFakeTimers();
    const port = createPort();
    vi.mocked(port.createAdmission).mockResolvedValue({
      ...admissionResponse(),
      betaAlias: null,
      capabilities: {
        frameAnalysisEnabled: true,
        entitlementLeaseVersion: null,
      },
    });
    vi.mocked(port.promoteAdmission).mockResolvedValue({
      ...sessionResponse(),
      betaAlias: null,
      capabilities: {
        frameAnalysisEnabled: true,
        entitlementLeaseVersion: null,
      },
    });
    const controller = createController(port);

    await completeSetup(controller, "preview-code");

    expect(controller.getSnapshot()).toMatchObject({
      phase: "ready",
      identity: null,
      failure: null,
    });
    expect(port.probeAdmissionFrame).toHaveBeenCalledTimes(5);
    vi.useRealTimers();
  });

  it("rejects an entitlement admission that omits canonical correlation", async () => {
    vi.useFakeTimers();
    const port = createPort();
    vi.mocked(port.createAdmission).mockResolvedValue({
      ...admissionResponse(),
      betaAlias: null,
    });
    const controller = createController(port);

    await completeSetup(controller);

    expect(controller.getSnapshot()).toMatchObject({
      phase: "failed",
      identity: null,
      failure: {
        code: "invalid-response",
        phase: "admission",
        technicalMessage: "remote-recognition-admission-correlation-missing",
      },
    });
    expect(port.probeAdmissionFrame).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("rejects an admission-to-session entitlement capability downgrade", async () => {
    vi.useFakeTimers();
    const port = createPort();
    vi.mocked(port.promoteAdmission).mockResolvedValue({
      ...sessionResponse(),
      capabilities: {
        frameAnalysisEnabled: true,
        entitlementLeaseVersion: null,
      },
    });
    const controller = createController(port);

    await completeSetup(controller);

    expect(controller.getSnapshot()).toMatchObject({
      phase: "failed",
      failure: {
        code: "invalid-response",
        phase: "session",
        technicalMessage:
          "remote-recognition-session-entitlement-capability-mismatch",
      },
    });
    expect(port.stopSession).toHaveBeenCalledWith(
      "session-1",
      "session-secret",
    );
    vi.useRealTimers();
  });

  it("rejects a canonical session alias that changes after admission", async () => {
    vi.useFakeTimers();
    const port = createPort();
    vi.mocked(port.promoteAdmission).mockResolvedValue({
      ...sessionResponse(),
      betaAlias: "BETA-23456",
    });
    const controller = createController(port);

    await completeSetup(controller);

    expect(controller.getSnapshot()).toMatchObject({
      phase: "failed",
      identity: {
        betaAlias: "BETA-23AHK",
        connectionCode: "7HJK-9MNP",
      },
      failure: {
        code: "invalid-response",
        phase: "session",
        technicalMessage: "remote-recognition-session-beta-alias-mismatch",
      },
    });
    expect(port.stopSession).toHaveBeenCalledWith(
      "session-1",
      "session-secret",
    );
    vi.useRealTimers();
  });

  it("still reserves when status is full so native can decide idempotency or conflict", async () => {
    const port = createPort();
    vi.mocked(port.getStatus).mockResolvedValue({
      ...statusResponse(),
      serviceState: "full",
      admissionAvailable: false,
      retryAfterMs: 5_000,
    });
    vi.mocked(port.createAdmission).mockRejectedValue(
      new RemoteRecognitionControlContractError(
        "capacity-full",
        "admission",
        true,
        5_000,
        "remote-recognition-capacity-full",
      ),
    );
    const controller = createController(port);

    await controller.start(
      ACCESS_CODE,
      REMOTE_RECOGNITION_READINESS_CONSENT_VERSION,
    );

    expect(controller.getSnapshot()).toMatchObject({
      phase: "failed",
      failure: { code: "capacity-full", phase: "admission" },
    });
    expect(port.createAdmission).toHaveBeenCalledOnce();
  });

  it("preserves an access-code-in-use admission failure", async () => {
    vi.useFakeTimers();
    const port = createPort();
    vi.mocked(port.createAdmission).mockRejectedValue(
      new RemoteRecognitionControlContractError(
        "access-code-in-use",
        "admission",
        true,
        15_000,
        "remote-recognition-access-code-in-use",
      ),
    );
    const controller = createController(port);

    await completeSetup(controller);

    expect(controller.getSnapshot()).toMatchObject({
      phase: "failed",
      identity: null,
      failure: {
        code: "access-code-in-use",
        phase: "admission",
        retryable: true,
        retryAfterMs: 15_000,
      },
    });
    expect(port.probeAdmissionFrame).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("releases a temporary admission when the probe is rejected", async () => {
    vi.useFakeTimers();
    const port = createPort();
    vi.mocked(port.probeAdmissionFrame).mockImplementation(
      async (_admissionId, _token, frame) =>
        frameProbeResponse(frame.sequence, false),
    );
    const controller = createController(port);

    await completeSetup(controller);

    expect(controller.getSnapshot()).toMatchObject({
      phase: "failed",
      failure: { code: "probe-failed" },
    });
    expect(port.cancelAdmission).toHaveBeenCalledWith(
      "admission-1",
      "admission-secret",
    );
    vi.useRealTimers();
  });

  it("tolerates one retryable heartbeat failure and fails on the second", async () => {
    vi.useFakeTimers();
    const port = createPort();
    vi.mocked(port.heartbeatSession).mockRejectedValue(
      new RemoteRecognitionControlContractError(
        "network-error",
        "session",
        true,
        null,
        "temporary-network-error",
      ),
    );
    const controller = createController(port);
    await completeSetup(controller);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(controller.getSnapshot().phase).toBe("ready");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(controller.getSnapshot()).toMatchObject({
      phase: "failed",
      failure: { code: "network-error" },
    });
    vi.useRealTimers();
  });

  it("drops active and pending parser frames when the heartbeat ends the session", async () => {
    vi.useFakeTimers();
    const port = createPort();
    vi.mocked(port.heartbeatSession).mockRejectedValue(
      new RemoteRecognitionControlContractError(
        "network-error",
        "session",
        true,
        null,
        "temporary-network-error",
      ),
    );
    vi.mocked(port.analyzeSessionParserFrame).mockImplementation(
      (_sessionId, _token, _frame, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        }),
    );
    const controller = createController(port);
    await completeSetup(controller);
    enableParserProvider(controller);

    const active = controller.analyzeParserFrame(parserRequest(1));
    const pending = controller.analyzeParserFrame(parserRequest(2));
    const activeExpectation = expect(active).rejects.toBeInstanceOf(
      RemoteRecognitionParserFrameDroppedError,
    );
    const pendingExpectation = expect(pending).rejects.toMatchObject({
      name: "RemoteRecognitionParserFrameDroppedError",
      sampledAt: parserRequest(2).sampledAt,
      replacedBySampledAt: null,
    });

    await vi.advanceTimersByTimeAsync(5_000);
    expect(controller.getSnapshot().phase).toBe("ready");
    await vi.advanceTimersByTimeAsync(1_000);

    await Promise.all([activeExpectation, pendingExpectation]);
    expect(controller.getSnapshot()).toMatchObject({
      phase: "failed",
      parserProvider: { active: false, consentVersion: null },
      failure: { code: "network-error", phase: "session" },
    });
    expect(port.analyzeSessionParserFrame).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("requires a separate session-scoped consent before any provider frame", async () => {
    vi.useFakeTimers();
    const port = createPort();
    const controller = createController(port);
    await completeSetup(controller);

    await expect(
      controller.analyzeParserFrame(parserRequest(1)),
    ).rejects.toMatchObject({ code: "transport-not-enabled" });
    expect(port.analyzeSessionParserFrame).not.toHaveBeenCalled();

    controller.setParserProviderConsent(true);
    await expect(
      controller.analyzeParserFrame(parserRequest(1)),
    ).rejects.toMatchObject({ code: "transport-not-enabled" });
    expect(port.analyzeSessionParserFrame).not.toHaveBeenCalled();

    controller.setParserProviderEnabled(true);
    await expect(controller.analyzeParserFrame(parserRequest(1))).resolves.toBeDefined();
    expect(port.analyzeSessionParserFrame).toHaveBeenCalledOnce();

    controller.setParserProviderConsent(false);
    expect(controller.getSnapshot().parserProvider).toMatchObject({
      active: false,
      consentVersion: null,
    });
    vi.useRealTimers();
  });

  it("keeps consent recorded before setup through the ready transition", async () => {
    vi.useFakeTimers();
    const port = createPort();
    const controller = createController(port);

    controller.setParserProviderConsent(true);
    expect(controller.getSnapshot().parserProvider.consentVersion).not.toBeNull();

    controller.setParserProviderConsent(false);
    expect(controller.getSnapshot().parserProvider.consentVersion).toBeNull();

    controller.setParserProviderConsent(true);
    await completeSetup(controller);
    expect(controller.getSnapshot().phase).toBe("ready");
    expect(controller.getSnapshot().parserProvider.consentVersion).not.toBeNull();

    controller.setParserProviderEnabled(true);
    expect(controller.getSnapshot().parserProvider.active).toBe(true);
    vi.useRealTimers();
  });

  it("keeps recorded consent through a failed attempt and its retry", async () => {
    vi.useFakeTimers();
    const port = createPort();
    vi.mocked(port.createAdmission).mockRejectedValueOnce(
      new RemoteRecognitionControlContractError(
        "network-error",
        "admission",
        true,
        null,
        "temporary-admission-failure",
      ),
    );
    const controller = createController(port);

    controller.setParserProviderConsent(true);
    await completeSetup(controller);
    expect(controller.getSnapshot().phase).toBe("failed");
    expect(controller.getSnapshot().parserProvider.consentVersion).not.toBeNull();

    await completeSetup(controller);
    expect(controller.getSnapshot().phase).toBe("ready");
    // The retry path resets the snapshot before checking; recorded consent
    // must survive it.
    expect(controller.getSnapshot().parserProvider.consentVersion).not.toBeNull();

    controller.setParserProviderEnabled(true);
    expect(controller.getSnapshot().parserProvider.active).toBe(true);
    vi.useRealTimers();
  });

  it("returns parser coordinates and records the latest frame E2E time", async () => {
    vi.useFakeTimers();
    const port = createPort();
    const controller = createController(port);
    await completeSetup(controller);
    enableParserProvider(controller);

    await expect(
      controller.analyzeParserFrame({
        sampledAt: 1_785_600_001_000,
        width: 683,
        height: 384,
        encodedVp8: new Uint8Array([1, 2, 3]).buffer,
        encodeMs: 7,
      }),
    ).resolves.toMatchObject({
      response: { frame: { parser: { boxCount: 1 } } },
      e2eMs: 47,
    });
    expect(controller.getSnapshot().parserFrames).toMatchObject({
      successfulFrames: 1,
      failedFrames: 0,
      droppedFrames: 0,
      lastE2eMs: 47,
      lastServerTotalMs: 35,
      lastEncodedBytes: 3,
      lastSampledAt: 1_785_600_001_000,
    });
    vi.useRealTimers();
  });

  it("reports cumulative client transport telemetry with only the latest four verified E2E samples", async () => {
    vi.useFakeTimers();
    const port = createPort();
    enableClientTelemetryCapability(port);
    const controller = createController(port);
    await completeSetup(controller);
    enableParserProvider(controller);

    for (const sequence of [1, 2, 3, 4, 5]) {
      await controller.analyzeParserFrame(parserRequest(sequence));
    }
    await vi.advanceTimersByTimeAsync(5_000);

    expect(port.heartbeatSession).toHaveBeenLastCalledWith(
      "session-1",
      "session-secret",
      {
        clientTelemetry: {
          version: 1,
          reportSequence: 6,
          counters: {
            acceptedResults: 5,
            unavailableSamples: 0,
            pendingReplacements: 0,
            retryableFailures: 0,
            terminalFallbacks: 0,
          },
          recentTransportE2e: [
            { frameSequence: 2, transportE2eMs: 43 },
            { frameSequence: 3, transportE2eMs: 43 },
            { frameSequence: 4, transportE2eMs: 43 },
            { frameSequence: 5, transportE2eMs: 43 },
          ],
        },
      },
    );
    vi.useRealTimers();
  });

  it("keeps parser frame and telemetry sequences monotonic when the provider is re-enabled in the same session", async () => {
    vi.useFakeTimers();
    const port = createPort();
    enableClientTelemetryCapability(port);
    const controller = createController(port);
    await completeSetup(controller);
    enableParserProvider(controller);

    await controller.analyzeParserFrame(parserRequest(1));
    controller.setParserProviderEnabled(false);
    controller.setParserProviderEnabled(true);
    await controller.analyzeParserFrame(parserRequest(2));
    await vi.advanceTimersByTimeAsync(5_000);

    expect(port.analyzeSessionParserFrame).toHaveBeenNthCalledWith(
      1,
      "session-1",
      "session-secret",
      expect.objectContaining({ sequence: 1 }),
      expect.anything(),
    );
    expect(port.analyzeSessionParserFrame).toHaveBeenNthCalledWith(
      2,
      "session-1",
      "session-secret",
      expect.objectContaining({ sequence: 2 }),
      expect.anything(),
    );
    expect(port.heartbeatSession).toHaveBeenLastCalledWith(
      "session-1",
      "session-secret",
      expect.objectContaining({
        clientTelemetry: expect.objectContaining({
          recentTransportE2e: [
            { frameSequence: 1, transportE2eMs: 43 },
            { frameSequence: 2, transportE2eMs: 43 },
          ],
        }),
      }),
    );
    vi.useRealTimers();
  });

  it("does not count an accepted frame as unavailable when a terminal heartbeat settles immediately after it", async () => {
    vi.useFakeTimers();
    const port = createPort();
    enableClientTelemetryCapability(port);
    const heartbeatRejectors: Array<(reason?: unknown) => void> = [];
    vi.mocked(port.heartbeatSession)
      .mockRejectedValueOnce(retryableHeartbeatFailure())
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            heartbeatRejectors.push(reject);
          }),
      );
    const frameResolvers: Array<
      (value: ReturnType<typeof parserFrameResponse>) => void
    > = [];
    vi.mocked(port.analyzeSessionParserFrame).mockImplementationOnce(
      (_sessionId, _token, frame) =>
        new Promise((resolve) => {
          frameResolvers.push(resolve);
          expect(frame.sequence).toBe(1);
        }),
    );
    const controller = createController(port);
    await completeSetup(controller);
    enableParserProvider(controller);

    await vi.advanceTimersByTimeAsync(5_000);
    const frame = controller.analyzeParserFrame(parserRequest(1));
    await vi.advanceTimersByTimeAsync(1_000);
    frameResolvers.shift()?.(parserFrameResponse(1, parserRequest(1)));
    heartbeatRejectors.shift()?.(retryableHeartbeatFailure());

    await expect(frame).resolves.toBeDefined();
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.getSnapshot().phase).toBe("failed");
    expect(port.stopSession).toHaveBeenCalledWith(
      "session-1",
      "session-secret",
      {
        clientTelemetry: expect.objectContaining({
          counters: {
            acceptedResults: 1,
            unavailableSamples: 0,
            pendingReplacements: 0,
            retryableFailures: 0,
            terminalFallbacks: 1,
          },
        }),
      },
    );
    vi.useRealTimers();
  });

  it("reports pending replacements and retryable failures as unavailable samples without calling them retries", async () => {
    vi.useFakeTimers();
    const port = createPort();
    enableClientTelemetryCapability(port);
    const controller = createController(port);
    await completeSetup(controller);
    enableParserProvider(controller);

    vi.mocked(port.analyzeSessionParserFrame)
      .mockRejectedValueOnce(retryableParserFrameFailure())
      .mockImplementation(async (_sessionId, _token, frame) =>
        parserFrameResponse(frame.sequence, {
          sampledAt: frame.sampledAt,
          width: frame.width,
          height: frame.height,
          encodedVp8: frame.encodedVp8,
          encodeMs: 0,
        }),
      );
    await expect(
      controller.analyzeParserFrame(parserRequest(1)),
    ).rejects.toBeInstanceOf(RemoteRecognitionParserFrameDroppedError);
    await controller.analyzeParserFrame(parserRequest(2));
    await vi.advanceTimersByTimeAsync(0);

    expect(port.analyzeSessionParserFrame).toHaveBeenNthCalledWith(
      2,
      "session-1",
      "session-secret",
      expect.objectContaining({ sequence: 2 }),
      expect.objectContaining({
        clientTelemetry: expect.objectContaining({
          counters: {
            acceptedResults: 0,
            unavailableSamples: 1,
            pendingReplacements: 0,
            retryableFailures: 1,
            terminalFallbacks: 0,
          },
        }),
      }),
    );

    const activeResolvers: Array<
      (value: ReturnType<typeof parserFrameResponse>) => void
    > = [];
    vi.mocked(port.analyzeSessionParserFrame).mockImplementationOnce(
      (_sessionId, _token, frame) =>
        new Promise((resolve) => {
          activeResolvers.push(resolve);
          expect(frame.sequence).toBe(3);
        }),
    );
    const active = controller.analyzeParserFrame(parserRequest(3));
    const replaced = controller.analyzeParserFrame(parserRequest(4));
    const replacedExpectation = expect(replaced).rejects.toBeInstanceOf(
      RemoteRecognitionParserFrameDroppedError,
    );
    const latest = controller.analyzeParserFrame(parserRequest(5));
    await replacedExpectation;
    activeResolvers.shift()?.(parserFrameResponse(3, parserRequest(3)));
    await active;
    await vi.advanceTimersByTimeAsync(0);
    await latest;

    expect(port.analyzeSessionParserFrame).toHaveBeenLastCalledWith(
      "session-1",
      "session-secret",
      expect.objectContaining({ sequence: 4 }),
      expect.objectContaining({
        clientTelemetry: expect.objectContaining({
          counters: {
            acceptedResults: 2,
            unavailableSamples: 2,
            pendingReplacements: 1,
            retryableFailures: 1,
            terminalFallbacks: 0,
          },
        }),
      }),
    );
    vi.useRealTimers();
  });

  it("keeps the session after one retryable parser frame failure and recovers", async () => {
    vi.useFakeTimers();
    const port = createPort();
    const controller = createController(port);
    await completeSetup(controller);
    enableParserProvider(controller);
    vi.mocked(port.analyzeSessionParserFrame)
      .mockRejectedValueOnce(retryableParserFrameFailure())
      .mockImplementation(async (_sessionId, _token, frame) =>
        parserFrameResponse(frame.sequence, {
          sampledAt: frame.sampledAt,
          width: frame.width,
          height: frame.height,
          encodedVp8: frame.encodedVp8,
          encodeMs: 0,
        }),
      );

    await expect(
      controller.analyzeParserFrame(parserRequest(1)),
    ).rejects.toMatchObject({
      name: "RemoteRecognitionParserFrameDroppedError",
      sampledAt: parserRequest(1).sampledAt,
      replacedBySampledAt: null,
    });
    expect(controller.getSnapshot()).toMatchObject({
      phase: "ready",
      parserFrames: {
        failedFrames: 1,
        successfulFrames: 0,
        lastError: "temporary-parser-frame-failure",
      },
    });
    expect(port.stopSession).not.toHaveBeenCalled();

    await expect(
      controller.analyzeParserFrame(parserRequest(2)),
    ).resolves.toMatchObject({ response: { frame: { sequence: 2 } } });
    expect(controller.getSnapshot()).toMatchObject({
      phase: "ready",
      parserFrames: {
        failedFrames: 1,
        successfulFrames: 1,
        lastError: null,
      },
    });
    vi.useRealTimers();
  });

  it("ends the session after three consecutive retryable parser frame failures", async () => {
    vi.useFakeTimers();
    const port = createPort();
    enableClientTelemetryCapability(port);
    const controller = createController(port);
    await completeSetup(controller);
    enableParserProvider(controller);
    vi.mocked(port.analyzeSessionParserFrame).mockRejectedValue(
      retryableParserFrameFailure(),
    );

    for (const sequence of [1, 2]) {
      await expect(
        controller.analyzeParserFrame(parserRequest(sequence)),
      ).rejects.toBeInstanceOf(RemoteRecognitionParserFrameDroppedError);
      expect(controller.getSnapshot().phase).toBe("ready");
    }
    await expect(
      controller.analyzeParserFrame(parserRequest(3)),
    ).rejects.toMatchObject({ code: "service-unavailable" });

    expect(controller.getSnapshot()).toMatchObject({
      phase: "failed",
      session: null,
      failure: { code: "service-unavailable" },
      parserFrames: { failedFrames: 3 },
    });
    expect(port.stopSession).toHaveBeenCalledWith(
      "session-1",
      "session-secret",
      {
        clientTelemetry: expect.objectContaining({
          reportSequence: 4,
          counters: {
            acceptedResults: 0,
            unavailableSamples: 3,
            pendingReplacements: 0,
            retryableFailures: 3,
            terminalFallbacks: 1,
          },
        }),
      },
    );
    vi.useRealTimers();
  });

  it.each([1, 2] as const)(
    "routes %i V1 injected parser failures through the normal drop policy, then recovers",
    async (failureCount) => {
      vi.useFakeTimers();
      const port = createPort();
      enableClientTelemetryCapability(port);
      const parserFramePort = createV1FaultPort(port, failureCount);
      const controller = createController(port, { parserFramePort });
      await completeSetup(controller);
      enableParserProvider(controller);

      for (let sequence = 1; sequence <= failureCount; sequence += 1) {
        await expect(
          controller.analyzeParserFrame(parserRequest(sequence)),
        ).rejects.toMatchObject({
          name: "RemoteRecognitionParserFrameDroppedError",
          sampledAt: parserRequest(sequence).sampledAt,
          replacedBySampledAt: null,
        });
        expect(controller.getSnapshot().phase).toBe("ready");
      }

      if (failureCount === 1) {
        expect(port.heartbeatSession).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(5_000);
        expect(port.heartbeatSession).toHaveBeenCalledOnce();
        expect(port.heartbeatSession).toHaveBeenCalledWith(
          "session-1",
          "session-secret",
          {
            clientTelemetry: expect.objectContaining({
              reportSequence: 2,
              counters: {
                acceptedResults: 0,
                unavailableSamples: 1,
                pendingReplacements: 0,
                retryableFailures: 1,
                terminalFallbacks: 0,
              },
            }),
          },
        );
        expect(controller.getSnapshot()).toMatchObject({
          phase: "ready",
          parserProvider: { active: true },
        });
      }

      expect(port.analyzeSessionParserFrame).not.toHaveBeenCalled();
      await expect(
        controller.analyzeParserFrame(parserRequest(failureCount + 1)),
      ).resolves.toMatchObject({
        response: { frame: { sequence: failureCount + 1 } },
      });

      expect(port.analyzeSessionParserFrame).toHaveBeenCalledOnce();
      expect(port.analyzeSessionParserFrame).toHaveBeenCalledWith(
        "session-1",
        "session-secret",
        expect.objectContaining({ sequence: failureCount + 1 }),
        expect.objectContaining({
          clientTelemetry: expect.objectContaining({
            counters: {
              acceptedResults: 0,
              unavailableSamples: failureCount,
              pendingReplacements: 0,
              retryableFailures: failureCount,
              terminalFallbacks: 0,
            },
          }),
        }),
      );
      expect(controller.getSnapshot()).toMatchObject({
        phase: "ready",
        parserProvider: { active: true },
        parserFrames: {
          failedFrames: failureCount,
          successfulFrames: 1,
          lastError: null,
        },
      });
      expect(port.stopSession).not.toHaveBeenCalled();
      if (failureCount === 1) {
        await controller.stop();
        expect(port.stopSession).toHaveBeenCalledOnce();
        expect(port.stopSession).toHaveBeenCalledWith(
          "session-1",
          "session-secret",
          {
            clientTelemetry: expect.objectContaining({
              reportSequence: 4,
              counters: {
                acceptedResults: 1,
                unavailableSamples: 1,
                pendingReplacements: 0,
                retryableFailures: 1,
                terminalFallbacks: 0,
              },
            }),
          },
        );
        expect(controller.getSnapshot().phase).toBe("idle");
      }
      vi.useRealTimers();
    },
  );

  it("routes three V1 injected parser failures through terminal fallback while release stays on the base port", async () => {
    vi.useFakeTimers();
    const port = createPort();
    enableClientTelemetryCapability(port);
    const controller = createController(port, {
      parserFramePort: createV1FaultPort(port, 3),
    });
    await completeSetup(controller);
    enableParserProvider(controller);

    for (const sequence of [1, 2]) {
      await expect(
        controller.analyzeParserFrame(parserRequest(sequence)),
      ).rejects.toBeInstanceOf(RemoteRecognitionParserFrameDroppedError);
    }
    await expect(
      controller.analyzeParserFrame(parserRequest(3)),
    ).rejects.toMatchObject({
      name: "RemoteRecognitionControlContractError",
      code: "network-error",
      phase: "transport",
      retryable: true,
      retryAfterMs: null,
      message: "remote-recognition-v1-parser-frame-failure-injected",
    });

    expect(port.analyzeSessionParserFrame).not.toHaveBeenCalled();
    expect(controller.getSnapshot()).toMatchObject({
      phase: "failed",
      session: null,
      parserProvider: { active: false, consentVersion: null },
      parserFrames: {
        failedFrames: 3,
        successfulFrames: 0,
        lastError: "remote-recognition-v1-parser-frame-failure-injected",
      },
      failure: {
        code: "network-error",
        phase: "transport",
        retryable: true,
      },
    });
    expect(port.stopSession).toHaveBeenCalledOnce();
    expect(port.stopSession).toHaveBeenCalledWith(
      "session-1",
      "session-secret",
      {
        clientTelemetry: expect.objectContaining({
          counters: {
            acceptedResults: 0,
            unavailableSamples: 3,
            pendingReplacements: 0,
            retryableFailures: 3,
            terminalFallbacks: 1,
          },
        }),
      },
    );
    await vi.advanceTimersByTimeAsync(10_000);
    expect(port.heartbeatSession).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it.each(["production", "development"] as const)(
    "ignores an injected parser-frame dependency for the %s client channel",
    async (channel) => {
      vi.useFakeTimers();
      const port = createPort();
      const injectedPort: RemoteRecognitionParserFrameControlPort = {
        analyzeSessionParserFrame: vi
          .fn()
          .mockRejectedValue(
            new RemoteRecognitionControlContractError(
              "network-error",
              "transport",
              true,
              null,
              "must-not-run",
            ),
          ),
      };
      const controller = createController(port, {
        channel,
        parserFramePort: injectedPort,
      });
      await completeSetup(controller);
      enableParserProvider(controller);

      await expect(
        controller.analyzeParserFrame(parserRequest(1)),
      ).resolves.toMatchObject({ response: { frame: { sequence: 1 } } });
      expect(injectedPort.analyzeSessionParserFrame).not.toHaveBeenCalled();
      expect(port.analyzeSessionParserFrame).toHaveBeenCalledOnce();
      expect(controller.getSnapshot().phase).toBe("ready");
      vi.useRealTimers();
    },
  );

  it("keeps one parser frame in flight and only the latest pending frame", async () => {
    vi.useFakeTimers();
    const port = createPort();
    const controller = createController(port);
    await completeSetup(controller);
    enableParserProvider(controller);
    const responses: Array<(value: ReturnType<typeof parserFrameResponse>) => void> = [];
    let requestCalls = 0;
    vi.mocked(port.analyzeSessionParserFrame).mockImplementation(
      (_sessionId, _token, frame) => {
        requestCalls += 1;
        return new Promise((resolve) => {
          responses.push((value) => resolve(value));
          expect(frame.sequence).toBe(requestCalls);
        });
      },
    );

    const first = controller.analyzeParserFrame(parserRequest(1));
    const replaced = controller.analyzeParserFrame(parserRequest(2));
    const latest = controller.analyzeParserFrame(parserRequest(3));
    await expect(replaced).rejects.toBeInstanceOf(
      RemoteRecognitionParserFrameDroppedError,
    );
    expect(port.analyzeSessionParserFrame).toHaveBeenCalledTimes(1);

    responses.shift()?.(parserFrameResponse(1, parserRequest(1)));
    await first;
    await vi.advanceTimersByTimeAsync(0);
    expect(port.analyzeSessionParserFrame).toHaveBeenCalledTimes(2);
    responses.shift()?.(parserFrameResponse(2, parserRequest(3)));
    await latest;
    expect(controller.getSnapshot().parserFrames).toMatchObject({
      successfulFrames: 2,
      droppedFrames: 1,
      lastSampledAt: parserRequest(3).sampledAt,
    });
    vi.useRealTimers();
  });

  it("treats an active provider request aborted by disable as a typed drop", async () => {
    vi.useFakeTimers();
    const port = createPort();
    const controller = createController(port);
    await completeSetup(controller);
    enableParserProvider(controller);
    vi.mocked(port.analyzeSessionParserFrame).mockImplementation(
      (_sessionId, _token, _frame, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        }),
    );

    const pending = controller.analyzeParserFrame(parserRequest(1));
    controller.setParserProviderEnabled(false);

    await expect(pending).rejects.toBeInstanceOf(
      RemoteRecognitionParserFrameDroppedError,
    );
    expect(controller.getSnapshot()).toMatchObject({
      phase: "ready",
      parserProvider: { active: false },
      failure: null,
    });
    vi.useRealTimers();
  });

  it("records a client transport failure and releases before local fallback", async () => {
    vi.useFakeTimers();
    const port = createPort();
    enableClientTelemetryCapability(port);
    const controller = createController(port);
    await completeSetup(controller);
    enableParserProvider(controller);

    await controller.failParserProvider(
      new Error("vp8-parser-preview-webcodecs-unavailable"),
      1_785_600_001_000,
    );

    expect(controller.getSnapshot()).toMatchObject({
      phase: "failed",
      session: null,
      parserProvider: { active: false, consentVersion: null },
      parserFrames: {
        failedFrames: 1,
        lastSampledAt: 1_785_600_001_000,
        lastError: "vp8-parser-preview-webcodecs-unavailable",
      },
      failure: {
        code: "internal-error",
        phase: "transport",
        retryable: false,
      },
    });
    expect(port.stopSession).toHaveBeenCalledWith(
      "session-1",
      "session-secret",
      {
        clientTelemetry: {
          version: 1,
          reportSequence: 1,
          counters: {
            acceptedResults: 0,
            unavailableSamples: 1,
            pendingReplacements: 0,
            retryableFailures: 0,
            terminalFallbacks: 1,
          },
          recentTransportE2e: [],
        },
      },
    );
    vi.useRealTimers();
  });
});

function createController(
  port: RemoteRecognitionControlPort,
  {
    clientInstanceId = CLIENT_INSTANCE_ID,
    channel = "preview",
    parserFramePort,
  }: {
    clientInstanceId?: string;
    channel?: "production" | "preview" | "development";
    parserFramePort?: RemoteRecognitionParserFrameControlPort;
  } = {},
) {
  let monotonicTime = 0;
  let admissionAttemptSequence = 0;
  const frameSource: RemoteRecognitionFrameProbeSource = {
    captureFrame: vi.fn(async (sequence) => ({
      frame: framePayload(sequence),
      timings: { captureMs: 2, compressionMs: 3 },
    })),
  };
  return new RemoteRecognitionSessionController(
    port,
    frameSource,
    {
      appBuild: "preview main@abc1234",
      channel,
      runtimeVersion: "browser-v1",
      getClientInstanceId: () => clientInstanceId,
      createAdmissionAttemptId: () =>
        admissionAttemptId(++admissionAttemptSequence),
    },
    {
      setTimeout: (handler, delayMs) => setTimeout(handler, delayMs),
      clearTimeout: (handle) => clearTimeout(handle),
    },
    () => {
      const value = monotonicTime;
      monotonicTime += 40;
      return value;
    },
    parserFramePort,
  );
}

function createV1FaultPort(
  port: RemoteRecognitionControlPort,
  failureCount: 1 | 2 | 3,
): RemoteRecognitionParserFrameControlPort {
  const commitSha = "a".repeat(40);
  const branch = "codex/remote-recognition-v1-owner-gate";
  const decorated = createRemoteRecognitionV1ClientFaultDecorator({
    port,
    compileTimeArm: true,
    buildInfo: {
      name: "maple-timer",
      version: "0.1.0",
      commitSha,
      shortCommit: commitSha.slice(0, 7),
      branch,
      deploymentUrl: "https://preview.maple-timer.pages.dev",
      buildTime: "2026-08-05T00:00:00.000Z",
      channel: "preview",
      remoteRecognitionV1TestArm: true,
    },
    reviewedCommit: commitSha,
    reviewedBranch: branch,
    labAvailable: true,
    search: `?remote-recognition-v1-parser-frame-failures=${failureCount}`,
  });
  if (!decorated) {
    throw new Error("expected-v1-parser-frame-fault-port");
  }
  return decorated;
}

function enableClientTelemetryCapability(
  port: RemoteRecognitionControlPort,
): void {
  vi.mocked(port.promoteAdmission).mockResolvedValue({
    ...sessionResponse(),
    capabilities: {
      ...sessionResponse().capabilities,
      clientTelemetryVersion: 1,
    },
  });
}

function retryableParserFrameFailure() {
  return new RemoteRecognitionControlContractError(
    "service-unavailable",
    "transport",
    true,
    5_000,
    "temporary-parser-frame-failure",
  );
}

function retryableHeartbeatFailure() {
  return new RemoteRecognitionControlContractError(
    "network-error",
    "session",
    true,
    null,
    "temporary-heartbeat-failure",
  );
}

function createPort(): RemoteRecognitionControlPort {
  return {
    getStatus: vi.fn().mockResolvedValue(statusResponse()),
    createAdmission: vi.fn().mockResolvedValue(admissionResponse()),
    probeAdmission: vi.fn().mockResolvedValue(probeResponse()),
    probeAdmissionFrame: vi.fn().mockImplementation(
      async (_admissionId, _token, frame) =>
        frameProbeResponse(frame.sequence),
    ),
    promoteAdmission: vi.fn().mockResolvedValue(sessionResponse()),
    cancelAdmission: vi.fn().mockResolvedValue(releaseResponse()),
    heartbeatSession: vi.fn().mockResolvedValue({
      contract: createRemoteRecognitionControlMarker(),
      status: "ok",
      sessionId: "session-1",
      expiresAt: Date.now() + 15_000,
    }),
    analyzeSessionParserFrame: vi.fn().mockImplementation(
      async (_sessionId, _token, frame) =>
        parserFrameResponse(frame.sequence, {
          sampledAt: frame.sampledAt,
          width: frame.width,
          height: frame.height,
          encodedVp8: frame.encodedVp8,
          encodeMs: 0,
        }),
    ),
    stopSession: vi.fn().mockResolvedValue(releaseResponse()),
  };
}

function statusResponse() {
  return {
    contract: createRemoteRecognitionControlMarker(),
    status: "ok" as const,
    serviceState: "available" as const,
    admissionAvailable: true,
    frameAnalysisEnabled: true,
    retryAfterMs: null,
  };
}

function admissionResponse() {
  return {
    contract: createRemoteRecognitionControlMarker(),
    status: "ok" as const,
    admissionId: "admission-1",
    admissionToken: "admission-secret",
    betaAlias: "BETA-23AHK",
    connectionCode: "7HJK-9MNP",
    expiresAt: Date.now() + 15_000,
    probe: { requiredRounds: 5, intervalMs: 1_000 },
    capabilities: {
      frameAnalysisEnabled: true,
      entitlementLeaseVersion: 1 as const,
    },
  };
}

function probeResponse() {
  return {
    contract: createRemoteRecognitionControlMarker(),
    status: "ok" as const,
    admissionId: "admission-1",
    accepted: true,
    rounds: Array.from({ length: 5 }, (_, index) => ({
      round: index + 1,
      status: "ok" as const,
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
    status: "ok" as const,
    sessionId: "session-1",
    sessionToken: "session-secret",
    betaAlias: "BETA-23AHK",
    connectionCode: "7HJK-9MNP",
    expiresAt: Date.now() + 15_000,
    idleTimeoutMs: 15_000,
    heartbeatIntervalMs: 5_000,
    modelSetId: "studio-parser-probe-v1",
    capabilities: {
      frameAnalysisEnabled: true,
      entitlementLeaseVersion: 1 as const,
    },
  };
}

function releaseResponse() {
  return {
    contract: createRemoteRecognitionControlMarker(),
    status: "ok" as const,
    released: true as const,
  };
}

function framePayload(sequence: number) {
  return {
    sequence,
    sampledAt: 1_785_600_000_000 + sequence,
    width: 683,
    height: 384,
    encodedRgba: new Uint8Array([sequence]).buffer,
  };
}

function frameProbeResponse(sequence: number, accepted = sequence === 5) {
  const frame = framePayload(sequence);
  return {
    contract: createRemoteRecognitionControlMarker(),
    status: "ok" as const,
    admissionId: "admission-1",
    accepted,
    requiredRounds: 5,
    round: {
      round: sequence,
      status: "ok" as const,
      elapsedMs: 35,
      sampledAt: frame.sampledAt,
      encodedBytes: frame.encodedRgba.byteLength,
      width: frame.width,
      height: frame.height,
      parser: {
        engine: "onnxruntime-native" as const,
        modelId: "buff-detector-test",
        executionProviders: ["CoreMLExecutionProvider"],
        boxCount: 0,
      },
      timings: {
        decodeMs: 1,
        preprocessMs: 4,
        inferenceMs: 28,
        postprocessMs: 2,
        serverTotalMs: 35,
      },
    },
    summary: {
      completedRounds: sequence,
      successfulRounds: sequence,
      medianMs: 35,
      maxMs: 35,
      totalElapsedMs: sequence * 35,
    },
  };
}

function parserRequest(sequence: number) {
  return {
    sampledAt: 1_785_600_001_000 + sequence,
    width: 683,
    height: 384,
    encodedVp8: new Uint8Array([sequence]).buffer,
    encodeMs: 3,
  };
}

function parserFrameResponse(
  sequence: number,
  request = parserRequest(sequence),
) {
  return {
    contract: createRemoteRecognitionControlMarker(),
    status: "ok" as const,
    sessionId: "session-1",
    purpose: "parser-provider" as const,
    expiresAt: Date.now() + 15_000,
    frame: {
      sequence,
      sampledAt: request.sampledAt,
      encodedBytes: request.encodedVp8.byteLength,
      width: request.width,
      height: request.height,
      parser: {
        engine: "onnxruntime-native" as const,
        modelId: "buff-detector-test",
        modelInputWidth: 544,
        modelInputHeight: 960,
        onnxRuntimeVersion: "1.24.4",
        executionProviders: ["CoreMLExecutionProvider"],
        boxCount: 1,
      },
      boxes: [{ x: 600, y: 20, size: 30, confidence: 0.99, score: 990 }],
      timings: {
        decodeMs: 1,
        preprocessMs: 4,
        inferenceMs: 28,
        postprocessMs: 2,
        serverTotalMs: 35,
      },
    },
  };
}

async function completeSetup(
  controller: RemoteRecognitionSessionController,
  accessCode = ACCESS_CODE,
): Promise<void> {
  const setup = controller.start(
    accessCode,
    REMOTE_RECOGNITION_READINESS_CONSENT_VERSION,
  );
  await vi.advanceTimersByTimeAsync(0);
  await setup;
}

function admissionAttemptId(sequence: number): string {
  return `22222222-2222-4222-8222-${String(sequence).padStart(12, "0")}`;
}

function enableParserProvider(
  controller: RemoteRecognitionSessionController,
): void {
  controller.setParserProviderConsent(true);
  controller.setParserProviderEnabled(true);
}

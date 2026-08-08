import {
  REMOTE_RECOGNITION_CONTROL_PIPELINE,
  REMOTE_RECOGNITION_READINESS_CONSENT_VERSION,
  REMOTE_RECOGNITION_PARSER_FRAME_CONSENT_VERSION,
  RemoteRecognitionControlContractError,
  RemoteRecognitionParserFrameDroppedError,
  createRemoteRecognitionControlMarker,
  deriveRemoteRecognitionBetaAliasFromAccessCode,
  isValidRemoteRecognitionClientUuid,
  type RemoteRecognitionAdmissionRequest,
  type RemoteRecognitionConnectionIdentity,
  type RemoteRecognitionControlFailureCode,
  type RemoteRecognitionControlFailurePhase,
  type RemoteRecognitionFrameProbeResponse,
  type RemoteRecognitionProbeSummary,
  type RemoteRecognitionParserFrameProviderRequest,
  type RemoteRecognitionParserFrameProviderResult,
  type RemoteRecognitionParserFrameResponse,
  type RemoteRecognitionServiceState,
} from "../../contracts/remote-recognition/remoteRecognitionControlContract";
import type {
  RemoteRecognitionControlPort,
  RemoteRecognitionControlRequestOptions,
  RemoteRecognitionParserFrameControlPort,
} from "./remoteRecognitionControlPort";
import {
  REMOTE_RECOGNITION_CLIENT_TELEMETRY_MAX_COUNTER,
  REMOTE_RECOGNITION_CLIENT_TELEMETRY_MAX_RECENT_E2E_SAMPLES,
  REMOTE_RECOGNITION_CLIENT_TELEMETRY_VERSION,
  type RemoteRecognitionClientTelemetryReport,
  type RemoteRecognitionClientTransportE2eSample,
} from "../../contracts/remote-recognition/remoteRecognitionClientTelemetry";
import {
  RemoteRecognitionFrameProbeSourceError,
  type RemoteRecognitionFrameCapture,
  type RemoteRecognitionFrameProbeSource,
} from "./remoteRecognitionFrameProbeSource";

export type RemoteRecognitionSetupPhase =
  | "idle"
  | "checking"
  | "reserving"
  | "probing"
  | "activating"
  | "ready"
  | "stopping"
  | "failed";

export type RemoteRecognitionSetupFailure = {
  code: RemoteRecognitionControlFailureCode;
  phase: RemoteRecognitionControlFailurePhase;
  retryable: boolean;
  retryAfterMs: number | null;
  technicalMessage: string;
};

export type RemoteRecognitionSessionSnapshot = {
  phase: RemoteRecognitionSetupPhase;
  identity: RemoteRecognitionConnectionIdentity | null;
  serviceState: RemoteRecognitionServiceState | null;
  probe: RemoteRecognitionProbeSummary | null;
  probeDiagnostics: RemoteRecognitionProbeDiagnostics | null;
  session: {
    expiresAt: number;
    heartbeatIntervalMs: number;
    modelSetId: string;
    frameAnalysisEnabled: boolean;
  } | null;
  parserProvider: RemoteRecognitionParserProviderSnapshot;
  parserFrames: RemoteRecognitionParserFrameDiagnostics;
  failure: RemoteRecognitionSetupFailure | null;
};

export type RemoteRecognitionParserProviderSnapshot = {
  active: boolean;
  consentVersion: typeof REMOTE_RECOGNITION_PARSER_FRAME_CONSENT_VERSION | null;
  generation: number;
};

export type RemoteRecognitionParserFrameDiagnostics = {
  successfulFrames: number;
  failedFrames: number;
  droppedFrames: number;
  lastE2eMs: number | null;
  lastServerTotalMs: number | null;
  lastEncodedBytes: number | null;
  lastSampledAt: number | null;
  lastError: string | null;
};

export type RemoteRecognitionProbeDiagnostics = {
  completedRounds: number;
  parserModelId: string;
  executionProviders: string[];
  averageCaptureMs: number;
  averageCompressionMs: number;
  averageRoundTripMs: number;
  averageEncodedBytes: number;
  averageDecodeMs: number;
  averagePreprocessMs: number;
  averageInferenceMs: number;
  averagePostprocessMs: number;
  averageServerTotalMs: number;
};

export type RemoteRecognitionSetupClient = {
  appBuild: string;
  channel: "production" | "preview" | "development";
  runtimeVersion: string;
  getClientInstanceId(): string;
  createAdmissionAttemptId(): string;
};

type Scheduler = {
  setTimeout(handler: () => void, delayMs: number): ReturnType<typeof setTimeout>;
  clearTimeout(handle: ReturnType<typeof setTimeout>): void;
};

type AdmissionLease = {
  id: string;
  token: string;
};

type SessionLease = AdmissionLease & {
  heartbeatIntervalMs: number;
  clientTelemetryVersion:
    | typeof REMOTE_RECOGNITION_CLIENT_TELEMETRY_VERSION
    | null;
};

type ClientTelemetryCounters =
  RemoteRecognitionClientTelemetryReport["counters"];

type QueuedParserFrame = {
  request: RemoteRecognitionParserFrameProviderRequest;
  resolve: (result: RemoteRecognitionParserFrameProviderResult) => void;
  reject: (error: unknown) => void;
  unsettled: boolean;
};

const INITIAL_SNAPSHOT: RemoteRecognitionSessionSnapshot = {
  phase: "idle",
  identity: null,
  serviceState: null,
  probe: null,
  probeDiagnostics: null,
  session: null,
  parserProvider: createInitialParserProviderSnapshot(),
  parserFrames: createInitialParserFrameDiagnostics(),
  failure: null,
};

const defaultScheduler: Scheduler = {
  setTimeout: (handler, delayMs) => setTimeout(handler, delayMs),
  clearTimeout: (handle) => clearTimeout(handle),
};

const defaultMonotonicNow = (): number =>
  typeof performance !== "undefined" ? performance.now() : Date.now();

const MAX_CONSECUTIVE_RETRYABLE_PARSER_FRAME_FAILURES = 3;

export function createInitialParserProviderSnapshot(): RemoteRecognitionParserProviderSnapshot {
  return {
    active: false,
    consentVersion: null,
    generation: 0,
  };
}

export function createInitialParserFrameDiagnostics(): RemoteRecognitionParserFrameDiagnostics {
  return {
    successfulFrames: 0,
    failedFrames: 0,
    droppedFrames: 0,
    lastE2eMs: null,
    lastServerTotalMs: null,
    lastEncodedBytes: null,
    lastSampledAt: null,
    lastError: null,
  };
}

export class RemoteRecognitionSessionController {
  private readonly parserFramePort: RemoteRecognitionParserFrameControlPort;
  private snapshot: RemoteRecognitionSessionSnapshot = INITIAL_SNAPSHOT;
  private readonly listeners = new Set<() => void>();
  private generation = 0;
  private abortController: AbortController | null = null;
  private admission: AdmissionLease | null = null;
  private session: SessionLease | null = null;
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatFailureCount = 0;
  private parserProviderGeneration = 0;
  private parserFrameSequence = 0;
  private parserFrameAbortController: AbortController | null = null;
  private parserFrameActive: QueuedParserFrame | null = null;
  private parserFramePending: QueuedParserFrame | null = null;
  private parserFrameFailureCount = 0;
  private clientTelemetryReportSequence = 0;
  private clientTelemetryCounters = createInitialClientTelemetryCounters();
  private clientTelemetryRecentE2e: RemoteRecognitionClientTransportE2eSample[] =
    [];

  constructor(
    private readonly port: RemoteRecognitionControlPort,
    private readonly frameSource: RemoteRecognitionFrameProbeSource,
    private readonly client: RemoteRecognitionSetupClient,
    private readonly scheduler: Scheduler = defaultScheduler,
    private readonly monotonicNow: () => number = defaultMonotonicNow,
    parserFramePort: RemoteRecognitionParserFrameControlPort = port,
  ) {
    this.parserFramePort =
      client.channel === "preview" ? parserFramePort : port;
  }

  getSnapshot = (): RemoteRecognitionSessionSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  async start(
    accessCode: string,
    readinessConsentVersion: string | null,
  ): Promise<void> {
    if (
      readinessConsentVersion !==
      REMOTE_RECOGNITION_READINESS_CONSENT_VERSION
    ) {
      throw new RemoteRecognitionControlContractError(
        "invalid-request",
        "admission",
        false,
        null,
        "remote-recognition-readiness-consent-required",
      );
    }
    const clientInstanceId = this.client.getClientInstanceId().toLowerCase();
    const admissionAttemptId =
      this.client.createAdmissionAttemptId().toLowerCase();
    if (
      !isValidRemoteRecognitionClientUuid(clientInstanceId) ||
      !isValidRemoteRecognitionClientUuid(admissionAttemptId)
    ) {
      throw new RemoteRecognitionControlContractError(
        "invalid-request",
        "admission",
        false,
        null,
        "remote-recognition-client-identity-invalid",
      );
    }
    const fallbackBetaAlias =
      deriveRemoteRecognitionBetaAliasFromAccessCode(accessCode);
    // Captured before stop(): a non-idle stop resets the snapshot, which
    // would otherwise wipe consent recorded before the connection on retry.
    const preservedConsentVersion = this.snapshot.parserProvider.consentVersion;
    await this.stop();
    this.resetClientTelemetry();
    const generation = ++this.generation;
    const abortController = new AbortController();
    this.abortController = abortController;
    this.transition({
      phase: "checking",
      identity: this.snapshot.identity,
      serviceState: null,
      probe: null,
      probeDiagnostics: null,
      session: null,
      parserProvider: {
        ...createInitialParserProviderSnapshot(),
        // Consent recorded before the connection survives the setup flow.
        consentVersion: preservedConsentVersion,
      },
      parserFrames: createInitialParserFrameDiagnostics(),
      failure: null,
    });

    try {
      const status = await this.port.getStatus({
        signal: abortController.signal,
      });
      this.assertCurrent(generation);
      if (
        status.serviceState !== "available" &&
        status.serviceState !== "full"
      ) {
        throw serviceStateError(status.serviceState, status.retryAfterMs);
      }
      if (!status.frameAnalysisEnabled) {
        throw frameAnalysisUnavailableError();
      }

      this.transition({
        ...this.snapshot,
        phase: "reserving",
        serviceState: status.serviceState,
      });
      const admission = await this.port.createAdmission(
        createAdmissionRequest(
          accessCode,
          fallbackBetaAlias,
          clientInstanceId,
          admissionAttemptId,
          this.client,
        ),
        { signal: abortController.signal },
      );
      if (!this.isCurrent(generation)) {
        void this.port.cancelAdmission(
          admission.admissionId,
          admission.admissionToken,
        );
        return;
      }
      this.admission = {
        id: admission.admissionId,
        token: admission.admissionToken,
      };
      const admissionBetaAlias = resolveCanonicalBetaAlias({
        fallback: fallbackBetaAlias,
        canonical: admission.betaAlias,
        phase: "admission",
      });
      const admissionUsesEntitlementLease =
        admission.capabilities.entitlementLeaseVersion === 1;
      if (
        admissionUsesEntitlementLease &&
        (admission.connectionCode === null || admission.betaAlias === null)
      ) {
        throw new RemoteRecognitionControlContractError(
          "invalid-response",
          "admission",
          false,
          null,
          "remote-recognition-admission-correlation-missing",
        );
      }
      this.transition({
        ...this.snapshot,
        identity: admission.connectionCode && admissionBetaAlias
          ? {
              betaAlias: admissionBetaAlias,
              connectionCode: admission.connectionCode,
            }
          : null,
      });
      if (!admission.capabilities.frameAnalysisEnabled) {
        throw frameAnalysisUnavailableError();
      }

      this.transition({ ...this.snapshot, phase: "probing" });
      let probe: RemoteRecognitionFrameProbeResponse | null = null;
      for (let sequence = 1; sequence <= admission.probe.requiredRounds; sequence += 1) {
        const capture = await this.frameSource.captureFrame(sequence, {
          signal: abortController.signal,
        });
        const requestStartedAt = this.monotonicNow();
        probe = await this.port.probeAdmissionFrame(
          admission.admissionId,
          admission.admissionToken,
          capture.frame,
          { signal: abortController.signal },
        );
        const roundTripMs = elapsedMs(requestStartedAt, this.monotonicNow());
        this.assertCurrent(generation);
        assertFrameProbeRound(probe, capture.frame, admission.admissionId);
        this.transition({
          ...this.snapshot,
          phase: "probing",
          probe: probe.summary,
          probeDiagnostics: appendProbeDiagnostics(
            this.snapshot.probeDiagnostics,
            capture,
            probe,
            roundTripMs,
          ),
        });
      }
      this.assertCurrent(generation);
      if (!probe?.accepted) {
        throw new RemoteRecognitionControlContractError(
          "probe-failed",
          "probe",
          true,
          5_000,
          "remote-recognition-probe-rejected",
        );
      }

      this.transition({
        ...this.snapshot,
        phase: "activating",
        probe: probe.summary,
      });
      const session = await this.port.promoteAdmission(
        admission.admissionId,
        admission.admissionToken,
        { signal: abortController.signal },
      );
      if (!this.isCurrent(generation)) {
        void this.port.stopSession(session.sessionId, session.sessionToken);
        return;
      }
      let sessionBetaAlias: string | null;
      try {
        sessionBetaAlias = resolveCanonicalBetaAlias({
          fallback: admissionBetaAlias ?? fallbackBetaAlias,
          canonical: session.betaAlias,
          phase: "session",
        });
      } catch (error) {
        void this.port.stopSession(session.sessionId, session.sessionToken);
        throw error;
      }
      if (
        (session.capabilities.entitlementLeaseVersion === 1) !==
        admissionUsesEntitlementLease
      ) {
        void this.port.stopSession(session.sessionId, session.sessionToken);
        throw new RemoteRecognitionControlContractError(
          "invalid-response",
          "session",
          false,
          null,
          "remote-recognition-session-entitlement-capability-mismatch",
        );
      }
      if (
        admissionUsesEntitlementLease &&
        (session.connectionCode === null || session.betaAlias === null)
      ) {
        void this.port.stopSession(session.sessionId, session.sessionToken);
        throw new RemoteRecognitionControlContractError(
          "invalid-response",
          "session",
          false,
          null,
          "remote-recognition-session-correlation-missing",
        );
      }
      if (
        session.connectionCode !== null &&
        session.connectionCode !== admission.connectionCode
      ) {
        void this.port.stopSession(session.sessionId, session.sessionToken);
        throw new RemoteRecognitionControlContractError(
          "invalid-response",
          "session",
          false,
          null,
          "remote-recognition-session-connection-code-mismatch",
        );
      }
      if (!session.capabilities.frameAnalysisEnabled) {
        void this.port.stopSession(session.sessionId, session.sessionToken);
        throw frameAnalysisUnavailableError();
      }

      this.admission = null;
      this.session = {
        id: session.sessionId,
        token: session.sessionToken,
        heartbeatIntervalMs: session.heartbeatIntervalMs,
        clientTelemetryVersion:
          session.capabilities.clientTelemetryVersion ?? null,
      };
      this.abortController = null;
      this.heartbeatFailureCount = 0;
      this.transition({
        phase: "ready",
        identity:
          admission.connectionCode && sessionBetaAlias
            ? {
                betaAlias: sessionBetaAlias,
                connectionCode: admission.connectionCode,
              }
            : null,
        serviceState: "available",
        probe: probe.summary,
        probeDiagnostics: this.snapshot.probeDiagnostics,
        session: {
          expiresAt: session.expiresAt,
          heartbeatIntervalMs: session.heartbeatIntervalMs,
          modelSetId: session.modelSetId,
          frameAnalysisEnabled: session.capabilities.frameAnalysisEnabled,
        },
        parserProvider: {
          ...createInitialParserProviderSnapshot(),
          consentVersion: this.snapshot.parserProvider.consentVersion,
        },
        parserFrames: createInitialParserFrameDiagnostics(),
        failure: null,
      });
      this.scheduleHeartbeat(generation, session.heartbeatIntervalMs);
    } catch (error) {
      if (!this.isCurrent(generation)) {
        return;
      }
      this.abortController = null;
      const failure = normalizeFailure(error);
      await this.releaseLeases();
      if (this.isCurrent(generation)) {
        this.transition({
          ...this.snapshot,
          phase: "failed",
          session: null,
          failure,
        });
      }
    }
  }

  async stop(): Promise<void> {
    const wasIdle = this.snapshot.phase === "idle";
    const recentIdentity = this.snapshot.identity;
    const generation = ++this.generation;
    this.abortController?.abort();
    this.abortController = null;
    this.parserProviderGeneration += 1;
    this.parserFrameAbortController?.abort();
    this.parserFrameAbortController = null;
    this.parserFrameActive = null;
    this.rejectPendingParserFrame(
      new RemoteRecognitionParserFrameDroppedError({
        sampledAt: this.parserFramePending?.request.sampledAt ?? null,
        replacedBySampledAt: null,
      }),
    );
    this.parserFrameSequence = 0;
    this.parserFrameFailureCount = 0;
    this.clearHeartbeat();
    const hasLease = Boolean(this.admission || this.session);
    if (hasLease) {
      this.transition({ ...this.snapshot, phase: "stopping", failure: null });
    }
    await this.releaseLeases();
    if (this.isCurrent(generation) && !wasIdle) {
      this.transition({ ...INITIAL_SNAPSHOT, identity: recentIdentity });
    }
  }

  dispose(): void {
    void this.stop();
    this.listeners.clear();
  }

  setParserProviderConsent(consented: boolean): void {
    // Consent is a browser-local decision the user may record before any
    // session exists (the setup dialog collects it on the input page).
    // Enabling the provider stays gated on a ready session plus consent.
    if (!consented) {
      if (this.session && this.snapshot.phase === "ready") {
        this.disableParserProvider(true);
        return;
      }
      this.transition({
        ...this.snapshot,
        parserProvider: {
          ...this.snapshot.parserProvider,
          consentVersion: null,
        },
      });
      return;
    }
    this.transition({
      ...this.snapshot,
      parserProvider: {
        ...this.snapshot.parserProvider,
        consentVersion: REMOTE_RECOGNITION_PARSER_FRAME_CONSENT_VERSION,
      },
    });
  }

  setParserProviderEnabled(enabled: boolean): void {
    if (!enabled) {
      this.disableParserProvider(false);
      return;
    }
    if (
      !this.session ||
      this.snapshot.phase !== "ready" ||
      this.snapshot.parserProvider.consentVersion !==
        REMOTE_RECOGNITION_PARSER_FRAME_CONSENT_VERSION
    ) {
      throw new RemoteRecognitionControlContractError(
        "transport-not-enabled",
        "transport",
        false,
        null,
        "remote-recognition-parser-provider-consent-required",
      );
    }
    this.parserProviderGeneration += 1;
    this.transition({
      ...this.snapshot,
      parserProvider: {
        active: true,
        consentVersion: REMOTE_RECOGNITION_PARSER_FRAME_CONSENT_VERSION,
        generation: this.parserProviderGeneration,
      },
      parserFrames: createInitialParserFrameDiagnostics(),
    });
  }

  async failParserProvider(
    error: unknown,
    sampledAt: number | null = null,
  ): Promise<void> {
    const session = this.session;
    if (!session || this.snapshot.phase !== "ready") {
      return;
    }

    this.generation += 1;
    this.parserProviderGeneration += 1;
    this.recordUnavailableSample();
    if (this.parserFramePending) {
      this.recordUnavailableSample();
    }
    this.recordTerminalFallbackIfActive();
    this.parserFrameAbortController?.abort();
    this.parserFrameAbortController = null;
    this.parserFrameActive = null;
    this.rejectPendingParserFrame(
      new RemoteRecognitionParserFrameDroppedError({
        sampledAt: this.parserFramePending?.request.sampledAt ?? null,
        replacedBySampledAt: null,
      }),
    );
    this.clearHeartbeat();
    this.session = null;
    const failure = normalizeParserProviderClientFailure(error);
    this.transition({
      ...this.snapshot,
      phase: "failed",
      session: null,
      parserProvider: {
        active: false,
        consentVersion: null,
        generation: this.parserProviderGeneration,
      },
      parserFrames: {
        ...this.snapshot.parserFrames,
        failedFrames: this.snapshot.parserFrames.failedFrames + 1,
        lastSampledAt: sampledAt,
        lastError: limitText(failure.technicalMessage),
      },
      failure,
    });
    await Promise.allSettled([
      this.stopSession(session),
    ]);
  }

  analyzeParserFrame(
    request: RemoteRecognitionParserFrameProviderRequest,
  ): Promise<RemoteRecognitionParserFrameProviderResult> {
    if (
      !this.session ||
      this.snapshot.phase !== "ready" ||
      !this.snapshot.parserProvider.active ||
      this.snapshot.parserProvider.consentVersion !==
        REMOTE_RECOGNITION_PARSER_FRAME_CONSENT_VERSION
    ) {
      return Promise.reject(
        new RemoteRecognitionControlContractError(
          "transport-not-enabled",
          "transport",
          true,
          null,
          "remote-recognition-parser-session-not-ready",
        ),
      );
    }
    return new Promise((resolve, reject) => {
      const queued: QueuedParserFrame = {
        request,
        resolve,
        reject,
        unsettled: true,
      };
      if (this.parserFrameActive) {
        const replaced = this.parserFramePending;
        this.parserFramePending = queued;
        if (replaced) {
          replaced.unsettled = false;
          replaced.reject(
            new RemoteRecognitionParserFrameDroppedError({
              sampledAt: replaced.request.sampledAt,
              replacedBySampledAt: request.sampledAt,
            }),
          );
          this.recordUnavailableSample({ pendingReplacement: true });
          this.transition({
            ...this.snapshot,
            parserFrames: {
              ...this.snapshot.parserFrames,
              droppedFrames: this.snapshot.parserFrames.droppedFrames + 1,
            },
          });
        }
        return;
      }
      this.dispatchParserFrame(queued);
    });
  }

  private disableParserProvider(clearConsent: boolean): void {
    this.parserProviderGeneration += 1;
    this.parserFrameAbortController?.abort();
    this.parserFrameAbortController = null;
    this.parserFrameActive = null;
    this.rejectPendingParserFrame(
      new RemoteRecognitionParserFrameDroppedError({
        sampledAt: this.parserFramePending?.request.sampledAt ?? null,
        replacedBySampledAt: null,
      }),
    );
    this.parserFrameFailureCount = 0;
    this.transition({
      ...this.snapshot,
      parserProvider: {
        active: false,
        consentVersion: clearConsent
          ? null
          : this.snapshot.parserProvider.consentVersion,
        generation: this.parserProviderGeneration,
      },
    });
  }

  private scheduleHeartbeat(generation: number, intervalMs: number): void {
    this.clearHeartbeat();
    this.heartbeatTimer = this.scheduler.setTimeout(() => {
      void this.runHeartbeat(generation);
    }, intervalMs);
  }

  private dispatchParserFrame(queued: QueuedParserFrame): void {
    const session = this.session;
    const providerGeneration = this.parserProviderGeneration;
    if (
      !session ||
      this.snapshot.phase !== "ready" ||
      !this.snapshot.parserProvider.active ||
      this.snapshot.parserProvider.generation !== providerGeneration
    ) {
      queued.unsettled = false;
      queued.reject(
        new RemoteRecognitionControlContractError(
          "transport-not-enabled",
          "transport",
          true,
          null,
          "remote-recognition-parser-session-not-ready",
        ),
      );
      return;
    }
    const generation = this.generation;
    const sequence = ++this.parserFrameSequence;
    const abortController = new AbortController();
    this.parserFrameActive = queued;
    this.parserFrameAbortController = abortController;
    const startedAt = this.monotonicNow();

    void this.parserFramePort
      .analyzeSessionParserFrame(
        session.id,
        session.token,
        {
          sequence,
          sampledAt: queued.request.sampledAt,
          width: queued.request.width,
          height: queued.request.height,
          encodedVp8: queued.request.encodedVp8,
        },
        {
          signal: abortController.signal,
          ...(this.createClientTelemetryRequestOptions(session) ?? {}),
        },
      )
      .then((response) => {
        const requestElapsedMs = elapsedMs(startedAt, this.monotonicNow());
        if (
          !this.isCurrent(generation) ||
          this.session !== session ||
          this.parserProviderGeneration !== providerGeneration ||
          !this.snapshot.parserProvider.active
        ) {
          throw new RemoteRecognitionParserFrameDroppedError({
            sampledAt: queued.request.sampledAt,
            replacedBySampledAt: null,
          });
        }
        assertParserFrameResponse(
          response,
          {
            sequence,
            sampledAt: queued.request.sampledAt,
            width: queued.request.width,
            height: queued.request.height,
            encodedBytes: queued.request.encodedVp8.byteLength,
          },
          session.id,
        );
        const e2eMs = queued.request.encodeMs + requestElapsedMs;
        queued.unsettled = false;
        this.recordAcceptedResult(sequence, e2eMs);
        this.parserFrameFailureCount = 0;
        this.transition({
          ...this.snapshot,
          session: this.snapshot.session
            ? { ...this.snapshot.session, expiresAt: response.expiresAt }
            : null,
          parserFrames: {
            ...this.snapshot.parserFrames,
            successfulFrames: this.snapshot.parserFrames.successfulFrames + 1,
            lastE2eMs: roundMs(e2eMs),
            lastServerTotalMs: response.frame.timings.serverTotalMs,
            lastEncodedBytes: response.frame.encodedBytes,
            lastSampledAt: response.frame.sampledAt,
            lastError: null,
          },
        });
        queued.resolve({ response, e2eMs });
      })
      .catch((error) => {
        queued.unsettled = false;
        let rejection = error;
        const isStale =
          !this.isCurrent(generation) ||
          this.session !== session ||
          this.parserProviderGeneration !== providerGeneration ||
          abortController.signal.aborted;
        if (isStale) {
          rejection = new RemoteRecognitionParserFrameDroppedError({
            sampledAt: queued.request.sampledAt,
            replacedBySampledAt: null,
          });
        } else if (!(error instanceof RemoteRecognitionParserFrameDroppedError)) {
          const failure = normalizeFailure(error);
          this.recordUnavailableSample({ retryableFailure: failure.retryable });
          this.parserFrameFailureCount += 1;
          const parserFrames = {
            ...this.snapshot.parserFrames,
            failedFrames: this.snapshot.parserFrames.failedFrames + 1,
            lastSampledAt: queued.request.sampledAt,
            lastError: limitText(failure.technicalMessage),
          };
          if (
            isRecoverableParserFrameFailure(failure) &&
            this.parserFrameFailureCount <
              MAX_CONSECUTIVE_RETRYABLE_PARSER_FRAME_FAILURES
          ) {
            this.transition({
              ...this.snapshot,
              parserFrames,
            });
            rejection = new RemoteRecognitionParserFrameDroppedError({
              sampledAt: queued.request.sampledAt,
              replacedBySampledAt: null,
            });
          } else {
            if (this.parserFramePending) {
              this.recordUnavailableSample();
            }
            this.recordTerminalFallbackIfActive();
            this.clearHeartbeat();
            this.session = null;
            this.parserProviderGeneration += 1;
            void this.stopSession(session);
            this.transition({
              ...this.snapshot,
              phase: "failed",
              session: null,
              parserProvider: {
                active: false,
                consentVersion: null,
                generation: this.parserProviderGeneration,
              },
              parserFrames,
              failure,
            });
            this.rejectPendingParserFrame(error);
          }
        }
        queued.reject(rejection);
      })
      .finally(() => {
        if (this.parserFrameActive !== queued) {
          return;
        }
        this.parserFrameActive = null;
        if (this.parserFrameAbortController === abortController) {
          this.parserFrameAbortController = null;
        }
        const pending = this.parserFramePending;
        this.parserFramePending = null;
        if (
          pending &&
          this.isCurrent(generation) &&
          this.session === session &&
          this.parserProviderGeneration === providerGeneration &&
          this.snapshot.parserProvider.active
        ) {
          this.dispatchParserFrame(pending);
        } else if (pending) {
          pending.unsettled = false;
          pending.reject(
            new RemoteRecognitionParserFrameDroppedError({
              sampledAt: pending.request.sampledAt,
              replacedBySampledAt: null,
            }),
          );
        }
      });
  }

  private rejectPendingParserFrame(error: unknown): void {
    const pending = this.parserFramePending;
    this.parserFramePending = null;
    if (pending) {
      pending.unsettled = false;
    }
    pending?.reject(error);
  }

  private async runHeartbeat(generation: number): Promise<void> {
    const session = this.session;
    if (!session || !this.isCurrent(generation)) {
      return;
    }

    try {
      const telemetryOptions =
        this.createClientTelemetryRequestOptions(session);
      const heartbeat = telemetryOptions
        ? await this.port.heartbeatSession(
            session.id,
            session.token,
            telemetryOptions,
          )
        : await this.port.heartbeatSession(session.id, session.token);
      if (!this.isCurrent(generation) || this.session !== session) {
        return;
      }
      this.heartbeatFailureCount = 0;
      this.transition({
        ...this.snapshot,
        session: this.snapshot.session
          ? { ...this.snapshot.session, expiresAt: heartbeat.expiresAt }
          : null,
      });
      this.scheduleHeartbeat(generation, session.heartbeatIntervalMs);
    } catch (error) {
      if (!this.isCurrent(generation) || this.session !== session) {
        return;
      }
      const failure = normalizeFailure(error);
      this.heartbeatFailureCount += 1;
      if (failure.retryable && this.heartbeatFailureCount < 2) {
        this.scheduleHeartbeat(
          generation,
          Math.min(1_000, session.heartbeatIntervalMs),
        );
        return;
      }
      if (this.parserFrameActive?.unsettled) {
        this.parserFrameActive.unsettled = false;
        this.recordUnavailableSample();
      }
      if (this.parserFramePending) {
        this.recordUnavailableSample();
      }
      this.recordTerminalFallbackIfActive();
      this.session = null;
      this.parserProviderGeneration += 1;
      this.parserFrameAbortController?.abort();
      this.parserFrameAbortController = null;
      this.rejectPendingParserFrame(
        new RemoteRecognitionParserFrameDroppedError({
          sampledAt: this.parserFramePending?.request.sampledAt ?? null,
          replacedBySampledAt: null,
        }),
      );
      void this.stopSession(session);
      this.transition({
        ...this.snapshot,
        phase: "failed",
        session: null,
        parserProvider: {
          active: false,
          consentVersion: null,
          generation: this.parserProviderGeneration,
        },
        failure,
      });
    }
  }

  private async releaseLeases(): Promise<void> {
    const admission = this.admission;
    const session = this.session;
    this.admission = null;
    this.session = null;
    this.clearHeartbeat();

    await Promise.allSettled([
      admission
        ? this.port.cancelAdmission(admission.id, admission.token)
        : Promise.resolve(),
      session
        ? this.stopSession(session)
        : Promise.resolve(),
    ]);
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer === null) {
      return;
    }
    this.scheduler.clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private resetClientTelemetry(): void {
    this.clientTelemetryReportSequence = 0;
    this.clientTelemetryCounters = createInitialClientTelemetryCounters();
    this.clientTelemetryRecentE2e = [];
  }

  private recordAcceptedResult(
    frameSequence: number,
    transportE2eMs: number,
  ): void {
    this.clientTelemetryCounters.acceptedResults = incrementBoundedCounter(
      this.clientTelemetryCounters.acceptedResults,
    );
    this.clientTelemetryRecentE2e = [
      ...this.clientTelemetryRecentE2e,
      { frameSequence, transportE2eMs: roundMs(transportE2eMs) },
    ].slice(-REMOTE_RECOGNITION_CLIENT_TELEMETRY_MAX_RECENT_E2E_SAMPLES);
  }

  private recordUnavailableSample({
    pendingReplacement = false,
    retryableFailure = false,
  }: {
    pendingReplacement?: boolean;
    retryableFailure?: boolean;
  } = {}): void {
    this.clientTelemetryCounters.unavailableSamples = incrementBoundedCounter(
      this.clientTelemetryCounters.unavailableSamples,
    );
    if (pendingReplacement) {
      this.clientTelemetryCounters.pendingReplacements =
        incrementBoundedCounter(
          this.clientTelemetryCounters.pendingReplacements,
        );
    }
    if (retryableFailure) {
      this.clientTelemetryCounters.retryableFailures = incrementBoundedCounter(
        this.clientTelemetryCounters.retryableFailures,
      );
    }
  }

  private recordTerminalFallbackIfActive(): void {
    if (!this.snapshot.parserProvider.active) {
      return;
    }
    this.clientTelemetryCounters.terminalFallbacks = 1;
  }

  private createClientTelemetryRequestOptions(
    session: SessionLease,
  ):
    | Pick<RemoteRecognitionControlRequestOptions, "clientTelemetry">
    | undefined {
    if (
      session.clientTelemetryVersion !==
      REMOTE_RECOGNITION_CLIENT_TELEMETRY_VERSION
    ) {
      return undefined;
    }
    this.clientTelemetryReportSequence = incrementBoundedCounter(
      this.clientTelemetryReportSequence,
    );
    return {
      clientTelemetry: {
        version: REMOTE_RECOGNITION_CLIENT_TELEMETRY_VERSION,
        reportSequence: this.clientTelemetryReportSequence,
        counters: { ...this.clientTelemetryCounters },
        recentTransportE2e: this.clientTelemetryRecentE2e.map((sample) => ({
          ...sample,
        })),
      },
    };
  }

  private stopSession(session: SessionLease): Promise<unknown> {
    const telemetryOptions = this.createClientTelemetryRequestOptions(session);
    return telemetryOptions
      ? this.port.stopSession(session.id, session.token, telemetryOptions)
      : this.port.stopSession(session.id, session.token);
  }

  private transition(snapshot: RemoteRecognitionSessionSnapshot): void {
    this.snapshot = snapshot;
    for (const listener of this.listeners) {
      listener();
    }
  }

  private assertCurrent(generation: number): void {
    if (!this.isCurrent(generation)) {
      throw new SupersededSetupError();
    }
  }

  private isCurrent(generation: number): boolean {
    return this.generation === generation;
  }
}

function createInitialClientTelemetryCounters(): ClientTelemetryCounters {
  return {
    acceptedResults: 0,
    unavailableSamples: 0,
    pendingReplacements: 0,
    retryableFailures: 0,
    terminalFallbacks: 0,
  };
}

function incrementBoundedCounter(value: number): number {
  return Math.min(
    REMOTE_RECOGNITION_CLIENT_TELEMETRY_MAX_COUNTER,
    Math.max(0, Math.trunc(value)) + 1,
  );
}

function createAdmissionRequest(
  accessCode: string,
  betaAlias: string | null,
  clientInstanceId: string,
  admissionAttemptId: string,
  client: RemoteRecognitionSetupClient,
): RemoteRecognitionAdmissionRequest {
  return {
    contract: createRemoteRecognitionControlMarker(),
    accessCode: accessCode.trim(),
    client: {
      appBuild: client.appBuild,
      channel: client.channel,
      runtimeVersion: client.runtimeVersion,
      clientInstanceId,
      admissionAttemptId,
      ...(betaAlias ? { betaAlias } : {}),
    },
    requestedPipeline: REMOTE_RECOGNITION_CONTROL_PIPELINE,
    consent: {
      version: REMOTE_RECOGNITION_READINESS_CONSENT_VERSION,
      remoteFrameProcessing: true,
      normalFrameStorage: "none",
    },
  };
}

function resolveCanonicalBetaAlias({
  fallback,
  canonical,
  phase,
}: {
  fallback: string | null;
  canonical: string | null;
  phase: "admission" | "session";
}): string | null {
  if (canonical === null) {
    return fallback;
  }
  if (fallback !== null && canonical !== fallback) {
    throw new RemoteRecognitionControlContractError(
      "invalid-response",
      phase,
      false,
      null,
      `remote-recognition-${phase}-beta-alias-mismatch`,
    );
  }
  return canonical;
}

function assertFrameProbeRound(
  response: RemoteRecognitionFrameProbeResponse,
  frame: {
    sequence: number;
    sampledAt: number;
    width: number;
    height: number;
  },
  admissionId: string,
): void {
  if (
    response.admissionId !== admissionId ||
    response.round.round !== frame.sequence ||
    response.round.sampledAt !== frame.sampledAt ||
    response.round.width !== frame.width ||
    response.round.height !== frame.height ||
    response.summary.completedRounds !== frame.sequence
  ) {
    throw new RemoteRecognitionControlContractError(
      "invalid-response",
      "probe",
      false,
      null,
      "remote-recognition-frame-probe-response-mismatch",
    );
  }
}

function assertParserFrameResponse(
  response: RemoteRecognitionParserFrameResponse,
  frame: {
    sequence: number;
    sampledAt: number;
    width: number;
    height: number;
    encodedBytes: number;
  },
  sessionId: string,
): void {
  if (
    response.sessionId !== sessionId ||
    response.frame.sequence !== frame.sequence ||
    response.frame.sampledAt !== frame.sampledAt ||
    response.frame.width !== frame.width ||
    response.frame.height !== frame.height ||
    response.frame.encodedBytes !== frame.encodedBytes ||
    response.frame.parser.boxCount !== response.frame.boxes.length
  ) {
    throw new RemoteRecognitionControlContractError(
      "invalid-response",
      "transport",
      false,
      null,
      "remote-recognition-parser-frame-response-mismatch",
    );
  }
}

function appendProbeDiagnostics(
  previous: RemoteRecognitionProbeDiagnostics | null,
  capture: RemoteRecognitionFrameCapture,
  response: RemoteRecognitionFrameProbeResponse,
  roundTripMs: number,
): RemoteRecognitionProbeDiagnostics {
  const previousRounds = previous?.completedRounds ?? 0;
  const completedRounds = previousRounds + 1;
  const average = (previousAverage: number | undefined, current: number) =>
    ((previousAverage ?? 0) * previousRounds + current) / completedRounds;
  const round = response.round;

  return {
    completedRounds,
    parserModelId: round.parser.modelId,
    executionProviders: [...round.parser.executionProviders],
    averageCaptureMs: average(
      previous?.averageCaptureMs,
      capture.timings.captureMs,
    ),
    averageCompressionMs: average(
      previous?.averageCompressionMs,
      capture.timings.compressionMs,
    ),
    averageRoundTripMs: average(previous?.averageRoundTripMs, roundTripMs),
    averageEncodedBytes: average(
      previous?.averageEncodedBytes,
      round.encodedBytes,
    ),
    averageDecodeMs: average(previous?.averageDecodeMs, round.timings.decodeMs),
    averagePreprocessMs: average(
      previous?.averagePreprocessMs,
      round.timings.preprocessMs,
    ),
    averageInferenceMs: average(
      previous?.averageInferenceMs,
      round.timings.inferenceMs,
    ),
    averagePostprocessMs: average(
      previous?.averagePostprocessMs,
      round.timings.postprocessMs,
    ),
    averageServerTotalMs: average(
      previous?.averageServerTotalMs,
      round.timings.serverTotalMs,
    ),
  };
}

function isRecoverableParserFrameFailure(
  failure: RemoteRecognitionSetupFailure,
): boolean {
  return (
    failure.retryable &&
    [
      "network-error",
      "request-timeout",
      "service-unavailable",
      "probe-failed",
    ].includes(failure.code)
  );
}

function elapsedMs(startedAt: number, finishedAt: number): number {
  return Math.max(0, finishedAt - startedAt);
}

function roundMs(value: number): number {
  return Math.round(value * 10) / 10;
}

function limitText(value: string, maxLength = 500): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function frameAnalysisUnavailableError(): RemoteRecognitionControlContractError {
  return new RemoteRecognitionControlContractError(
    "transport-not-enabled",
    "probe",
    true,
    5_000,
    "remote-recognition-frame-analysis-unavailable",
  );
}

function serviceStateError(
  state: Exclude<RemoteRecognitionServiceState, "available">,
  retryAfterMs: number | null,
): RemoteRecognitionControlContractError {
  if (state === "full") {
    return new RemoteRecognitionControlContractError(
      "capacity-full",
      "admission",
      true,
      retryAfterMs,
      "remote-recognition-capacity-full",
    );
  }
  return new RemoteRecognitionControlContractError(
    "service-unavailable",
    "status",
    true,
    retryAfterMs,
    state === "maintenance"
      ? "remote-recognition-maintenance"
      : "remote-recognition-service-unavailable",
  );
}

function normalizeFailure(error: unknown): RemoteRecognitionSetupFailure {
  if (error instanceof RemoteRecognitionFrameProbeSourceError) {
    return {
      code: "probe-failed",
      phase: "probe",
      retryable: true,
      retryAfterMs: null,
      technicalMessage: error.message,
    };
  }
  if (error instanceof RemoteRecognitionControlContractError) {
    return {
      code: error.code,
      phase: error.phase,
      retryable: error.retryable,
      retryAfterMs: error.retryAfterMs,
      technicalMessage: error.message,
    };
  }
  return {
    code: "internal-error",
    phase: "session",
    retryable: false,
    retryAfterMs: null,
    technicalMessage:
      error instanceof Error
        ? error.message
        : "remote-recognition-unexpected-error",
  };
}

function normalizeParserProviderClientFailure(
  error: unknown,
): RemoteRecognitionSetupFailure {
  if (error instanceof RemoteRecognitionControlContractError) {
    return normalizeFailure(error);
  }
  return {
    code: "internal-error",
    phase: "transport",
    retryable: false,
    retryAfterMs: null,
    technicalMessage: limitText(
      error instanceof Error && error.message
        ? error.message
        : "remote-recognition-parser-client-transport-failed",
    ),
  };
}

class SupersededSetupError extends Error {}

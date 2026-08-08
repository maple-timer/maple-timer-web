import {
  REMOTE_RECOGNITION_WARM_TRACE_BROWSER_CLASSES,
  REMOTE_RECOGNITION_WARM_TRACE_BUFF_WAIT_LIMITS_US,
  REMOTE_RECOGNITION_WARM_TRACE_COMPLETED_LIMITS_US,
  REMOTE_RECOGNITION_WARM_TRACE_FEATURE_OWNERS,
  REMOTE_RECOGNITION_WARM_TRACE_OUTCOMES,
  REMOTE_RECOGNITION_WARM_TRACE_SCHEMA,
  REMOTE_RECOGNITION_WARM_TRACE_STAGES,
  REMOTE_RECOGNITION_WARM_TRACE_TARGETS,
  REMOTE_RECOGNITION_WARM_TRACE_VERSION,
  getRemoteRecognitionWarmTraceTargetOwner,
  validateRemoteRecognitionWarmTraceRecord,
  type RemoteRecognitionWarmTraceArmRequest,
  type RemoteRecognitionWarmTraceBrowserClass,
  type RemoteRecognitionWarmTraceBuffScheduleDeclaration,
  type RemoteRecognitionWarmTraceBuffScheduledWait,
  type RemoteRecognitionWarmTraceBuffSchedulerPort,
  type RemoteRecognitionWarmTraceBuffTemporalPort,
  type RemoteRecognitionWarmTraceBuffWaitAuthorization,
  type RemoteRecognitionWarmTraceBuffWaitPreparation,
  type RemoteRecognitionWarmTraceBuffWaitProof,
  type RemoteRecognitionWarmTraceCompletableFeatureStage,
  type RemoteRecognitionWarmTraceFeatureClaim,
  type RemoteRecognitionWarmTraceHandle,
  type RemoteRecognitionWarmTraceFeatureOwner,
  type RemoteRecognitionWarmTraceOutcome,
  type RemoteRecognitionWarmTracePort,
  type RemoteRecognitionWarmTraceRecord,
  type RemoteRecognitionWarmTraceSeries,
  type RemoteRecognitionWarmTraceFeatureStage,
  type RemoteRecognitionWarmTraceSharedStage,
  type RemoteRecognitionWarmTraceStage,
  type RemoteRecognitionWarmTraceTerminalOutcome,
} from "../../contracts/remote-recognition/remoteRecognitionWarmTrace";

export const REMOTE_RECOGNITION_WARM_TRACE_LIMITS = Object.freeze({
  armTimeoutMs: 12_000,
  activeTimeoutMs:
    REMOTE_RECOGNITION_WARM_TRACE_COMPLETED_LIMITS_US.activeExclusive / 1_000,
  hardWallTimeoutMs:
    REMOTE_RECOGNITION_WARM_TRACE_COMPLETED_LIMITS_US.wallExclusive / 1_000,
  completedRecordsPerSeries: 128,
  totalRecordsPerSeries: 160,
  records: 2_048,
});

export type RemoteRecognitionWarmTraceCollectorOptions = {
  browserClass: RemoteRecognitionWarmTraceBrowserClass;
  monotonicNowMs?: () => number;
  scheduleTimeout?: (callback: () => void, delayMs: number) => () => void;
};

type TraceState = {
  handle: RemoteRecognitionWarmTraceHandle;
  ordinal: number;
  series: Readonly<RemoteRecognitionWarmTraceSeries>;
  lastBoundaryAtUs: number | null;
  completedStageCount: number;
  stageDurationsUs: Record<RemoteRecognitionWarmTraceStage, number | null>;
  featureClaim: RemoteRecognitionWarmTraceFeatureClaim | null;
  buffWaitAuthorization: BuffWaitAuthorizationState | null;
  buffWaitPreparation: BuffWaitPreparationState | null;
  buffScheduledWait: BuffScheduledWaitState | null;
  cancelArmTimeout: (() => void) | null;
  cancelActiveTimeout: (() => void) | null;
  cancelHardWallTimeout: (() => void) | null;
  startedAtUs: number | null;
  activeDeadlineUs: number | null;
  hardWallDeadlineUs: number | null;
  physicalSampledAtMs: number | null;
};

type BuffWaitAuthorizationState = {
  value: RemoteRecognitionWarmTraceBuffWaitAuthorization;
  proof: RemoteRecognitionWarmTraceBuffWaitProof;
};

type BuffWaitPreparationState = {
  value: RemoteRecognitionWarmTraceBuffWaitPreparation;
  preparedAtUs: number;
  declaration: RemoteRecognitionWarmTraceBuffScheduleDeclaration;
};

type BuffScheduledWaitState = {
  value: RemoteRecognitionWarmTraceBuffScheduledWait;
  scheduledWaitUs: number;
  committedAtUs: number;
  nominalDueAtUs: number;
  excludedWaitUs: number;
  resumed: boolean;
};

export type RemoteRecognitionWarmTraceCollectorErrorCode =
  | "trace-already-armed"
  | "trace-collector-closed"
  | "trace-invalid-options"
  | "trace-record-limit";

export class RemoteRecognitionWarmTraceCollectorError extends Error {
  constructor(readonly code: RemoteRecognitionWarmTraceCollectorErrorCode) {
    super(code);
    this.name = "RemoteRecognitionWarmTraceCollectorError";
  }
}

export class RemoteRecognitionWarmTraceCollector implements RemoteRecognitionWarmTracePort {
  private readonly browserClass: RemoteRecognitionWarmTraceBrowserClass;
  private readonly monotonicNowMs: () => number;
  private readonly scheduleTimeout: (
    callback: () => void,
    delayMs: number,
  ) => () => void;
  private readonly records: RemoteRecognitionWarmTraceRecord[] = [];
  private readonly stateByHandle = new WeakMap<
    RemoteRecognitionWarmTraceHandle,
    TraceState
  >();
  private readonly stateByFeatureClaim = new WeakMap<
    RemoteRecognitionWarmTraceFeatureClaim,
    TraceState
  >();
  private readonly stateByBuffWaitAuthorization = new WeakMap<
    RemoteRecognitionWarmTraceBuffWaitAuthorization,
    TraceState
  >();
  private readonly stateByBuffWaitPreparation = new WeakMap<
    RemoteRecognitionWarmTraceBuffWaitPreparation,
    TraceState
  >();
  private readonly stateByBuffScheduledWait = new WeakMap<
    RemoteRecognitionWarmTraceBuffScheduledWait,
    TraceState
  >();
  private readonly buffTemporalPort: RemoteRecognitionWarmTraceBuffTemporalPort;
  private readonly buffSchedulerPort: RemoteRecognitionWarmTraceBuffSchedulerPort;
  private armed: TraceState | null = null;
  private active: TraceState | null = null;
  private nextOrdinal = 1;
  private closed = false;

  constructor(options: RemoteRecognitionWarmTraceCollectorOptions) {
    if (
      !options ||
      typeof options !== "object" ||
      !REMOTE_RECOGNITION_WARM_TRACE_BROWSER_CLASSES.includes(
        options.browserClass,
      ) ||
      (options.monotonicNowMs !== undefined &&
        typeof options.monotonicNowMs !== "function") ||
      (options.scheduleTimeout !== undefined &&
        typeof options.scheduleTimeout !== "function")
    ) {
      throw new RemoteRecognitionWarmTraceCollectorError(
        "trace-invalid-options",
      );
    }
    this.browserClass = options.browserClass;
    this.monotonicNowMs = options.monotonicNowMs ?? (() => performance.now());
    this.scheduleTimeout =
      options.scheduleTimeout ??
      ((callback, delayMs) => {
        const timeout = globalThis.setTimeout(callback, delayMs);
        return () => globalThis.clearTimeout(timeout);
      });
    this.buffTemporalPort = Object.freeze({
      authorizeBuffExpiryPlannedWait: (
        claim: RemoteRecognitionWarmTraceFeatureClaim,
        proof: RemoteRecognitionWarmTraceBuffWaitProof,
      ) => this.authorizeBuffExpiryPlannedWait(claim, proof),
    });
    this.buffSchedulerPort = Object.freeze({
      prepareBuffExpiryPlannedWait: (
        authorization: RemoteRecognitionWarmTraceBuffWaitAuthorization,
        declaration: RemoteRecognitionWarmTraceBuffScheduleDeclaration,
      ) => this.prepareBuffExpiryPlannedWait(authorization, declaration),
      commitBuffExpiryPlannedWait: (
        preparation: RemoteRecognitionWarmTraceBuffWaitPreparation,
      ) => this.commitBuffExpiryPlannedWait(preparation),
      resumeBuffExpiryPlannedWait: (
        scheduledWait: RemoteRecognitionWarmTraceBuffScheduledWait,
      ) => this.resumeBuffExpiryPlannedWait(scheduledWait),
      completeBuffExpiryPlannedWait: (
        scheduledWait: RemoteRecognitionWarmTraceBuffScheduledWait,
      ) => this.completeBuffExpiryPlannedWait(scheduledWait),
      terminateBuffExpiryPlannedWait: (
        scheduledWait: RemoteRecognitionWarmTraceBuffScheduledWait,
        outcome: RemoteRecognitionWarmTraceTerminalOutcome,
      ) => this.terminateBuffExpiryPlannedWait(scheduledWait, outcome),
    });
  }

  getBuffExpiryTemporalPort(): RemoteRecognitionWarmTraceBuffTemporalPort {
    return this.buffTemporalPort;
  }

  getBuffExpirySchedulerPort(): RemoteRecognitionWarmTraceBuffSchedulerPort {
    return this.buffSchedulerPort;
  }

  armNextDecisiveTick(request: RemoteRecognitionWarmTraceArmRequest): void {
    if (this.closed) {
      throw new RemoteRecognitionWarmTraceCollectorError(
        "trace-collector-closed",
      );
    }
    if (this.armed || this.active) {
      throw new RemoteRecognitionWarmTraceCollectorError("trace-already-armed");
    }
    assertArmRequest(request);
    const series = Object.freeze({
      target: request.target,
      provider: request.provider,
      browserClass: this.browserClass,
      loadTier: "v1-owner-one" as const,
    });
    if (
      this.records.length >= REMOTE_RECOGNITION_WARM_TRACE_LIMITS.records ||
      this.countSeriesRecords(series) >=
        REMOTE_RECOGNITION_WARM_TRACE_LIMITS.totalRecordsPerSeries ||
      this.countCompletedSeriesRecords(series) >=
        REMOTE_RECOGNITION_WARM_TRACE_LIMITS.completedRecordsPerSeries
    ) {
      throw new RemoteRecognitionWarmTraceCollectorError("trace-record-limit");
    }

    const state: TraceState = {
      handle: Object.freeze({}) as RemoteRecognitionWarmTraceHandle,
      ordinal: this.nextOrdinal,
      series,
      lastBoundaryAtUs: null,
      completedStageCount: 0,
      stageDurationsUs: createEmptyStageDurations(),
      featureClaim: null,
      buffWaitAuthorization: null,
      buffWaitPreparation: null,
      buffScheduledWait: null,
      cancelArmTimeout: null,
      cancelActiveTimeout: null,
      cancelHardWallTimeout: null,
      startedAtUs: null,
      activeDeadlineUs: null,
      hardWallDeadlineUs: null,
      physicalSampledAtMs: null,
    };
    this.armed = state;
    this.stateByHandle.set(state.handle, state);
    const cancelTimeout = this.createSafeTimeout(() => {
      this.guardPortCall(() => {
        if (this.armed === state) {
          this.finalize(state, "timed-out");
        }
        return true;
      });
    }, REMOTE_RECOGNITION_WARM_TRACE_LIMITS.armTimeoutMs);
    if (!cancelTimeout) {
      this.armed = null;
      this.stateByHandle.delete(state.handle);
      throw new RemoteRecognitionWarmTraceCollectorError(
        "trace-invalid-options",
      );
    }
    state.cancelArmTimeout = cancelTimeout;
    this.nextOrdinal += 1;
  }

  beginPhysicalSample(): RemoteRecognitionWarmTraceHandle | null {
    try {
      const state = this.armed;
      if (!state || this.active) {
        return null;
      }
      state.cancelArmTimeout?.();
      state.cancelArmTimeout = null;
      const startedAtUs = this.readMonotonicNowUs();
      if (startedAtUs === null) {
        this.finalize(state, "failed");
        return null;
      }
      this.armed = null;
      this.active = state;
      state.startedAtUs = startedAtUs;
      state.lastBoundaryAtUs = startedAtUs;
      state.activeDeadlineUs =
        startedAtUs +
        REMOTE_RECOGNITION_WARM_TRACE_COMPLETED_LIMITS_US.activeExclusive;
      state.hardWallDeadlineUs =
        startedAtUs +
        REMOTE_RECOGNITION_WARM_TRACE_COMPLETED_LIMITS_US.wallExclusive;
      const cancelActiveTimeout = this.createDeadlineTimeout(
        state,
        "active",
        state.activeDeadlineUs,
        startedAtUs,
      );
      if (!cancelActiveTimeout) {
        this.finalize(state, "failed");
        return null;
      }
      state.cancelActiveTimeout = cancelActiveTimeout;
      const cancelHardWallTimeout = this.createDeadlineTimeout(
        state,
        "hard-wall",
        state.hardWallDeadlineUs,
        startedAtUs,
      );
      if (!cancelHardWallTimeout) {
        cancelActiveTimeout();
        state.cancelActiveTimeout = null;
        this.finalize(state, "failed");
        return null;
      }
      state.cancelHardWallTimeout = cancelHardWallTimeout;
      return state.handle;
    } catch {
      const state = this.active ?? this.armed;
      if (state) {
        this.guardPortCall(() => {
          this.finalize(state, "failed");
          return false;
        });
      }
      return null;
    }
  }

  bindPhysicalSample(
    handle: RemoteRecognitionWarmTraceHandle,
    sampledAtMs: number,
  ): boolean {
    return this.guardPortCall(() => {
      const state = this.stateByHandle.get(handle);
      if (!state || this.active !== state || state.completedStageCount !== 0) {
        return false;
      }
      const nowUs = this.readNowWithinDeadlines(state);
      if (nowUs === null) {
        return false;
      }
      if (!isSafeNonnegativeInteger(sampledAtMs)) {
        this.finalizeAtCurrentStage(state, "failed");
        return false;
      }
      if (state.physicalSampledAtMs !== null) {
        if (state.physicalSampledAtMs === sampledAtMs) {
          return true;
        }
        this.finalizeAtCurrentStage(state, "failed");
        return false;
      }
      state.physicalSampledAtMs = sampledAtMs;
      return true;
    });
  }

  replacePendingPhysicalSample(
    handle: RemoteRecognitionWarmTraceHandle,
  ): boolean {
    return this.guardPortCall(() => {
      const state = this.stateByHandle.get(handle);
      if (!state || this.active !== state || state.completedStageCount !== 0) {
        return false;
      }
      if (!this.recordBoundary(state, "captureCropUs", false)) {
        this.finalize(state, "failed");
        return false;
      }
      this.finalize(state, "replaced");
      return true;
    });
  }

  getSeries(
    handle: RemoteRecognitionWarmTraceHandle,
  ): Readonly<RemoteRecognitionWarmTraceSeries> | null {
    try {
      return this.stateByHandle.get(handle)?.series ?? null;
    } catch {
      return null;
    }
  }

  claimFeatureOwner(
    handle: RemoteRecognitionWarmTraceHandle,
    owner: RemoteRecognitionWarmTraceFeatureOwner,
  ): RemoteRecognitionWarmTraceFeatureClaim | null {
    return this.guardPortCall(() => {
      const state = this.stateByHandle.get(handle);
      if (!state || this.active !== state) {
        return null;
      }
      const nowUs = this.readNowWithinDeadlines(state);
      if (nowUs === null) {
        return null;
      }
      if (
        !REMOTE_RECOGNITION_WARM_TRACE_FEATURE_OWNERS.includes(owner) ||
        getRemoteRecognitionWarmTraceTargetOwner(state.series.target) !==
          owner ||
        state.featureClaim !== null
      ) {
        return null;
      }
      if (
        state.completedStageCount !== 4 ||
        state.physicalSampledAtMs === null
      ) {
        this.finalize(state, "failed");
        return null;
      }
      const claim = Object.freeze({}) as RemoteRecognitionWarmTraceFeatureClaim;
      state.featureClaim = claim;
      this.stateByFeatureClaim.set(claim, state);
      return claim;
    }, null);
  }

  completeStage(
    handle: RemoteRecognitionWarmTraceHandle,
    stage: RemoteRecognitionWarmTraceSharedStage,
  ): boolean {
    return this.guardPortCall(() => {
      const state = this.active;
      if (!state || state.handle !== handle) {
        return false;
      }
      const nowUs = this.readNowWithinDeadlines(state);
      if (nowUs === null) {
        return false;
      }
      if (state.completedStageCount >= 4) {
        return false;
      }
      if (!isSharedWarmTraceStage(stage)) {
        return false;
      }
      const expectedStage =
        REMOTE_RECOGNITION_WARM_TRACE_STAGES[state.completedStageCount];
      if (stage !== expectedStage) {
        this.finalize(state, "failed");
        return false;
      }
      return this.recordBoundaryAt(state, stage, nowUs);
    });
  }

  completeZeroStage(
    handle: RemoteRecognitionWarmTraceHandle,
    stage: "encodeUs" | "remoteRoundTripUs",
  ): boolean {
    return this.guardPortCall(() => {
      const state = this.active;
      if (!state || state.handle !== handle) {
        return false;
      }
      const nowUs = this.readNowWithinDeadlines(state);
      if (nowUs === null) {
        return false;
      }
      if (state.completedStageCount >= 4) {
        return false;
      }
      const expectedStage =
        REMOTE_RECOGNITION_WARM_TRACE_STAGES[state.completedStageCount];
      if (
        state.series.provider !== "local" ||
        (stage !== "encodeUs" && stage !== "remoteRoundTripUs") ||
        stage !== expectedStage
      ) {
        this.finalize(state, "failed");
        return false;
      }
      state.stageDurationsUs[stage] = 0;
      state.completedStageCount += 1;
      return true;
    });
  }

  terminate(
    handle: RemoteRecognitionWarmTraceHandle,
    outcome: RemoteRecognitionWarmTraceTerminalOutcome,
  ): boolean {
    return this.guardPortCall(() => {
      const state = this.stateByHandle.get(handle);
      if (!state || (this.active !== state && this.armed !== state)) {
        return false;
      }
      if (
        this.active === state &&
        this.readNowWithinDeadlines(state) === null
      ) {
        return false;
      }
      if (this.active === state && state.completedStageCount >= 4) {
        return false;
      }
      if (!isWarmTraceTerminalOutcome(outcome)) {
        this.finalize(state, "failed");
        return false;
      }
      this.finalize(state, outcome);
      return true;
    });
  }

  terminateStage(
    handle: RemoteRecognitionWarmTraceHandle,
    stage: RemoteRecognitionWarmTraceSharedStage,
    outcome: RemoteRecognitionWarmTraceTerminalOutcome,
  ): boolean {
    return this.guardPortCall(() => {
      const state = this.stateByHandle.get(handle);
      if (!state || this.active !== state) {
        return false;
      }
      const nowUs = this.readNowWithinDeadlines(state);
      if (nowUs === null) {
        return false;
      }
      if (state.completedStageCount >= 4) {
        return false;
      }
      if (!isSharedWarmTraceStage(stage)) {
        return false;
      }
      const expectedStage =
        REMOTE_RECOGNITION_WARM_TRACE_STAGES[state.completedStageCount];
      if (stage !== expectedStage || !isWarmTraceTerminalOutcome(outcome)) {
        this.finalize(state, "failed");
        return false;
      }
      if (!this.recordBoundaryAt(state, stage, nowUs, false)) {
        this.finalize(state, "failed");
        return false;
      }
      this.finalize(state, outcome);
      return true;
    });
  }

  completeFeatureStage(
    claim: RemoteRecognitionWarmTraceFeatureClaim,
    stage: RemoteRecognitionWarmTraceCompletableFeatureStage,
  ): boolean {
    return this.guardPortCall(() => {
      const state = this.stateByFeatureClaim.get(claim);
      if (!state || this.active !== state) {
        return false;
      }
      const nowUs = this.readNowWithinDeadlines(state);
      if (nowUs === null) {
        return false;
      }
      if (!isCompletableFeatureWarmTraceStage(stage)) {
        return false;
      }
      if (
        stage === "scheduleUs" &&
        getRemoteRecognitionWarmTraceTargetOwner(state.series.target) ===
          "buff-expiry"
      ) {
        return false;
      }
      const expectedStage =
        REMOTE_RECOGNITION_WARM_TRACE_STAGES[state.completedStageCount];
      if (stage !== expectedStage) {
        this.finalize(state, "failed");
        return false;
      }
      return this.recordBoundaryAt(state, stage, nowUs);
    });
  }

  terminateFeatureStage(
    claim: RemoteRecognitionWarmTraceFeatureClaim,
    stage: RemoteRecognitionWarmTraceFeatureStage,
    outcome: RemoteRecognitionWarmTraceTerminalOutcome,
  ): boolean {
    return this.guardPortCall(() => {
      const state = this.stateByFeatureClaim.get(claim);
      if (!state || this.active !== state) {
        return false;
      }
      const nowUs = this.readNowWithinDeadlines(state);
      if (nowUs === null) {
        return false;
      }
      if (state.buffScheduledWait !== null || !isFeatureWarmTraceStage(stage)) {
        return false;
      }
      const expectedStage =
        REMOTE_RECOGNITION_WARM_TRACE_STAGES[state.completedStageCount];
      if (stage !== expectedStage || !isWarmTraceTerminalOutcome(outcome)) {
        this.finalize(state, "failed");
        return false;
      }
      if (!this.recordBoundaryAt(state, stage, nowUs, false)) {
        this.finalize(state, "failed");
        return false;
      }
      this.finalize(state, outcome);
      return true;
    });
  }

  terminateFeatureCurrentStage(
    claim: RemoteRecognitionWarmTraceFeatureClaim,
    outcome: RemoteRecognitionWarmTraceTerminalOutcome,
  ): boolean {
    return this.guardPortCall(() => {
      const state = this.stateByFeatureClaim.get(claim);
      if (!state || this.active !== state) {
        return false;
      }
      const nowUs = this.readNowWithinDeadlines(state);
      if (nowUs === null) {
        return false;
      }
      if (state.buffScheduledWait !== null) {
        return false;
      }
      if (!isWarmTraceTerminalOutcome(outcome)) {
        this.finalize(state, "failed");
        return false;
      }
      this.finalizeAtCurrentStageAt(state, outcome, nowUs);
      return true;
    });
  }

  completeFeature(claim: RemoteRecognitionWarmTraceFeatureClaim): boolean {
    return this.guardPortCall(() => {
      const state = this.stateByFeatureClaim.get(claim);
      if (!state || this.active !== state) {
        return false;
      }
      const nowUs = this.readNowWithinDeadlines(state);
      if (nowUs === null) {
        return false;
      }
      if (
        getRemoteRecognitionWarmTraceTargetOwner(state.series.target) ===
        "buff-expiry"
      ) {
        return false;
      }
      if (
        state.completedStageCount !==
          REMOTE_RECOGNITION_WARM_TRACE_STAGES.length - 1 ||
        !this.recordBoundaryAt(state, "playbackAcceptanceUs", nowUs, false)
      ) {
        if (this.active === state) {
          this.finalize(state, "failed");
        }
        return false;
      }
      this.finalize(state, "completed");
      return true;
    });
  }

  private authorizeBuffExpiryPlannedWait(
    claim: RemoteRecognitionWarmTraceFeatureClaim,
    proof: RemoteRecognitionWarmTraceBuffWaitProof,
  ): RemoteRecognitionWarmTraceBuffWaitAuthorization | null {
    return this.guardPortCall(() => {
      const state = this.stateByFeatureClaim.get(claim);
      if (!state || this.active !== state) {
        return null;
      }
      if (this.readNowWithinDeadlines(state) === null) {
        return null;
      }
      if (
        getRemoteRecognitionWarmTraceTargetOwner(state.series.target) !==
          "buff-expiry" ||
        state.completedStageCount !== 6 ||
        state.buffWaitAuthorization !== null ||
        state.buffWaitPreparation !== null ||
        state.buffScheduledWait !== null
      ) {
        return null;
      }
      if (
        state.physicalSampledAtMs === null ||
        !isValidBuffWaitProof(
          proof,
          state.series.target,
          state.physicalSampledAtMs,
        )
      ) {
        this.finalizeAtCurrentStage(state, "failed");
        return null;
      }
      const value = Object.freeze(
        {},
      ) as RemoteRecognitionWarmTraceBuffWaitAuthorization;
      state.buffWaitAuthorization = {
        value,
        proof: Object.freeze({ ...proof }),
      };
      this.stateByBuffWaitAuthorization.set(value, state);
      return value;
    }, null);
  }

  private prepareBuffExpiryPlannedWait(
    authorization: RemoteRecognitionWarmTraceBuffWaitAuthorization,
    declaration: RemoteRecognitionWarmTraceBuffScheduleDeclaration,
  ): RemoteRecognitionWarmTraceBuffWaitPreparation | null {
    return this.guardPortCall(() => {
      const state = this.stateByBuffWaitAuthorization.get(authorization);
      if (!state || this.active !== state) {
        return null;
      }
      const preparedAtUs = this.readNowWithinDeadlines(state);
      if (preparedAtUs === null) {
        return null;
      }
      if (
        state.buffWaitAuthorization?.value !== authorization ||
        state.completedStageCount !== 6
      ) {
        return null;
      }
      if (
        !isValidBuffScheduleDeclaration(
          declaration,
          state.buffWaitAuthorization.proof,
        )
      ) {
        this.finalizeAtCurrentStage(state, "failed");
        return null;
      }
      const value = Object.freeze(
        {},
      ) as RemoteRecognitionWarmTraceBuffWaitPreparation;
      state.buffWaitPreparation = {
        value,
        preparedAtUs,
        declaration: Object.freeze({ ...declaration }),
      };
      this.stateByBuffWaitPreparation.set(value, state);
      this.stateByBuffWaitAuthorization.delete(authorization);
      state.buffWaitAuthorization = null;
      return value;
    }, null);
  }

  private commitBuffExpiryPlannedWait(
    preparation: RemoteRecognitionWarmTraceBuffWaitPreparation,
  ): RemoteRecognitionWarmTraceBuffScheduledWait | null {
    return this.guardPortCall(() => {
      const state = this.stateByBuffWaitPreparation.get(preparation);
      if (!state || this.active !== state) {
        return null;
      }
      const committedAtUs = this.readNowWithinDeadlines(state);
      if (committedAtUs === null) {
        return null;
      }
      if (
        state.buffWaitPreparation?.value !== preparation ||
        state.completedStageCount !== 6
      ) {
        return null;
      }
      if (!this.recordBoundaryAt(state, "scheduleUs", committedAtUs, false)) {
        this.finalize(state, "failed");
        return null;
      }
      const scheduledWaitUs =
        state.buffWaitPreparation.declaration.delayMs * 1_000;
      const nominalDueAtUs =
        state.buffWaitPreparation.preparedAtUs + scheduledWaitUs;
      const remainingExcludedWaitUs = nominalDueAtUs - committedAtUs;
      if (
        remainingExcludedWaitUs <= 0 ||
        remainingExcludedWaitUs > scheduledWaitUs
      ) {
        this.finalize(state, "failed");
        return null;
      }
      const value = Object.freeze(
        {},
      ) as RemoteRecognitionWarmTraceBuffScheduledWait;
      state.buffScheduledWait = {
        value,
        scheduledWaitUs,
        committedAtUs,
        nominalDueAtUs,
        excludedWaitUs: 0,
        resumed: false,
      };
      this.stateByBuffScheduledWait.set(value, state);
      this.stateByBuffWaitPreparation.delete(preparation);
      state.buffWaitPreparation = null;
      if (!this.extendActiveTimeout(state, remainingExcludedWaitUs)) {
        this.finalizeAtCurrentStage(state, "failed");
        return null;
      }
      return value;
    }, null);
  }

  private resumeBuffExpiryPlannedWait(
    scheduledWait: RemoteRecognitionWarmTraceBuffScheduledWait,
  ): boolean {
    return this.guardPortCall(() => {
      const state = this.stateByBuffScheduledWait.get(scheduledWait);
      if (!state || this.active !== state) {
        return false;
      }
      const nowUs = this.readNowWithinDeadlines(state);
      if (nowUs === null) {
        return false;
      }
      if (
        state.buffScheduledWait?.value !== scheduledWait ||
        state.buffScheduledWait.resumed
      ) {
        return false;
      }
      if (nowUs < state.buffScheduledWait.nominalDueAtUs) {
        this.finalizeScheduledWaitAt(state, "failed", nowUs);
        return false;
      }
      state.buffScheduledWait.resumed = true;
      return true;
    });
  }

  private completeBuffExpiryPlannedWait(
    scheduledWait: RemoteRecognitionWarmTraceBuffScheduledWait,
  ): boolean {
    return this.guardPortCall(() => {
      const state = this.stateByBuffScheduledWait.get(scheduledWait);
      if (!state || this.active !== state) {
        return false;
      }
      const nowUs = this.readNowWithinDeadlines(state);
      if (nowUs === null) {
        return false;
      }
      if (state.buffScheduledWait?.value !== scheduledWait) {
        return false;
      }
      if (
        !state.buffScheduledWait.resumed ||
        nowUs < state.buffScheduledWait.nominalDueAtUs
      ) {
        this.finalizeScheduledWaitAt(state, "failed", nowUs);
        return false;
      }
      if (!this.recordScheduledPlaybackBoundaryAt(state, nowUs)) {
        this.finalize(state, "failed");
        return false;
      }
      this.finalize(state, "completed");
      return true;
    });
  }

  private terminateBuffExpiryPlannedWait(
    scheduledWait: RemoteRecognitionWarmTraceBuffScheduledWait,
    outcome: RemoteRecognitionWarmTraceTerminalOutcome,
  ): boolean {
    return this.guardPortCall(() => {
      const state = this.stateByBuffScheduledWait.get(scheduledWait);
      if (!state || this.active !== state) {
        return false;
      }
      const nowUs = this.readNowWithinDeadlines(state);
      if (nowUs === null) {
        return false;
      }
      if (state.buffScheduledWait?.value !== scheduledWait) {
        return false;
      }
      if (!isWarmTraceTerminalOutcome(outcome)) {
        this.finalizeAtCurrentStage(state, "failed");
        return false;
      }
      this.finalizeScheduledWaitAt(state, outcome, nowUs);
      return true;
    });
  }

  cancelSharedOpen(
    outcome: RemoteRecognitionWarmTraceTerminalOutcome,
  ): boolean {
    return this.guardPortCall(() => {
      const state = this.active ?? this.armed;
      if (!state) {
        return false;
      }
      if (this.active === state && state.completedStageCount >= 4) {
        return false;
      }
      if (!isWarmTraceTerminalOutcome(outcome)) {
        this.finalize(state, "failed");
        return false;
      }
      if (this.active === state) {
        this.finalizeAtCurrentStage(state, outcome);
      } else {
        this.finalize(state, outcome);
      }
      return true;
    });
  }

  cancelOpen(outcome: RemoteRecognitionWarmTraceTerminalOutcome): boolean {
    return this.guardPortCall(() => {
      const state = this.active ?? this.armed;
      if (!state) {
        return false;
      }
      if (!isWarmTraceTerminalOutcome(outcome)) {
        this.finalize(state, "failed");
        return false;
      }
      if (this.active === state) {
        this.finalizeAtCurrentStage(state, outcome);
      } else {
        this.finalize(state, outcome);
      }
      return true;
    });
  }

  snapshot(): readonly RemoteRecognitionWarmTraceRecord[] {
    return Object.freeze([...this.records]);
  }

  dispose(): void {
    this.cancelOpen("cancelled");
    this.closed = true;
  }

  private recordBoundary(
    state: TraceState,
    stage: RemoteRecognitionWarmTraceStage,
    failOnError = true,
  ): boolean {
    const nowUs = this.readNowWithinDeadlines(state);
    return nowUs === null
      ? this.failBoundary(state, failOnError)
      : this.recordBoundaryAt(state, stage, nowUs, failOnError);
  }

  private recordBoundaryAt(
    state: TraceState,
    stage: RemoteRecognitionWarmTraceStage,
    nowUs: number,
    failOnError = true,
  ): boolean {
    const durationUs =
      state.lastBoundaryAtUs === null ? null : nowUs - state.lastBoundaryAtUs;
    const completedTotalUs = REMOTE_RECOGNITION_WARM_TRACE_STAGES.slice(
      0,
      state.completedStageCount,
    ).reduce(
      (total, completedStage) =>
        total + (state.stageDurationsUs[completedStage] ?? 0),
      0,
    );
    if (
      state.lastBoundaryAtUs === null ||
      durationUs === null ||
      durationUs < 0 ||
      durationUs > 3_600_000_000 ||
      completedTotalUs + durationUs > 3_600_000_000
    ) {
      if (failOnError) {
        this.finalize(state, "failed");
      }
      return false;
    }
    state.stageDurationsUs[stage] = durationUs;
    state.lastBoundaryAtUs = nowUs;
    state.completedStageCount += 1;
    return true;
  }

  private failBoundary(state: TraceState, failOnError: boolean): false {
    if (failOnError) {
      this.finalize(state, "failed");
    }
    return false;
  }

  private recordScheduledPlaybackBoundaryAt(
    state: TraceState,
    nowUs: number,
  ): boolean {
    const wait = state.buffScheduledWait;
    if (
      !wait ||
      state.completedStageCount !== 7 ||
      nowUs < wait.nominalDueAtUs
    ) {
      return false;
    }
    const durationUs = nowUs - wait.nominalDueAtUs;
    const completedTotalUs = REMOTE_RECOGNITION_WARM_TRACE_STAGES.slice(
      0,
      state.completedStageCount,
    ).reduce(
      (total, completedStage) =>
        total + (state.stageDurationsUs[completedStage] ?? 0),
      0,
    );
    if (
      durationUs < 0 ||
      durationUs > 3_600_000_000 ||
      completedTotalUs + durationUs > 3_600_000_000
    ) {
      return false;
    }
    state.stageDurationsUs.playbackAcceptanceUs = durationUs;
    state.completedStageCount += 1;
    state.lastBoundaryAtUs = nowUs;
    wait.excludedWaitUs = wait.nominalDueAtUs - wait.committedAtUs;
    return true;
  }

  private finalizeScheduledWaitAt(
    state: TraceState,
    outcome: RemoteRecognitionWarmTraceTerminalOutcome,
    nowUs: number,
  ): void {
    if (!state.buffScheduledWait || state.completedStageCount !== 7) {
      this.finalize(state, outcome);
      return;
    }
    if (!this.settleScheduledWaitAt(state, nowUs)) {
      this.cleanupState(state);
      return;
    }
    this.finalize(state, outcome);
  }

  private settleScheduledWaitAt(state: TraceState, nowUs: number): boolean {
    const wait = state.buffScheduledWait;
    if (
      !wait ||
      state.completedStageCount !== 7 ||
      nowUs < wait.committedAtUs
    ) {
      return false;
    }
    if (nowUs < wait.nominalDueAtUs) {
      wait.excludedWaitUs = nowUs - wait.committedAtUs;
      state.stageDurationsUs.playbackAcceptanceUs = 0;
      state.completedStageCount += 1;
      state.lastBoundaryAtUs = nowUs;
      return true;
    }
    return this.recordScheduledPlaybackBoundaryAt(state, nowUs);
  }

  private extendActiveTimeout(
    state: TraceState,
    excludedWaitUs: number,
  ): boolean {
    if (state.activeDeadlineUs === null) {
      return false;
    }
    const nowUs = this.readNowWithinDeadlines(state);
    if (nowUs === null) {
      return false;
    }
    const activeDeadlineUs = state.activeDeadlineUs + excludedWaitUs;
    if (!Number.isSafeInteger(activeDeadlineUs)) {
      return false;
    }
    const delayUs = activeDeadlineUs - nowUs;
    if (delayUs <= 0) {
      return false;
    }
    const nextCancel = this.createDeadlineTimeout(
      state,
      "active",
      activeDeadlineUs,
      nowUs,
    );
    if (!nextCancel) {
      return false;
    }
    const previousCancel = state.cancelActiveTimeout;
    state.activeDeadlineUs = activeDeadlineUs;
    state.cancelActiveTimeout = nextCancel;
    previousCancel?.();
    return true;
  }

  private finalizeAtCurrentStage(
    state: TraceState,
    outcome: RemoteRecognitionWarmTraceTerminalOutcome,
  ): void {
    if (this.active !== state) {
      this.finalize(state, outcome);
      return;
    }
    const nowUs = this.readNowWithinDeadlines(state);
    if (nowUs === null) {
      return;
    }
    this.finalizeAtCurrentStageAt(state, outcome, nowUs);
  }

  private finalizeAtCurrentStageAt(
    state: TraceState,
    outcome: RemoteRecognitionWarmTraceTerminalOutcome,
    nowUs: number,
  ): void {
    if (this.active !== state) {
      this.finalize(state, outcome);
      return;
    }
    if (state.buffScheduledWait && state.completedStageCount === 7) {
      if (!this.settleScheduledWaitAt(state, nowUs)) {
        this.cleanupState(state);
        return;
      }
      this.finalize(state, outcome);
      return;
    }
    const stage =
      REMOTE_RECOGNITION_WARM_TRACE_STAGES[state.completedStageCount];
    if (!stage || !this.recordBoundaryAt(state, stage, nowUs, false)) {
      this.finalize(state, "failed");
      return;
    }
    this.finalize(state, outcome);
  }

  private finalize(
    state: TraceState,
    outcome: RemoteRecognitionWarmTraceOutcome,
  ): void {
    if (this.active !== state && this.armed !== state) {
      return;
    }
    let resolvedOutcome = outcome;
    if (state.buffScheduledWait && state.completedStageCount === 7) {
      const nowUs = this.readMonotonicNowUs();
      if (nowUs === null || !this.settleScheduledWaitAt(state, nowUs)) {
        this.cleanupState(state);
        return;
      }
      if (this.isAtOrPastDeadline(state, nowUs)) {
        resolvedOutcome = "timed-out";
      }
    }
    const completedStages = REMOTE_RECOGNITION_WARM_TRACE_STAGES.slice(
      0,
      state.completedStageCount,
    );
    const totalUs = completedStages.reduce(
      (total, stage) => total + (state.stageDurationsUs[stage] ?? 0),
      0,
    );
    const terminalStage =
      completedStages[completedStages.length - 1] ?? "collector";
    const waitMode = state.buffScheduledWait
      ? ("scheduler-planned-excluded" as const)
      : ("none" as const);
    const scheduledWaitUs = state.buffScheduledWait?.scheduledWaitUs ?? 0;
    const excludedWaitUs = state.buffScheduledWait?.excludedWaitUs ?? 0;
    const record = Object.freeze({
      schema: REMOTE_RECOGNITION_WARM_TRACE_SCHEMA,
      version: REMOTE_RECOGNITION_WARM_TRACE_VERSION,
      ordinal: state.ordinal,
      ...state.series,
      outcome: resolvedOutcome,
      terminalStage,
      waitMode,
      scheduledWaitUs,
      excludedWaitUs,
      stageDurationsUs: Object.freeze({ ...state.stageDurationsUs }),
      totalUs,
      wallTotalUs: totalUs + excludedWaitUs,
    });
    this.cleanupState(state);
    validateRemoteRecognitionWarmTraceRecord(record);
    this.records.push(record);
  }

  private guardPortCall(callback: () => boolean): boolean;
  private guardPortCall<T>(callback: () => T, fallback: T): T;
  private guardPortCall<T>(callback: () => T, fallback?: T): T | boolean {
    try {
      return callback();
    } catch {
      const state = this.active ?? this.armed;
      if (state) {
        try {
          this.finalize(state, "failed");
        } catch {
          this.cleanupState(state);
        }
      }
      return arguments.length >= 2 ? (fallback as T) : false;
    }
  }

  private countSeriesRecords(series: RemoteRecognitionWarmTraceSeries): number {
    return this.records.filter((record) => isSameSeries(record, series)).length;
  }

  private countCompletedSeriesRecords(
    series: RemoteRecognitionWarmTraceSeries,
  ): number {
    return this.records.filter(
      (record) =>
        record.outcome === "completed" && isSameSeries(record, series),
    ).length;
  }

  private cleanupState(state: TraceState): void {
    state.cancelArmTimeout?.();
    state.cancelActiveTimeout?.();
    state.cancelHardWallTimeout?.();
    state.cancelArmTimeout = null;
    state.cancelActiveTimeout = null;
    state.cancelHardWallTimeout = null;
    if (this.active === state) {
      this.active = null;
    }
    if (this.armed === state) {
      this.armed = null;
    }
    this.stateByHandle.delete(state.handle);
    if (state.featureClaim) {
      this.stateByFeatureClaim.delete(state.featureClaim);
    }
    if (state.buffWaitAuthorization) {
      this.stateByBuffWaitAuthorization.delete(
        state.buffWaitAuthorization.value,
      );
    }
    if (state.buffWaitPreparation) {
      this.stateByBuffWaitPreparation.delete(state.buffWaitPreparation.value);
    }
    if (state.buffScheduledWait) {
      this.stateByBuffScheduledWait.delete(state.buffScheduledWait.value);
    }
  }

  private readNowWithinDeadlines(state: TraceState): number | null {
    const nowUs = this.readMonotonicNowUs();
    if (nowUs === null) {
      this.finalize(state, "failed");
      return null;
    }
    if (this.isAtOrPastDeadline(state, nowUs)) {
      this.finalizeAtCurrentStageAt(state, "timed-out", nowUs);
      return null;
    }
    return nowUs;
  }

  private isAtOrPastDeadline(state: TraceState, nowUs: number): boolean {
    return (
      this.active === state &&
      ((state.activeDeadlineUs !== null && nowUs >= state.activeDeadlineUs) ||
        (state.hardWallDeadlineUs !== null &&
          nowUs >= state.hardWallDeadlineUs))
    );
  }

  private createDeadlineTimeout(
    state: TraceState,
    kind: "active" | "hard-wall",
    deadlineUs: number,
    nowUs: number,
  ): (() => void) | null {
    const delayUs = deadlineUs - nowUs;
    if (!Number.isSafeInteger(delayUs) || delayUs <= 0) {
      return null;
    }
    return this.createSafeTimeout(
      () => this.handleDeadlineWakeup(state, kind, deadlineUs),
      Math.ceil(delayUs / 1_000),
    );
  }

  private handleDeadlineWakeup(
    state: TraceState,
    kind: "active" | "hard-wall",
    scheduledDeadlineUs: number,
  ): void {
    this.guardPortCall(() => {
      if (this.active !== state) {
        return true;
      }
      const currentDeadlineUs =
        kind === "active" ? state.activeDeadlineUs : state.hardWallDeadlineUs;
      if (currentDeadlineUs !== scheduledDeadlineUs) {
        return true;
      }
      const nowUs = this.readMonotonicNowUs();
      if (nowUs === null) {
        this.finalize(state, "failed");
        return false;
      }
      if (nowUs < currentDeadlineUs) {
        const replacement = this.createDeadlineTimeout(
          state,
          kind,
          currentDeadlineUs,
          nowUs,
        );
        if (!replacement) {
          this.finalizeAtCurrentStageAt(state, "failed", nowUs);
          return false;
        }
        if (kind === "active") {
          state.cancelActiveTimeout = replacement;
        } else {
          state.cancelHardWallTimeout = replacement;
        }
        return true;
      }
      this.finalizeAtCurrentStageAt(state, "timed-out", nowUs);
      return true;
    });
  }

  private readMonotonicNowUs(): number | null {
    try {
      const milliseconds = this.monotonicNowMs();
      const microseconds = Math.round(milliseconds * 1_000);
      return Number.isSafeInteger(microseconds) && microseconds >= 0
        ? microseconds
        : null;
    } catch {
      return null;
    }
  }

  private createSafeTimeout(
    callback: () => void,
    delayMs: number,
  ): (() => void) | null {
    let ready = false;
    let firedSynchronously = false;
    let rawCancel: unknown;
    try {
      rawCancel = this.scheduleTimeout(() => {
        if (!ready) {
          firedSynchronously = true;
          return;
        }
        try {
          callback();
        } catch {
          // A scheduler callback must never escape into the app runtime.
        }
      }, delayMs);
    } catch {
      return null;
    }
    if (typeof rawCancel !== "function") {
      return null;
    }
    const cancel = () => {
      try {
        rawCancel();
      } catch {
        // Cancelling instrumentation must not change product behavior.
      }
    };
    if (firedSynchronously) {
      cancel();
      return null;
    }
    ready = true;
    return cancel;
  }
}

function createEmptyStageDurations(): Record<
  RemoteRecognitionWarmTraceStage,
  number | null
> {
  return Object.fromEntries(
    REMOTE_RECOGNITION_WARM_TRACE_STAGES.map((stage) => [stage, null]),
  ) as Record<RemoteRecognitionWarmTraceStage, number | null>;
}

function assertArmRequest(request: RemoteRecognitionWarmTraceArmRequest): void {
  if (
    !request ||
    typeof request !== "object" ||
    Array.isArray(request) ||
    Object.getPrototypeOf(request) !== Object.prototype ||
    Object.getOwnPropertySymbols(request).length > 0 ||
    Object.keys(request).sort().join("|") !== "provider|target" ||
    !REMOTE_RECOGNITION_WARM_TRACE_TARGETS.includes(request.target) ||
    (request.provider !== "local" && request.provider !== "remote")
  ) {
    throw new RemoteRecognitionWarmTraceCollectorError("trace-invalid-options");
  }
}

function isValidBuffWaitProof(
  proof: RemoteRecognitionWarmTraceBuffWaitProof,
  armedTarget: RemoteRecognitionWarmTraceSeries["target"],
  physicalSampledAtMs: number,
): boolean {
  if (
    !hasExactEnumerableDataKeys(proof, [
      "target",
      "trackId",
      "transition",
      "acceptedSeconds",
      "derivedSeconds",
      "sampledAtMs",
      "detectedAtMs",
      "expiresAtMs",
      "alertLeadSeconds",
      "alertedAtMs",
    ]) ||
    proof.target !== armedTarget ||
    getRemoteRecognitionWarmTraceTargetOwner(armedTarget) !== "buff-expiry" ||
    typeof proof.trackId !== "string" ||
    proof.trackId.length < 1 ||
    proof.trackId.length > 256 ||
    proof.transition !== "pending-to-confirmed" ||
    proof.acceptedSeconds !== 21 ||
    proof.derivedSeconds !== 21 ||
    !isSafeNonnegativeInteger(proof.sampledAtMs) ||
    proof.sampledAtMs !== physicalSampledAtMs ||
    proof.detectedAtMs !== proof.sampledAtMs ||
    !isSafeNonnegativeInteger(proof.expiresAtMs) ||
    proof.alertLeadSeconds !== 20 ||
    proof.alertedAtMs !== null
  ) {
    return false;
  }
  const remainingMs = proof.expiresAtMs - proof.sampledAtMs;
  const delayMs = remainingMs - 20_000;
  return (
    Math.round(remainingMs / 1_000) === 21 &&
    Number.isSafeInteger(delayMs) &&
    delayMs >=
      REMOTE_RECOGNITION_WARM_TRACE_BUFF_WAIT_LIMITS_US.minimumScheduled /
        1_000 &&
    delayMs <
      REMOTE_RECOGNITION_WARM_TRACE_BUFF_WAIT_LIMITS_US.maximumScheduledExclusive /
        1_000
  );
}

function isValidBuffScheduleDeclaration(
  declaration: RemoteRecognitionWarmTraceBuffScheduleDeclaration,
  proof: RemoteRecognitionWarmTraceBuffWaitProof,
): boolean {
  if (
    !hasExactEnumerableDataKeys(declaration, [
      "trackId",
      "sampledAtMs",
      "dueAtMs",
      "delayMs",
    ]) ||
    declaration.trackId !== proof.trackId ||
    declaration.sampledAtMs !== proof.sampledAtMs ||
    !isSafeNonnegativeInteger(declaration.dueAtMs) ||
    !isSafeNonnegativeInteger(declaration.delayMs)
  ) {
    return false;
  }
  const dueAtMs = proof.expiresAtMs - proof.alertLeadSeconds * 1_000;
  return (
    declaration.dueAtMs === dueAtMs &&
    declaration.delayMs === dueAtMs - proof.sampledAtMs
  );
}

function hasExactEnumerableDataKeys(
  value: unknown,
  expectedKeys: readonly string[],
): value is Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.getOwnPropertySymbols(value).length > 0
  ) {
    return false;
  }
  const actualKeys = Object.getOwnPropertyNames(value).sort();
  const sortedExpected = [...expectedKeys].sort();
  if (
    actualKeys.length !== sortedExpected.length ||
    actualKeys.some((key, index) => key !== sortedExpected[index])
  ) {
    return false;
  }
  return expectedKeys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return Boolean(
      descriptor && "value" in descriptor && descriptor.enumerable === true,
    );
  });
}

function isSafeNonnegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isSameSeries(
  record: RemoteRecognitionWarmTraceRecord,
  series: RemoteRecognitionWarmTraceSeries,
): boolean {
  return (
    record.target === series.target &&
    record.provider === series.provider &&
    record.browserClass === series.browserClass &&
    record.loadTier === series.loadTier
  );
}

function isWarmTraceTerminalOutcome(
  value: unknown,
): value is RemoteRecognitionWarmTraceTerminalOutcome {
  return (
    value !== "completed" &&
    REMOTE_RECOGNITION_WARM_TRACE_OUTCOMES.includes(
      value as RemoteRecognitionWarmTraceOutcome,
    )
  );
}

function isSharedWarmTraceStage(
  value: unknown,
): value is RemoteRecognitionWarmTraceSharedStage {
  return (
    value === "captureCropUs" ||
    value === "encodeUs" ||
    value === "remoteRoundTripUs" ||
    value === "responseProjectionUs"
  );
}

function isFeatureWarmTraceStage(
  value: unknown,
): value is RemoteRecognitionWarmTraceFeatureStage {
  return (
    value === "matcherOcrUs" ||
    value === "temporalDecisionUs" ||
    value === "scheduleUs" ||
    value === "playbackAcceptanceUs"
  );
}

function isCompletableFeatureWarmTraceStage(
  value: unknown,
): value is RemoteRecognitionWarmTraceCompletableFeatureStage {
  return (
    value === "matcherOcrUs" ||
    value === "temporalDecisionUs" ||
    value === "scheduleUs"
  );
}

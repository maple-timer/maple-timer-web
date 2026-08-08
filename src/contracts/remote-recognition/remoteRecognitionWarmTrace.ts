export const REMOTE_RECOGNITION_WARM_TRACE_SCHEMA =
  "maple-timer.remote-recognition-v1-artifact.warm-e2e";
export const REMOTE_RECOGNITION_WARM_TRACE_VERSION = 2;

export const REMOTE_RECOGNITION_WARM_TRACE_WAIT_MODES = [
  "none",
  "scheduler-planned-excluded",
] as const;

export const REMOTE_RECOGNITION_WARM_TRACE_BUFF_WAIT_LIMITS_US = Object.freeze({
  minimumScheduled: 500_000,
  maximumScheduledExclusive: 1_500_000,
});

export const REMOTE_RECOGNITION_WARM_TRACE_COMPLETED_LIMITS_US = Object.freeze({
  activeExclusive: 15_000_000,
  wallExclusive: 20_000_000,
});

export function isRemoteRecognitionWarmTraceCompletedWithinLimits(
  totalUs: number,
  wallTotalUs: number,
): boolean {
  return (
    totalUs <
      REMOTE_RECOGNITION_WARM_TRACE_COMPLETED_LIMITS_US.activeExclusive &&
    wallTotalUs <
      REMOTE_RECOGNITION_WARM_TRACE_COMPLETED_LIMITS_US.wallExclusive
  );
}

export const REMOTE_RECOGNITION_WARM_TRACE_TARGETS = [
  "janus",
  "hologram-graffiti-barrier",
  "fountain",
  "yein",
  "union-wealth",
  "union-luck",
  "potion",
  "exp-coupon",
  "special-core",
] as const;

export const REMOTE_RECOGNITION_WARM_TRACE_STAGES = [
  "captureCropUs",
  "encodeUs",
  "remoteRoundTripUs",
  "responseProjectionUs",
  "matcherOcrUs",
  "temporalDecisionUs",
  "scheduleUs",
  "playbackAcceptanceUs",
] as const;

export const REMOTE_RECOGNITION_WARM_TRACE_OUTCOMES = [
  "completed",
  "failed",
  "timed-out",
  "dropped",
  "replaced",
  "fallback",
  "cancelled",
  "suppressed",
] as const;

export const REMOTE_RECOGNITION_WARM_TRACE_BROWSER_CLASSES = [
  "chromium-local-headed",
  "chrome-stable-macos-arm64",
  "chrome-stable-macos-x64",
  "chrome-stable-windows-x64",
] as const;

export const REMOTE_RECOGNITION_WARM_TRACE_FEATURE_OWNERS = [
  "skill",
  "buff-expiry",
  "special-core",
] as const;

export type RemoteRecognitionWarmTraceTarget =
  (typeof REMOTE_RECOGNITION_WARM_TRACE_TARGETS)[number];
export type RemoteRecognitionWarmTraceStage =
  (typeof REMOTE_RECOGNITION_WARM_TRACE_STAGES)[number];
export type RemoteRecognitionWarmTraceSharedStage =
  "captureCropUs" | "encodeUs" | "remoteRoundTripUs" | "responseProjectionUs";
export type RemoteRecognitionWarmTraceFeatureStage =
  "matcherOcrUs" | "temporalDecisionUs" | "scheduleUs" | "playbackAcceptanceUs";
export type RemoteRecognitionWarmTraceCompletableFeatureStage = Exclude<
  RemoteRecognitionWarmTraceFeatureStage,
  "playbackAcceptanceUs"
>;
export type RemoteRecognitionWarmTraceOutcome =
  (typeof REMOTE_RECOGNITION_WARM_TRACE_OUTCOMES)[number];
export type RemoteRecognitionWarmTraceTerminalOutcome = Exclude<
  RemoteRecognitionWarmTraceOutcome,
  "completed"
>;
export type RemoteRecognitionWarmTraceBrowserClass =
  (typeof REMOTE_RECOGNITION_WARM_TRACE_BROWSER_CLASSES)[number];
export type RemoteRecognitionWarmTraceFeatureOwner =
  (typeof REMOTE_RECOGNITION_WARM_TRACE_FEATURE_OWNERS)[number];
export type RemoteRecognitionWarmTraceWaitMode =
  (typeof REMOTE_RECOGNITION_WARM_TRACE_WAIT_MODES)[number];

const REMOTE_RECOGNITION_WARM_TRACE_TARGET_OWNERS = Object.freeze({
  janus: "skill",
  "hologram-graffiti-barrier": "skill",
  fountain: "skill",
  yein: "skill",
  "union-wealth": "buff-expiry",
  "union-luck": "buff-expiry",
  potion: "buff-expiry",
  "exp-coupon": "buff-expiry",
  "special-core": "special-core",
} satisfies Record<
  RemoteRecognitionWarmTraceTarget,
  RemoteRecognitionWarmTraceFeatureOwner
>);

export function getRemoteRecognitionWarmTraceTargetOwner(
  target: RemoteRecognitionWarmTraceTarget,
): RemoteRecognitionWarmTraceFeatureOwner {
  return REMOTE_RECOGNITION_WARM_TRACE_TARGET_OWNERS[target];
}

declare const remoteRecognitionWarmTraceHandleBrand: unique symbol;
declare const remoteRecognitionWarmTraceFeatureClaimBrand: unique symbol;
declare const remoteRecognitionWarmTraceBuffWaitAuthorizationBrand: unique symbol;
declare const remoteRecognitionWarmTraceBuffWaitPreparationBrand: unique symbol;
declare const remoteRecognitionWarmTraceBuffScheduledWaitBrand: unique symbol;
const remoteRecognitionWarmTraceHandleProperty = Symbol(
  "maple-timer.remote-recognition-warm-trace-handle",
);

export type RemoteRecognitionWarmTraceHandle = Readonly<{
  readonly [remoteRecognitionWarmTraceHandleBrand]: true;
}>;
export type RemoteRecognitionWarmTraceFeatureClaim = Readonly<{
  readonly [remoteRecognitionWarmTraceFeatureClaimBrand]: true;
}>;
export type RemoteRecognitionWarmTraceBuffWaitAuthorization = Readonly<{
  readonly [remoteRecognitionWarmTraceBuffWaitAuthorizationBrand]: true;
}>;
export type RemoteRecognitionWarmTraceBuffWaitPreparation = Readonly<{
  readonly [remoteRecognitionWarmTraceBuffWaitPreparationBrand]: true;
}>;
export type RemoteRecognitionWarmTraceBuffScheduledWait = Readonly<{
  readonly [remoteRecognitionWarmTraceBuffScheduledWaitBrand]: true;
}>;

export function attachRemoteRecognitionWarmTraceHandle(
  carrier: object,
  handle: RemoteRecognitionWarmTraceHandle,
): boolean {
  try {
    const existing = Object.getOwnPropertyDescriptor(
      carrier,
      remoteRecognitionWarmTraceHandleProperty,
    );
    if (existing) {
      return (
        existing.value === handle &&
        existing.enumerable === false &&
        existing.writable === false &&
        existing.configurable === false
      );
    }
    Object.defineProperty(carrier, remoteRecognitionWarmTraceHandleProperty, {
      value: handle,
      enumerable: false,
      writable: false,
      configurable: false,
    });
    return true;
  } catch {
    return false;
  }
}

export function getRemoteRecognitionWarmTraceHandle(
  carrier: unknown,
): RemoteRecognitionWarmTraceHandle | null {
  if (
    carrier === null ||
    (typeof carrier !== "object" && typeof carrier !== "function")
  ) {
    return null;
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(
      carrier,
      remoteRecognitionWarmTraceHandleProperty,
    );
    const handle =
      descriptor && "value" in descriptor ? descriptor.value : null;
    return descriptor?.enumerable === false &&
      descriptor.writable === false &&
      descriptor.configurable === false &&
      handle !== null &&
      typeof handle === "object"
      ? (handle as RemoteRecognitionWarmTraceHandle)
      : null;
  } catch {
    return null;
  }
}

export type RemoteRecognitionWarmTraceSeries = {
  target: RemoteRecognitionWarmTraceTarget;
  provider: "local" | "remote";
  browserClass: RemoteRecognitionWarmTraceBrowserClass;
  loadTier: "v1-owner-one";
};

export type RemoteRecognitionWarmTraceArmRequest = Pick<
  RemoteRecognitionWarmTraceSeries,
  "target" | "provider"
>;

export type RemoteRecognitionWarmTraceBuffWaitProof = Readonly<{
  target: Extract<
    RemoteRecognitionWarmTraceTarget,
    "union-wealth" | "union-luck" | "potion" | "exp-coupon"
  >;
  trackId: string;
  transition: "pending-to-confirmed";
  acceptedSeconds: 21;
  derivedSeconds: 21;
  sampledAtMs: number;
  detectedAtMs: number;
  expiresAtMs: number;
  alertLeadSeconds: 20;
  alertedAtMs: null;
}>;

export type RemoteRecognitionWarmTraceBuffScheduleDeclaration = Readonly<{
  trackId: string;
  sampledAtMs: number;
  dueAtMs: number;
  delayMs: number;
}>;

export type RemoteRecognitionWarmTraceRecord = {
  schema: typeof REMOTE_RECOGNITION_WARM_TRACE_SCHEMA;
  version: typeof REMOTE_RECOGNITION_WARM_TRACE_VERSION;
  ordinal: number;
  target: RemoteRecognitionWarmTraceTarget;
  provider: RemoteRecognitionWarmTraceSeries["provider"];
  browserClass: RemoteRecognitionWarmTraceBrowserClass;
  loadTier: "v1-owner-one";
  outcome: RemoteRecognitionWarmTraceOutcome;
  terminalStage: "collector" | RemoteRecognitionWarmTraceStage;
  waitMode: RemoteRecognitionWarmTraceWaitMode;
  scheduledWaitUs: number;
  excludedWaitUs: number;
  stageDurationsUs: Readonly<
    Record<RemoteRecognitionWarmTraceStage, number | null>
  >;
  totalUs: number;
  wallTotalUs: number;
};

export interface RemoteRecognitionWarmTracePort {
  beginPhysicalSample(): RemoteRecognitionWarmTraceHandle | null;
  bindPhysicalSample(
    handle: RemoteRecognitionWarmTraceHandle,
    sampledAtMs: number,
  ): boolean;
  replacePendingPhysicalSample(
    handle: RemoteRecognitionWarmTraceHandle,
  ): boolean;
  getSeries(
    handle: RemoteRecognitionWarmTraceHandle,
  ): Readonly<RemoteRecognitionWarmTraceSeries> | null;
  claimFeatureOwner(
    handle: RemoteRecognitionWarmTraceHandle,
    owner: RemoteRecognitionWarmTraceFeatureOwner,
  ): RemoteRecognitionWarmTraceFeatureClaim | null;
  completeStage(
    handle: RemoteRecognitionWarmTraceHandle,
    stage: RemoteRecognitionWarmTraceSharedStage,
  ): boolean;
  completeZeroStage(
    handle: RemoteRecognitionWarmTraceHandle,
    stage: "encodeUs" | "remoteRoundTripUs",
  ): boolean;
  terminateStage(
    handle: RemoteRecognitionWarmTraceHandle,
    stage: RemoteRecognitionWarmTraceSharedStage,
    outcome: RemoteRecognitionWarmTraceTerminalOutcome,
  ): boolean;
  completeFeatureStage(
    claim: RemoteRecognitionWarmTraceFeatureClaim,
    stage: RemoteRecognitionWarmTraceCompletableFeatureStage,
  ): boolean;
  terminateFeatureStage(
    claim: RemoteRecognitionWarmTraceFeatureClaim,
    stage: RemoteRecognitionWarmTraceFeatureStage,
    outcome: RemoteRecognitionWarmTraceTerminalOutcome,
  ): boolean;
  terminateFeatureCurrentStage(
    claim: RemoteRecognitionWarmTraceFeatureClaim,
    outcome: RemoteRecognitionWarmTraceTerminalOutcome,
  ): boolean;
  completeFeature(claim: RemoteRecognitionWarmTraceFeatureClaim): boolean;
  terminate(
    handle: RemoteRecognitionWarmTraceHandle,
    outcome: RemoteRecognitionWarmTraceTerminalOutcome,
  ): boolean;
  cancelSharedOpen(outcome: RemoteRecognitionWarmTraceTerminalOutcome): boolean;
  cancelOpen(outcome: RemoteRecognitionWarmTraceTerminalOutcome): boolean;
}

export type RemoteRecognitionWarmTraceSharedPort = Pick<
  RemoteRecognitionWarmTracePort,
  | "getSeries"
  | "completeStage"
  | "completeZeroStage"
  | "terminateStage"
  | "cancelSharedOpen"
>;

export type RemoteRecognitionWarmTraceFeaturePort = Pick<
  RemoteRecognitionWarmTracePort,
  | "getSeries"
  | "claimFeatureOwner"
  | "completeFeatureStage"
  | "terminateFeatureStage"
  | "terminateFeatureCurrentStage"
  | "completeFeature"
>;

export interface RemoteRecognitionWarmTraceBuffTemporalPort {
  authorizeBuffExpiryPlannedWait(
    claim: RemoteRecognitionWarmTraceFeatureClaim,
    proof: RemoteRecognitionWarmTraceBuffWaitProof,
  ): RemoteRecognitionWarmTraceBuffWaitAuthorization | null;
}

export interface RemoteRecognitionWarmTraceBuffSchedulerPort {
  prepareBuffExpiryPlannedWait(
    authorization: RemoteRecognitionWarmTraceBuffWaitAuthorization,
    declaration: RemoteRecognitionWarmTraceBuffScheduleDeclaration,
  ): RemoteRecognitionWarmTraceBuffWaitPreparation | null;
  commitBuffExpiryPlannedWait(
    preparation: RemoteRecognitionWarmTraceBuffWaitPreparation,
  ): RemoteRecognitionWarmTraceBuffScheduledWait | null;
  resumeBuffExpiryPlannedWait(
    scheduledWait: RemoteRecognitionWarmTraceBuffScheduledWait,
  ): boolean;
  completeBuffExpiryPlannedWait(
    scheduledWait: RemoteRecognitionWarmTraceBuffScheduledWait,
  ): boolean;
  terminateBuffExpiryPlannedWait(
    scheduledWait: RemoteRecognitionWarmTraceBuffScheduledWait,
    outcome: RemoteRecognitionWarmTraceTerminalOutcome,
  ): boolean;
}

export class RemoteRecognitionWarmTraceContractError extends Error {
  constructor() {
    super("remote-recognition-warm-trace-invalid");
    this.name = "RemoteRecognitionWarmTraceContractError";
  }
}

export function validateRemoteRecognitionWarmTraceRecord(
  value: unknown,
): RemoteRecognitionWarmTraceRecord {
  const record = assertPlainObject(value);
  assertExactKeys(record, [
    "schema",
    "version",
    "ordinal",
    "target",
    "provider",
    "browserClass",
    "loadTier",
    "outcome",
    "terminalStage",
    "waitMode",
    "scheduledWaitUs",
    "excludedWaitUs",
    "stageDurationsUs",
    "totalUs",
    "wallTotalUs",
  ]);
  if (
    record.schema !== REMOTE_RECOGNITION_WARM_TRACE_SCHEMA ||
    record.version !== REMOTE_RECOGNITION_WARM_TRACE_VERSION ||
    !isSafeIntegerInRange(record.ordinal, 1, 2_048) ||
    !REMOTE_RECOGNITION_WARM_TRACE_TARGETS.includes(
      record.target as RemoteRecognitionWarmTraceTarget,
    ) ||
    (record.provider !== "local" && record.provider !== "remote") ||
    !REMOTE_RECOGNITION_WARM_TRACE_BROWSER_CLASSES.includes(
      record.browserClass as RemoteRecognitionWarmTraceBrowserClass,
    ) ||
    record.loadTier !== "v1-owner-one" ||
    !REMOTE_RECOGNITION_WARM_TRACE_OUTCOMES.includes(
      record.outcome as RemoteRecognitionWarmTraceOutcome,
    ) ||
    !REMOTE_RECOGNITION_WARM_TRACE_WAIT_MODES.includes(
      record.waitMode as RemoteRecognitionWarmTraceWaitMode,
    ) ||
    !isSafeIntegerInRange(record.scheduledWaitUs, 0, 1_499_999) ||
    !isSafeIntegerInRange(record.excludedWaitUs, 0, 1_499_999)
  ) {
    invalidWarmTrace();
  }

  const durations = assertPlainObject(record.stageDurationsUs);
  assertExactKeys(durations, REMOTE_RECOGNITION_WARM_TRACE_STAGES);
  let foundNull = false;
  let totalUs = 0;
  let terminalStage: "collector" | RemoteRecognitionWarmTraceStage =
    "collector";
  for (const stage of REMOTE_RECOGNITION_WARM_TRACE_STAGES) {
    const duration = durations[stage];
    if (duration === null) {
      foundNull = true;
      continue;
    }
    if (foundNull || !isSafeIntegerInRange(duration, 0, 3_600_000_000)) {
      invalidWarmTrace();
    }
    totalUs += duration as number;
    if (!Number.isSafeInteger(totalUs)) {
      invalidWarmTrace();
    }
    terminalStage = stage;
  }
  if (
    record.terminalStage !== terminalStage ||
    record.totalUs !== totalUs ||
    !isSafeIntegerInRange(record.totalUs, 0, 3_600_000_000) ||
    !isSafeIntegerInRange(record.wallTotalUs, 0, 3_600_000_000) ||
    record.wallTotalUs !== record.totalUs + record.excludedWaitUs ||
    (record.outcome === "completed" && foundNull)
  ) {
    invalidWarmTrace();
  }
  const isBuffTarget =
    getRemoteRecognitionWarmTraceTargetOwner(
      record.target as RemoteRecognitionWarmTraceTarget,
    ) === "buff-expiry";
  if (record.waitMode === "none") {
    if (record.scheduledWaitUs !== 0 || record.excludedWaitUs !== 0) {
      invalidWarmTrace();
    }
  } else if (
    !isBuffTarget ||
    !isSafeIntegerInRange(
      record.scheduledWaitUs,
      REMOTE_RECOGNITION_WARM_TRACE_BUFF_WAIT_LIMITS_US.minimumScheduled,
      REMOTE_RECOGNITION_WARM_TRACE_BUFF_WAIT_LIMITS_US.maximumScheduledExclusive -
        1,
    ) ||
    record.scheduledWaitUs % 1_000 !== 0 ||
    record.excludedWaitUs > record.scheduledWaitUs ||
    REMOTE_RECOGNITION_WARM_TRACE_STAGES.slice(0, 7).some(
      (stage) => durations[stage] === null,
    ) ||
    durations.playbackAcceptanceUs === null
  ) {
    invalidWarmTrace();
  }
  if (
    record.outcome === "completed" &&
    (!isRemoteRecognitionWarmTraceCompletedWithinLimits(
      record.totalUs as number,
      record.wallTotalUs as number,
    ) ||
      (isBuffTarget &&
        (record.waitMode !== "scheduler-planned-excluded" ||
          record.excludedWaitUs <= 0 ||
          record.scheduledWaitUs - record.excludedWaitUs >
            (durations.scheduleUs as number))) ||
      (!isBuffTarget && record.waitMode !== "none"))
  ) {
    invalidWarmTrace();
  }
  return value as RemoteRecognitionWarmTraceRecord;
}

function assertPlainObject(value: unknown): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.getOwnPropertySymbols(value).length > 0
  ) {
    invalidWarmTrace();
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): void {
  const actual = Object.getOwnPropertyNames(value).sort();
  const expected = [...expectedKeys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    invalidWarmTrace();
  }
  for (const key of expectedKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      !descriptor ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true
    ) {
      invalidWarmTrace();
    }
  }
}

function isSafeIntegerInRange(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    Number.isSafeInteger(value) &&
    (value as number) >= minimum &&
    (value as number) <= maximum
  );
}

function invalidWarmTrace(): never {
  throw new RemoteRecognitionWarmTraceContractError();
}

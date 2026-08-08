import { describe, expect, it, vi } from "vitest";
import {
  attachRemoteRecognitionWarmTraceHandle,
  getRemoteRecognitionWarmTraceTargetOwner,
  getRemoteRecognitionWarmTraceHandle,
  REMOTE_RECOGNITION_WARM_TRACE_COMPLETED_LIMITS_US,
  REMOTE_RECOGNITION_WARM_TRACE_SCHEMA,
  REMOTE_RECOGNITION_WARM_TRACE_STAGES,
  REMOTE_RECOGNITION_WARM_TRACE_VERSION,
  RemoteRecognitionWarmTraceContractError,
  validateRemoteRecognitionWarmTraceRecord,
  type RemoteRecognitionWarmTraceRecord,
  type RemoteRecognitionWarmTraceHandle,
} from "./remoteRecognitionWarmTrace";

function makeCompletedRecord(
  overrides: Partial<RemoteRecognitionWarmTraceRecord> = {},
): RemoteRecognitionWarmTraceRecord {
  const stageDurationsUs = Object.fromEntries(
    REMOTE_RECOGNITION_WARM_TRACE_STAGES.map((stage, index) => [
      stage,
      (index + 1) * 1_000,
    ]),
  ) as RemoteRecognitionWarmTraceRecord["stageDurationsUs"];
  return {
    schema: REMOTE_RECOGNITION_WARM_TRACE_SCHEMA,
    version: REMOTE_RECOGNITION_WARM_TRACE_VERSION,
    ordinal: 1,
    target: "janus",
    provider: "remote",
    browserClass: "chromium-local-headed",
    loadTier: "v1-owner-one",
    outcome: "completed",
    terminalStage: "playbackAcceptanceUs",
    waitMode: "none",
    scheduledWaitUs: 0,
    excludedWaitUs: 0,
    stageDurationsUs,
    totalUs: Object.values(stageDurationsUs).reduce<number>(
      (total, value) => total + (value ?? 0),
      0,
    ),
    wallTotalUs: Object.values(stageDurationsUs).reduce<number>(
      (total, value) => total + (value ?? 0),
      0,
    ),
    ...overrides,
  };
}

describe("validateRemoteRecognitionWarmTraceRecord", () => {
  it.each([
    ["janus", "skill"],
    ["hologram-graffiti-barrier", "skill"],
    ["fountain", "skill"],
    ["yein", "skill"],
    ["union-wealth", "buff-expiry"],
    ["union-luck", "buff-expiry"],
    ["potion", "buff-expiry"],
    ["exp-coupon", "buff-expiry"],
    ["special-core", "special-core"],
  ] as const)("maps %s to its only feature owner", (target, owner) => {
    expect(getRemoteRecognitionWarmTraceTargetOwner(target)).toBe(owner);
  });

  it.each(["local", "remote"] as const)(
    "accepts an exact completed %s record",
    (provider) => {
      const record = makeCompletedRecord({ provider });

      expect(validateRemoteRecognitionWarmTraceRecord(record)).toBe(record);
    },
  );

  it("accepts only a continuous duration prefix for terminal records", () => {
    const record = makeCompletedRecord({
      outcome: "dropped",
      terminalStage: "encodeUs",
      stageDurationsUs: {
        captureCropUs: 1_000,
        encodeUs: 2_000,
        remoteRoundTripUs: null,
        responseProjectionUs: null,
        matcherOcrUs: null,
        temporalDecisionUs: null,
        scheduleUs: null,
        playbackAcceptanceUs: null,
      },
      totalUs: 3_000,
      wallTotalUs: 3_000,
    });

    expect(validateRemoteRecognitionWarmTraceRecord(record)).toBe(record);
    expect(() =>
      validateRemoteRecognitionWarmTraceRecord({
        ...record,
        stageDurationsUs: {
          ...record.stageDurationsUs,
          responseProjectionUs: 1,
        },
      }),
    ).toThrow(RemoteRecognitionWarmTraceContractError);
  });

  it("rejects missing completed stages and inconsistent totals", () => {
    const record = makeCompletedRecord();

    expect(() =>
      validateRemoteRecognitionWarmTraceRecord({
        ...record,
        stageDurationsUs: {
          ...record.stageDurationsUs,
          playbackAcceptanceUs: null,
        },
      }),
    ).toThrow(RemoteRecognitionWarmTraceContractError);
    expect(() =>
      validateRemoteRecognitionWarmTraceRecord({
        ...record,
        totalUs: record.totalUs + 1,
      }),
    ).toThrow(RemoteRecognitionWarmTraceContractError);
  });

  it("accepts only bounded Buff planned-wait accounting", () => {
    const record = makeCompletedRecord({
      target: "union-wealth",
      waitMode: "scheduler-planned-excluded",
      scheduledWaitUs: 1_000_000,
      excludedWaitUs: 999_000,
      wallTotalUs: 1_035_000,
    });

    expect(validateRemoteRecognitionWarmTraceRecord(record)).toBe(record);
    for (const invalid of [
      { ...record, target: "janus" as const },
      { ...record, scheduledWaitUs: 1_500_000 },
      { ...record, scheduledWaitUs: 1_000_001 },
      { ...record, excludedWaitUs: 1_000_001 },
      { ...record, excludedWaitUs: 0 },
      { ...record, wallTotalUs: record.wallTotalUs + 1 },
    ]) {
      expect(() => validateRemoteRecognitionWarmTraceRecord(invalid)).toThrow(
        RemoteRecognitionWarmTraceContractError,
      );
    }
  });

  it("enforces completed active and wall deadlines without hiding timed-out evidence", () => {
    const base = makeCompletedRecord();
    const activeBelow = {
      ...base,
      stageDurationsUs: {
        ...base.stageDurationsUs,
        captureCropUs:
          (base.stageDurationsUs.captureCropUs ?? 0) +
          REMOTE_RECOGNITION_WARM_TRACE_COMPLETED_LIMITS_US.activeExclusive -
          base.totalUs -
          1,
      },
      totalUs:
        REMOTE_RECOGNITION_WARM_TRACE_COMPLETED_LIMITS_US.activeExclusive - 1,
      wallTotalUs:
        REMOTE_RECOGNITION_WARM_TRACE_COMPLETED_LIMITS_US.activeExclusive - 1,
    };
    expect(validateRemoteRecognitionWarmTraceRecord(activeBelow)).toBe(
      activeBelow,
    );

    const atActiveDeadline = {
      ...activeBelow,
      stageDurationsUs: {
        ...activeBelow.stageDurationsUs,
        captureCropUs: (activeBelow.stageDurationsUs.captureCropUs ?? 0) + 1,
      },
      totalUs:
        REMOTE_RECOGNITION_WARM_TRACE_COMPLETED_LIMITS_US.activeExclusive,
      wallTotalUs:
        REMOTE_RECOGNITION_WARM_TRACE_COMPLETED_LIMITS_US.activeExclusive,
    };
    expect(() =>
      validateRemoteRecognitionWarmTraceRecord(atActiveDeadline),
    ).toThrow(RemoteRecognitionWarmTraceContractError);

    const timedOut = { ...atActiveDeadline, outcome: "timed-out" as const };
    expect(validateRemoteRecognitionWarmTraceRecord(timedOut)).toBe(timedOut);

    const atWallDeadline = {
      ...activeBelow,
      target: "union-wealth" as const,
      waitMode: "scheduler-planned-excluded" as const,
      scheduledWaitUs: 1_000_000,
      excludedWaitUs: 1_000_000,
      wallTotalUs:
        REMOTE_RECOGNITION_WARM_TRACE_COMPLETED_LIMITS_US.wallExclusive,
      totalUs:
        REMOTE_RECOGNITION_WARM_TRACE_COMPLETED_LIMITS_US.wallExclusive -
        1_000_000,
      stageDurationsUs: {
        ...activeBelow.stageDurationsUs,
        captureCropUs:
          (activeBelow.stageDurationsUs.captureCropUs ?? 0) + 4_000_001,
      },
    };
    expect(() =>
      validateRemoteRecognitionWarmTraceRecord(atWallDeadline),
    ).toThrow(RemoteRecognitionWarmTraceContractError);
  });

  it("binds completed Buff wait discount to measured schedule registration cost", () => {
    const base = makeCompletedRecord();
    const scheduleUs = base.stageDurationsUs.scheduleUs ?? 0;
    const equality = makeCompletedRecord({
      target: "union-wealth",
      waitMode: "scheduler-planned-excluded",
      scheduledWaitUs: 1_000_000,
      excludedWaitUs: 1_000_000 - scheduleUs,
      wallTotalUs: base.totalUs + 1_000_000 - scheduleUs,
    });
    expect(validateRemoteRecognitionWarmTraceRecord(equality)).toBe(equality);

    expect(() =>
      validateRemoteRecognitionWarmTraceRecord({
        ...equality,
        excludedWaitUs: equality.excludedWaitUs - 1,
        wallTotalUs: equality.wallTotalUs - 1,
      }),
    ).toThrow(RemoteRecognitionWarmTraceContractError);
  });

  it("rejects extra string or symbol keys", () => {
    const symbol = Symbol("private");

    expect(() =>
      validateRemoteRecognitionWarmTraceRecord({
        ...makeCompletedRecord(),
        accessCode: "BETA-SECRET",
      }),
    ).toThrow(RemoteRecognitionWarmTraceContractError);
    expect(() =>
      validateRemoteRecognitionWarmTraceRecord({
        ...makeCompletedRecord(),
        [symbol]: "hidden",
      }),
    ).toThrow(RemoteRecognitionWarmTraceContractError);

    const hiddenExtra =
      makeCompletedRecord() as RemoteRecognitionWarmTraceRecord & {
        hidden?: string;
      };
    Object.defineProperty(hiddenExtra, "hidden", {
      value: "not-json-visible",
      enumerable: false,
    });
    expect(() => validateRemoteRecognitionWarmTraceRecord(hiddenExtra)).toThrow(
      RemoteRecognitionWarmTraceContractError,
    );

    const accessorRecord = makeCompletedRecord();
    const ordinalGetter = vi.fn(() => 1);
    Object.defineProperty(accessorRecord, "ordinal", {
      get: ordinalGetter,
      enumerable: true,
    });
    expect(() =>
      validateRemoteRecognitionWarmTraceRecord(accessorRecord),
    ).toThrow(RemoteRecognitionWarmTraceContractError);
    expect(ordinalGetter).not.toHaveBeenCalled();
  });

  it("carries an opaque handle without exposing it to object or JSON output", () => {
    const carrier = { sampledAt: 1_000 };
    const handle = Object.freeze({}) as RemoteRecognitionWarmTraceHandle;

    expect(attachRemoteRecognitionWarmTraceHandle(carrier, handle)).toBe(true);
    expect(getRemoteRecognitionWarmTraceHandle(carrier)).toBe(handle);
    expect(Object.keys(carrier)).toEqual(["sampledAt"]);
    expect({ ...carrier }).toEqual({ sampledAt: 1_000 });
    expect(JSON.stringify(carrier)).toBe('{"sampledAt":1000}');
    expect(
      attachRemoteRecognitionWarmTraceHandle(
        carrier,
        Object.freeze({}) as RemoteRecognitionWarmTraceHandle,
      ),
    ).toBe(false);
    expect(
      getRemoteRecognitionWarmTraceHandle(Object.create(carrier)),
    ).toBeNull();
  });
});

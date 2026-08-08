import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeReportEvidenceEnvelope } from "../../contracts/reporting/runtimeReportEvidence";
import { createRuntimeReportEvidenceCoordinator } from "./runtimeReportEvidenceCoordinator";

describe("runtime report evidence coordinator", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves only matching evidence captured after the request", async () => {
    const coordinator = createRuntimeReportEvidenceCoordinator();
    const target = { feature: "skill-buff-duration" as const, targetId: "janus" };
    const pending = coordinator.request<{ detected: boolean }>(target);

    expect(coordinator.hasPending()).toBe(true);
    expect(coordinator.hasPending(target)).toBe(true);
    expect(coordinator.publish(createEvidence({
      target,
      sampledAt: 999,
      payload: { detected: false },
    }))).toBe(false);
    expect(coordinator.publish(createEvidence({
      target: { feature: "skill-buff-duration", targetId: "fountain" },
      sampledAt: 1_000,
      payload: { detected: false },
    }))).toBe(false);

    const evidence = createEvidence({
      target,
      sampledAt: 1_001,
      payload: { detected: true },
    });
    expect(coordinator.publish(evidence)).toBe(true);
    await expect(pending).resolves.toEqual(evidence);
    expect(coordinator.hasPending()).toBe(false);
  });

  it("times out without retaining the request", async () => {
    const coordinator = createRuntimeReportEvidenceCoordinator();
    const target = { feature: "buff-expiry" as const };
    const pending = coordinator.request(target, { timeoutMs: 500 });
    const rejection = expect(pending).rejects.toThrow("runtime-report-evidence-timeout");

    await vi.advanceTimersByTimeAsync(500);

    await rejection;
    expect(coordinator.hasPending(target)).toBe(false);
  });

  it("cancels every pending feature request", async () => {
    const coordinator = createRuntimeReportEvidenceCoordinator();
    const skillPending = coordinator.request({
      feature: "skill-buff-duration",
      targetId: "janus",
    });
    const corePending = coordinator.request({ feature: "special-core" });
    const skillRejection = expect(skillPending).rejects.toThrow("capture-stopped");
    const coreRejection = expect(corePending).rejects.toThrow("capture-stopped");

    coordinator.cancelAll("capture-stopped");

    await Promise.all([skillRejection, coreRejection]);
    expect(coordinator.hasPending()).toBe(false);
  });
});

function createEvidence<TPayload>({
  target,
  sampledAt,
  payload,
}: Pick<RuntimeReportEvidenceEnvelope<TPayload>, "target" | "sampledAt" | "payload">): RuntimeReportEvidenceEnvelope<TPayload> {
  return {
    target,
    sampledAt,
    source: {
      kind: "buff-slot-top-right-quadrant-v1",
      parserInputMode: "topRightQuadrant",
      coordinateSpace: "capture-pixels",
      sourceSize: { width: 1920, height: 1080 },
      roi: { x: 960, y: 0, width: 960, height: 540 },
      dataUrl: "data:image/png;base64,source",
    },
    parser: {
      engine: "dl",
      version: "parser-v1",
      fallbackReason: null,
    },
    payload,
  };
}

import { beforeEach, describe, expect, it, vi } from "vitest";

describe("semantic lab browser resource ledger", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("refuses to end a pass while an explicitly registered resource is live", async () => {
    installRequiredBrowserStubs();
    const { installSemanticLabBrowserResourceLedger } = await import(
      "./browserResourceLedger"
    );
    const ledger = installSemanticLabBrowserResourceLedger();
    const scope = ledger.begin("local");
    const releaseRoot = scope.register("reactRoot");
    scope.assertObserved(["reactRoot"]);
    expect(() => scope.assertClean()).toThrow(
      "semantic-lab-resource-leak:reactRoot",
    );
    releaseRoot();
    scope.assertClean();
    scope.end();
    ledger.restore();
  });

  it("tracks fired and cleared timers without force-cleaning them", async () => {
    vi.useFakeTimers();
    installRequiredBrowserStubs();
    const { installSemanticLabBrowserResourceLedger } = await import(
      "./browserResourceLedger"
    );
    const ledger = installSemanticLabBrowserResourceLedger();
    const scope = ledger.begin("local");
    const fired = window.setTimeout(() => undefined, 10);
    const cleared = window.setTimeout(() => undefined, 20);
    window.clearTimeout(cleared);
    expect(scope.snapshot().live.timeout).toBe(1);
    await vi.advanceTimersByTimeAsync(10);
    expect(scope.snapshot().live.timeout).toBe(0);
    expect(scope.snapshot().observed.timeout).toBe(2);
    window.clearTimeout(fired);
    scope.end();
    ledger.restore();
    vi.useRealTimers();
  });

  it("prevents overlapping passes and requires every scope to be clean before restore", async () => {
    installRequiredBrowserStubs();
    const { installSemanticLabBrowserResourceLedger } = await import(
      "./browserResourceLedger"
    );
    const ledger = installSemanticLabBrowserResourceLedger();
    const local = ledger.begin("local");
    expect(() => ledger.begin("remote")).toThrow(
      "semantic-lab-resource-scope-overlap",
    );
    expect(() => ledger.restore()).toThrow(
      "semantic-lab-resource-ledger-active",
    );
    local.end();
    const remote = ledger.begin("remote");
    remote.end();
    ledger.restore();
  });
});

function installRequiredBrowserStubs() {
  class WorkerStub {
    terminate() {}
  }
  Object.defineProperty(window, "Worker", {
    configurable: true,
    writable: true,
    value: WorkerStub,
  });
  Object.defineProperty(HTMLVideoElement.prototype, "requestVideoFrameCallback", {
    configurable: true,
    writable: true,
    value: (_callback: VideoFrameRequestCallback) => 1,
  });
  Object.defineProperty(HTMLVideoElement.prototype, "cancelVideoFrameCallback", {
    configurable: true,
    writable: true,
    value: () => undefined,
  });
  if (typeof URL.createObjectURL !== "function") {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: () => "blob:semantic-lab",
    });
  }
  if (typeof URL.revokeObjectURL !== "function") {
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      writable: true,
      value: () => undefined,
    });
  }
}

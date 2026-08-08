import { afterEach, describe, expect, it } from "vitest";
import {
  collectDomDiagnostics,
  collectProfileDiagnostics,
  getMemoryDiagnosticsMode,
  getWorkerScriptLabel,
  getWorkerDiagnosticsSnapshot,
  installMemoryDiagnosticsHooks,
} from "./memoryDiagnostics";
import {
  getRuntimePerformanceDiagnosticsSnapshot,
  resetRuntimePerformanceDiagnostics,
} from "./runtimePerformanceDiagnostics";

describe("memory diagnostics", () => {
  const nativeWorker = window.Worker;

  afterEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
    window.history.replaceState(null, "", "/");
    delete window.__MAPLE_TIMER_MEMORY_DIAGNOSTICS__;
    resetRuntimePerformanceDiagnostics();
    Object.defineProperty(window, "Worker", {
      value: nativeWorker,
      configurable: true,
      writable: true,
    });
  });

  it("enables query diagnostics only outside production", () => {
    expect(
      getMemoryDiagnosticsMode(
        { channel: "preview" },
        new URL("https://preview.maple-timer.pages.dev/?diag=memory"),
      ),
    ).toBe("panel");
    expect(
      getMemoryDiagnosticsMode(
        { channel: "local" },
        new URL("http://localhost:5173/memory-lab"),
      ),
    ).toBe("lab");
    expect(
      getMemoryDiagnosticsMode(
        { channel: "production" },
        new URL("https://maple-timer.com/memory-lab"),
      ),
    ).toBe("off");
  });

  it("summarizes profile feature toggles without loading runtime modules", () => {
    localStorage.setItem(
      "maple-hunt-timer.profile.v1",
      JSON.stringify({
        skills: [
          { enabled: true, detectionSource: "buff-duration" },
          { enabled: false, detectionSource: "buff-duration" },
          { enabled: true, detectionSource: "quickslot" },
        ],
        runeAlert: { enabled: true },
        huntStallAlert: { enabled: false },
        buffExpiryAlert: { enabled: true },
        boosterExpiryAlert: { enabled: false },
        specialCoreAlert: { enabled: true },
        generalTimers: [{ enabled: true }, { enabled: false }],
      }),
    );

    expect(collectProfileDiagnostics()).toMatchObject({
      loaded: true,
      skillCount: 3,
      enabledSkillCount: 2,
      precisionSkillCount: 1,
      runeEnabled: true,
      huntStallEnabled: false,
      buffExpiryEnabled: true,
      boosterExpiryEnabled: false,
      specialCoreEnabled: true,
      enabledGeneralTimerCount: 1,
    });
  });

  it("collects DOM counts and data image size evidence", () => {
    document.body.innerHTML = `
      <main>
        <canvas width="320" height="180"></canvas>
        <canvas width="16" height="16"></canvas>
        <img src="data:image/png;base64,AAAA" alt="">
        <video></video>
      </main>
    `;

    const snapshot = collectDomDiagnostics();

    expect(snapshot.canvasCount).toBe(2);
    expect(snapshot.canvasPixels).toBe(320 * 180 + 16 * 16);
    expect(snapshot.imageCount).toBe(1);
    expect(snapshot.dataImageCount).toBe(1);
    expect(snapshot.dataImageCharacters).toBeGreaterThan(0);
    expect(snapshot.videoCount).toBe(1);
  });

  it("derives readable worker labels from asset URLs", () => {
    expect(getWorkerScriptLabel("https://preview.maple-timer.pages.dev/assets/runeDetection.worker-BV1ev4Ef.js")).toBe(
      "runeDetection.worker-BV1ev4Ef.js",
    );
  });

  it("preserves Worker postMessage argument shape while counting messages", () => {
    const calls: unknown[][] = [];
    class FakeWorker extends EventTarget {
      constructor(readonly scriptUrl: string | URL, readonly options?: WorkerOptions) {
        super();
      }

      postMessage(...args: unknown[]) {
        calls.push(args);
      }

      terminate() {}
    }

    Object.defineProperty(window, "Worker", {
      value: FakeWorker,
      configurable: true,
      writable: true,
    });
    window.history.replaceState(null, "", "/?diag=memory");

    installMemoryDiagnosticsHooks({ channel: "preview" });
    const worker = new Worker("worker.js", { type: "module" });
    worker.postMessage({ type: "preload" });
    const transfer: Transferable[] = [];
    worker.postMessage({ type: "process" }, transfer);

    expect(calls).toEqual([[{ type: "preload" }], [{ type: "process" }, transfer]]);
    expect(getWorkerDiagnosticsSnapshot()).toMatchObject({
      installed: true,
      activeCount: 1,
      createdCount: 1,
      postedMessages: 2,
    });
  });

  it("records runtime performance from instrumented Worker responses", () => {
    class FakeWorker extends EventTarget {
      postMessage() {}
      terminate() {}
    }

    Object.defineProperty(window, "Worker", {
      value: FakeWorker,
      configurable: true,
      writable: true,
    });
    window.history.replaceState(null, "", "/memory-lab");

    installMemoryDiagnosticsHooks({ channel: "preview" });
    const worker = new Worker("/assets/buffSlotAnalysis.worker-test123.js");
    worker.postMessage({
      type: "process",
      runtimeSelection: {
        executionProvider: "wasm",
        selectionSource: "user-opt-in",
      },
    });
    worker.dispatchEvent(new MessageEvent("message", {
      data: {
        ok: true,
        response: {
          analysis: {
            engine: "dl",
            runtime: {
              executionProvider: "wasm",
              selectionSource: "user-opt-in",
              parserVersion: "efficientdet-lite-v1",
            },
          },
          performance: {
            totalMs: 143.2,
            detectMs: 136.8,
          },
        },
      },
    }));

    expect(getRuntimePerformanceDiagnosticsSnapshot().pipelines).toEqual([
      expect.objectContaining({
        id: "shared-buff-slot-parser:wasm:user-opt-in",
        sampleCount: 1,
        metrics: expect.arrayContaining([
          expect.objectContaining({ key: "detectMs", latestMs: 136.8 }),
        ]),
        metadata: expect.objectContaining({
          executionProvider: "wasm",
          parserVersion: "efficientdet-lite-v1",
        }),
      }),
    ]);
  });
});

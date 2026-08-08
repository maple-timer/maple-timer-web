import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createRuntimeWorkerFailure,
  markRuntimeWorkerReady,
} from "./runtimeWorkerHealth";

const runtimeAssetHealthMocks = vi.hoisted(() => ({
  clearRuntimeAssetFailure: vi.fn(),
  reportRuntimeAssetFailure: vi.fn(),
}));

vi.mock("../runtime-assets/browserRuntimeAssetHealth", () => runtimeAssetHealthMocks);

describe("runtimeWorkerHealth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports structured worker failure provenance and preserves the original error", () => {
    const original = new Error("worker script 404");

    const result = createRuntimeWorkerFailure({
      feature: "special-core",
      code: "worker-runtime-failed",
      error: original,
      fallbackMessage: "worker failed",
    });

    expect(result).toBe(original);
    expect(runtimeAssetHealthMocks.reportRuntimeAssetFailure).toHaveBeenCalledWith({
      source: "worker",
      feature: "special-core",
      code: "worker-runtime-failed",
      message: "worker script 404",
    });
  });

  it("clears only the feature that returned a successful worker result", () => {
    markRuntimeWorkerReady("buff-expiry");

    expect(runtimeAssetHealthMocks.clearRuntimeAssetFailure).toHaveBeenCalledWith("buff-expiry");
  });
});

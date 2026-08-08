import { describe, expect, it, vi } from "vitest";
import type { PrecisionParserDiagnosticEvent } from "../../../contracts/recognition/precisionParserDiagnostics";
import { requestPrecisionWebGpuDevice } from "./precisionWebGpuDevice";

describe("requestPrecisionWebGpuDevice", () => {
  it("separates WebGPU API, adapter, and device readiness inside the worker", async () => {
    const destroy = vi.fn();
    const requestDevice = vi.fn(async () => ({ destroy }));
    const events: PrecisionParserDiagnosticEvent[] = [];
    const result = await requestPrecisionWebGpuDevice({
      navigatorLike: {
        gpu: {
          requestAdapter: async () => ({
            info: { vendor: "test-vendor", device: "test-device" },
            features: new Set(["shader-f16", "subgroups"]),
            requestDevice,
          }),
        },
      },
      secureContext: true,
      requiredFeatures: ["shader-f16"],
      onDiagnostic: (event) => events.push(event),
    });

    expect(result.adapterDetails).toEqual({
      vendor: "test-vendor",
      device: "test-device",
      shaderF16Supported: true,
      subgroupsSupported: true,
      requiredFeatures: "shader-f16",
      optionalFeatures: "none",
      shaderF16Enabled: true,
      subgroupsEnabled: true,
    });
    expect(requestDevice).toHaveBeenCalledWith({
      requiredFeatures: ["shader-f16", "subgroups"],
    });
    expect(events.map(({ stage, status }) => `${stage}:${status}`)).toEqual([
      "webgpu-api:checking",
      "webgpu-api:passed",
      "gpu-adapter:checking",
      "gpu-adapter:passed",
      "gpu-device:checking",
      "gpu-device:passed",
    ]);
    result.device.destroy?.();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("creates an FP32-capable device when optional shader-f16 is unavailable", async () => {
    const requestDevice = vi.fn(async () => ({}));

    const result = await requestPrecisionWebGpuDevice({
      navigatorLike: {
        gpu: {
          requestAdapter: async () => ({
            info: { vendor: "nvidia", architecture: "pascal" },
            features: new Set<string>(),
            requestDevice,
          }),
        },
      },
      optionalFeatures: ["shader-f16"],
    });

    expect(result.features).toMatchObject({
      shaderF16Supported: false,
      shaderF16Enabled: false,
    });
    expect(requestDevice).toHaveBeenCalledWith({ requiredFeatures: [] });
    expect(result.adapterDetails).toMatchObject({
      optionalFeatures: "shader-f16",
      shaderF16Supported: false,
      shaderF16Enabled: false,
    });
  });

  it("rejects a model-required feature before creating an incompatible device", async () => {
    const requestDevice = vi.fn(async () => ({}));
    const events: PrecisionParserDiagnosticEvent[] = [];

    await expect(
      requestPrecisionWebGpuDevice({
        navigatorLike: {
          gpu: {
            requestAdapter: async () => ({
              info: { vendor: "nvidia", architecture: "pascal" },
              features: new Set<string>(),
              requestDevice,
            }),
          },
        },
        requiredFeatures: ["shader-f16"],
        onDiagnostic: (event) => events.push(event),
      }),
    ).rejects.toMatchObject({
      precisionParserDiagnostic: expect.objectContaining({
        stage: "gpu-device",
        code: "gpu-required-feature-unavailable",
        technicalMessage: "required WebGPU feature unavailable: shader-f16",
        details: expect.objectContaining({
          vendor: "nvidia",
          architecture: "pascal",
          shaderF16Supported: false,
        }),
      }),
    });
    expect(requestDevice).not.toHaveBeenCalled();
    expect(events.map(({ stage, status }) => `${stage}:${status}`)).toEqual([
      "webgpu-api:checking",
      "webgpu-api:passed",
      "gpu-adapter:checking",
      "gpu-adapter:passed",
      "gpu-device:checking",
      "gpu-device:failed",
    ]);
  });

  it("reports a missing worker WebGPU API without blaming the model", async () => {
    const events: PrecisionParserDiagnosticEvent[] = [];

    await expect(
      requestPrecisionWebGpuDevice({
        navigatorLike: {},
        secureContext: true,
        onDiagnostic: (event) => events.push(event),
      }),
    ).rejects.toMatchObject({
      precisionParserDiagnostic: expect.objectContaining({
        stage: "webgpu-api",
        status: "failed",
        code: "webgpu-api-unavailable",
      }),
    });
    expect(events[events.length - 1]?.stage).toBe("webgpu-api");
  });

  it("reports adapter and device failures as different stages", async () => {
    await expect(
      requestPrecisionWebGpuDevice({
        navigatorLike: { gpu: { requestAdapter: async () => null } },
      }),
    ).rejects.toMatchObject({
      precisionParserDiagnostic: expect.objectContaining({
        stage: "gpu-adapter",
        code: "gpu-adapter-unavailable",
      }),
    });

    await expect(
      requestPrecisionWebGpuDevice({
        navigatorLike: {
          gpu: {
            requestAdapter: async () => ({
              requestDevice: async () => {
                throw new Error("device rejected");
              },
            }),
          },
        },
      }),
    ).rejects.toMatchObject({
      precisionParserDiagnostic: expect.objectContaining({
        stage: "gpu-device",
        code: "gpu-device-request-failed",
        technicalMessage: "device rejected",
      }),
    });
  });
});

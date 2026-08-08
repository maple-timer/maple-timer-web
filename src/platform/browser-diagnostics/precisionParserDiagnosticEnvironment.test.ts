import { describe, expect, it } from "vitest";
import { probePrecisionParserMainThreadWebGpuAdapter } from "./precisionParserDiagnosticEnvironment";

describe("probePrecisionParserMainThreadWebGpuAdapter", () => {
  it("separates a missing API, null adapter, and available adapter", async () => {
    await expect(
      probePrecisionParserMainThreadWebGpuAdapter({ navigatorLike: {} }),
    ).resolves.toMatchObject({ status: "api-unavailable" });
    await expect(
      probePrecisionParserMainThreadWebGpuAdapter({
        navigatorLike: { gpu: { requestAdapter: async () => null } },
      }),
    ).resolves.toMatchObject({ status: "unavailable" });
    await expect(
      probePrecisionParserMainThreadWebGpuAdapter({
        navigatorLike: {
          gpu: {
            requestAdapter: async () => ({
              info: { vendor: "test-vendor", device: "test-device" },
            }),
          },
        },
      }),
    ).resolves.toEqual({
      status: "available",
      technicalMessage: null,
      adapterDetails: {
        vendor: "test-vendor",
        device: "test-device",
      },
    });
  });

  it("records request failures without throwing", async () => {
    await expect(
      probePrecisionParserMainThreadWebGpuAdapter({
        navigatorLike: {
          gpu: {
            requestAdapter: async () => {
              throw new Error("adapter crashed");
            },
          },
        },
      }),
    ).resolves.toEqual({
      status: "failed",
      technicalMessage: "adapter crashed",
      adapterDetails: {},
    });
  });
});

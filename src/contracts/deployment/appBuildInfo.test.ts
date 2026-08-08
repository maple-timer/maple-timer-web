import { describe, expect, it } from "vitest";
import {
  formatAppBuildInfo,
  normalizeAppBuildInfo,
  parseAppBuildInfo,
  type AppBuildInfo,
} from "./appBuildInfo";

describe("appBuildInfo contract", () => {
  it("rejects values without the required runtime identity", () => {
    expect(parseAppBuildInfo(null)).toBeNull();
    expect(parseAppBuildInfo({ commitSha: "commit" })).toBeNull();
    expect(parseAppBuildInfo({ buildTime: "2026-07-16T00:00:00.000Z" })).toBeNull();
  });

  it("normalizes optional fields with the existing defaults", () => {
    expect(
      parseAppBuildInfo({
        commitSha: "1234567890",
        buildTime: "2026-07-16T00:00:00.000Z",
        channel: "invalid",
      }),
    ).toEqual({
      name: "maple-timer",
      version: "0.1.0",
      commitSha: "1234567890",
      shortCommit: "1234567",
      branch: "unknown",
      deploymentUrl: null,
      buildTime: "2026-07-16T00:00:00.000Z",
      channel: "local",
      remoteRecognitionV1TestArm: false,
    });
  });

  it("keeps the local fallback for an unavailable build constant", () => {
    expect(normalizeAppBuildInfo(undefined)).toEqual({
      name: "maple-timer",
      version: "0.1.0",
      commitSha: "unknown",
      shortCommit: "unknown",
      branch: "unknown",
      deploymentUrl: null,
      buildTime: "unknown",
      channel: "local",
      remoteRecognitionV1TestArm: false,
    });
  });

  it("preserves the non-secret remote V1 test-arm attestation", () => {
    expect(
      parseAppBuildInfo({
        commitSha: "1234567890",
        buildTime: "2026-07-16T00:00:00.000Z",
        remoteRecognitionV1TestArm: true,
      }),
    ).toMatchObject({ remoteRecognitionV1TestArm: true });
    expect(
      parseAppBuildInfo({
        commitSha: "1234567890",
        buildTime: "2026-07-16T00:00:00.000Z",
        remoteRecognitionV1TestArm: "true",
      }),
    ).toMatchObject({ remoteRecognitionV1TestArm: false });
  });

  it("formats known and unknown commits without changing report copy", () => {
    const info: AppBuildInfo = {
      name: "maple-timer",
      version: "0.1.0",
      commitSha: "1234567890",
      shortCommit: "1234567",
      branch: "main",
      deploymentUrl: "https://maple-timer.com",
      buildTime: "2026-07-16T00:00:00.000Z",
      channel: "production",
      remoteRecognitionV1TestArm: false,
    };

    expect(formatAppBuildInfo(info)).toBe("production main@1234567");
    expect(formatAppBuildInfo({ ...info, shortCommit: "unknown" })).toBe("production main");
  });
});

import { describe, expect, it } from "vitest";
import type { AppBuildInfo } from "../../contracts/deployment/appBuildInfo";
import { isRemoteRecognitionLabAvailable } from "./remoteRecognitionLabAvailability";

describe("isRemoteRecognitionLabAvailable", () => {
  it("is available on every channel without a query flag", () => {
    expect(available("local", "", false)).toBe(true);
    expect(available("preview", "", false)).toBe(true);
    expect(available("production", "", false)).toBe(true);
    expect(available("production", "?remote-recognition-lab=1", true)).toBe(
      true,
    );
  });
});

function available(
  channel: AppBuildInfo["channel"],
  search: string,
  environmentEnabled: boolean,
) {
  return isRemoteRecognitionLabAvailable({
    buildInfo: {
      name: "maple-timer",
      version: "0.1.0",
      commitSha: "abc1234",
      shortCommit: "abc1234",
      branch: "main",
      deploymentUrl: null,
      buildTime: "2026-08-01T00:00:00.000Z",
      channel,
      remoteRecognitionV1TestArm: false,
    },
    search,
    environmentEnabled,
  });
}

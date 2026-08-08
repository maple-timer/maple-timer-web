import { describe, expect, it } from "vitest";
import { getPrecisionParserBrowserGuidance } from "./precisionParserBrowserGuidance";

describe("getPrecisionParserBrowserGuidance", () => {
  it.each([
    {
      userAgent:
        "Mozilla/5.0 Chrome/149.0.0.0 Safari/537.36",
      expected: {
        family: "chrome",
        label: "Chrome",
        version: "149.0.0.0",
        settingsUrl: "chrome://settings/system",
        gpuStatusUrl: "chrome://gpu",
      },
    },
    {
      userAgent:
        "Mozilla/5.0 Chrome/149.0.0.0 Safari/537.36 Edg/149.0.0.0",
      expected: {
        family: "edge",
        label: "Microsoft Edge",
        version: "149.0.0.0",
        settingsUrl: "edge://settings/system",
        gpuStatusUrl: "edge://gpu",
      },
    },
    {
      userAgent:
        "Mozilla/5.0 Chrome/138.0.0.0 Whale/4.32.315.22 Safari/537.36",
      expected: {
        family: "whale",
        label: "NAVER Whale",
        version: "4.32.315.22",
        settingsUrl: "whale://settings/system",
        gpuStatusUrl: "whale://gpu",
      },
    },
  ])("recognizes $expected.label before generic Chromium tokens", ({ userAgent, expected }) => {
    expect(getPrecisionParserBrowserGuidance(userAgent)).toEqual(expected);
  });

  it("falls back to neutral Chromium guidance", () => {
    expect(getPrecisionParserBrowserGuidance("Test Browser")).toMatchObject({
      family: "chromium",
      label: "현재 브라우저",
      version: null,
    });
  });
});

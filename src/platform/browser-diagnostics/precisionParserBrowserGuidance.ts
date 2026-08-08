export type PrecisionParserBrowserFamily =
  | "chrome"
  | "edge"
  | "whale"
  | "chromium";

export type PrecisionParserBrowserGuidance = {
  family: PrecisionParserBrowserFamily;
  label: string;
  version: string | null;
  settingsUrl: string;
  gpuStatusUrl: string;
};

export function getPrecisionParserBrowserGuidance(
  userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent,
): PrecisionParserBrowserGuidance {
  const edgeVersion = matchVersion(userAgent, /Edg\/([\d.]+)/);
  if (edgeVersion) {
    return {
      family: "edge",
      label: "Microsoft Edge",
      version: edgeVersion,
      settingsUrl: "edge://settings/system",
      gpuStatusUrl: "edge://gpu",
    };
  }

  const whaleVersion = matchVersion(userAgent, /Whale\/([\d.]+)/);
  if (whaleVersion) {
    return {
      family: "whale",
      label: "NAVER Whale",
      version: whaleVersion,
      settingsUrl: "whale://settings/system",
      gpuStatusUrl: "whale://gpu",
    };
  }

  const chromeVersion = matchVersion(userAgent, /(?:Chrome|CriOS)\/([\d.]+)/);
  if (chromeVersion) {
    return {
      family: "chrome",
      label: "Chrome",
      version: chromeVersion,
      settingsUrl: "chrome://settings/system",
      gpuStatusUrl: "chrome://gpu",
    };
  }

  return {
    family: "chromium",
    label: "현재 브라우저",
    version: null,
    settingsUrl: "chrome://settings/system",
    gpuStatusUrl: "chrome://gpu",
  };
}

function matchVersion(userAgent: string, pattern: RegExp): string | null {
  return pattern.exec(userAgent)?.[1] ?? null;
}

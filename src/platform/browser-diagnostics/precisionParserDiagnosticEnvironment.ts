import type { AppBuildReportInfo } from "../../contracts/deployment/appBuildInfo";
import {
  appBuildInfo,
  formatAppBuildInfo,
  getAppBuildReportInfo,
} from "../runtime-build/currentAppBuildInfo";

export type PrecisionParserDiagnosticEnvironment = {
  appBuild: AppBuildReportInfo;
  buildLabel: string;
  origin: string;
  currentUrl: string;
  userAgent: string;
  secureContext: boolean;
  mainThreadWebGpu: boolean;
  mainThreadWebGpuAdapterProbe: PrecisionParserMainThreadWebGpuAdapterProbe;
  viewport: {
    width: number;
    height: number;
  };
};

export type PrecisionParserMainThreadWebGpuAdapterProbe = {
  status:
    | "not-run"
    | "api-unavailable"
    | "available"
    | "unavailable"
    | "failed";
  technicalMessage: string | null;
  adapterDetails: Record<string, string>;
};

type WebGpuAdapterInfoLike = {
  vendor?: unknown;
  architecture?: unknown;
  device?: unknown;
  description?: unknown;
};

type NavigatorWithWebGpu = {
  gpu?: {
    requestAdapter: () => Promise<{ info?: WebGpuAdapterInfoLike } | null>;
  };
};

export function collectPrecisionParserDiagnosticEnvironment(): PrecisionParserDiagnosticEnvironment {
  const browserWindow = typeof window === "undefined" ? null : window;
  const browserNavigator = typeof navigator === "undefined" ? null : navigator;
  const navigatorWithGpu = browserNavigator as (Navigator & { gpu?: unknown }) | null;

  return {
    appBuild: getAppBuildReportInfo(),
    buildLabel: formatAppBuildInfo(appBuildInfo),
    origin: browserWindow?.location.origin ?? "unknown",
    currentUrl: browserWindow?.location.href ?? "unknown",
    userAgent: browserNavigator?.userAgent ?? "unknown",
    secureContext: Boolean(browserWindow?.isSecureContext),
    mainThreadWebGpu: Boolean(navigatorWithGpu?.gpu),
    mainThreadWebGpuAdapterProbe: {
      status: "not-run",
      technicalMessage: null,
      adapterDetails: {},
    },
    viewport: {
      width: browserWindow?.innerWidth ?? 0,
      height: browserWindow?.innerHeight ?? 0,
    },
  };
}

export async function collectPrecisionParserDiagnosticEnvironmentWithProbe(): Promise<PrecisionParserDiagnosticEnvironment> {
  const environment = collectPrecisionParserDiagnosticEnvironment();
  return {
    ...environment,
    mainThreadWebGpuAdapterProbe:
      await probePrecisionParserMainThreadWebGpuAdapter(),
  };
}

export async function probePrecisionParserMainThreadWebGpuAdapter({
  navigatorLike = globalThis.navigator as NavigatorWithWebGpu | undefined,
}: {
  navigatorLike?: NavigatorWithWebGpu;
} = {}): Promise<PrecisionParserMainThreadWebGpuAdapterProbe> {
  if (!navigatorLike?.gpu) {
    return {
      status: "api-unavailable",
      technicalMessage: "navigator.gpu is unavailable on the main thread",
      adapterDetails: {},
    };
  }

  try {
    const adapter = await navigatorLike.gpu.requestAdapter();
    if (!adapter) {
      return {
        status: "unavailable",
        technicalMessage:
          "navigator.gpu.requestAdapter() returned null on the main thread",
        adapterDetails: {},
      };
    }
    return {
      status: "available",
      technicalMessage: null,
      adapterDetails: getAdapterDetails(adapter.info),
    };
  } catch (error) {
    return {
      status: "failed",
      technicalMessage: getErrorMessage(error),
      adapterDetails: {},
    };
  }
}

function getAdapterDetails(info: WebGpuAdapterInfoLike | undefined) {
  const details: Record<string, string> = {};
  for (const key of ["vendor", "architecture", "device", "description"] as const) {
    const value = info?.[key];
    if (typeof value === "string" && value) {
      details[key] = value;
    }
  }
  return details;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return typeof error === "string" && error
    ? error
    : "unknown main-thread WebGPU adapter error";
}

import { appBuildInfo } from "../platform/runtime-build/currentAppBuildInfo";

type AnalyticsParamValue = string | number | boolean | null;
export type AnalyticsParams = Record<string, AnalyticsParamValue | undefined>;

type GtagCommand = [command: string, ...args: unknown[]];

declare global {
  interface Window {
    dataLayer?: GtagCommand[];
    gtag?: (...args: GtagCommand) => void;
    __MAPLE_TIMER_GA_BOOTSTRAPPED__?: boolean;
  }
}

const GA_SCRIPT_ID = "maple-timer-google-analytics";
const GA_MEASUREMENT_ID = import.meta.env.VITE_GA_MEASUREMENT_ID?.trim() ?? "";

let isInitialized = false;

function getBaseParams(): AnalyticsParams {
  return {
    app_channel: appBuildInfo.channel,
    app_branch: appBuildInfo.branch,
    app_commit: appBuildInfo.shortCommit,
    app_version: appBuildInfo.version,
  };
}

function sanitizeParams(params: AnalyticsParams): Record<string, AnalyticsParamValue> {
  return Object.fromEntries(
    Object.entries(params).filter((entry): entry is [string, AnalyticsParamValue] => {
      const [, value] = entry;
      return (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean" ||
        value === null
      );
    }),
  );
}

function ensureGtag() {
  window.dataLayer = window.dataLayer ?? [];
  window.gtag =
    window.gtag ??
    ((...args: GtagCommand) => {
      window.dataLayer?.push(args);
    });
}

function appendGoogleTagScript() {
  if (document.getElementById(GA_SCRIPT_ID)) {
    return;
  }

  const script = document.createElement("script");
  script.id = GA_SCRIPT_ID;
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(
    GA_MEASUREMENT_ID,
  )}`;
  document.head.appendChild(script);
}

export function isAnalyticsEnabled(): boolean {
  return typeof window !== "undefined" && GA_MEASUREMENT_ID.length > 0;
}

export function initAnalytics(): boolean {
  if (!isAnalyticsEnabled()) {
    return false;
  }

  ensureGtag();

  if (isInitialized) {
    return true;
  }

  appendGoogleTagScript();
  if (!window.__MAPLE_TIMER_GA_BOOTSTRAPPED__) {
    window.gtag?.("js", new Date());
    window.gtag?.("config", GA_MEASUREMENT_ID, {
      send_page_view: true,
      app_name: appBuildInfo.name,
      ...sanitizeParams(getBaseParams()),
    });
    window.__MAPLE_TIMER_GA_BOOTSTRAPPED__ = true;
  }
  isInitialized = true;
  return true;
}

export function trackAnalyticsEvent(eventName: string, params: AnalyticsParams = {}) {
  try {
    if (!initAnalytics()) {
      return;
    }

    window.gtag?.("event", eventName, sanitizeParams({ ...getBaseParams(), ...params }));
  } catch {
    // Analytics must never affect timer or alert behavior.
  }
}

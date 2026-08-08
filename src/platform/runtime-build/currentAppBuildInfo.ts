import {
  formatAppBuildInfo as formatBuildInfo,
  normalizeAppBuildInfo,
  type AppBuildInfo,
  type AppBuildReportInfo,
} from "../../contracts/deployment/appBuildInfo";

export const appBuildInfo = normalizeAppBuildInfo(
  typeof __APP_BUILD_INFO__ === "undefined" ? null : __APP_BUILD_INFO__,
);

export function getAppBuildReportInfo(): AppBuildReportInfo {
  const location =
    typeof window === "undefined"
      ? { origin: null, hostname: null }
      : {
          origin: window.location.origin,
          hostname: window.location.hostname,
        };

  return {
    ...appBuildInfo,
    runtimeOrigin: location.origin,
    runtimeHostname: location.hostname,
  };
}

export function formatAppBuildInfo(info: AppBuildInfo = appBuildInfo): string {
  return formatBuildInfo(info);
}

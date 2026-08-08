import {
  clearRuntimeAssetFailure,
  reportRuntimeAssetFailure,
} from "../runtime-assets/browserRuntimeAssetHealth";

export function createRuntimeWorkerFailure({
  feature,
  code,
  error,
  fallbackMessage,
}: {
  feature: string;
  code: string;
  error?: unknown;
  fallbackMessage: string;
}): Error {
  const normalized =
    error instanceof Error
      ? error
      : new Error(typeof error === "string" && error ? error : fallbackMessage);
  reportRuntimeAssetFailure({
    source: "worker",
    feature,
    code,
    message: normalized.message,
  });
  return normalized;
}

export function markRuntimeWorkerReady(feature: string) {
  clearRuntimeAssetFailure(feature);
}

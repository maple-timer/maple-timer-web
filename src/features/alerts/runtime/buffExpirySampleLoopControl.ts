import { createBuffExpiryRuntimeState } from "../../../lib/buffExpiry/buffExpiryRuntimeState";
import type {
  BuffExpiryRuntimeState,
  BuffExpirySnapshot,
} from "../../../lib/buffExpiry/buffExpiryTypes";
import { createDefaultBuffExpiryAlert } from "../../../lib/storage";
import type { MonitoringFrameContext } from "../../../runtime/monitoring/monitoringFrameContext";
import type { BuffExpiryAlertConfig, Profile } from "../../../types";

export const BUFF_EXPIRY_PREVIEW_INTERVAL_MS = 2500;

export type BuffExpirySampleLoopControl =
  | {
      kind: "skip";
      resetEngineState: boolean;
      resetPrecisionEngine: boolean;
      state: BuffExpiryRuntimeState;
      snapshot: BuffExpirySnapshot | null;
    }
  | {
      kind: "ready";
      config: BuffExpiryAlertConfig;
      context: MonitoringFrameContext;
      shouldIncludeDebugPreview: boolean;
    };

export function getBuffExpirySampleLoopControl({
  profile,
  stream,
  context,
  currentState,
  sampledAt,
  showDebugColumns,
  lastPreviewAt,
}: {
  profile: Profile;
  stream: MediaStream | null;
  context: MonitoringFrameContext | null;
  currentState: BuffExpiryRuntimeState;
  sampledAt: number;
  showDebugColumns: boolean;
  lastPreviewAt: number;
}): BuffExpirySampleLoopControl {
  const config = profile.buffExpiryAlert ?? createDefaultBuffExpiryAlert();

  if (!config.enabled) {
    return {
      kind: "skip",
      resetEngineState: true,
      resetPrecisionEngine: true,
      state: {
        ...createBuffExpiryRuntimeState(),
        status: "paused",
        lastSampledAt: sampledAt,
      },
      snapshot: null,
    };
  }

  if (!stream) {
    return {
      kind: "skip",
      resetEngineState: true,
      resetPrecisionEngine: true,
      state: {
        ...createBuffExpiryRuntimeState(),
        status: "no-stream",
        lastSampledAt: sampledAt,
      },
      snapshot: null,
    };
  }

  if (!context) {
    return {
      kind: "skip",
      resetEngineState: false,
      resetPrecisionEngine: false,
      state: {
        ...currentState,
        status: "no-stream",
        lastSampledAt: sampledAt,
      },
      snapshot: null,
    };
  }

  return {
    kind: "ready",
    config,
    context,
    shouldIncludeDebugPreview:
      showDebugColumns && sampledAt - lastPreviewAt >= BUFF_EXPIRY_PREVIEW_INTERVAL_MS,
  };
}

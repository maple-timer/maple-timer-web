import type { MonitoringFrameContext } from "../../../runtime/monitoring/monitoringFrameContext";

export type MonitoringFrameProcessor = ({
  context,
}: {
  context: MonitoringFrameContext;
}) => Promise<void> | void;

export function runSkillRuneMonitoringFrame({
  context,
  handleMetadata,
  processSkillFrame,
  processRuneFrame,
}: {
  context: MonitoringFrameContext | null;
  handleMetadata: () => void;
  processSkillFrame: MonitoringFrameProcessor;
  processRuneFrame: MonitoringFrameProcessor;
}): boolean | Promise<boolean> {
  if (!context) {
    return false;
  }

  handleMetadata();
  const skillResult = context.gameViewport
    ? processSkillFrame({ context })
    : undefined;
  const runeResult = processRuneFrame({ context });
  if (isPromiseLike(skillResult) || isPromiseLike(runeResult)) {
    return Promise.all([skillResult, runeResult]).then(() => true);
  }
  return true;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return Boolean(value) && typeof (value as { then?: unknown }).then === "function";
}

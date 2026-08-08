import { useEffect, useMemo } from "react";
import type {
  RuntimeReportEvidenceCoordinator,
  RuntimeReportEvidenceEnvelope,
  RuntimeReportEvidenceTarget,
} from "../../contracts/reporting/runtimeReportEvidence";

type PendingRequest = {
  requestedAt: number;
  resolve: (evidence: RuntimeReportEvidenceEnvelope) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
};

const DEFAULT_RUNTIME_REPORT_EVIDENCE_TIMEOUT_MS = 4_500;

export function createRuntimeReportEvidenceCoordinator(): RuntimeReportEvidenceCoordinator {
  const pending = new Map<string, PendingRequest[]>();

  const cancelRequests = (requests: PendingRequest[], reason: string) => {
    requests.forEach((request) => {
      clearTimeout(request.timeoutId);
      request.reject(new Error(reason));
    });
  };

  return {
    hasPending(target) {
      if (!target) {
        return pending.size > 0;
      }
      return (pending.get(getRuntimeReportEvidenceTargetKey(target))?.length ?? 0) > 0;
    },
    request<TPayload>(
      target: RuntimeReportEvidenceTarget,
      options: { timeoutMs?: number } = {},
    ) {
      const key = getRuntimeReportEvidenceTargetKey(target);
      const timeoutMs = options.timeoutMs ?? DEFAULT_RUNTIME_REPORT_EVIDENCE_TIMEOUT_MS;
      return new Promise<RuntimeReportEvidenceEnvelope<TPayload>>((resolve, reject) => {
        const request: PendingRequest = {
          requestedAt: Date.now(),
          resolve: resolve as PendingRequest["resolve"],
          reject,
          timeoutId: setTimeout(() => {
            const requests = pending.get(key) ?? [];
            const remaining = requests.filter((candidate) => candidate !== request);
            if (remaining.length > 0) {
              pending.set(key, remaining);
            } else {
              pending.delete(key);
            }
            reject(new Error("runtime-report-evidence-timeout"));
          }, timeoutMs),
        };
        pending.set(key, [...(pending.get(key) ?? []), request]);
      });
    },
    publish(evidence) {
      const key = getRuntimeReportEvidenceTargetKey(evidence.target);
      const requests = pending.get(key) ?? [];
      const eligible = requests.filter((request) => evidence.sampledAt >= request.requestedAt);
      if (eligible.length <= 0) {
        return false;
      }
      const remaining = requests.filter((request) => !eligible.includes(request));
      if (remaining.length > 0) {
        pending.set(key, remaining);
      } else {
        pending.delete(key);
      }
      eligible.forEach((request) => {
        clearTimeout(request.timeoutId);
        request.resolve(evidence);
      });
      return true;
    },
    cancelAll(reason = "runtime-report-evidence-cancelled") {
      for (const requests of pending.values()) {
        cancelRequests(requests, reason);
      }
      pending.clear();
    },
  };
}

export function useRuntimeReportEvidenceCoordinator(): RuntimeReportEvidenceCoordinator {
  const coordinator = useMemo(createRuntimeReportEvidenceCoordinator, []);
  useEffect(() => () => coordinator.cancelAll(), [coordinator]);
  return coordinator;
}

function getRuntimeReportEvidenceTargetKey(target: RuntimeReportEvidenceTarget): string {
  return `${target.feature}:${target.targetId ?? "default"}`;
}

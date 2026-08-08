import { reconcileAlertReportIncidentPayload } from "./alertReportIncident";

export const ALERT_REPORT_SCHEMA = "maple-timer.alert-report";
export const ALERT_REPORT_VERSION = 1;

export type AlertReportContract = {
  schema: string;
  version: number;
};

export type VersionedAlertReport<TPayload extends Record<string, unknown>> = TPayload & {
  reportContract: AlertReportContract;
};

export function createAlertReportPayload<TPayload extends Record<string, unknown>>(
  payload: TPayload,
): VersionedAlertReport<TPayload> {
  return reconcileAlertReportIncidentPayload({
    ...payload,
    reportContract: {
      schema: ALERT_REPORT_SCHEMA,
      version: ALERT_REPORT_VERSION,
    },
  });
}

export function readAlertReportContract(value: unknown): AlertReportContract | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const contract = value as Record<string, unknown>;
  if (
    typeof contract.schema !== "string" ||
    !contract.schema.trim() ||
    typeof contract.version !== "number" ||
    !Number.isInteger(contract.version) ||
    contract.version < 1
  ) {
    return null;
  }

  return {
    schema: contract.schema,
    version: contract.version,
  };
}

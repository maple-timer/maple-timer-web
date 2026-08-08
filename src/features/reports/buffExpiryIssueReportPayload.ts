import type {
  BuffExpiryRuntimeState,
  BuffExpirySnapshot,
} from "../../lib/buffExpiry/buffExpiryTypes";
import type { BuffExpiryAlertConfig } from "../../types";
import type { RuntimeReportEvidenceMetadata } from "../../contracts/reporting/runtimeReportEvidence";
import { buildBuffExpiryPrecisionIssueReportPayload } from "./buffExpiryPrecisionIssueReportPayload";
import type {
  AlertIssueReportDetails,
  CaptureDiagnostics,
  ReportBase,
} from "./alertReportPayloadShared";
import type { AlertIncidentJournalSelection } from "../../application/reporting/alertIncidentJournal";
import type { BuffExpiryIncidentReportEvidence } from "../../runtime/buff-expiry/evidence/buffExpiryIncidentReportEvidence";

export function buildBuffExpiryIssueReportPayload({
  submittedAt,
  url,
  clientId,
  viewportDiagnostics,
  captureDiagnostics,
  config,
  snapshot,
  state,
  stateBefore,
  runtimeEvidence,
  incidentEvidence,
  issue,
  journalSelection,
}: ReportBase & {
  clientId: string;
  captureDiagnostics: CaptureDiagnostics;
  config: BuffExpiryAlertConfig;
  snapshot: BuffExpirySnapshot;
  state: BuffExpiryRuntimeState;
  stateBefore?: BuffExpiryRuntimeState | null;
  runtimeEvidence?: RuntimeReportEvidenceMetadata | null;
  incidentEvidence?: BuffExpiryIncidentReportEvidence | null;
  issue: AlertIssueReportDetails;
  journalSelection?: AlertIncidentJournalSelection | null;
}) {
  return buildBuffExpiryPrecisionIssueReportPayload({
    submittedAt,
    url,
    clientId,
    viewportDiagnostics,
    captureDiagnostics,
    config,
    snapshot,
    state,
    stateBefore,
    runtimeEvidence,
    incidentEvidence,
    issue,
    journalSelection,
  });
}

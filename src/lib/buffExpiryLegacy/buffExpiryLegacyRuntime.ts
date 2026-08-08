// Legacy matcher/reconciliation facade kept for regression tests and offline
// analysis scripts while the production app uses the precision runtime.
export { markDueBuffExpiryTracksAlerted } from "./buffExpiryAlertDecision";
export { selectBuffExpiryRuntimeMatches } from "./buffExpiryRuntimeMatches";
export { reconcileBuffExpiryTracks } from "./buffExpiryTrackReconciliation";

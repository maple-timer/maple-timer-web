import { describe, expect, it } from "vitest";
import {
  BUFF_EXPIRY_PRECISION_ALERT_CLUSTER_WINDOW_MS as domainWindowMs,
  getBuffExpiryPrecisionAlertClusters as getDomainClusters,
  isFreshBuffExpiryPrecisionAlertTrack as isDomainFreshTrack,
  markDueBuffExpiryPrecisionClustersAlerted as markDomainClustersAlerted,
} from "../../domain/buff-expiry/precisionAlertClusters";
import {
  BUFF_EXPIRY_PRECISION_ALERT_CLUSTER_WINDOW_MS,
  getBuffExpiryPrecisionAlertClusters,
  isFreshBuffExpiryPrecisionAlertTrack,
  markDueBuffExpiryPrecisionClustersAlerted,
} from "./buffExpiryPrecisionAlertClusters";

describe("buffExpiryPrecisionAlertClusters compatibility", () => {
  it("re-exports the domain alert-cluster owner", () => {
    expect(BUFF_EXPIRY_PRECISION_ALERT_CLUSTER_WINDOW_MS).toBe(domainWindowMs);
    expect(getBuffExpiryPrecisionAlertClusters).toBe(getDomainClusters);
    expect(isFreshBuffExpiryPrecisionAlertTrack).toBe(isDomainFreshTrack);
    expect(markDueBuffExpiryPrecisionClustersAlerted).toBe(markDomainClustersAlerted);
  });
});

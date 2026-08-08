import { describe, expect, it } from "vitest";
import * as domainOwner from "../../domain/buff-expiry/alertLeadPolicy";
import * as compatibilityPath from "./buffExpiryAlertLead";

describe("buffExpiryAlertLead compatibility", () => {
  it("re-exports the domain owner", () => {
    expect(compatibilityPath).toEqual(domainOwner);
  });
});

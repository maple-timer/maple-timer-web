import { describe, expect, it } from "vitest";
import * as domainOwner from "../../domain/buff-expiry/catalog";
import * as compatibilityPath from "./buffExpiryCatalog";

describe("buffExpiryCatalog compatibility", () => {
  it("re-exports the domain owner", () => {
    expect(compatibilityPath).toEqual(domainOwner);
  });
});

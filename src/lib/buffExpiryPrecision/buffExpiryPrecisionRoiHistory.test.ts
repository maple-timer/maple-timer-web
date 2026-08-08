import { describe, expect, it } from "vitest";
import * as runtimeOwner from "../../runtime/buff-expiry/evidence/buffExpiryPrecisionRoiHistory";
import * as compatibilityPath from "./buffExpiryPrecisionRoiHistory";

describe("buffExpiryPrecisionRoiHistory compatibility", () => {
  it("re-exports the runtime evidence owner", () => {
    expect(compatibilityPath).toEqual(runtimeOwner);
  });
});

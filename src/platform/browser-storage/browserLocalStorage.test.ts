import { afterEach, describe, expect, it, vi } from "vitest";
import { getBrowserLocalStorage } from "./browserLocalStorage";

describe("browser local storage platform", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the active browser localStorage implementation", () => {
    expect(getBrowserLocalStorage()).toBe(localStorage);
  });

  it("reports unavailable storage without creating a fallback", () => {
    vi.stubGlobal("localStorage", undefined);

    expect(getBrowserLocalStorage()).toBeNull();
  });
});

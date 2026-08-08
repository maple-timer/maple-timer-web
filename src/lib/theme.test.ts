import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyThemePreference,
  getEffectiveTheme,
  loadThemePreference,
  normalizeThemePreference,
  saveThemePreference,
} from "./theme";

describe("theme preferences", () => {
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
    delete document.documentElement.dataset.theme;
    delete document.documentElement.dataset.themePreference;
  });

  it("uses light as the default preference", () => {
    expect(normalizeThemePreference("unknown")).toBe("light");
    expect(loadThemePreference()).toBe("light");
  });

  it("persists an explicit preference", () => {
    saveThemePreference("dark");
    expect(loadThemePreference()).toBe("dark");

    saveThemePreference("system");
    expect(loadThemePreference()).toBe("system");
  });

  it("applies the effective theme to the document root", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));

    expect(getEffectiveTheme("system")).toBe("dark");
    expect(applyThemePreference("system")).toBe("dark");
    expect(document.documentElement.dataset.themePreference).toBe("system");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});

export type ThemePreference = "system" | "light" | "dark";
export type EffectiveTheme = "light" | "dark";

const THEME_STORAGE_KEY = "maple-hunt-timer.theme.v1";
const DARK_MODE_QUERY = "(prefers-color-scheme: dark)";
const DEFAULT_THEME_PREFERENCE: ThemePreference = "light";
const THEME_SWITCHING_CLASS = "theme-switching";
let themeSwitchingTimer: ReturnType<typeof setTimeout> | null = null;

export function normalizeThemePreference(value: unknown): ThemePreference {
  return value === "light" || value === "dark" || value === "system"
    ? value
    : DEFAULT_THEME_PREFERENCE;
}

export function loadThemePreference(): ThemePreference {
  if (typeof localStorage === "undefined") {
    return DEFAULT_THEME_PREFERENCE;
  }

  return normalizeThemePreference(localStorage.getItem(THEME_STORAGE_KEY));
}

export function saveThemePreference(preference: ThemePreference): void {
  if (typeof localStorage === "undefined") {
    return;
  }

  localStorage.setItem(THEME_STORAGE_KEY, preference);
}

export function getEffectiveTheme(preference: ThemePreference): EffectiveTheme {
  if (preference !== "system") {
    return preference;
  }

  if (typeof window === "undefined" || !window.matchMedia) {
    return "light";
  }

  return window.matchMedia(DARK_MODE_QUERY).matches ? "dark" : "light";
}

export function getSystemThemeMediaQuery(): MediaQueryList | null {
  if (typeof window === "undefined" || !window.matchMedia) {
    return null;
  }

  return window.matchMedia(DARK_MODE_QUERY);
}

export function applyThemePreference(preference: ThemePreference): EffectiveTheme {
  const normalized = normalizeThemePreference(preference);
  const effectiveTheme = getEffectiveTheme(normalized);

  if (typeof document !== "undefined") {
    const root = document.documentElement;
    const previousTheme = root.dataset.theme;
    if (previousTheme && previousTheme !== effectiveTheme) {
      root.classList.add(THEME_SWITCHING_CLASS);
      if (themeSwitchingTimer) {
        clearTimeout(themeSwitchingTimer);
      }
      themeSwitchingTimer = setTimeout(() => {
        root.classList.remove(THEME_SWITCHING_CLASS);
        themeSwitchingTimer = null;
      }, 140);
    }

    document.documentElement.dataset.themePreference = normalized;
    document.documentElement.dataset.theme = effectiveTheme;
  }

  return effectiveTheme;
}

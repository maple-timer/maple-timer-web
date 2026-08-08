import { useEffect, useState } from "react";
import {
  applyThemePreference,
  getSystemThemeMediaQuery,
  loadThemePreference,
  saveThemePreference,
  type ThemePreference,
} from "../../lib/theme";

export function useThemePreference() {
  const [themePreference, setThemePreference] = useState<ThemePreference>(() =>
    loadThemePreference(),
  );

  useEffect(() => {
    saveThemePreference(themePreference);
    applyThemePreference(themePreference);

    if (themePreference !== "system") {
      return;
    }

    const mediaQuery = getSystemThemeMediaQuery();
    if (!mediaQuery) {
      return;
    }

    const handleSystemThemeChange = () => applyThemePreference("system");
    mediaQuery.addEventListener("change", handleSystemThemeChange);
    return () => mediaQuery.removeEventListener("change", handleSystemThemeChange);
  }, [themePreference]);

  return { themePreference, setThemePreference };
}

import type { CSSProperties } from "react";
import { Toaster } from "sonner";
import type { ThemePreference } from "../../lib/theme";
import { APP_TOASTER_ID } from "./appToastConstants";

export function AppToaster({ themePreference }: { themePreference: ThemePreference }) {
  return (
    <Toaster
      id={APP_TOASTER_ID}
      position="bottom-right"
      theme={themePreference}
      offset={{ right: 18, bottom: 18 }}
      mobileOffset={{ right: 14, bottom: 14, left: 14 }}
      duration={4500}
      gap={12}
      visibleToasts={3}
      containerAriaLabel="Maple Timer notifications"
      style={
        {
          "--width": "min(410px, calc(100vw - 32px))",
        } as CSSProperties
      }
    />
  );
}

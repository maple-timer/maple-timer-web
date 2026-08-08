import { Monitor, Moon, Sun } from "lucide-react";
import type { ThemePreference } from "../../lib/theme";
import { MotionSegmentedControl } from "./MotionSegmentedControl";

const THEME_OPTIONS: Array<{
  value: ThemePreference;
  label: string;
  icon: typeof Monitor;
}> = [
  { value: "system", label: "시스템", icon: Monitor },
  { value: "light", label: "라이트", icon: Sun },
  { value: "dark", label: "다크", icon: Moon },
];

export function ThemeModeControl({
  value,
  onChange,
}: {
  value: ThemePreference;
  onChange: (value: ThemePreference) => void;
}) {
  return (
    <MotionSegmentedControl
      ariaLabel="화면 테마"
      className="theme-mode-control"
      optionClassName="theme-mode-option"
      value={value}
      onChange={onChange}
      options={THEME_OPTIONS.map((option) => {
        const Icon = option.icon;
        return {
          value: option.value,
          label: option.label,
          icon: <Icon size={15} />,
          tooltip: `${option.label} 테마`,
          tooltipAlign: "end" as const,
        };
      })}
    />
  );
}

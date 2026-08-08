import NumberFlow from "@number-flow/react";
import type { Format } from "@number-flow/react";
import { useReducedMotion } from "motion/react";
import { useMemo } from "react";

export const SHOULD_RENDER_ANIMATED_NUMBER_TEXT = import.meta.env.MODE === "test";

const DEFAULT_NUMBER_FORMAT: Format = {
  maximumFractionDigits: 0,
  useGrouping: false,
};

export function AnimatedNumber({
  value,
  className,
  locales = "ko-KR",
  format = DEFAULT_NUMBER_FORMAT,
  ariaHidden,
  ariaLabel,
}: {
  value: number;
  className?: string;
  locales?: Intl.LocalesArgument;
  format?: Format;
  ariaHidden?: boolean;
  ariaLabel?: string;
}) {
  const shouldReduceMotion = useReducedMotion();
  const safeValue = Number.isFinite(value) ? value : 0;
  const formattedValue = useMemo(
    () => new Intl.NumberFormat(locales, format).format(safeValue),
    [format, locales, safeValue],
  );

  if (SHOULD_RENDER_ANIMATED_NUMBER_TEXT) {
    return (
      <span className={className} aria-hidden={ariaHidden} aria-label={ariaLabel}>
        {formattedValue}
      </span>
    );
  }

  return (
    <NumberFlow
      aria-hidden={ariaHidden}
      aria-label={ariaLabel}
      className={className}
      value={safeValue}
      locales={locales}
      format={format}
      animated={!shouldReduceMotion}
      transformTiming={{
        duration: 420,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
      }}
      spinTiming={{
        duration: 520,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
      }}
      opacityTiming={{
        duration: 180,
        easing: "ease-out",
      }}
      willChange
    />
  );
}

import type { ReactNode } from "react";
import { AnimatedNumber } from "./AnimatedNumber";

export function CompactMetricCell({
  label,
  children,
  className = "",
  ariaLabel,
}: {
  label?: string;
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <div className={["compact-metric-cell", className].filter(Boolean).join(" ")} aria-label={ariaLabel}>
      {label ? <span className="compact-metric-label">{label}</span> : null}
      <span className="compact-metric-value">{children}</span>
    </div>
  );
}

export function RelativeSecondsMetric({
  timestamp,
  now,
}: {
  timestamp: number | null;
  now: number;
}) {
  if (timestamp === null) {
    return <span className="compact-metric-placeholder">--</span>;
  }

  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  const elapsed = formatRelativeElapsedTime(seconds);
  return (
    <span className="animated-inline-number animated-seconds-value" aria-label={elapsed.label}>
      <AnimatedNumber ariaHidden className="animated-inline-number-flow" value={elapsed.value} />
      <span>{elapsed.unit} 전</span>
    </span>
  );
}

export function CountdownSecondsMetric({
  dueAt,
  now,
}: {
  dueAt: number | null;
  now: number;
}) {
  if (dueAt === null) {
    return <span className="compact-metric-placeholder">--</span>;
  }

  const seconds = Math.ceil((dueAt - now) / 1000);
  if (seconds <= 0) {
    return <span className="compact-metric-plain-value">곧</span>;
  }

  const display = formatCountdownTime(seconds);
  return (
    <span className="animated-inline-number animated-seconds-value" aria-label={display.label}>
      <AnimatedNumber ariaHidden className="animated-inline-number-flow" value={display.value} />
      <span>{display.unit}</span>
    </span>
  );
}

export function formatCountdownTime(seconds: number): {
  value: number;
  unit: "초" | "분";
  label: string;
} {
  const safeSeconds = Math.max(0, Math.ceil(seconds));
  if (safeSeconds < 60) {
    return {
      value: safeSeconds,
      unit: "초",
      label: `${safeSeconds}초`,
    };
  }

  const minutes = Math.max(1, Math.ceil(safeSeconds / 60));
  return {
    value: minutes,
    unit: "분",
    label: `${minutes}분`,
  };
}

export function formatRelativeElapsedTime(seconds: number): {
  value: number;
  unit: "초" | "분";
  label: string;
} {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  if (safeSeconds < 60) {
    return {
      value: safeSeconds,
      unit: "초",
      label: `${safeSeconds}초 전`,
    };
  }

  const minutes = Math.max(1, Math.floor(safeSeconds / 60));
  return {
    value: minutes,
    unit: "분",
    label: `${minutes}분 전`,
  };
}

export function AnimatedMetricText({
  value,
  className = "compact-metric-plain-value",
}: {
  value: string | number;
  className?: string;
}) {
  const text = String(value).trim();
  const countMatch = text.match(/^(\d+)개$/);
  if (countMatch) {
    return (
      <span className={`animated-inline-number ${className}`}>
        <AnimatedNumber ariaHidden className="animated-inline-number-flow" value={Number(countMatch[1])} />
        <span>개</span>
      </span>
    );
  }

  const timeMatch = text.match(/^(\d+):(\d{2})$/);
  if (timeMatch) {
    return (
      <span className={`animated-inline-number ${className}`} aria-label={text}>
        <AnimatedNumber ariaHidden className="animated-inline-number-flow" value={Number(timeMatch[1])} />
        <span className="animated-time-separator">:</span>
        <AnimatedNumber
          ariaHidden
          className="animated-inline-number-flow"
          value={Number(timeMatch[2])}
          format={{
            minimumIntegerDigits: 2,
            maximumFractionDigits: 0,
            useGrouping: false,
          }}
        />
      </span>
    );
  }

  const decimalMatch = text.match(/^-?\d+\.(\d+)$/);
  if (decimalMatch) {
    return (
      <span className={`animated-inline-number ${className}`}>
        <AnimatedNumber
          ariaHidden
          className="animated-inline-number-flow"
          value={Number(text)}
          format={{
            minimumFractionDigits: decimalMatch[1].length,
            maximumFractionDigits: decimalMatch[1].length,
            useGrouping: false,
          }}
        />
      </span>
    );
  }

  if (/^-?\d+$/.test(text)) {
    return (
      <span className={`animated-inline-number ${className}`}>
        <AnimatedNumber ariaHidden className="animated-inline-number-flow" value={Number(text)} />
      </span>
    );
  }

  return <span className={className}>{text}</span>;
}

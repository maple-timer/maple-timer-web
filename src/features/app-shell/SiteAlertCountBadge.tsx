import { AnimatePresence, m as motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import type { GlobalAlertCountSnapshot } from "../../lib/globalAlertCounter";
import { getSubtlePressMotion } from "../../shared/motionPresets";
import { AnimatedNumber } from "../../shared/components/AnimatedNumber";

type AlertCountPeriod = "total" | "today" | "last7Days" | "month";

const ALERT_COUNT_AUTO_CYCLE_MS = 7_000;

const ALERT_COUNT_PERIODS: Array<{
  id: AlertCountPeriod;
  label: string;
  ariaLabel: string;
}> = [
  { id: "total", label: "전체", ariaLabel: "전체" },
  { id: "today", label: "오늘", ariaLabel: "오늘" },
  { id: "last7Days", label: "일주일", ariaLabel: "최근 일주일" },
  { id: "month", label: "한 달", ariaLabel: "최근 한 달" },
];

export function SiteAlertCountBadge({
  className = "",
  snapshot,
}: {
  className?: string;
  snapshot: GlobalAlertCountSnapshot | null;
}) {
  const [period, setPeriod] = useState<AlertCountPeriod>("total");
  const [isAutoCyclePaused, setIsAutoCyclePaused] = useState(false);
  const [isPageVisible, setIsPageVisible] = useState(
    () => typeof document === "undefined" || document.visibilityState === "visible",
  );
  const selectedPeriod = ALERT_COUNT_PERIODS.find((item) => item.id === period) ?? ALERT_COUNT_PERIODS[0];
  const count = snapshot?.counts[period] ?? null;
  const formattedCount = useMemo(
    () => new Intl.NumberFormat("ko-KR").format(count ?? 0),
    [count],
  );
  const shouldReduceMotion = useReducedMotion();
  const reducedMotion = Boolean(shouldReduceMotion);

  useEffect(() => {
    if (typeof document === "undefined") {
      return undefined;
    }

    const updateVisibility = () => {
      setIsPageVisible(document.visibilityState === "visible");
    };
    updateVisibility();
    document.addEventListener("visibilitychange", updateVisibility);
    return () => document.removeEventListener("visibilitychange", updateVisibility);
  }, []);

  useEffect(() => {
    if (count === null || reducedMotion || isAutoCyclePaused || !isPageVisible) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setPeriod(getNextAlertCountPeriod);
    }, ALERT_COUNT_AUTO_CYCLE_MS);

    return () => window.clearTimeout(timeoutId);
  }, [count, isAutoCyclePaused, isPageVisible, period, reducedMotion]);

  if (count === null) {
    return null;
  }

  return (
    <motion.button
      className={`site-alert-count ${className}`.trim()}
      type="button"
      data-header-tooltip="메이플 타이머가 알려준 알림 횟수"
      aria-label={`메이플 타이머가 알려준 ${selectedPeriod.ariaLabel} 알림 횟수 ${formattedCount}회`}
      onBlur={() => setIsAutoCyclePaused(false)}
      onClick={() => setPeriod(getNextAlertCountPeriod)}
      onFocus={() => setIsAutoCyclePaused(true)}
      onMouseEnter={() => setIsAutoCyclePaused(true)}
      onMouseLeave={() => setIsAutoCyclePaused(false)}
      {...getAlertCountPressMotion(reducedMotion)}
    >
      <PeriodLabel label={selectedPeriod.label} reducedMotion={reducedMotion} />
      <strong className="site-alert-count-number" aria-hidden="true">
        <AnimatedNumber
          className="site-alert-number-flow"
          value={count}
          format={{
            useGrouping: true,
            maximumFractionDigits: 0,
          }}
        />
      </strong>
      <span className="site-alert-count-suffix">회</span>
    </motion.button>
  );
}

function getNextAlertCountPeriod(current: AlertCountPeriod): AlertCountPeriod {
  const index = ALERT_COUNT_PERIODS.findIndex((item) => item.id === current);
  return ALERT_COUNT_PERIODS[(index + 1) % ALERT_COUNT_PERIODS.length].id;
}

function PeriodLabel({
  label,
  reducedMotion,
}: {
  label: string;
  reducedMotion: boolean;
}) {
  return (
    <span className="site-alert-count-period" aria-hidden="true">
      <AnimatePresence initial={false}>
        <motion.span
          key={label}
          className="site-alert-count-period-value"
          initial={reducedMotion ? false : { y: "100%", opacity: 0 }}
          animate={{ y: "0%", opacity: 1 }}
          exit={reducedMotion ? undefined : { y: "-100%", opacity: 0 }}
          transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
        >
          {label}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

function getAlertCountPressMotion(reducedMotion: boolean) {
  const motionProps = getSubtlePressMotion(reducedMotion);
  return {
    ...motionProps,
    whileHover: undefined,
  };
}

import { Heart } from "lucide-react";
import { m as motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { createMapleTimerApiUrl } from "../../lib/mapleTimerApi";
import type { ThemePreference } from "../../lib/theme";
import { ThemeModeControl } from "../../shared/components/ThemeModeControl";
import { getSubtlePressMotion } from "../../shared/motionPresets";
import {
  MAPLE_TIMER_SUPPORTERS,
  type MapleTimerSupporter,
  isMapleTimerSupporter,
} from "./supporters";

const SUPPORTERS_API_URL = createMapleTimerApiUrl("/v1/supporters");
const SUPPORTERS_REFRESH_MS = 60 * 60 * 1000;

export function SupporterThanksRail({
  themePreference,
  onOpenDonation,
  onThemePreferenceChange,
}: {
  themePreference?: ThemePreference;
  onOpenDonation: () => void;
  onThemePreferenceChange?: (preference: ThemePreference) => void;
}) {
  const shouldReduceMotion = useReducedMotion();
  const pressMotion = getSubtlePressMotion(Boolean(shouldReduceMotion));
  const supporters = useSupporters();

  if (supporters.length === 0) {
    return null;
  }

  return (
    <div className="supporter-thanks-top-row">
      <motion.button
        className="supporter-thanks-rail"
        type="button"
        aria-label="Maple Timer 후원자 감사 명단 보기"
        onClick={onOpenDonation}
        {...pressMotion}
      >
        <span className="supporter-thanks-label" aria-hidden="true">
          <span className="supporter-thanks-signal">
            <Heart size={11} strokeWidth={2.4} />
          </span>
          후원 감사
        </span>
        <span className="supporter-thanks-window" aria-hidden="true">
          <span className="supporter-thanks-track">
            <SupporterGroup supporters={supporters} />
          </span>
        </span>
      </motion.button>
      {themePreference && onThemePreferenceChange ? (
        <div className="supporter-thanks-theme">
          <ThemeModeControl value={themePreference} onChange={onThemePreferenceChange} />
        </div>
      ) : null}
    </div>
  );
}

function SupporterGroup({ supporters }: { supporters: MapleTimerSupporter[] }) {
  return (
    <span className="supporter-thanks-group">
      {supporters.map((supporter) => (
        <span
          className="supporter-thanks-item"
          key={`${supporter.worldId}-${supporter.nickname}`}
        >
          <span className={`supporter-thanks-world supporter-world-${supporter.worldId}`}>
            {supporter.worldName}
          </span>
          <span className="supporter-thanks-name">{supporter.nickname}</span>
        </span>
      ))}
    </span>
  );
}

function useSupporters() {
  const [supporters, setSupporters] = useState<MapleTimerSupporter[]>(MAPLE_TIMER_SUPPORTERS);

  useEffect(() => {
    let isMounted = true;
    let abortController: AbortController | null = null;

    const refreshSupporters = async () => {
      abortController?.abort();
      abortController = new AbortController();
      const nextSupporters = await fetchSupporters(abortController.signal);
      if (isMounted && nextSupporters) {
        setSupporters(nextSupporters);
      }
    };

    void refreshSupporters();
    const intervalId = window.setInterval(refreshSupporters, SUPPORTERS_REFRESH_MS);

    return () => {
      isMounted = false;
      abortController?.abort();
      window.clearInterval(intervalId);
    };
  }, []);

  return supporters;
}

async function fetchSupporters(signal: AbortSignal): Promise<MapleTimerSupporter[] | null> {
  try {
    const response = await fetch(SUPPORTERS_API_URL, {
      signal,
    });
    if (!response.ok) {
      return null;
    }

    const payload = await response.json() as {
      available?: unknown;
      supporters?: unknown;
    };
    if (payload.available !== true || !Array.isArray(payload.supporters)) {
      return null;
    }

    return payload.supporters.filter(isMapleTimerSupporter);
  } catch {
    return null;
  }
}

import { useEffect, useState } from "react";
import { fetchGlobalAlertCount, type GlobalAlertCountSnapshot } from "../../lib/globalAlertCounter";

const DESKTOP_MEDIA_QUERY = "(min-width: 761px)";
const ALERT_COUNT_RETRY_INTERVAL_MS = 5 * 60 * 1000;

type SiteAlertCountState =
  | { status: "hidden"; snapshot: null }
  | { status: "ready"; snapshot: GlobalAlertCountSnapshot };

export function useSiteAlertCount(): SiteAlertCountState {
  const [state, setState] = useState<SiteAlertCountState>({ status: "hidden", snapshot: null });
  const [enabled, setEnabled] = useState(() => shouldEnableSiteAlertCount());

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const media = window.matchMedia(DESKTOP_MEDIA_QUERY);
    const handleChange = () => setEnabled(media.matches);
    handleChange();
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    if (!enabled) {
      setState({ status: "hidden", snapshot: null });
      return;
    }

    let disposed = false;
    let timer: number | null = null;
    let abortController: AbortController | null = null;

    const schedule = (intervalMs: number) => {
      if (disposed) {
        return;
      }
      timer = window.setTimeout(load, intervalMs);
    };

    const load = () => {
      abortController?.abort();
      abortController = new AbortController();

      void fetchGlobalAlertCount(abortController.signal)
        .then((snapshot) => {
          if (disposed) {
            return;
          }
          setState({ status: "ready", snapshot });
          schedule(snapshot.pollIntervalMs);
        })
        .catch(() => {
          if (disposed) {
            return;
          }
          setState({ status: "hidden", snapshot: null });
          schedule(ALERT_COUNT_RETRY_INTERVAL_MS);
        });
    };

    load();

    return () => {
      disposed = true;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
      abortController?.abort();
    };
  }, [enabled]);

  return state;
}

function shouldEnableSiteAlertCount() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return true;
  }

  return window.matchMedia(DESKTOP_MEDIA_QUERY).matches;
}

const DEFAULT_MAPLE_TIMER_API_BASE_URL = "https://api.maple-timer.com";

const MAPLE_TIMER_API_BASE_URL =
  import.meta.env.VITE_MAPLE_TIMER_API_BASE_URL?.trim() ||
  DEFAULT_MAPLE_TIMER_API_BASE_URL;

export function createMapleTimerApiUrl(path: string) {
  return new URL(path, MAPLE_TIMER_API_BASE_URL).toString();
}

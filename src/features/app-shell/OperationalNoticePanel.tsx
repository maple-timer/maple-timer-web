import {
  CheckCircle2,
  Info,
  Siren,
  TriangleAlert,
  Wrench,
  X,
} from "lucide-react";
import { AnimatePresence, m as motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchOperationalNotices,
  type OperationalNotice,
  type OperationalNoticeLevel,
} from "./operationalNotices";

const DISMISSED_NOTICES_STORAGE_KEY = "maple-timer.operational-notices.dismissed.v1";
const POLL_JITTER_MS = 10_000;

export function OperationalNoticePanel() {
  const [notices, setNotices] = useState<OperationalNotice[]>([]);
  const [hasResolvedNotices, setHasResolvedNotices] = useState(false);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(loadDismissedNoticeIds);
  const pollIntervalMsRef = useRef(60_000);
  const shouldReduceMotion = useReducedMotion();

  useEffect(() => {
    let isMounted = true;
    let abortController: AbortController | null = null;
    let timeoutId: number | null = null;

    const refresh = async () => {
      abortController?.abort();
      abortController = new AbortController();

      try {
        const snapshot = await fetchOperationalNotices(abortController.signal);
        if (!isMounted) {
          return;
        }
        setNotices(snapshot.available ? snapshot.notices : []);
        setHasResolvedNotices(snapshot.available);
        pollIntervalMsRef.current = snapshot.pollIntervalMs;
      } catch {
        if (isMounted) {
          setNotices([]);
          setHasResolvedNotices(false);
        }
      } finally {
        if (isMounted) {
          const jitter = Math.floor(Math.random() * POLL_JITTER_MS);
          timeoutId = window.setTimeout(refresh, pollIntervalMsRef.current + jitter);
        }
      }
    };

    void refresh();

    return () => {
      isMounted = false;
      abortController?.abort();
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, []);

  const visibleNotices = useMemo(() => {
    const primaryNotice = hasResolvedNotices ? notices[0] ?? null : null;
    if (!primaryNotice || dismissedIds.has(primaryNotice.id)) {
      return [];
    }
    return [primaryNotice];
  }, [dismissedIds, hasResolvedNotices, notices]);

  const dismissNotice = (noticeId: string) => {
    setDismissedIds((current) => {
      const next = new Set(current);
      next.add(noticeId);
      saveDismissedNoticeIds(next);
      return next;
    });
  };

  return (
    <AnimatePresence initial={false}>
      {visibleNotices.length > 0 && (
        <motion.section
          className="operational-notice-panel"
          aria-label="운영 공지"
          initial={shouldReduceMotion ? false : { opacity: 0, y: -8 }}
          animate={shouldReduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
          exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
          transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
        >
          {visibleNotices.map((notice) => (
            <OperationalNoticeCard
              key={notice.id}
              notice={notice}
              onDismiss={() => dismissNotice(notice.id)}
            />
          ))}
        </motion.section>
      )}
    </AnimatePresence>
  );
}

function OperationalNoticeCard({
  notice,
  onDismiss,
}: {
  notice: OperationalNotice;
  onDismiss: () => void;
}) {
  const Icon = getNoticeIcon(notice.level);

  return (
    <article className={`operational-notice-card level-${notice.level}`}>
      <div className="operational-notice-icon" aria-hidden="true">
        <Icon size={18} strokeWidth={2.2} />
      </div>
      <div className="operational-notice-content">
        <div className="operational-notice-title-row">
          <strong>{notice.title}</strong>
          <span>{formatUpdatedAt(notice.updatedAt)}</span>
        </div>
        {notice.body && <p>{notice.body}</p>}
      </div>
      <div className="operational-notice-actions">
        {notice.link && (
          <a
            className="operational-notice-link"
            href={notice.link.href}
            target="_blank"
            rel="noreferrer"
          >
            {notice.link.label}
          </a>
        )}
        {notice.dismissible && (
          <button
            className="icon-button small operational-notice-dismiss"
            type="button"
            aria-label={`${notice.title} 공지 닫기`}
            onClick={onDismiss}
          >
            <X size={15} />
          </button>
        )}
      </div>
    </article>
  );
}

function getNoticeIcon(level: OperationalNoticeLevel) {
  switch (level) {
    case "success":
      return CheckCircle2;
    case "warning":
      return TriangleAlert;
    case "critical":
      return Siren;
    case "maintenance":
      return Wrench;
    case "info":
    default:
      return Info;
  }
}

function formatUpdatedAt(value: string | null): string {
  if (!value) {
    return "실시간 공지";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "실시간 공지";
  }
  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function loadDismissedNoticeIds(): Set<string> {
  if (typeof localStorage === "undefined") {
    return new Set();
  }

  try {
    const parsed = JSON.parse(localStorage.getItem(DISMISSED_NOTICES_STORAGE_KEY) ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((value) => typeof value === "string") : []);
  } catch {
    return new Set();
  }
}

function saveDismissedNoticeIds(ids: Set<string>) {
  if (typeof localStorage === "undefined") {
    return;
  }
  localStorage.setItem(DISMISSED_NOTICES_STORAGE_KEY, JSON.stringify([...ids].slice(-30)));
}

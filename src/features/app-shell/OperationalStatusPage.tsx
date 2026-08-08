import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchOperationalNotices,
  type OperationalIncident,
  type OperationalIncidentStatus,
  type OperationalNotice,
} from "./operationalNotices";

type StatusState =
  | { kind: "loading"; incidents: OperationalIncident[]; notices: OperationalNotice[] }
  | { kind: "ready"; incidents: OperationalIncident[]; notices: OperationalNotice[] }
  | { kind: "unavailable"; incidents: OperationalIncident[]; notices: OperationalNotice[] };

const DEFAULT_STATUS_POLL_INTERVAL_MS = 60_000;
const STATUS_POLL_JITTER_MS = 10_000;

export function OperationalStatusPage() {
  const [status, setStatus] = useState<StatusState>({ kind: "loading", incidents: [], notices: [] });
  const pollIntervalMsRef = useRef(DEFAULT_STATUS_POLL_INTERVAL_MS);

  const refreshStatus = useCallback(async (signal?: AbortSignal) => {
    try {
      const snapshot = await fetchOperationalNotices(signal);
      pollIntervalMsRef.current = snapshot.pollIntervalMs;
      setStatus({
        kind: snapshot.available ? "ready" : "unavailable",
        incidents: snapshot.incidents,
        notices: snapshot.notices,
      });
    } catch {
      setStatus({ kind: "unavailable", incidents: [], notices: [] });
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    const abortController = new AbortController();
    let timeoutId: number | null = null;

    const poll = async () => {
      await refreshStatus(abortController.signal);
      if (!isMounted) {
        return;
      }
      const jitter = Math.floor(Math.random() * STATUS_POLL_JITTER_MS);
      timeoutId = window.setTimeout(poll, pollIntervalMsRef.current + jitter);
    };

    void poll();

    return () => {
      isMounted = false;
      abortController.abort();
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [refreshStatus]);

  const hasIncidents = status.incidents.length > 0;
  const hasLegacyNotices = !hasIncidents && status.notices.length > 0;

  return (
    <main className="app-shell operational-status-page">
      <section className="operational-status-hero" aria-label="Maple Timer 상태">
        <div>
          <span className={`operational-status-dot status-${status.kind}`} aria-hidden="true" />
          <p>Maple Timer 상태</p>
        </div>
        <a className="operational-status-action" href="/">
          앱으로 돌아가기
        </a>
      </section>

      <section className="operational-status-panel" aria-label="운영 안내">
        <div className="operational-status-panel-heading">
          <h2>운영 안내</h2>
          <button
            className="operational-status-action"
            type="button"
            onClick={() => void refreshStatus()}
          >
            <RefreshCw size={15} />
            새로고침
          </button>
        </div>
        {status.kind === "loading" ? (
          <p className="operational-status-empty">상태 정보를 확인하는 중입니다.</p>
        ) : hasIncidents ? (
          <div className="operational-incident-list">
            {status.incidents.map((incident) => (
              <OperationalIncidentCard key={incident.id} incident={incident} />
            ))}
          </div>
        ) : hasLegacyNotices ? (
          <LegacyNoticeList notices={status.notices} />
        ) : (
          <p className="operational-status-empty">
            현재 공지 중인 장애나 점검 안내가 없습니다.
          </p>
        )}
      </section>
    </main>
  );
}

function OperationalIncidentCard({ incident }: { incident: OperationalIncident }) {
  return (
    <article id={incident.id} className={`operational-incident-card level-${incident.level}`}>
      <div className="operational-incident-main">
        <div className="operational-incident-title-row">
          <div>
            <span className={`operational-incident-status status-${incident.status}`}>
              {getIncidentStatusLabel(incident.status)}
            </span>
            <h3>{incident.title}</h3>
          </div>
          <time dateTime={incident.updatedAt}>업데이트 {formatDateTime(incident.updatedAt)}</time>
        </div>

        {incident.summary && <p className="operational-incident-summary">{incident.summary}</p>}

        <dl className="operational-incident-meta">
          <div>
            <dt>발생</dt>
            <dd>{formatDateTime(incident.startedAt)}</dd>
          </div>
          <div>
            <dt>영향</dt>
            <dd>{incident.affected.length ? incident.affected.join(", ") : "확인 중"}</dd>
          </div>
          {incident.resolvedAt && (
            <div>
              <dt>해결</dt>
              <dd>{formatDateTime(incident.resolvedAt)}</dd>
            </div>
          )}
        </dl>
      </div>

      {incident.updates.length > 0 && (
        <ol className="operational-incident-timeline" aria-label={`${incident.title} 진행 내역`}>
          {incident.updates.map((update) => (
            <li key={update.id}>
              <span className={`operational-incident-timeline-dot status-${update.status}`} aria-hidden="true" />
              <div>
                <div className="operational-incident-timeline-heading">
                  <strong>{getIncidentStatusLabel(update.status)}</strong>
                  <time dateTime={update.createdAt}>{formatDateTime(update.createdAt)}</time>
                </div>
                {update.body && <p>{update.body}</p>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}

function LegacyNoticeList({ notices }: { notices: OperationalNotice[] }) {
  return (
    <ul className="operational-status-list">
      {notices.map((notice) => (
        <li key={notice.id} className={`level-${notice.level}`}>
          <strong>{notice.title}</strong>
          {notice.body && <p>{notice.body}</p>}
        </li>
      ))}
    </ul>
  );
}

function getIncidentStatusLabel(status: OperationalIncidentStatus) {
  switch (status) {
    case "identified":
      return "원인 파악";
    case "monitoring":
      return "모니터링";
    case "resolved":
      return "해결 완료";
    case "maintenance":
      return "점검";
    case "investigating":
    default:
      return "확인 중";
  }
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--";
  }
  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

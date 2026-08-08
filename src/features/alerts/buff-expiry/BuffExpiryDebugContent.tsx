import type {
  BuffExpiryPendingTrack,
  BuffExpiryRuntimeState,
  BuffExpirySnapshot,
  BuffExpiryTrackedBuff,
} from "../../../lib/buffExpiry/buffExpiryTypes";

const BUFF_EXPIRY_DEBUG_STRONG_CONFIRM_MIN_OBSERVATIONS = 2;
const BUFF_EXPIRY_DEBUG_WEAK_CONFIRM_MIN_OBSERVATIONS = 3;
const BUFF_EXPIRY_DEBUG_CONFIRM_SPREAD_MS = 2000;

export function BuffExpiryDebugContent({
  state,
  snapshot,
}: {
  state: BuffExpiryRuntimeState;
  snapshot: BuffExpirySnapshot | null;
}) {
  const debugNow = state.lastSampledAt ?? Date.now();

  return (
    <div className="hunt-debug-panel">
      <div className="hunt-debug-grid">
        <div>
          <strong>ROI</strong>
          <span>{snapshot?.rawPreviewUrl ? "있음" : "없음"}</span>
        </div>
        <div>
          <strong>버프칸</strong>
          <span>{snapshot?.boxes.length ?? 0}개</span>
        </div>
        <div>
          <strong>매칭</strong>
          <span>{snapshot?.acceptedMatches.length ?? 0}개</span>
        </div>
        <div>
          <strong>처리</strong>
          <span>{snapshot?.performance ? `${snapshot.performance.totalMs.toFixed(1)}ms` : "-"}</span>
        </div>
        <div>
          <strong>확정</strong>
          <span>{state.tracks.length}개</span>
        </div>
        <div>
          <strong>확인 후보</strong>
          <span>{state.pendingTracks.length}개</span>
        </div>
      </div>
      <details className="hunt-debug-details" open>
        <summary>버프 종료 확인 상태</summary>
        <div className="hunt-debug-diagnostics">
          {state.tracks.length ? (
            state.tracks.map((track) => (
              <span className="hunt-debug-chip hunt-debug-wide-chip" key={track.id}>
                <em>{track.name}</em>
                <strong>{getConfirmedTrackDebugText(track, debugNow)}</strong>
              </span>
            ))
          ) : (
            <span className="hunt-debug-chip">
              <em>확정</em>
              <strong>없음</strong>
            </span>
          )}
          {state.pendingTracks.length ? (
            state.pendingTracks.map((track) => (
              <span className="hunt-debug-chip hunt-debug-wide-chip" key={track.id}>
                <em>{track.name}</em>
                <strong>{getPendingTrackDebugText(track)}</strong>
              </span>
            ))
          ) : (
            <span className="hunt-debug-chip">
              <em>확인 후보</em>
              <strong>없음</strong>
            </span>
          )}
        </div>
      </details>
      {snapshot?.rawPreviewUrl && (
        <div className="hunt-debug-previews">
          <figure>
            <img src={snapshot.rawPreviewUrl} alt="버프 종료 감지 ROI" />
            <figcaption>ROI</figcaption>
          </figure>
          {snapshot.processedPreviewUrl && (
            <figure>
              <img src={snapshot.processedPreviewUrl} alt="버프 종료 감지 후보 표시" />
              <figcaption>후보 표시</figcaption>
            </figure>
          )}
          {snapshot.fullFramePreviewUrl && (
            <figure>
              <img src={snapshot.fullFramePreviewUrl} alt="버프 종료 감지 전체 화면" />
              <figcaption>전체 화면</figcaption>
            </figure>
          )}
        </div>
      )}
    </div>
  );
}

function getConfirmedTrackDebugText(track: BuffExpiryTrackedBuff, now: number): string {
  const remainingSeconds = Math.max(0, Math.ceil((track.expiresAt - now) / 1000));
  return `${remainingSeconds}초 남음 · ${track.alertedAt === null ? "알림 전" : "알림 완료"}`;
}

function getPendingTrackDebugText(track: BuffExpiryPendingTrack): string {
  const secondsText = track.observations.map((observation) => `${observation.seconds}초`).join(" -> ");
  const expiresSpreadMs = getPendingExpiresSpreadMs(track);
  const minimumObservations = track.observations.some((observation) => observation.strength === "strong")
    ? BUFF_EXPIRY_DEBUG_STRONG_CONFIRM_MIN_OBSERVATIONS
    : BUFF_EXPIRY_DEBUG_WEAK_CONFIRM_MIN_OBSERVATIONS;
  const strengthText = track.observations.some((observation) => observation.strength === "strong")
    ? "강한 후보 포함"
    : "약한 후보";
  const reason =
    track.observations.length < minimumObservations
      ? "관측 부족"
      : expiresSpreadMs > BUFF_EXPIRY_DEBUG_CONFIRM_SPREAD_MS
        ? "초 흔들림"
        : "확정 가능";

  return `${track.observations.length}회 · ${secondsText || "-"} · ${formatDebugMs(expiresSpreadMs)} · ${strengthText} · ${reason}`;
}

function getPendingExpiresSpreadMs(track: BuffExpiryPendingTrack): number {
  if (track.observations.length < 2) {
    return 0;
  }

  const predictedExpiresAt = track.observations.map(
    (observation) => observation.observedAt + observation.seconds * 1000,
  );
  return Math.max(...predictedExpiresAt) - Math.min(...predictedExpiresAt);
}

function formatDebugMs(value: number): string {
  if (value < 1000) {
    return `${Math.round(value)}ms`;
  }
  return `${(value / 1000).toFixed(1)}초`;
}

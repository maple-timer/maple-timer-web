import type {
  BuffExpiryPendingTrack,
  BuffExpiryRuntimeState,
  BuffExpiryTrackedBuff,
} from "../../../lib/buffExpiry/buffExpiryTypes";
import { getBuffExpiryRemainingSeconds } from "../../../lib/buffExpiry/buffExpiryRuntimeTiming";

export type BuffExpiryStatusView = {
  label: string;
  detail: string | null;
  className: string;
  activeTrackCount?: number;
  remainingSeconds?: number;
};

export function getBuffExpiryStatusView(
  state: BuffExpiryRuntimeState,
  hasStream: boolean,
  enabled: boolean,
  isGameViewportReady = true,
): BuffExpiryStatusView {
  const now = Date.now();
  if (!enabled) {
    return { label: "중지", detail: "알림 꺼짐", className: "paused" };
  }
  if (!hasStream) {
    return {
      label: "화면 공유 필요",
      detail: "화면 공유 후 버프칸 확인",
      className: "no-stream",
    };
  }
  if (!isGameViewportReady) {
    return {
      label: "게임 영역 설정 필요",
      detail: "화면 공유 메뉴에서 게임 영역 설정",
      className: "warning",
    };
  }
  if (state.status === "unsupported") {
    return { label: "지원 해상도 아님", detail: state.unsupportedReason, className: "warning" };
  }
  if (state.status === "unavailable") {
    return { label: "감지 오류", detail: state.unsupportedReason, className: "warning" };
  }
  if (state.tracks.length) {
    const activeTracks = state.tracks.filter((track) => track.alertedAt === null);
    const nextTrack = getNearestExpiringTrack(activeTracks);
    const remainingSeconds = nextTrack ? getBuffExpiryRemainingSeconds(nextTrack, now) : null;
    if (!activeTracks.length) {
      return {
        label: "알림 완료",
        detail: "다음 버프를 기다리는 중",
        className: "alerted",
      };
    }
    return {
      label: "알림 대기",
      detail: "알림 예정",
      className: "active",
      activeTrackCount: activeTracks.length,
      remainingSeconds: remainingSeconds ?? undefined,
    };
  }
  const displayablePendingTracks = state.pendingTracks.filter(isDisplayablePendingTrack);
  const confirmationCandidateCount = Math.max(
    displayablePendingTracks.length,
    state.confirmationCandidateCount ?? 0,
  );
  if (confirmationCandidateCount) {
    return {
      label: "시간 확인 중",
      detail: "남은 시간 흐름 확인 중",
      className: "candidate",
    };
  }

  return {
    label: "감지 대기",
    detail: state.boxCount > 0 ? "지원 버프를 찾는 중" : "버프칸 확인 중",
    className: "waiting",
  };
}

export function getNearestExpiringTrack(tracks: BuffExpiryTrackedBuff[]): BuffExpiryTrackedBuff | null {
  return [...tracks].sort((a, b) => a.expiresAt - b.expiresAt)[0] ?? null;
}

function isDisplayablePendingTrack(track: BuffExpiryPendingTrack): boolean {
  if (track.observations.length >= 2) {
    return true;
  }
  return track.observations.some((observation) => observation.strength === "strong");
}

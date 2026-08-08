import { type CSSProperties } from "react";
import { AnimatePresence, m as motion } from "motion/react";
import type { BuffExpiryLastAlertEvidence } from "../../../lib/buffExpiry/buffExpiryTypes";
import type { BuffExpiryPrecisionTargetGroup } from "../../../lib/buffExpiryPrecision/buffExpiryPrecisionTypes";
import { formatRelativeElapsedTime } from "../../../shared/components/CompactMetricCell";
import {
  BUFF_EXPIRY_PRECISION_GROUP_LABELS,
  BUFF_EXPIRY_PRECISION_TARGET_GROUP_MAX_VISIBLE,
  BUFF_EXPIRY_PRECISION_TARGET_GROUPS,
  getBuffExpiryPrecisionGroupFromBuffId,
} from "./buffExpiryPrecisionTargetSlots";
import { BUFF_EXPIRY_DETAIL_TRANSITION } from "./BuffExpiryPrecisionDetectedMotion";

export function BuffExpiryPrecisionRecentAlertBoard({
  evidence,
  now,
  reduceMotion,
}: {
  evidence: BuffExpiryLastAlertEvidence | null;
  now: number;
  reduceMotion: boolean;
}) {
  const tracksByGroup = getBuffExpiryPrecisionRecentAlertTracksByGroup(evidence);
  const headingMeta = getBuffExpiryPrecisionRecentAlertHeadingMeta(evidence, now);

  return (
    <section className="buff-expiry-precision-detected-group buff-expiry-precision-recent-alert buff-expiry-precision-recent-board">
      <div className="buff-expiry-precision-detected-heading">
        <strong>최근 알림</strong>
        <span>{headingMeta}</span>
      </div>
      <div className="buff-expiry-precision-target-grid">
        {BUFF_EXPIRY_PRECISION_TARGET_GROUPS.map((group) => {
          const tracks = tracksByGroup.get(group) ?? [];
          const maxVisible = BUFF_EXPIRY_PRECISION_TARGET_GROUP_MAX_VISIBLE[group];
          const slots = Array.from({ length: maxVisible }, (_, index) => tracks[index] ?? null);
          return (
            <section className="buff-expiry-precision-target-cell" key={group}>
              <div className="buff-expiry-precision-target-cell-heading">
                <strong>{BUFF_EXPIRY_PRECISION_GROUP_LABELS[group]}</strong>
                <span>{tracks.length} / {maxVisible}</span>
              </div>
              <div
                className="buff-expiry-precision-target-cell-icons"
                style={{
                  "--buff-expiry-precision-target-slots": maxVisible,
                } as CSSProperties}
              >
                {slots.map((track, index) => (
                  <div
                    className="buff-expiry-precision-target-slot"
                    data-group={group}
                    data-slot-index={index}
                    key={`${group}:${track?.id ?? `empty-${index}`}`}
                  >
                    <AnimatePresence initial={false}>
                      {track ? (
                        <BuffExpiryPrecisionRecentAlertCard
                          key={track.id}
                          track={track}
                          reduceMotion={reduceMotion}
                        />
                      ) : (
                        <motion.div
                          className="buff-expiry-precision-target-empty buff-expiry-precision-recent-empty-slot"
                          aria-label={`${BUFF_EXPIRY_PRECISION_GROUP_LABELS[group]} 최근 알림 없음`}
                          initial={reduceMotion ? false : { opacity: 0 }}
                          animate={reduceMotion ? undefined : { opacity: 1 }}
                          exit={reduceMotion ? undefined : { opacity: 0 }}
                          transition={reduceMotion ? undefined : BUFF_EXPIRY_DETAIL_TRANSITION}
                        >
                          없음
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </section>
  );
}

function getBuffExpiryPrecisionRecentAlertHeadingMeta(
  evidence: BuffExpiryLastAlertEvidence | null,
  now: number,
): string {
  if (!evidence) {
    return "없음";
  }
  const elapsed = formatRelativeElapsedTime(Math.max(0, Math.floor((now - evidence.alertedAt) / 1000)));
  return elapsed.label;
}

function getBuffExpiryPrecisionRecentAlertTracksByGroup(
  evidence: BuffExpiryLastAlertEvidence | null,
): Map<BuffExpiryPrecisionTargetGroup, BuffExpiryLastAlertEvidence["triggeredTracks"]> {
  const tracksByGroup = new Map<BuffExpiryPrecisionTargetGroup, BuffExpiryLastAlertEvidence["triggeredTracks"]>();
  for (const group of BUFF_EXPIRY_PRECISION_TARGET_GROUPS) {
    tracksByGroup.set(group, []);
  }
  for (const track of evidence?.triggeredTracks ?? []) {
    const group = getBuffExpiryPrecisionGroupFromBuffId(track.buffId);
    if (!group) {
      continue;
    }
    const tracks = tracksByGroup.get(group) ?? [];
    if (tracks.length >= BUFF_EXPIRY_PRECISION_TARGET_GROUP_MAX_VISIBLE[group]) {
      continue;
    }
    tracksByGroup.set(group, [...tracks, track]);
  }
  return tracksByGroup;
}

function BuffExpiryPrecisionRecentAlertCard({
  track,
  reduceMotion,
}: {
  track: BuffExpiryLastAlertEvidence["triggeredTracks"][number];
  reduceMotion: boolean;
}) {
  const cropStyle: CSSProperties | null = track.normalizedIconDataUrl
    ? {
        backgroundImage: `url(${track.normalizedIconDataUrl})`,
        backgroundSize: "32px 32px",
      }
    : null;

  return (
    <motion.div
      className="buff-expiry-detected-card icon-only recent-alert"
      aria-label={`${track.name} 최근 알림 · ${track.remainingSeconds}초 기준으로 알림`}
      initial={reduceMotion ? false : { opacity: 0, scale: 0.92 }}
      animate={reduceMotion ? undefined : { opacity: 1, scale: 1 }}
      exit={reduceMotion ? undefined : { opacity: 0, scale: 0.92 }}
      transition={reduceMotion ? undefined : BUFF_EXPIRY_DETAIL_TRANSITION}
    >
      {cropStyle ? (
        <span className="buff-expiry-detected-crop" style={cropStyle} aria-hidden="true" />
      ) : (
        <span className="buff-expiry-detected-placeholder" aria-hidden="true" />
      )}
      <span className="buff-expiry-detected-countdown" aria-hidden="true">
        {track.remainingSeconds}초
      </span>
    </motion.div>
  );
}

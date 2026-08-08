import { type CSSProperties, useRef } from "react";
import { AnimatePresence, m as motion } from "motion/react";
import type { BuffExpirySnapshot } from "../../../lib/buffExpiry/buffExpiryTypes";
import type { BuffExpiryPrecisionTargetGroup } from "../../../lib/buffExpiryPrecision/buffExpiryPrecisionTypes";
import {
  InfoTooltip,
  TooltipHelpContent,
} from "../../../shared/components/FloatingTooltip";
import { ImageDataCanvas } from "../../../shared/components/ImageDataCanvas";
import {
  BUFF_EXPIRY_PRECISION_GROUP_LABELS,
  BUFF_EXPIRY_PRECISION_TARGET_GROUP_MAX_VISIBLE,
  BUFF_EXPIRY_PRECISION_TARGET_GROUPS,
  getBuffExpiryPrecisionTargetSlotState,
  getStableBoxSlotKey,
  type BuffExpiryDetectedBoxView,
  type BuffExpiryPrecisionStickyTargetEntry,
} from "./buffExpiryPrecisionTargetSlots";
import { BuffExpiryDetectedBoxCard } from "./BuffExpiryDetectedBoxCard";
import { BUFF_EXPIRY_DETAIL_TRANSITION } from "./BuffExpiryPrecisionDetectedMotion";

export function BuffExpiryPrecisionTargetBoard({
  snapshot,
  views,
  selectedGroups,
  reduceMotion,
}: {
  snapshot: BuffExpirySnapshot | null;
  views: BuffExpiryDetectedBoxView[];
  selectedGroups: Set<BuffExpiryPrecisionTargetGroup>;
  reduceMotion: boolean;
}) {
  const slotAssignmentsRef = useRef(new Map<BuffExpiryPrecisionTargetGroup, Map<string, number>>());
  const stickyTargetEntriesRef = useRef(new Map<BuffExpiryPrecisionTargetGroup, BuffExpiryPrecisionStickyTargetEntry[]>());
  const { slotsByGroup, visibleTargetCount } = getBuffExpiryPrecisionTargetSlotState(
    snapshot,
    views,
    selectedGroups,
    slotAssignmentsRef.current,
    stickyTargetEntriesRef.current,
  );

  return (
    <section className="buff-expiry-precision-detected-group buff-expiry-precision-target-board">
      <div className="buff-expiry-precision-detected-heading">
        <div className="buff-expiry-precision-detected-title">
          <strong>알림 대상 후보</strong>
          <InfoTooltip
            id="buff-expiry-precision-target-candidate-tooltip"
            label="알림 대상 후보 안내"
            className="buff-expiry-precision-target-info-button"
            iconSize={14}
            content={
              <TooltipHelpContent
                title="정밀 감지가 알림 대상으로 보고 있는 버프입니다."
                items={[
                  "지원 버프가 없을 때는 비슷한 버프가 일시적으로 후보에 보일 수 있습니다.",
                  "알림은 남은 시간 흐름까지 확인한 뒤 확정합니다.",
                  "잘못 잡힌 버프가 보이면 제보하기로 알려주세요.",
                ]}
              />
            }
            width={390}
            fitContent
          />
        </div>
        <span>{visibleTargetCount}개</span>
      </div>
      <div className="buff-expiry-precision-target-grid">
        {BUFF_EXPIRY_PRECISION_TARGET_GROUPS.map((group) => {
          const groupSlots = slotsByGroup.get(group) ?? [];
          const groupTargetCount = groupSlots.filter((slot) => slot.view || slot.stickyEntry).length;
          return (
            <section className="buff-expiry-precision-target-cell" key={group}>
              <div className="buff-expiry-precision-target-cell-heading">
                <strong>{BUFF_EXPIRY_PRECISION_GROUP_LABELS[group]}</strong>
                <span>{groupTargetCount} / {BUFF_EXPIRY_PRECISION_TARGET_GROUP_MAX_VISIBLE[group]}</span>
              </div>
              <div
                className="buff-expiry-precision-target-cell-icons"
                style={{
                  "--buff-expiry-precision-target-slots": BUFF_EXPIRY_PRECISION_TARGET_GROUP_MAX_VISIBLE[group],
                } as CSSProperties}
              >
                {groupSlots.map((slot) => (
                  <div
                    className="buff-expiry-precision-target-slot"
                    data-group={group}
                    data-slot-index={slot.index}
                    key={`${group}:${slot.index}`}
                  >
                    <AnimatePresence initial={false}>
                      {slot.view ? (
                        <BuffExpiryDetectedBoxCard
                          key={`${getStableBoxSlotKey(slot.view.box)}:${slot.view.nextObservation?.identity.kind ?? "unknown"}`}
                          snapshot={snapshot}
                          view={slot.view}
                          reduceMotion={reduceMotion}
                          layoutMotion={false}
                          showCountdown
                        />
                      ) : slot.stickyEntry ? (
                        <BuffExpiryStickyTargetCard
                          key={`sticky:${slot.stickyEntry.id}`}
                          entry={slot.stickyEntry}
                          reduceMotion={reduceMotion}
                        />
                      ) : (
                        <motion.div
                          className="buff-expiry-precision-target-empty"
                          aria-label={`${BUFF_EXPIRY_PRECISION_GROUP_LABELS[group]} 감지 없음`}
                          initial={reduceMotion ? false : { opacity: 0 }}
                          animate={reduceMotion ? undefined : { opacity: 1 }}
                          exit={reduceMotion ? undefined : { opacity: 0 }}
                          transition={reduceMotion ? undefined : BUFF_EXPIRY_DETAIL_TRANSITION}
                        >
                          빈칸
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

export function BuffExpiryStickyTargetCard({
  entry,
  reduceMotion,
}: {
  entry: BuffExpiryPrecisionStickyTargetEntry;
  reduceMotion: boolean;
}) {
  const label = BUFF_EXPIRY_PRECISION_GROUP_LABELS[entry.group];
  const cropStyle: CSSProperties | null = entry.previewDataUrl
    ? {
        backgroundImage: `url(${entry.previewDataUrl})`,
        backgroundSize: "32px 32px",
      }
    : null;

  return (
    <motion.div
      layout={false}
      className="buff-expiry-detected-card icon-only next-target reacquiring"
      aria-label={`${label} 다시 확인 중 · 최근 감지 이미지를 잠시 유지합니다.`}
      initial={reduceMotion ? false : { opacity: 0, scale: 0.92 }}
      animate={reduceMotion ? undefined : { opacity: 1, scale: 1 }}
      exit={reduceMotion ? undefined : { opacity: 0, scale: 0.92 }}
      transition={reduceMotion ? undefined : BUFF_EXPIRY_DETAIL_TRANSITION}
    >
      {entry.previewImageData ? (
        <ImageDataCanvas
          className="buff-expiry-detected-crop"
          image={entry.previewImageData}
        />
      ) : cropStyle ? (
        <span className="buff-expiry-detected-crop" style={cropStyle} aria-hidden="true" />
      ) : (
        <span className="buff-expiry-detected-placeholder" aria-hidden="true" />
      )}
      <span className="buff-expiry-detected-countdown reacquiring" aria-hidden="true">
        확인 중
      </span>
    </motion.div>
  );
}

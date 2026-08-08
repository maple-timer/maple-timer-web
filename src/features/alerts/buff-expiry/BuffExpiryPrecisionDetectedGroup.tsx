import { type CSSProperties } from "react";
import { AnimatePresence, m as motion } from "motion/react";
import type { BuffExpirySnapshot } from "../../../lib/buffExpiry/buffExpiryTypes";
import {
  BuffExpiryDetectedBoxCard,
  getDetectedBoxLayout,
} from "./BuffExpiryDetectedBoxCard";
import {
  getStableBoxSlotKey,
  type BuffExpiryDetectedBoxView,
} from "./buffExpiryPrecisionTargetSlots";
import { BUFF_EXPIRY_DETAIL_TRANSITION } from "./BuffExpiryPrecisionDetectedMotion";

export function BuffExpiryPrecisionDetectedGroup({
  title,
  count,
  emptyLabel,
  snapshot,
  views,
  reduceMotion,
}: {
  title: string;
  count: number;
  emptyLabel: string;
  snapshot: BuffExpirySnapshot | null;
  views: BuffExpiryDetectedBoxView[];
  reduceMotion: boolean;
}) {
  const layout = getDetectedBoxLayout(views);
  return (
    <section className="buff-expiry-precision-detected-group">
      <div className="buff-expiry-precision-detected-heading buff-expiry-precision-detected-heading-end">
        <strong>{title}</strong>
        <span>{count}개</span>
      </div>
      <div
        className="buff-expiry-observation-rail buff-expiry-detected-grid"
        style={{
          "--buff-expiry-detected-columns": layout.columnCount,
        } as CSSProperties}
      >
        <AnimatePresence initial={false}>
          {layout.rows.map((row) => (
            <div className="buff-expiry-detected-layout-row" key={row.key}>
              {row.items.map(({ view, colIndex }) => (
                <BuffExpiryDetectedBoxCard
                  key={`${getStableBoxSlotKey(view.box)}:${view.nextObservation?.identity.kind ?? "unknown"}`}
                  snapshot={snapshot}
                  view={view}
                  reduceMotion={reduceMotion}
                  style={{ gridColumn: `${colIndex + 1}` }}
                />
              ))}
            </div>
          ))}
        </AnimatePresence>
        {!views.length && (
          <motion.div
            className="buff-expiry-empty-detected"
            initial={reduceMotion ? false : { opacity: 0 }}
            animate={reduceMotion ? undefined : { opacity: 1 }}
            transition={reduceMotion ? undefined : BUFF_EXPIRY_DETAIL_TRANSITION}
          >
            {emptyLabel}
          </motion.div>
        )}
      </div>
    </section>
  );
}

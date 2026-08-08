import { type CSSProperties } from "react";
import { m as motion } from "motion/react";
import type { BuffExpirySnapshot } from "../../../lib/buffExpiry/buffExpiryTypes";
import { ImageDataCanvas } from "../../../shared/components/ImageDataCanvas";
import type { BuffExpiryDetectedBoxView } from "./buffExpiryPrecisionTargetSlots";
import {
  getDetectedBoxLayout,
  getDetectedBoxPresentation,
  type BuffExpiryDetectedBoxLayout,
} from "./buffExpiryDetectedBoxView";

const BUFF_EXPIRY_DETAIL_TRANSITION = { duration: 0.16, ease: [0.22, 1, 0.36, 1] } as const;

export { getDetectedBoxLayout, type BuffExpiryDetectedBoxLayout };

export function BuffExpiryDetectedBoxCard({
  snapshot,
  view,
  reduceMotion,
  showCountdown = false,
  layoutMotion = true,
  style,
}: {
  snapshot: BuffExpirySnapshot | null;
  view: BuffExpiryDetectedBoxView;
  reduceMotion: boolean;
  showCountdown?: boolean;
  layoutMotion?: boolean;
  style?: CSSProperties;
}) {
  const {
    label,
    statusClassName,
    title,
    countdownLabel,
    cropImageData,
    cropStyle,
  } = getDetectedBoxPresentation({ snapshot, view, showCountdown });

  return (
    <motion.div
      layout={reduceMotion || !layoutMotion ? false : "position"}
      className={`buff-expiry-detected-card icon-only ${statusClassName}`}
      aria-label={title || label}
      style={style}
      initial={reduceMotion ? false : { opacity: 0, scale: 0.92 }}
      animate={reduceMotion ? undefined : { opacity: 1, scale: 1 }}
      exit={reduceMotion ? undefined : { opacity: 0, scale: 0.92 }}
      transition={reduceMotion ? undefined : BUFF_EXPIRY_DETAIL_TRANSITION}
    >
      {cropImageData ? (
        <ImageDataCanvas
          className="buff-expiry-detected-crop"
          image={cropImageData}
        />
      ) : cropStyle ? (
        <span className="buff-expiry-detected-crop" style={cropStyle} aria-hidden="true" />
      ) : (
        <span className="buff-expiry-detected-placeholder" aria-hidden="true" />
      )}
      {countdownLabel && (
        <span className="buff-expiry-detected-countdown" aria-hidden="true">
          {countdownLabel}
        </span>
      )}
    </motion.div>
  );
}

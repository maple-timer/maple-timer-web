export const BUFF_EXPIRY_DETAIL_TRANSITION = { duration: 0.16, ease: [0.22, 1, 0.36, 1] } as const;

const BUFF_EXPIRY_PRECISION_PANEL_TRANSITION = { duration: 0.22, ease: [0.22, 1, 0.36, 1] } as const;

type BuffExpiryPrecisionPanelMotionDirection = "left" | "right";

export function getBuffExpiryPrecisionPanelMotion(
  index: number,
  direction: BuffExpiryPrecisionPanelMotionDirection,
  reduceMotion: boolean,
  isExpanded: boolean,
) {
  if (reduceMotion) {
    return {};
  }

  const offsetX = direction === "right" ? 12 : -12;
  const enterDelay = Math.min(index * 0.035, 0.07);

  return {
    initial: isExpanded ? { opacity: 0, x: offsetX } : false,
    animate: isExpanded ? { opacity: 1, x: 0 } : { opacity: 0, x: offsetX },
    transition: {
      ...BUFF_EXPIRY_PRECISION_PANEL_TRANSITION,
      duration: isExpanded ? BUFF_EXPIRY_PRECISION_PANEL_TRANSITION.duration : 0.14,
      delay: isExpanded ? enterDelay : 0,
    },
  };
}

import type { MotionProps, Transition } from "motion/react";

export const selectedPillTransition: Transition = {
  type: "spring",
  stiffness: 420,
  damping: 34,
  mass: 0.72,
};

export function getSubtlePressMotion(reducedMotion: boolean): MotionProps {
  if (reducedMotion) {
    return {};
  }

  return {
    whileHover: { y: -1 },
    whileTap: { scale: 0.98 },
    transition: {
      type: "spring",
      stiffness: 520,
      damping: 34,
      mass: 0.55,
    },
  };
}

import { m as motion, useReducedMotion } from "motion/react";
import type { HTMLMotionProps } from "motion/react";
import type { ReactNode } from "react";

type MotionCollapseProps = Omit<HTMLMotionProps<"div">, "children"> & {
  children: ReactNode;
  collapsedClassName?: string;
  isCollapsed: boolean;
};

export function MotionCollapse({
  children,
  className = "",
  collapsedClassName = "",
  isCollapsed,
  style,
  ...props
}: MotionCollapseProps) {
  const shouldReduceMotion = useReducedMotion();
  const classes = [className, isCollapsed ? collapsedClassName : ""].filter(Boolean).join(" ");

  return (
    <motion.div
      {...props}
      className={classes}
      initial={false}
      animate={
        isCollapsed
          ? { height: 0, opacity: 0, y: -4 }
          : { height: "auto", opacity: 1, y: 0 }
      }
      transition={
        shouldReduceMotion
          ? { duration: 0 }
          : {
              height: { duration: 0.24, ease: [0.22, 1, 0.36, 1] },
              opacity: { duration: 0.14, ease: "easeOut" },
              y: { duration: 0.18, ease: "easeOut" },
            }
      }
      style={{ ...style, overflow: "hidden" }}
    >
      {children}
    </motion.div>
  );
}

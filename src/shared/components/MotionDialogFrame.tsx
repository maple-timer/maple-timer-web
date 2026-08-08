import { m as motion, useReducedMotion } from "motion/react";
import { forwardRef, useCallback, useEffect, useRef } from "react";
import type { ForwardedRef, MouseEventHandler, ReactNode } from "react";

type MotionDialogFrameProps = {
  backdropClassName: string;
  children: ReactNode;
  dialogClassName: string;
  dialogLayout?: boolean | "position" | "size";
  dialogAs?: "section" | "div";
  dialogRole?: "dialog" | "alertdialog";
  labelledBy?: string;
  describedBy?: string;
  onBackdropClick?: MouseEventHandler<HTMLDivElement>;
  onBackdropMouseDown?: MouseEventHandler<HTMLDivElement>;
  onDialogClick?: MouseEventHandler<HTMLElement>;
  onDialogMouseDown?: MouseEventHandler<HTMLElement>;
};

const backdropTransition = { duration: 0.16, ease: "easeOut" } as const;
const dialogTransition = {
  opacity: { duration: 0.16, ease: "easeOut" },
  scale: { duration: 0.2, ease: [0.22, 1, 0.36, 1] },
  y: { duration: 0.2, ease: [0.22, 1, 0.36, 1] },
  layout: { duration: 0.22, ease: [0.22, 1, 0.36, 1] },
} as const;

let bodyScrollLockCount = 0;
let previousBodyOverflow = "";
let previousBodyOverscrollBehavior = "";
let previousDocumentOverscrollBehavior = "";

function setForwardedRef<T>(ref: ForwardedRef<T>, value: T | null) {
  if (typeof ref === "function") {
    ref(value);
    return;
  }

  if (ref) {
    ref.current = value;
  }
}

export const MotionDialogFrame = forwardRef<HTMLDivElement, MotionDialogFrameProps>(function MotionDialogFrame(
  {
    backdropClassName,
    children,
    dialogClassName,
    dialogLayout = false,
    dialogAs = "section",
    dialogRole = "dialog",
    labelledBy,
    describedBy,
    onBackdropClick,
    onBackdropMouseDown,
    onDialogClick,
    onDialogMouseDown,
  },
  forwardedRef,
) {
  const shouldReduceMotion = useReducedMotion();
  const Dialog = dialogAs === "div" ? motion.div : motion.section;
  const dialogRef = useRef<HTMLElement | null>(null);
  const setBackdropNode = useCallback(
    (node: HTMLDivElement | null) => {
      setForwardedRef(forwardedRef, node);
    },
    [forwardedRef],
  );

  useEffect(() => {
    const { body, documentElement } = document;

    if (bodyScrollLockCount === 0) {
      previousBodyOverflow = body.style.overflow;
      previousBodyOverscrollBehavior = body.style.overscrollBehavior;
      previousDocumentOverscrollBehavior = documentElement.style.overscrollBehavior;
      body.style.overflow = "hidden";
      body.style.overscrollBehavior = "contain";
      documentElement.style.overscrollBehavior = "contain";
    }

    bodyScrollLockCount += 1;
    dialogRef.current?.focus({ preventScroll: true });

    return () => {
      bodyScrollLockCount = Math.max(0, bodyScrollLockCount - 1);
      if (bodyScrollLockCount === 0) {
        body.style.overflow = previousBodyOverflow;
        body.style.overscrollBehavior = previousBodyOverscrollBehavior;
        documentElement.style.overscrollBehavior = previousDocumentOverscrollBehavior;
      }
    };
  }, []);

  return (
    <motion.div
      ref={setBackdropNode}
      className={backdropClassName}
      role="presentation"
      initial={shouldReduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={shouldReduceMotion ? undefined : { opacity: 0 }}
      transition={shouldReduceMotion ? { duration: 0 } : backdropTransition}
      onClick={onBackdropClick}
      onMouseDown={onBackdropMouseDown}
    >
      <Dialog
        ref={(node) => {
          dialogRef.current = node;
        }}
        className={dialogClassName}
        role={dialogRole}
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
        initial={shouldReduceMotion ? false : { opacity: 0, scale: 0.985, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={shouldReduceMotion ? undefined : { opacity: 0, scale: 0.99, y: 8 }}
        layout={shouldReduceMotion ? false : dialogLayout}
        transition={shouldReduceMotion ? { duration: 0 } : dialogTransition}
        onClick={onDialogClick}
        onMouseDown={onDialogMouseDown}
      >
        {children}
      </Dialog>
    </motion.div>
  );
});

import { ChevronDown } from "lucide-react";
import { m as motion, useReducedMotion } from "motion/react";
import {
  type CSSProperties,
  type MouseEventHandler,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

type DropdownPlacement = "bottom" | "top";

type MotionDropdownMenuProps = {
  ariaLabel: string;
  children: ReactNode;
  className: string;
  disabled?: boolean;
  id?: string;
  isOpen: boolean;
  maxHeight: number;
  minWidth: number;
  outsideMouseDownCapture?: boolean;
  pickerRef: RefObject<HTMLElement | null>;
  role?: "listbox" | "menu";
  triggerRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onMouseDown?: MouseEventHandler<HTMLDivElement>;
};

const dropdownTransition = {
  opacity: { duration: 0.12, ease: "easeOut" },
  scale: { duration: 0.14, ease: [0.22, 1, 0.36, 1] },
  y: { duration: 0.14, ease: [0.22, 1, 0.36, 1] },
} as const;

export function MotionDropdownChevron({
  isOpen,
  size = 15,
}: {
  isOpen: boolean;
  size?: number;
}) {
  const shouldReduceMotion = useReducedMotion();

  return (
    <motion.span
      className="motion-dropdown-chevron"
      aria-hidden="true"
      animate={{ rotate: isOpen ? 180 : 0 }}
      initial={false}
      transition={
        shouldReduceMotion
          ? { duration: 0 }
          : { type: "spring", stiffness: 520, damping: 34 }
      }
    >
      <ChevronDown size={size} />
    </motion.span>
  );
}

export function MotionDropdownMenu({
  ariaLabel,
  children,
  className,
  disabled = false,
  id,
  isOpen,
  maxHeight,
  minWidth,
  outsideMouseDownCapture = false,
  pickerRef,
  role = "listbox",
  triggerRef,
  onClose,
  onMouseDown,
}: MotionDropdownMenuProps) {
  const shouldReduceMotion = useReducedMotion();
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({ visibility: "hidden" });
  const [placement, setPlacement] = useState<DropdownPlacement>("bottom");
  const shouldShowMenu = isOpen && !disabled;
  const [shouldRenderMenu, setShouldRenderMenu] = useState(shouldShowMenu);

  const updateMenuPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) {
      return;
    }

    const rect = trigger.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const margin = 12;
    const gap = 8;
    const availableHeight = Math.max(80, viewportHeight - margin * 2);
    const resolvedMaxHeight = Math.min(maxHeight, availableHeight);
    const contentHeight = menuRef.current
      ? Math.min(menuRef.current.scrollHeight, resolvedMaxHeight)
      : resolvedMaxHeight;
    const width = Math.min(Math.max(rect.width, minWidth), viewportWidth - margin * 2);
    const left = Math.min(Math.max(margin, rect.left), viewportWidth - width - margin);
    const shouldOpenUp =
      rect.bottom + contentHeight + gap > viewportHeight - margin &&
      rect.top - margin > contentHeight;
    const top = shouldOpenUp
      ? Math.max(margin, rect.top - contentHeight - gap)
      : Math.min(rect.bottom + gap, viewportHeight - contentHeight - margin);

    setPlacement(shouldOpenUp ? "top" : "bottom");
    setMenuStyle({
      left,
      maxHeight: resolvedMaxHeight,
      top,
      transformOrigin: shouldOpenUp ? "center bottom" : "center top",
      visibility: "visible",
      width,
    });
  }, [maxHeight, minWidth, triggerRef]);

  useEffect(() => {
    if (shouldShowMenu) {
      setShouldRenderMenu(true);
      return;
    }

    if (!shouldRenderMenu) {
      return;
    }

    if (shouldReduceMotion) {
      setShouldRenderMenu(false);
      return;
    }

    const timeoutId = window.setTimeout(() => setShouldRenderMenu(false), 120);
    return () => window.clearTimeout(timeoutId);
  }, [shouldReduceMotion, shouldRenderMenu, shouldShowMenu]);

  useLayoutEffect(() => {
    if (!shouldShowMenu) {
      return;
    }

    updateMenuPosition();
  }, [shouldShowMenu, updateMenuPosition, children]);

  useEffect(() => {
    if (!shouldShowMenu) {
      return;
    }

    updateMenuPosition();

    const closeFromOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || pickerRef.current?.contains(target)) {
        return;
      }
      onClose();
    };
    const closeFromEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("mousedown", closeFromOutside, outsideMouseDownCapture);
    document.addEventListener("keydown", closeFromEscape);
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      document.removeEventListener("mousedown", closeFromOutside, outsideMouseDownCapture);
      document.removeEventListener("keydown", closeFromEscape);
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [onClose, outsideMouseDownCapture, pickerRef, shouldShowMenu, updateMenuPosition]);

  useEffect(() => {
    if (disabled && isOpen) {
      onClose();
    }
  }, [disabled, isOpen, onClose]);

  return createPortal(
    shouldRenderMenu ? (
      <motion.div
        className={className}
        id={id}
        ref={menuRef}
        role={shouldShowMenu ? role : undefined}
        aria-hidden={shouldShowMenu ? undefined : true}
        aria-label={shouldShowMenu ? ariaLabel : undefined}
        style={menuStyle}
        initial={
          shouldReduceMotion
            ? false
            : { opacity: 0, scale: 0.985, y: placement === "top" ? 4 : -4 }
        }
        animate={
          shouldShowMenu
            ? { opacity: 1, scale: 1, y: 0 }
            : { opacity: 0, scale: 0.99, y: placement === "top" ? 3 : -3 }
        }
        transition={shouldReduceMotion ? { duration: 0 } : dropdownTransition}
        onMouseDown={onMouseDown}
      >
        {children}
      </motion.div>
    ) : null,
    document.body,
  );
}

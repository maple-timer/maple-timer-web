import { CircleAlert } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MapleHoverCard } from "./MapleHoverCard";

const DEFAULT_TOOLTIP_WIDTH = 310;
const TOOLTIP_MARGIN = 12;

export type FloatingTooltipState = {
  id: string;
  text?: string;
  content?: ReactNode;
  anchor?: HTMLElement;
  left: number;
  top: number;
  placement: "top" | "bottom";
  width?: number;
  fitContent?: boolean;
};

function getEffectiveTooltipWidth(width: number): number {
  if (typeof window === "undefined") {
    return width;
  }

  return Math.min(width, Math.max(160, window.innerWidth - TOOLTIP_MARGIN * 2));
}

function clampTooltipLeft(value: number, width: number): number {
  if (typeof window === "undefined") {
    return value;
  }

  const halfWidth = getEffectiveTooltipWidth(width) / 2;
  return Math.min(
    window.innerWidth - TOOLTIP_MARGIN - halfWidth,
    Math.max(TOOLTIP_MARGIN + halfWidth, value),
  );
}

function clampMeasuredTooltipLeft(value: number, measuredWidth: number): number {
  if (typeof window === "undefined") {
    return value;
  }

  const effectiveWidth = Math.min(
    measuredWidth,
    Math.max(160, window.innerWidth - TOOLTIP_MARGIN * 2),
  );
  const halfWidth = effectiveWidth / 2;
  return Math.min(
    window.innerWidth - TOOLTIP_MARGIN - halfWidth,
    Math.max(TOOLTIP_MARGIN + halfWidth, value),
  );
}

export function getFloatingTooltipPosition(
  target: HTMLElement,
  width = DEFAULT_TOOLTIP_WIDTH,
): Omit<FloatingTooltipState, "id" | "text"> {
  const rect = target.getBoundingClientRect();
  const canShowBelow =
    typeof window === "undefined" || window.innerHeight - rect.bottom >= 88 || rect.top < 104;
  const placement = canShowBelow ? "bottom" : "top";

  return {
    left: clampTooltipLeft(rect.left + rect.width / 2, width),
    top: placement === "bottom" ? rect.bottom + 8 : rect.top - 8,
    placement,
    width,
  };
}

function isPointInsideElement(element: HTMLElement, x: number, y: number): boolean {
  const rect = element.getBoundingClientRect();
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

export function FloatingTooltipPortal({
  tooltip,
  onDismiss,
}: {
  tooltip: FloatingTooltipState;
  onDismiss?: () => void;
}) {
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [left, setLeft] = useState(tooltip.left);

  useLayoutEffect(() => {
    const node = tooltipRef.current;
    if (!node) {
      setLeft(tooltip.left);
      return;
    }

    setLeft(clampMeasuredTooltipLeft(tooltip.left, node.getBoundingClientRect().width));
  }, [tooltip.content, tooltip.fitContent, tooltip.left, tooltip.text, tooltip.width]);

  useEffect(() => {
    if (!tooltip.anchor || !onDismiss) {
      return;
    }

    const dismissIfOutsideAnchor = (event: PointerEvent) => {
      const anchor = tooltip.anchor;
      if (!anchor?.isConnected || !isPointInsideElement(anchor, event.clientX, event.clientY)) {
        onDismiss();
      }
    };

    window.addEventListener("pointermove", dismissIfOutsideAnchor, { passive: true });
    window.addEventListener("pointerdown", dismissIfOutsideAnchor, true);
    return () => {
      window.removeEventListener("pointermove", dismissIfOutsideAnchor);
      window.removeEventListener("pointerdown", dismissIfOutsideAnchor, true);
    };
  }, [onDismiss, tooltip.anchor]);

  if (typeof document === "undefined") {
    return null;
  }

  const viewportMaxWidth = `calc(100vw - ${TOOLTIP_MARGIN * 2}px)`;
  const boundedMaxWidth =
    tooltip.fitContent && tooltip.width === undefined
      ? viewportMaxWidth
      : `min(${tooltip.width ?? DEFAULT_TOOLTIP_WIDTH}px, ${viewportMaxWidth})`;

  return createPortal(
    <div
      ref={tooltipRef}
      id={tooltip.id}
      className={`floating-tooltip ${tooltip.placement}`}
      role="tooltip"
      style={{
        left,
        top: tooltip.top,
        width: "fit-content",
        maxWidth: boundedMaxWidth,
      }}
    >
      {tooltip.content ?? tooltip.text}
    </div>,
    document.body,
  );
}

export function FloatingTooltipButton({
  tooltipId,
  tooltip,
  tooltipWidth,
  fitContent = true,
  children,
  className,
  onBlur,
  onFocus,
  onMouseEnter,
  onMouseLeave,
  ...buttonProps
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  tooltipId: string;
  tooltip: ReactNode;
  tooltipWidth?: number;
  fitContent?: boolean;
}) {
  const wrapperRef = useRef<HTMLSpanElement | null>(null);
  const [floatingTooltip, setFloatingTooltip] = useState<FloatingTooltipState | null>(null);

  const showTooltip = useCallback(() => {
    const target = wrapperRef.current;
    if (!target || !tooltip) {
      return;
    }

    setFloatingTooltip({
      id: tooltipId,
      content: tooltip,
      fitContent,
      anchor: target,
      ...getFloatingTooltipPosition(target, tooltipWidth),
    });
  }, [fitContent, tooltip, tooltipId, tooltipWidth]);

  const hideTooltip = useCallback(() => setFloatingTooltip(null), []);

  useEffect(() => {
    if (!floatingTooltip) {
      return;
    }

    const reposition = () => showTooltip();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [floatingTooltip, showTooltip]);

  return (
    <span
      ref={wrapperRef}
      className="floating-tooltip-button-target"
      onMouseEnter={showTooltip}
      onMouseLeave={() => {
        hideTooltip();
      }}
    >
      <button
        {...buttonProps}
        aria-describedby={tooltipId}
        className={className}
        onBlur={(event) => {
          hideTooltip();
          onBlur?.(event);
        }}
        onFocus={(event) => {
          showTooltip();
          onFocus?.(event);
        }}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        {children}
      </button>
      {floatingTooltip && <FloatingTooltipPortal tooltip={floatingTooltip} onDismiss={hideTooltip} />}
    </span>
  );
}

export function InfoTooltip({
  id,
  label,
  displayLabel,
  text,
  content,
  className,
  iconSize = 16,
  width,
  fitContent = false,
}: {
  id: string;
  label: string;
  displayLabel?: ReactNode;
  text?: string;
  content?: ReactNode;
  className: string;
  iconSize?: number;
  width?: number;
  fitContent?: boolean;
}) {
  const tooltipContent = content ?? text;
  const button = (
    <button
      aria-describedby={id}
      aria-label={label}
      className={className}
      type="button"
      onClick={(event) => {
        event.stopPropagation();
      }}
    >
      {displayLabel ? (
        <span className="info-tooltip-label-text">{displayLabel}</span>
      ) : (
        <CircleAlert size={iconSize} />
      )}
    </button>
  );

  if (!tooltipContent) {
    return button;
  }

  return (
    <MapleHoverCard
      className={["info-hover-card", fitContent ? "fit-content" : ""].filter(Boolean).join(" ")}
      content={
        <span id={id} className="info-hover-card-content">
          {tooltipContent}
        </span>
      }
      width={width ?? (fitContent ? 640 : DEFAULT_TOOLTIP_WIDTH)}
    >
      {button}
    </MapleHoverCard>
  );
}

export function TooltipHelpContent({
  title,
  items,
}: {
  title: ReactNode;
  items: ReactNode[];
}) {
  return (
    <div className="tooltip-help-content">
      <strong>{title}</strong>
      <ul>
        {items.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

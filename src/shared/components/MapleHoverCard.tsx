import { useHoverCard } from "@astryxdesign/core/HoverCard";
import {
  cloneElement,
  isValidElement,
  useCallback,
  useState,
  type CSSProperties,
  type FocusEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";

type MapleHoverCardPlacement = "above" | "below" | "start" | "end";
type MapleHoverCardAlignment = "start" | "center" | "end";
type MapleHoverCardFocusTrigger = "auto" | "always" | "never";

type MapleHoverCardStyle = CSSProperties & {
  "--maple-hover-card-width"?: string;
};

type MapleHoverCardTriggerProps = {
  "aria-describedby"?: string;
  onFocus?: (event: FocusEvent<HTMLElement>) => void;
  onMouseEnter?: (event: MouseEvent<HTMLElement>) => void;
  ref?: (node: HTMLElement | null) => void;
};

function mergeIds(...ids: (string | undefined | null)[]) {
  const filtered = ids.filter(Boolean);
  return filtered.length > 0 ? filtered.join(" ") : undefined;
}

export function MapleHoverCard({
  children,
  content,
  width = 360,
  className,
  placement = "below",
  alignment = "center",
  focusTrigger = "always",
  style,
}: {
  children: ReactNode;
  content: ReactNode;
  width?: number;
  className?: string;
  placement?: MapleHoverCardPlacement;
  alignment?: MapleHoverCardAlignment;
  focusTrigger?: MapleHoverCardFocusTrigger;
  style?: CSSProperties;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const handleShow = useCallback(() => setIsOpen(true), []);
  const handleHide = useCallback(() => setIsOpen(false), []);
  const hoverCard = useHoverCard({
    alignment,
    delay: 0,
    focusTrigger,
    hideDelay: 0,
    onHide: handleHide,
    onShow: handleShow,
    placement,
  });
  const hoverCardStyle: MapleHoverCardStyle = {
    ...style,
    "--maple-hover-card-width": `${width}px`,
  };
  const childProps = isValidElement(children)
    ? (children.props as MapleHoverCardTriggerProps)
    : null;
  const trigger =
    childProps
      ? cloneElement(children as ReactElement<MapleHoverCardTriggerProps>, {
          "aria-describedby": mergeIds(
            childProps["aria-describedby"],
            hoverCard.describedBy,
          ),
          onFocus: (event: FocusEvent<HTMLElement>) => {
            childProps.onFocus?.(event);
            hoverCard.show();
          },
          onMouseEnter: (event: MouseEvent<HTMLElement>) => {
            childProps.onMouseEnter?.(event);
            hoverCard.show();
          },
          ref: hoverCard.ref,
        })
      : (
        <span
          aria-describedby={hoverCard.describedBy}
          className="maple-hover-card-trigger"
          ref={hoverCard.ref}
        >
          {children}
        </span>
      );

  return (
    <>
      {trigger}
      <span aria-hidden={!isOpen} className="maple-hover-card-layer">
        {hoverCard.renderHoverCard(
          <span
            className={["maple-hover-card", className].filter(Boolean).join(" ")}
            style={hoverCardStyle}
          >
            {isOpen ? content : null}
          </span>,
        )}
      </span>
    </>
  );
}

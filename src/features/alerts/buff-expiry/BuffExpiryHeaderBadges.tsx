import {
  BUFF_EXPIRY_BONUS_EXP_COUPON_GROUP_ID,
  BUFF_EXPIRY_BUFF_CATALOG,
} from "../../../domain/buff-expiry/catalog";
import { TooltipHelpContent } from "../../../shared/components/FloatingTooltip";
import { MapleHoverCard } from "../../../shared/components/MapleHoverCard";

export function BuffExpirySupportedBuffChip() {
  const supportedItems = BUFF_EXPIRY_BUFF_CATALOG.filter((item) => {
    if (!item.supported) {
      return false;
    }
    return item.id !== BUFF_EXPIRY_BONUS_EXP_COUPON_GROUP_ID;
  });
  const label = `지원 버프 ${supportedItems.map((item) => item.label).join(", ")}`;

  return (
    <MapleHoverCard
      className="buff-expiry-supported-hover-card"
      content={<BuffExpirySupportedBuffTooltip items={supportedItems} />}
      width={430}
    >
      <button
        aria-label={label}
        className="buff-expiry-supported-chip"
        type="button"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        지원 버프
      </button>
    </MapleHoverCard>
  );
}

function BuffExpirySupportedBuffTooltip({
  items,
}: {
  items: typeof BUFF_EXPIRY_BUFF_CATALOG;
}) {
  return (
    <div className="buff-expiry-supported-tooltip">
      <strong>현재 지원 중인 버프</strong>
      <div className="buff-expiry-supported-tooltip-grid">
        {items.map((item) => (
          <div className="buff-expiry-supported-tooltip-item" key={item.id}>
            <span
              className={item.iconSrcs.length > 1 ? "buff-expiry-icon-stack grouped" : "buff-expiry-icon-stack"}
              aria-hidden="true"
            >
              {item.iconSrcs.map((iconSrc) => (
                <img key={iconSrc} src={iconSrc} alt="" />
              ))}
            </span>
            <span>{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function BuffExpiryNoticeChip({
  ariaLabel,
  label,
  variant,
  title,
  items,
}: {
  id: string;
  ariaLabel: string;
  label: string;
  variant: "testing" | "cpu" | "ending";
  title: string;
  items: string[];
}) {
  return (
    <MapleHoverCard
      className="buff-expiry-notice-hover-card"
      content={<TooltipHelpContent title={title} items={items} />}
      width={430}
    >
      <button
        aria-label={ariaLabel}
        className={`buff-expiry-feedback-indicator ${variant}`}
        type="button"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <span className="buff-expiry-feedback-dot" aria-hidden="true" />
        {label}
      </button>
    </MapleHoverCard>
  );
}

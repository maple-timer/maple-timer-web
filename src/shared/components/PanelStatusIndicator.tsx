type PanelStatusIndicatorProps = {
  isActive?: boolean;
  isEnabled: boolean;
  label: string;
};

export function PanelStatusIndicator({
  isActive = false,
  isEnabled,
  label,
}: PanelStatusIndicatorProps) {
  const stateLabel = isActive ? "동작 중" : isEnabled ? "켜짐" : "꺼짐";

  return (
    <span
      aria-label={`${label} ${stateLabel}`}
      className={[
        "panel-status-indicator",
        isEnabled ? "is-on" : "is-off",
        isActive ? "is-active" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      role="img"
    />
  );
}

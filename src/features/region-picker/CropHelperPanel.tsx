export function CropHelperPanel({
  helperTitle,
  helperDescription,
  helperVideoSrc,
  helperVideoLabel,
  helperMediaVariant,
  helperSteps,
}: {
  helperTitle: string;
  helperDescription: string;
  helperVideoSrc: string | null;
  helperVideoLabel: string;
  helperMediaVariant: "wide" | "portrait";
  helperSteps: string[];
}) {
  return (
    <aside
      className={`crop-helper-panel media-${helperMediaVariant}`}
      aria-label="영역 선택 도움말"
    >
      <div className="crop-helper-text">
        <div className="crop-helper-copy">
          <p className="eyebrow">선택 예시</p>
          <h3>{helperTitle}</h3>
          <p>{helperDescription}</p>
        </div>
        <div className="crop-helper-steps" aria-label="영역 선택 핵심 단계">
          {helperSteps.map((step) => (
            <span key={step}>{step}</span>
          ))}
        </div>
      </div>
      {helperVideoSrc && (
        <div className="crop-helper-media">
          <video
            src={helperVideoSrc}
            aria-label={helperVideoLabel}
            autoPlay
            loop
            muted
            playsInline
            preload="metadata"
          />
        </div>
      )}
    </aside>
  );
}

import { ArrowLeft, ChevronLeft, ChevronRight, ExternalLink, X } from "lucide-react";
import { AnimatePresence, m as motion, useReducedMotion } from "motion/react";
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { USAGE_GUIDE_HIGHLIGHTS, USAGE_GUIDE_SECTIONS } from "../../lib/usageGuide";
import type { UsageGuideSection } from "../../lib/usageGuide";
import { MotionDialogFrame } from "../../shared/components/MotionDialogFrame";

function renderGuideText(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={part}>{part.slice(2, -2)}</strong>;
    }

    return part;
  });
}

function UsageGuideMedia({ section }: { section: UsageGuideSection }) {
  if (!section.media) {
    return null;
  }

  return (
    <div className={`usage-guide-media ${section.media.variant ?? "wide"}`}>
      {section.media.type === "image" ? (
        <img alt={section.media.label} src={section.media.src} />
      ) : (
        <video
          aria-label={section.media.label}
          autoPlay
          loop
          muted
          playsInline
          preload="metadata"
          src={section.media.src}
        />
      )}
    </div>
  );
}

function UsageGuideSectionCopy({ section }: { section: UsageGuideSection }) {
  const Icon = section.icon;

  return (
    <div className="usage-guide-section-copy">
      <div className="usage-guide-section-kicker">
        <span className="usage-guide-icon">
          <Icon size={18} />
        </span>
        <span>{section.eyebrow}</span>
      </div>
      <h2>{section.title}</h2>
      <p>{section.summary}</p>
    </div>
  );
}

function UsageGuideSectionView({
  section,
  compact = false,
}: {
  section: UsageGuideSection;
  compact?: boolean;
}) {
  const isIntro = section.layout === "intro";
  const isChecklist = section.layout === "checklist";
  const isSettings = section.layout === "settings";
  const hasMedia = Boolean(section.media);
  const checklistItems = isChecklist ? [...section.points, ...section.cautions] : [];

  if (isIntro) {
    return (
      <section
        className={`usage-guide-section section-${section.id} ${compact ? "compact" : ""} intro ${
          hasMedia ? "has-media" : "no-media"
        }`}
      >
        <div className="usage-guide-intro-layout">
          <div className="usage-guide-intro-copy">
            <UsageGuideSectionCopy section={section} />
            <ol className="usage-guide-flow" aria-label={`${section.modalTabLabel} 순서`}>
              {section.points.map((point, pointIndex) => (
                <li key={point}>
                  <span>{pointIndex + 1}</span>
                  <p>{renderGuideText(point)}</p>
                </li>
              ))}
            </ol>
          </div>

          {hasMedia && (
            <div className="usage-guide-core-content">
              <UsageGuideMedia section={section} />
            </div>
          )}
        </div>
      </section>
    );
  }

  return (
    <section
      className={`usage-guide-section section-${section.id} ${compact ? "compact" : ""} ${
        isIntro ? "intro" : ""
      } ${isChecklist ? "checklist" : ""} ${isSettings ? "settings" : ""} ${
        hasMedia ? "has-media" : "no-media"
      }`}
    >
      <UsageGuideSectionCopy section={section} />

      <div className="usage-guide-section-body">
        {isSettings ? (
          <>
            <div className="usage-guide-settings-list" aria-label="권장 인게임 설정">
              {section.points.map((point, pointIndex) => (
                <div className="usage-guide-settings-item" key={point}>
                  <span>{pointIndex + 1}</span>
                  <p>{renderGuideText(point)}</p>
                </div>
              ))}
            </div>
            {hasMedia && (
              <div className="usage-guide-core-content">
                <UsageGuideMedia section={section} />
              </div>
            )}
          </>
        ) : isChecklist ? (
          <ol className="usage-guide-checklist-flow" aria-label="문제 해결 점검 순서">
            {checklistItems.map((point, pointIndex) => (
              <li key={`${pointIndex}-${point}`}>
                <span>{pointIndex + 1}</span>
                <p>{renderGuideText(point)}</p>
              </li>
            ))}
          </ol>
        ) : (
          <div className="usage-guide-detail-grid">
            <div>
              <h3>확인할 것</h3>
              <ul>
                {section.points.map((point) => (
                  <li key={point}>{renderGuideText(point)}</li>
                ))}
              </ul>
            </div>
            <div className="usage-guide-caution">
              <h3>주의할 것</h3>
              <ul>
                {section.cautions.map((point) => (
                  <li key={point}>{renderGuideText(point)}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {!isSettings && hasMedia && (
          <div className="usage-guide-core-content">
            <UsageGuideMedia section={section} />
          </div>
        )}
      </div>
    </section>
  );
}

function UsageGuideHighlights() {
  return (
    <div className="usage-guide-highlights" aria-label="핵심 사용 기준">
      {USAGE_GUIDE_HIGHLIGHTS.map((item) => {
        const Icon = item.icon;
        return (
          <div className="usage-guide-highlight" key={item.title}>
            <Icon size={18} />
            <div>
              <strong>{item.title}</strong>
              <p>{item.body}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function UsageGuidePage() {
  return (
    <main className="app-shell usage-guide-page">
      <header className="app-header usage-guide-page-header">
        <div>
          <p className="eyebrow">Quick Guide</p>
          <h1>사용 가이드</h1>
        </div>
        <a className="secondary-button header-link" href="/">
          <ArrowLeft size={16} />
          타이머로 돌아가기
        </a>
      </header>

      <section className="usage-guide-hero">
        <div>
          <h2>자동 감지를 먼저 쓰고, 필요한 알림만 받습니다.</h2>
          <p>
            Maple Timer는 공유한 게임 화면을 현재 브라우저에서 실시간 분석합니다. 아래 순서대로
            설정하면 스킬, 룬, 울티마 스쿼드 장비, 버프, 사냥 멈춤 알림을 더 안정적으로
            사용할 수 있습니다.
          </p>
        </div>
        <UsageGuideHighlights />
      </section>

      <div className="usage-guide-section-list">
        {USAGE_GUIDE_SECTIONS.map((section) => (
          <UsageGuideSectionView section={section} key={section.id} />
        ))}
      </div>
    </main>
  );
}

export function UsageGuideModal({ onClose }: { onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState(1);
  const [sectionHeight, setSectionHeight] = useState<number | null>(null);
  const sectionObserverRef = useRef<ResizeObserver | null>(null);
  const section = USAGE_GUIDE_SECTIONS[index];
  const total = USAGE_GUIDE_SECTIONS.length;
  const reducedMotion = useReducedMotion();
  const sectionHeightFrameRef = useRef<number | null>(null);

  const progressLabel = useMemo(() => `${index + 1} / ${total}`, [index, total]);
  const goToIndex = useCallback(
    (nextIndex: number) => {
      const clampedIndex = Math.min(Math.max(nextIndex, 0), total - 1);

      if (clampedIndex === index) {
        return;
      }

      setDirection(clampedIndex > index ? 1 : -1);
      setIndex(clampedIndex);
    },
    [index, total],
  );
  const setSectionMotionNode = useCallback((node: HTMLDivElement | null) => {
    sectionObserverRef.current?.disconnect();
    sectionObserverRef.current = null;
    if (sectionHeightFrameRef.current !== null) {
      window.cancelAnimationFrame(sectionHeightFrameRef.current);
      sectionHeightFrameRef.current = null;
    }

    if (!node) {
      return;
    }

    const updateHeight = () => {
      setSectionHeight(Math.ceil(node.getBoundingClientRect().height) + 8);
    };

    updateHeight();
    sectionHeightFrameRef.current = window.requestAnimationFrame(() => {
      updateHeight();
      sectionHeightFrameRef.current = null;
    });

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(updateHeight);
    observer.observe(node);
    sectionObserverRef.current = observer;
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
      if (event.key === "ArrowRight") {
        goToIndex(index + 1);
      }
      if (event.key === "ArrowLeft") {
        goToIndex(index - 1);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [goToIndex, index, onClose]);

  useEffect(() => {
    return () => {
      sectionObserverRef.current?.disconnect();
      if (sectionHeightFrameRef.current !== null) {
        window.cancelAnimationFrame(sectionHeightFrameRef.current);
      }
    };
  }, []);

  return (
    <MotionDialogFrame
      backdropClassName="usage-guide-backdrop"
      dialogClassName="usage-guide-dialog"
      dialogLayout="size"
      labelledBy="usage-guide-title"
      onBackdropMouseDown={onClose}
      onDialogMouseDown={(event) => event.stopPropagation()}
    >
        <header className="usage-guide-modal-header">
          <div>
            <p className="eyebrow">Guide</p>
            <h2 id="usage-guide-title">사용 가이드</h2>
          </div>
          <div className="usage-guide-header-actions">
            <a className="secondary-button usage-guide-page-link" href="/guide">
              <ExternalLink size={15} />
              전체 보기
            </a>
            <button
              className="icon-button small"
              type="button"
              aria-label="사용 가이드 닫기"
              onClick={onClose}
            >
              <X size={16} />
            </button>
          </div>
        </header>

        <motion.div
          className="usage-guide-modal-body"
          layout
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        >
          <nav
            className="usage-guide-step-tabs"
            aria-label="사용 가이드 섹션"
            style={{ "--usage-guide-tab-count": USAGE_GUIDE_SECTIONS.length } as CSSProperties}
          >
            {USAGE_GUIDE_SECTIONS.map((item, itemIndex) => {
              const Icon = item.icon;
              return (
                <button
                  className={itemIndex === index ? "selected" : ""}
                  type="button"
                  key={item.id}
                  aria-current={itemIndex === index ? "step" : undefined}
                  onClick={() => goToIndex(itemIndex)}
                >
                  <span className="usage-guide-step-tab-content">
                    <Icon size={16} />
                    <span>{item.modalTabLabel}</span>
                  </span>
                </button>
              );
            })}
          </nav>

          <motion.div
            className="usage-guide-section-viewport"
            animate={reducedMotion || sectionHeight === null ? undefined : { height: sectionHeight }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={section.id}
                className="usage-guide-section-motion"
                initial={reducedMotion ? { opacity: 1 } : { opacity: 0, x: direction * 22 }}
                animate={{ opacity: 1, x: 0 }}
                exit={reducedMotion ? { opacity: 1 } : { opacity: 0, x: direction * -18 }}
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              >
                <div ref={setSectionMotionNode} className="usage-guide-section-measure">
                  <UsageGuideSectionView section={section} compact />
                </div>
              </motion.div>
            </AnimatePresence>
          </motion.div>

          <footer className="usage-guide-modal-footer">
            <button
              className="secondary-button"
              type="button"
              disabled={index === 0}
              onClick={() => goToIndex(index - 1)}
            >
              <ChevronLeft size={16} />
              이전
            </button>
            <span>{progressLabel}</span>
            <button
              className="primary-button"
              type="button"
              disabled={index === total - 1}
              onClick={() => goToIndex(index + 1)}
            >
              다음
              <ChevronRight size={16} />
            </button>
          </footer>
        </motion.div>
    </MotionDialogFrame>
  );
}

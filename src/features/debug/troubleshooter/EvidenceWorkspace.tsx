import { Button } from "@astryxdesign/core/Button";
import { Lightbox } from "@astryxdesign/core/Lightbox";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@astryxdesign/core/SegmentedControl";
import { Maximize2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import type { EvidenceAsset, EvidenceGroup, TroubleshooterViewModel } from "./model";
import { formatTimestamp } from "./model/sample";

type EvidenceFilter = "all" | EvidenceGroup;

const FILTER_LABELS: Record<EvidenceFilter, string> = {
  all: "전체",
  source: "원본",
  detection: "탐색",
  recognition: "판독",
  runtime: "흐름",
  alert: "알림",
};

export function EvidenceWorkspace({
  view,
  focusedStageId,
  onClearStage,
}: {
  view: TroubleshooterViewModel;
  focusedStageId: string | null;
  onClearStage(): void;
}) {
  const [filter, setFilter] = useState<EvidenceFilter>("all");
  const [selectedId, setSelectedId] = useState(view.evidence[0]?.id ?? "");
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const stageEvidence = useMemo(
    () =>
      focusedStageId
        ? view.evidence.filter((item) => item.stageId === focusedStageId)
        : [],
    [focusedStageId, view.evidence],
  );
  const visibleEvidence = useMemo(() => {
    const source = focusedStageId ? stageEvidence : view.evidence;
    return filter === "all" ? source : source.filter((item) => item.group === filter);
  }, [filter, focusedStageId, stageEvidence, view.evidence]);
  const selected =
    visibleEvidence.find((item) => item.id === selectedId) ??
    visibleEvidence[0] ??
    null;

  useEffect(() => {
    const first = stageEvidence[0] ?? view.evidence[0];
    if (first) setSelectedId(first.id);
  }, [focusedStageId, stageEvidence, view.evidence]);

  useEffect(() => {
    if (visibleEvidence.length > 0 && !visibleEvidence.some((item) => item.id === selectedId)) {
      setSelectedId(visibleEvidence[0].id);
    }
  }, [selectedId, visibleEvidence]);

  const lightboxIndex = Math.max(
    0,
    view.evidence.findIndex((item) => item.id === selected?.id),
  );

  return (
    <article className="evidence-workspace" aria-labelledby="evidence-title">
      <header className="workspace-toolbar">
        <span className="workspace-title-block">
          <strong id="evidence-title">증거 탐색</strong>
          <small>{visibleEvidence.length}개 이미지</small>
        </span>
        <span className="workspace-filter-row">
          {focusedStageId ? (
            <Button
              label="단계 필터 해제"
              size="sm"
              variant="ghost"
              onClick={onClearStage}
            />
          ) : null}
          <SegmentedControl
            value={filter}
            onChange={(value) => setFilter(value as EvidenceFilter)}
            label="증거 종류"
            size="sm"
          >
            {(Object.keys(FILTER_LABELS) as EvidenceFilter[]).map((value) => (
              <SegmentedControlItem
                key={value}
                value={value}
                label={FILTER_LABELS[value]}
                isDisabled={
                  value !== "all" &&
                  !(focusedStageId ? stageEvidence : view.evidence).some(
                    (item) => item.group === value,
                  )
                }
              />
            ))}
          </SegmentedControl>
        </span>
      </header>

      <section className="evidence-stage">
        {selected ? (
          <>
            <button
              className="evidence-main-button"
              type="button"
              onClick={() => setLightboxOpen(true)}
              aria-label={`${selected.label} 크게 보기`}
            >
              <AnimatePresence mode="wait">
                <motion.img
                  key={selected.id}
                  src={selected.src}
                  alt={selected.label}
                  initial={{ opacity: 0, scale: 0.995 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.16 }}
                />
              </AnimatePresence>
              <span className="evidence-expand" aria-hidden="true">
                <Maximize2 size={16} />
              </span>
            </button>
            <footer className="evidence-caption">
              <span>
                <strong>{selected.label}</strong>
                <small>{selected.description}</small>
              </span>
              <span className="evidence-caption-meta">
                {selected.capturedAt ? formatTimestamp(selected.capturedAt) : "시각 없음"}
              </span>
            </footer>
          </>
        ) : (
          <span className="evidence-empty">이 단계에 저장된 이미지가 없습니다.</span>
        )}
      </section>

      <nav className="evidence-thumbnails" aria-label="증거 이미지 목록">
        {visibleEvidence.map((item) => (
          <EvidenceThumbnail
            key={item.id}
            item={item}
            isSelected={item.id === selected?.id}
            onSelect={() => setSelectedId(item.id)}
          />
        ))}
      </nav>

      <Lightbox
        isOpen={lightboxOpen}
        onOpenChange={setLightboxOpen}
        media={view.evidence.map((item) => ({
          type: "image" as const,
          src: item.src,
          alt: item.label,
          caption: item.description,
        }))}
        index={lightboxIndex}
        onIndexChange={(index) => {
          const item = view.evidence[index];
          if (item) setSelectedId(item.id);
        }}
        hasZoom
      />
    </article>
  );
}

function EvidenceThumbnail({
  item,
  isSelected,
  onSelect,
}: {
  item: EvidenceAsset;
  isSelected: boolean;
  onSelect(): void;
}) {
  return (
    <button
      className="evidence-thumbnail"
      type="button"
      data-selected={isSelected ? "true" : "false"}
      onClick={onSelect}
      aria-label={item.label}
      aria-pressed={isSelected}
      title={item.label}
    >
      <img src={item.src} alt="" />
      <span>{item.label}</span>
    </button>
  );
}

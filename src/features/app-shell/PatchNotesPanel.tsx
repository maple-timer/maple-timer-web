import { ChevronDown, ScrollText, X } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { useEffect, useState } from "react";
import { PATCH_NOTES } from "../../lib/patchNotes";
import type { PatchNote } from "../../lib/patchNotes";
import { FloatingTooltipButton } from "../../shared/components/FloatingTooltip";
import { MotionCollapse } from "../../shared/components/MotionCollapse";
import { MotionDialogFrame } from "../../shared/components/MotionDialogFrame";

const PATCH_NOTES_COLLAPSED_STORAGE_KEY = "maple-timer.patch-notes.collapsed";
const PATCH_NOTES_LATEST_STORAGE_KEY = "maple-timer.patch-notes.latest";
const RECENT_PATCH_NOTE_COUNT = 5;

function getLatestPatchNoteKey(): string {
  const latest = PATCH_NOTES[0];
  return latest ? `${latest.date}:${latest.content}` : "";
}

function loadInitialCollapsedState(): boolean {
  if (typeof localStorage === "undefined") {
    return false;
  }

  const latestKey = getLatestPatchNoteKey();
  const storedLatestKey = localStorage.getItem(PATCH_NOTES_LATEST_STORAGE_KEY);
  if (storedLatestKey !== latestKey) {
    localStorage.setItem(PATCH_NOTES_LATEST_STORAGE_KEY, latestKey);
    localStorage.setItem(PATCH_NOTES_COLLAPSED_STORAGE_KEY, "false");
    return false;
  }

  return localStorage.getItem(PATCH_NOTES_COLLAPSED_STORAGE_KEY) === "true";
}

function saveCollapsedState(isCollapsed: boolean): void {
  if (typeof localStorage === "undefined") {
    return;
  }

  localStorage.setItem(PATCH_NOTES_LATEST_STORAGE_KEY, getLatestPatchNoteKey());
  localStorage.setItem(PATCH_NOTES_COLLAPSED_STORAGE_KEY, String(isCollapsed));
}

function isInteractiveHeadingTarget(target: EventTarget | null): boolean {
  return target instanceof Element
    ? Boolean(target.closest("button, a, input, select, textarea, label, [role='button']"))
    : false;
}

function formatPatchDate(date: string): string {
  return date.split("-").join(".");
}

function groupPatchNotesByDate(notes: PatchNote[]): Array<{ date: string; notes: PatchNote[] }> {
  return notes.reduce<Array<{ date: string; notes: PatchNote[] }>>((groups, note) => {
    const currentGroup = groups[groups.length - 1];
    if (currentGroup?.date === note.date) {
      currentGroup.notes.push(note);
      return groups;
    }

    groups.push({ date: note.date, notes: [note] });
    return groups;
  }, []);
}

export function PatchNotesPanel() {
  const [isCollapsed, setCollapsed] = useState(loadInitialCollapsedState);
  const [isFullHistoryOpen, setFullHistoryOpen] = useState(false);
  const recentPatchNoteGroups = groupPatchNotesByDate(PATCH_NOTES.slice(0, RECENT_PATCH_NOTE_COUNT));
  const allPatchNoteGroups = groupPatchNotesByDate(PATCH_NOTES);
  const toggleCollapsed = () => {
    setCollapsed((current) => {
      const next = !current;
      saveCollapsedState(next);
      return next;
    });
  };

  return (
    <>
      <section
        className={isCollapsed ? "patch-notes-panel collapsed" : "patch-notes-panel"}
        aria-labelledby="patch-notes-title"
      >
        <div
          className="patch-notes-heading"
          onClick={(event) => {
            if (isInteractiveHeadingTarget(event.target)) {
              return;
            }
            toggleCollapsed();
          }}
        >
          <h2 id="patch-notes-title">최근 업데이트</h2>
          <div className="patch-notes-heading-actions">
            <FloatingTooltipButton
              className="icon-button small patch-notes-full-button"
              type="button"
              aria-label="전체 보기"
              tooltipId="patch-notes-full-history-tooltip"
              tooltip="전체 패치 기록 보기"
              onClick={() => setFullHistoryOpen(true)}
            >
              <ScrollText size={15} />
            </FloatingTooltipButton>
            <FloatingTooltipButton
              className="icon-button small patch-notes-collapse-button"
              type="button"
              aria-controls="patch-notes-content"
              aria-expanded={!isCollapsed}
              aria-label={isCollapsed ? "최근 업데이트 펼치기" : "최근 업데이트 접기"}
              tooltipId="patch-notes-collapse-tooltip"
              tooltip={isCollapsed ? "펼치기" : "접기"}
              onClick={toggleCollapsed}
            >
              <ChevronDown size={16} />
            </FloatingTooltipButton>
          </div>
        </div>
        <MotionCollapse
          id="patch-notes-content"
          className="patch-notes-content"
          collapsedClassName="is-collapsed"
          isCollapsed={isCollapsed}
          aria-hidden={isCollapsed}
        >
          <PatchNoteGroupList groups={recentPatchNoteGroups} />
        </MotionCollapse>
      </section>
      <AnimatePresence>
        {isFullHistoryOpen && (
          <PatchNotesHistoryDialog
            key="patch-notes-history"
            groups={allPatchNoteGroups}
            onClose={() => setFullHistoryOpen(false)}
          />
        )}
      </AnimatePresence>
    </>
  );
}

function PatchNoteGroupList({ groups }: { groups: Array<{ date: string; notes: PatchNote[] }> }) {
  return (
    <ul className="patch-notes-list">
      {groups.map((group) => (
        <li className="patch-note-date-group" key={group.date}>
          <time className="patch-note-date" dateTime={group.date}>
            {formatPatchDate(group.date)}
          </time>
          <ul className="patch-note-group-list" aria-label={`${formatPatchDate(group.date)} 패치`}>
            {group.notes.map((note) => (
              <li className="patch-note-item" key={`${note.date}-${note.content}`}>
                <span>{note.content}</span>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

function PatchNotesHistoryDialog({
  groups,
  onClose,
}: {
  groups: Array<{ date: string; notes: PatchNote[] }>;
  onClose: () => void;
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <MotionDialogFrame
      backdropClassName="patch-notes-backdrop"
      dialogAs="div"
      dialogClassName="patch-notes-dialog"
      labelledBy="patch-notes-dialog-title"
      onBackdropMouseDown={onClose}
      onDialogMouseDown={(event) => event.stopPropagation()}
    >
        <header className="patch-notes-dialog-header">
          <div>
            <p className="eyebrow">UPDATE HISTORY</p>
            <h2 id="patch-notes-dialog-title">전체 패치 기록</h2>
          </div>
          <button className="icon-button small" type="button" aria-label="닫기" onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        <div className="patch-notes-dialog-body">
          <PatchNoteGroupList groups={groups} />
        </div>
    </MotionDialogFrame>
  );
}

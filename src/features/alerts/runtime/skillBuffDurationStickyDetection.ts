import type { SkillBuffDurationFrameResult } from "./skillFrameProcessor";

const SKILL_BUFF_DURATION_STICKY_WINDOW_MS = 8_000;
const SKILL_BUFF_DURATION_STICKY_HOLD_MS = 5_000;
const SKILL_BUFF_DURATION_STICKY_FIRST_MISS_HOLD_MS = 2_200;
const SKILL_BUFF_DURATION_STICKY_MIN_OBSERVATIONS = 2;

export type SkillBuffDurationStickyEntry = {
  previewUrl: string | null;
  previewImageData: SkillBuffDurationFrameResult["previewImageData"];
  regionLabel: string | null;
  firstSeenAt: number;
  lastSeenAt: number;
  seenAtList: number[];
};

export type SkillBuffDurationStickyState = {
  entry: SkillBuffDurationStickyEntry | null;
};

export function createSkillBuffDurationStickyState(): SkillBuffDurationStickyState {
  return { entry: null };
}

export function updateSkillBuffDurationStickyFrameResult(
  state: SkillBuffDurationStickyState,
  frameResult: SkillBuffDurationFrameResult | null,
  sampledAt: number,
): SkillBuffDurationFrameResult | null {
  if (!frameResult) {
    state.entry = null;
    return null;
  }

  if (frameResult.snapshot.error) {
    state.entry = null;
    return {
      ...frameResult,
      snapshot: {
        ...frameResult.snapshot,
        displayStatus: "missing",
        displayLastSeenAt: null,
      },
    };
  }

  if (frameResult.snapshot.detected) {
    const seenAtList = appendSkillBuffDurationStickySeenAt(
      state.entry?.seenAtList ?? [],
      sampledAt,
    );
    state.entry = {
      previewUrl: frameResult.previewUrl,
      previewImageData: frameResult.previewImageData ?? null,
      regionLabel: frameResult.regionLabel,
      firstSeenAt: state.entry?.firstSeenAt ?? sampledAt,
      lastSeenAt: sampledAt,
      seenAtList,
    };
    return {
      ...frameResult,
      snapshot: {
        ...frameResult.snapshot,
        displayStatus: "detected",
        displayLastSeenAt: sampledAt,
      },
    };
  }

  if (!state.entry) {
    return {
      ...frameResult,
      snapshot: {
        ...frameResult.snapshot,
        displayStatus: "missing",
        displayLastSeenAt: null,
      },
    };
  }

  state.entry = {
    ...state.entry,
    seenAtList: pruneSkillBuffDurationStickySeenAtList(state.entry.seenAtList, sampledAt),
  };

  if (!isDisplayableSkillBuffDurationStickyEntry(state.entry, sampledAt)) {
    if (sampledAt - state.entry.lastSeenAt > SKILL_BUFF_DURATION_STICKY_WINDOW_MS) {
      state.entry = null;
    }
    return {
      ...frameResult,
      snapshot: {
        ...frameResult.snapshot,
        displayStatus: "missing",
        displayLastSeenAt: null,
      },
    };
  }

  return {
    ...frameResult,
    previewUrl: state.entry.previewUrl,
    previewImageData: state.entry.previewImageData ?? null,
    regionLabel: state.entry.regionLabel ?? frameResult.regionLabel,
    snapshot: {
      ...frameResult.snapshot,
      displayStatus: "checking",
      displayLastSeenAt: state.entry.lastSeenAt,
    },
  };
}

function isDisplayableSkillBuffDurationStickyEntry(
  entry: SkillBuffDurationStickyEntry,
  sampledAt: number,
): boolean {
  const elapsedSinceLastSeen = sampledAt - entry.lastSeenAt;
  if (elapsedSinceLastSeen <= SKILL_BUFF_DURATION_STICKY_FIRST_MISS_HOLD_MS) {
    return true;
  }

  return (
    elapsedSinceLastSeen <= SKILL_BUFF_DURATION_STICKY_HOLD_MS &&
    pruneSkillBuffDurationStickySeenAtList(entry.seenAtList, sampledAt).length >=
      SKILL_BUFF_DURATION_STICKY_MIN_OBSERVATIONS
  );
}

function appendSkillBuffDurationStickySeenAt(seenAtList: number[], sampledAt: number): number[] {
  const lastSeenAt = seenAtList[seenAtList.length - 1];
  if (lastSeenAt === sampledAt) {
    return pruneSkillBuffDurationStickySeenAtList(seenAtList, sampledAt);
  }
  return pruneSkillBuffDurationStickySeenAtList([...seenAtList, sampledAt], sampledAt);
}

function pruneSkillBuffDurationStickySeenAtList(seenAtList: number[], sampledAt: number): number[] {
  return seenAtList.filter(
    (seenAt) => sampledAt - seenAt <= SKILL_BUFF_DURATION_STICKY_WINDOW_MS,
  );
}

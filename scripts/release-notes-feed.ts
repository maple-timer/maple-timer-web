import { createHash } from "node:crypto";
import type { AppBuildInfo } from "../src/contracts/deployment/appBuildInfo";
import type { PatchNote } from "../src/lib/patchNotes";

export const RELEASE_NOTES_FEED_SCHEMA = "maple-timer.release-notes";
export const RELEASE_NOTES_FEED_VERSION = 1;
export const STABLE_PATCH_NOTE_ID_REQUIRED_FROM = "2026-07-31";

export type ReleaseNotesFeedItem = {
  content: string;
  contentHash: string;
  date: string;
  id: string;
};

export type ReleaseNotesFeed = {
  build: Pick<
    AppBuildInfo,
    "branch" | "buildTime" | "channel" | "commitSha" | "shortCommit"
  >;
  generatedAt: string;
  notes: ReleaseNotesFeedItem[];
  schema: typeof RELEASE_NOTES_FEED_SCHEMA;
  version: typeof RELEASE_NOTES_FEED_VERSION;
};

export function createReleaseNotesFeed(
  buildInfo: AppBuildInfo,
  patchNotes: PatchNote[],
): ReleaseNotesFeed {
  const ids = new Set<string>();
  const notes = patchNotes.map((note) => {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(note.date) ||
      !Number.isFinite(Date.parse(`${note.date}T00:00:00.000Z`))
    ) {
      throw new Error(`Invalid patch note date: ${note.date}`);
    }
    if (!note.content.trim() || note.content.length > 500) {
      throw new Error(`Invalid patch note content for ${note.date}`);
    }
    const contentHash = hashPatchNote(note);
    const explicitId = note.id?.trim();
    if (!explicitId && note.date >= STABLE_PATCH_NOTE_ID_REQUIRED_FROM) {
      throw new Error(`Patch note id is required for ${note.date}`);
    }
    const id = explicitId || `legacy-${note.date}-${contentHash.slice(0, 16)}`;
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,79}$/.test(id)) {
      throw new Error(`Invalid patch note id: ${id}`);
    }
    if (ids.has(id)) {
      throw new Error(`Duplicate patch note id: ${id}`);
    }
    ids.add(id);
    return {
      content: note.content,
      contentHash,
      date: note.date,
      id,
    };
  });

  return {
    build: {
      branch: buildInfo.branch,
      buildTime: buildInfo.buildTime,
      channel: buildInfo.channel,
      commitSha: buildInfo.commitSha,
      shortCommit: buildInfo.shortCommit,
    },
    generatedAt: buildInfo.buildTime,
    notes,
    schema: RELEASE_NOTES_FEED_SCHEMA,
    version: RELEASE_NOTES_FEED_VERSION,
  };
}

function hashPatchNote(note: PatchNote): string {
  return createHash("sha256")
    .update(`${note.date}\u0000${note.content}`, "utf8")
    .digest("hex");
}

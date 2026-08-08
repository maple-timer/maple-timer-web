import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AppBuildInfo } from "../src/contracts/deployment/appBuildInfo";
import { createReleaseNotesFeed } from "./release-notes-feed";

const BUILD_INFO: AppBuildInfo = {
  branch: "main",
  buildTime: "2026-07-31T00:00:00.000Z",
  channel: "production",
  commitSha: "1234567890abcdef",
  deploymentUrl: "https://maple-timer.com",
  name: "maple-timer",
  shortCommit: "1234567",
  version: "0.1.0",
  remoteRecognitionV1TestArm: false,
};

describe("createReleaseNotesFeed", () => {
  it("keeps explicit ids and creates deterministic legacy ids", () => {
    const first = createReleaseNotesFeed(BUILD_INFO, [
      { id: "stable-note", date: "2026-07-31", content: "새 기능입니다." },
      { date: "2026-07-30", content: "기존 기능입니다." },
    ]);
    const second = createReleaseNotesFeed(BUILD_INFO, [
      { id: "stable-note", date: "2026-07-31", content: "새 기능입니다." },
      { date: "2026-07-30", content: "기존 기능입니다." },
    ]);

    expect(first.schema).toBe("maple-timer.release-notes");
    expect(first.version).toBe(1);
    expect(first.build.channel).toBe("production");
    expect(first.notes[0]?.id).toBe("stable-note");
    expect(first.notes[1]?.id).toMatch(/^legacy-2026-07-30-/);
    expect(first.notes[1]?.id).toBe(second.notes[1]?.id);
    expect(first.notes[0]?.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects duplicate stable ids", () => {
    expect(() =>
      createReleaseNotesFeed(BUILD_INFO, [
        { id: "same", date: "2026-07-31", content: "첫 번째" },
        { id: "same", date: "2026-07-31", content: "두 번째" },
      ]),
    ).toThrow("Duplicate patch note id");
  });

  it("requires stable ids for new patch notes while keeping legacy history", () => {
    expect(() =>
      createReleaseNotesFeed(BUILD_INFO, [
        { date: "2026-07-31", content: "새 항목" },
      ]),
    ).toThrow("Patch note id is required for 2026-07-31");

    expect(
      createReleaseNotesFeed(BUILD_INFO, [
        { date: "2026-07-30", content: "기존 항목" },
      ]).notes[0]?.id,
    ).toMatch(/^legacy-/);
  });

  it("requires immediate cache revalidation for deployment identity", () => {
    const headers = readFileSync("public/_headers", "utf8");
    expect(headers).toMatch(
      /\/release-notes\.json\s+Cache-Control: public, max-age=0, must-revalidate/,
    );
  });
});

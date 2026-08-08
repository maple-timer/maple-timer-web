import { describe, expect, it } from "vitest";
import {
  collectIncidentDegradationReasons,
  selectIncidentFrame,
  selectIncidentRecord,
} from "./shared";

describe("shared selected-incident helpers", () => {
  const records = [
    { id: "old", sampledAt: 1_000 },
    { id: "selected", sampledAt: 2_000 },
    { id: "latest", sampledAt: 3_000 },
  ];

  it("uses selected IDs before a closer or newer record", () => {
    expect(
      selectIncidentRecord({
        records,
        selectedIds: ["selected"],
        selectedEventAt: 3_000,
        timeKey: "sampledAt",
      }),
    ).toEqual(records[1]);
  });

  it("does not replace a missing selected ID with latest state", () => {
    expect(
      selectIncidentRecord({
        records,
        selectedIds: ["missing"],
        selectedEventAt: 3_000,
        timeKey: "sampledAt",
      }),
    ).toBeNull();
  });

  it("uses event proximity only when no selected ID was recorded", () => {
    expect(
      selectIncidentRecord({
        records,
        selectedIds: [],
        selectedEventAt: 2_100,
        timeKey: "sampledAt",
      }),
    ).toEqual(records[1]);
  });

  it("prefers an observation-linked frame over selection fallback", () => {
    expect(
      selectIncidentFrame({
        frames: records,
        frameId: "old",
        selectedIds: ["selected"],
        selectedEventAt: 2_000,
      }),
    ).toEqual(records[0]);
  });

  it("deduplicates typed degradation reasons and ignores malformed entries", () => {
    expect(
      collectIncidentDegradationReasons(
        { degradationReasons: ["asset-missing", null, "asset-missing"] },
        [
          { reason: "payload-compacted" },
          { reason: "asset-missing" },
          { reason: 123 },
        ],
      ),
    ).toEqual(["asset-missing", "payload-compacted"]);
  });
});

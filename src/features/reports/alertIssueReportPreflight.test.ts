import { describe, expect, it } from "vitest";
import {
  createOneRowBuffSlotReportPreflight,
  isOneRowBuffSlotParserResult,
} from "./alertIssueReportPreflight";

describe("alertIssueReportPreflight", () => {
  it("requires at least four parser boxes before warning about one-row buff slots", () => {
    expect(
      isOneRowBuffSlotParserResult({
        boxes: [
          { x: 100, y: 20, size: 32 },
          { x: 136, y: 20, size: 32 },
          { x: 172, y: 20, size: 32 },
        ],
      }),
    ).toBe(false);
  });

  it("detects one visible buff row from parser row count or box positions", () => {
    expect(isOneRowBuffSlotParserResult({ boxCount: 12, rowCount: 1 })).toBe(true);
    expect(
      isOneRowBuffSlotParserResult({
        boxes: [
          { x: 100, y: 20, size: 32 },
          { x: 136, y: 21, size: 32 },
          { x: 172, y: 19, size: 32 },
          { x: 208, y: 20, size: 32 },
        ],
      }),
    ).toBe(true);
  });

  it("does not warn when the parser found multiple rows", () => {
    expect(isOneRowBuffSlotParserResult({ boxCount: 12, rowCount: 2 })).toBe(false);
    expect(
      isOneRowBuffSlotParserResult({
        boxes: [
          { x: 100, y: 20, size: 32 },
          { x: 136, y: 20, size: 32 },
          { x: 172, y: 58, size: 32 },
          { x: 208, y: 58, size: 32 },
        ],
      }),
    ).toBe(false);
  });

  it("builds user-facing preflight copy for one-row buff slot reports", () => {
    expect(createOneRowBuffSlotReportPreflight({ boxCount: 12, rowCount: 1 })).toMatchObject({
      kind: "one-row-buff-slots",
      description:
        "버프 아이콘이 한 줄로 길게 보이면 필요한 버프를 읽지 못할 수 있습니다. 게임 설정을 확인한 뒤 계속 제보해주세요.",
    });
  });
});

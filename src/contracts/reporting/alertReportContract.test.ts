import { describe, expect, it } from "vitest";
import {
  ALERT_REPORT_SCHEMA,
  ALERT_REPORT_VERSION,
  createAlertReportPayload,
  readAlertReportContract,
} from "./alertReportContract";

describe("alertReportContract", () => {
  it("adds the current contract without changing payload fields", () => {
    const payload = createAlertReportPayload({ kind: "rune-issue", sample: { detected: true } });

    expect(payload).toEqual({
      kind: "rune-issue",
      sample: { detected: true },
      reportContract: {
        schema: ALERT_REPORT_SCHEMA,
        version: ALERT_REPORT_VERSION,
      },
    });
  });

  it("reads supported and future contract markers without rejecting the payload", () => {
    expect(
      readAlertReportContract({ schema: ALERT_REPORT_SCHEMA, version: ALERT_REPORT_VERSION }),
    ).toEqual({ schema: ALERT_REPORT_SCHEMA, version: ALERT_REPORT_VERSION });
    expect(readAlertReportContract({ schema: "maple-timer.alert-report.next", version: 2 })).toEqual({
      schema: "maple-timer.alert-report.next",
      version: 2,
    });
  });

  it.each([
    undefined,
    null,
    {},
    { schema: ALERT_REPORT_SCHEMA },
    { schema: ALERT_REPORT_SCHEMA, version: 0 },
    { schema: ALERT_REPORT_SCHEMA, version: "1" },
  ])("treats missing or malformed markers as legacy", (value) => {
    expect(readAlertReportContract(value)).toBeNull();
  });
});

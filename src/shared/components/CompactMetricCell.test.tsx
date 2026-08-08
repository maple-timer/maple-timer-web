import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RelativeSecondsMetric, formatRelativeElapsedTime } from "./CompactMetricCell";

describe("CompactMetricCell time metrics", () => {
  it("keeps recent elapsed time in seconds", () => {
    expect(formatRelativeElapsedTime(45)).toEqual({
      value: 45,
      unit: "초",
      label: "45초 전",
    });

    render(<RelativeSecondsMetric timestamp={1_000} now={46_000} />);

    expect(screen.getByLabelText("45초 전")).toHaveTextContent("45초 전");
  });

  it("switches older elapsed time to minutes", () => {
    expect(formatRelativeElapsedTime(125)).toEqual({
      value: 2,
      unit: "분",
      label: "2분 전",
    });

    render(<RelativeSecondsMetric timestamp={1_000} now={126_000} />);

    expect(screen.getByLabelText("2분 전")).toHaveTextContent("2분 전");
  });
});

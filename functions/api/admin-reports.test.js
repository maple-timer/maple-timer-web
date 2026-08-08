import { describe, expect, it } from "vitest";
import { onRequestGet as getReportAsset } from "./admin/reports/[id]/assets/[assetId].js";
import { onRequestGet as getReport } from "./admin/reports/[id].js";
import { onRequestGet as listReports } from "./admin/reports.js";

describe("admin reports API", () => {
  it("requires an admin token", async () => {
    const response = await listReports({
      request: new Request("https://maple-timer.com/api/admin/reports"),
      env: { ADMIN_API_TOKEN: "secret" },
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
  });

  it("reports missing bindings after authorization", async () => {
    const request = new Request("https://maple-timer.com/api/admin/reports", {
      headers: { Authorization: "Bearer secret" },
    });
    const env = { ADMIN_API_TOKEN: "secret" };

    await expect(listReports({ request, env })).resolves.toHaveProperty("status", 500);
    await expect(getReport({ request, env, params: { id: "report-1" } })).resolves.toHaveProperty(
      "status",
      500,
    );
    await expect(
      getReportAsset({
        request,
        env,
        params: { id: "report-1", assetId: "asset-1" },
      }),
    ).resolves.toHaveProperty("status", 500);
  });
});

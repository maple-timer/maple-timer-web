import { describe, expect, it, vi } from "vitest";
import {
  deleteReport,
  getReport,
  getReportAsset,
  listReports,
  r2ObjectToResponse,
  saveReport,
  updateReportStatus,
} from "./report-store.js";

function createR2Binding() {
  const store = new Map();

  return {
    delete: vi.fn(async (key) => {
      store.delete(key);
    }),
    get: vi.fn(async (key) => {
      const entry = store.get(key);
      if (!entry) {
        return null;
      }

      return {
        body: new Response(entry.value).body,
        httpMetadata: entry.options?.httpMetadata ?? {},
        writeHttpMetadata(headers) {
          const contentType = entry.options?.httpMetadata?.contentType;
          if (contentType) {
            headers.set("Content-Type", contentType);
          }
        },
      };
    }),
    put: vi.fn(async (key, value, options) => {
      store.set(key, { value, options });
    }),
  };
}

function createD1Binding() {
  const reports = new Map();
  const assets = new Map();

  function run(sql, params) {
    if (sql.includes("INSERT INTO reports")) {
      const [
        id,
        source,
        kind,
        status,
        reason,
        message,
        contact,
        url,
        createdAt,
        updatedAt,
        metadataJson,
        payloadKey,
        payloadJson,
      ] = params;
      reports.set(id, {
        id,
        source,
        kind,
        status,
        reason,
        message,
        contact,
        url,
        created_at: createdAt,
        updated_at: updatedAt,
        metadata_json: metadataJson,
        payload_key: payloadKey,
        payload_json: payloadJson,
      });
      return { meta: { changes: 1 } };
    }

    if (sql.includes("INSERT INTO report_assets")) {
      const [id, reportId, name, type, blobKey, size, createdAt] = params;
      assets.set(id, {
        id,
        report_id: reportId,
        name,
        type,
        blob_key: blobKey,
        size,
        created_at: createdAt,
      });
      return { meta: { changes: 1 } };
    }

    if (sql.includes("UPDATE reports SET status")) {
      const [status, updatedAt, id] = params;
      const report = reports.get(id);
      if (!report) {
        return { meta: { changes: 0 } };
      }
      report.status = status;
      report.updated_at = updatedAt;
      return { meta: { changes: 1 } };
    }

    if (sql.includes("DELETE FROM report_assets")) {
      const [reportId] = params;
      for (const [id, asset] of assets.entries()) {
        if (asset.report_id === reportId) {
          assets.delete(id);
        }
      }
      return { meta: { changes: 1 } };
    }

    if (sql.includes("DELETE FROM reports")) {
      const [id] = params;
      const existed = reports.delete(id);
      return { meta: { changes: existed ? 1 : 0 } };
    }

    throw new Error(`Unexpected run SQL: ${sql}`);
  }

  function all(sql, params) {
    if (sql.includes("FROM reports")) {
      const limit = params.at(-2);
      const offset = params.at(-1);
      const results = Array.from(reports.values())
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(offset, offset + limit)
        .map((report) => {
          const reportAssets = Array.from(assets.values()).filter(
            (asset) => asset.report_id === report.id,
          );
          return {
            ...report,
            asset_count: reportAssets.length,
            preview_asset_id: reportAssets[0]?.id ?? null,
          };
        });
      return { results };
    }

    if (sql.includes("FROM report_assets WHERE report_id = ?")) {
      const [reportId] = params;
      return {
        results: Array.from(assets.values()).filter((asset) => asset.report_id === reportId),
      };
    }

    throw new Error(`Unexpected all SQL: ${sql}`);
  }

  function first(sql, params) {
    if (sql.includes("FROM reports WHERE id = ?")) {
      return reports.get(params[0]) ?? null;
    }

    if (sql.includes("FROM report_assets WHERE report_id = ? AND id = ?")) {
      const [reportId, assetId] = params;
      const asset = assets.get(assetId);
      return asset?.report_id === reportId ? asset : null;
    }

    throw new Error(`Unexpected first SQL: ${sql}`);
  }

  return {
    prepare: vi.fn((sql) => ({
      bind: (...params) => ({
        all: () => Promise.resolve(all(sql, params)),
        first: () => Promise.resolve(first(sql, params)),
        run: () => Promise.resolve(run(sql, params)),
      }),
    })),
  };
}

function createEnv() {
  return {
    REPORTS_DB: createD1Binding(),
    REPORT_ASSETS: createR2Binding(),
  };
}

describe("report store", () => {
  it("stores reports with R2 assets and exposes list/detail/status/delete flows", async () => {
    const env = createEnv();

    const saved = await saveReport(env, {
      id: "report-1",
      source: "feedback",
      kind: "bug",
      message: "문의 내용",
      contact: "user@example.com",
      url: "https://maple-timer.com/",
      createdAt: "2026-05-13T00:00:00.000Z",
      metadata: { capture: { hasStream: true } },
      payload: {
        message: "문의 내용",
        attachments: [{ dataUrl: "data:image/png;base64,aGVsbG8=" }],
      },
      assets: [
        {
          name: "screen.png",
          type: "image/png",
          dataUrl: "data:image/png;base64,aGVsbG8=",
        },
      ],
    });

    expect(saved).toMatchObject({ skipped: false, id: "report-1", assetCount: 1 });
    expect(env.REPORT_ASSETS.put).toHaveBeenCalledTimes(1);

    const list = await listReports(env);
    expect(list.reports).toHaveLength(1);
    expect(list.reports[0]).toMatchObject({
      id: "report-1",
      source: "feedback",
      kind: "bug",
      status: "unresolved",
      assetCount: 1,
    });
    expect(list.reports[0].previewAssetUrl).toContain("/api/admin/reports/report-1/assets/");

    const detail = await getReport(env, "report-1");
    expect(detail.payload).toMatchObject({
      id: "report-1",
      payload: {
        message: "문의 내용",
        attachments: [{ dataUrl: "[stored as report asset]" }],
      },
    });
    expect(detail.assets).toHaveLength(1);

    const status = await updateReportStatus(env, "report-1", "resolved");
    expect(status).toMatchObject({ ok: true, status: "resolved" });
    expect((await getReport(env, "report-1")).status).toBe("resolved");

    const asset = await getReportAsset(env, "report-1", detail.assets[0].id);
    const response = r2ObjectToResponse(asset);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(await response.text()).toBe("hello");

    expect(await deleteReport(env, "report-1")).toBe(true);
    expect(env.REPORT_ASSETS.delete).toHaveBeenCalledTimes(1);
    expect(await getReport(env, "report-1")).toBeNull();
  });

  it("rejects unsupported report statuses", async () => {
    const env = createEnv();

    const result = await updateReportStatus(env, "report-1", "done");

    expect(result).toEqual({ ok: false, error: "invalid status" });
  });
});

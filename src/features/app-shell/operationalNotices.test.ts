import { describe, expect, it } from "vitest";
import {
  filterOperationalNoticesSnapshot,
  parseOperationalNoticesSnapshot,
} from "./operationalNotices";

describe("operational notice payload parsing", () => {
  it("keeps valid notices and clamps polling interval", () => {
    expect(
      parseOperationalNoticesSnapshot({
        available: true,
        pollIntervalMs: 10_000,
        updatedAt: "2026-06-23T00:00:00.000Z",
        incidents: [
          {
            id: "incident-1",
            level: "warning",
            status: "identified",
            title: "스킬 알림 문제 확인 중",
            summary: "일부 스킬 알림이 다시 감지되지 않을 수 있습니다.",
            affected: ["스킬 알림"],
            startedAt: "2026-06-23T00:00:00.000Z",
            resolvedAt: null,
            updatedAt: "2026-06-23T00:05:00.000Z",
            link: null,
            updates: [
              {
                id: "update-1",
                status: "identified",
                body: "원인을 확인했습니다.",
                createdAt: "2026-06-23T00:05:00.000Z",
              },
            ],
          },
        ],
        notices: [
          {
            id: "notice-1",
            level: "warning",
            title: "점검 안내",
            body: "일부 기능을 확인 중입니다.",
            dismissible: true,
            link: null,
            updatedAt: "2026-06-23T00:00:00.000Z",
          },
          {
            id: "",
            level: "warning",
            title: "invalid",
            body: "",
            dismissible: true,
            link: null,
            updatedAt: null,
          },
        ],
      }),
    ).toEqual({
      available: true,
      incidents: [
        {
          id: "incident-1",
          level: "warning",
          status: "identified",
          title: "스킬 알림 문제 확인 중",
          summary: "일부 스킬 알림이 다시 감지되지 않을 수 있습니다.",
          affected: ["스킬 알림"],
          channels: ["production", "preview"],
          startedAt: "2026-06-23T00:00:00.000Z",
          resolvedAt: null,
          updatedAt: "2026-06-23T00:05:00.000Z",
          link: null,
          updates: [
            {
              id: "update-1",
              status: "identified",
              body: "원인을 확인했습니다.",
              createdAt: "2026-06-23T00:05:00.000Z",
            },
          ],
        },
      ],
      notices: [
        {
          id: "notice-1",
          level: "warning",
          title: "점검 안내",
          body: "일부 기능을 확인 중입니다.",
          channels: ["production", "preview"],
          dismissible: true,
          link: null,
          updatedAt: "2026-06-23T00:00:00.000Z",
        },
      ],
      updatedAt: "2026-06-23T00:00:00.000Z",
      pollIntervalMs: 30_000,
    });
  });

  it("filters incidents and notices by the deployed build channel", () => {
    const snapshot = parseOperationalNoticesSnapshot({
      available: true,
      incidents: [
        createIncident("production-incident", ["production"]),
        createIncident("preview-incident", ["preview"]),
      ],
      notices: [
        createNotice("production-notice", ["production"]),
        createNotice("preview-notice", ["preview"]),
      ],
    });

    expect(
      filterOperationalNoticesSnapshot(snapshot, "production"),
    ).toMatchObject({
      incidents: [{ id: "production-incident" }],
      notices: [{ id: "production-notice" }],
    });
    expect(
      filterOperationalNoticesSnapshot(snapshot, "preview"),
    ).toMatchObject({
      incidents: [{ id: "preview-incident" }],
      notices: [{ id: "preview-notice" }],
    });
    expect(filterOperationalNoticesSnapshot(snapshot, "local")).toEqual(snapshot);
  });

  it("returns an unavailable snapshot for invalid payloads", () => {
    expect(parseOperationalNoticesSnapshot({ available: false })).toEqual({
      available: false,
      incidents: [],
      notices: [],
      updatedAt: null,
      pollIntervalMs: 60_000,
    });
  });
});

function createIncident(id: string, channels: Array<"production" | "preview">) {
  return {
    id,
    level: "info",
    status: "monitoring",
    title: id,
    summary: "",
    affected: [],
    channels,
    startedAt: "2026-06-23T00:00:00.000Z",
    resolvedAt: null,
    updatedAt: "2026-06-23T00:00:00.000Z",
    link: null,
    updates: [],
  };
}

function createNotice(id: string, channels: Array<"production" | "preview">) {
  return {
    id,
    level: "info",
    title: id,
    body: "",
    channels,
    dismissible: true,
    link: null,
    updatedAt: "2026-06-23T00:00:00.000Z",
  };
}

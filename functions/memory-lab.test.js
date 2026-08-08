import { describe, expect, it } from "vitest";
import { onRequest } from "./memory-lab.js";

describe("memory lab route", () => {
  it("serves the app shell from static assets", async () => {
    const fetched = [];
    const response = await onRequest({
      request: new Request("https://preview.maple-timer.pages.dev/memory-lab?diag=memory"),
      env: {
        ASSETS: {
          fetch: async (url) => {
            fetched.push(url);
            return new Response("<!doctype html><div id=\"root\"></div>", {
              headers: { "Content-Type": "text/html; charset=utf-8" },
            });
          },
        },
      },
    });

    expect(fetched).toEqual(["https://preview.maple-timer.pages.dev/"]);
    expect(response.headers.get("Content-Type")).toContain("text/html");
    await expect(response.text()).resolves.toContain("root");
  });
});

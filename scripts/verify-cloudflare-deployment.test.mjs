import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { isValidRemoteRecognitionV1ReviewedBranch as isValidRuntimeReviewedBranch } from "../src/contracts/deployment/remoteRecognitionV1TestArm";
import {
  isValidRemoteRecognitionV1ReviewedBranch as isValidVerifierReviewedBranch,
  validateDeployContext,
  validateDeploymentBuildInfo,
  validateDeploymentReleaseNotesFeed,
  validateRemoteRecognitionV1TestArmContext,
  verifyCloudflareDeployment,
} from "./verify-cloudflare-deployment.mjs";

const EXPECTED = {
  commitSha: "63dedb2dd0c3d4ca042a00479ad394bd9392580f",
  branch: "codex/architecture-baseline-20260715",
  channel: "preview",
  deploymentUrl: "https://preview.maple-timer.pages.dev",
  remoteRecognitionV1TestArm: false,
};

describe("Cloudflare deployment verification", () => {
  it.each([
    ["codex/remote-recognition-v1", true],
    [`codex/${"a".repeat(122)}`, true],
    [`codex/${"a".repeat(123)}`, false],
    ["codex/remote+v1", false],
    ["codex//remote-v1", false],
    ["codex/.hidden", false],
    ["codex/remote.lock", false],
  ])(
    "keeps build-time and deployment-time reviewed branch validation identical for %s",
    (branch, expected) => {
      expect(isValidRuntimeReviewedBranch(branch)).toBe(expected);
      expect(isValidVerifierReviewedBranch(branch)).toBe(expected);
    },
  );

  it("keeps standard deploy commands disarmed and isolates the reviewed V1 path", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
    const scripts = packageJson.scripts;

    expect(scripts.build).toContain(
      "MAPLE_TIMER_REMOTE_RECOGNITION_V1_TEST_ARM=0",
    );
    expect(scripts.build).toContain(
      "MAPLE_TIMER_REMOTE_RECOGNITION_V1_TEST_BUILD_MODE= ",
    );
    expect(scripts["build:cloudflare:preview"]).toContain(
      "MAPLE_TIMER_REMOTE_RECOGNITION_V1_TEST_ARM=0",
    );
    expect(scripts["build:cloudflare:preview"]).toContain(
      "MAPLE_TIMER_REMOTE_RECOGNITION_V1_TEST_BUILD_MODE= ",
    );
    expect(scripts["build:cloudflare:production"]).toContain(
      "MAPLE_TIMER_REMOTE_RECOGNITION_V1_TEST_ARM=0",
    );
    expect(scripts["build:cloudflare:preview:remote-v1"]).toContain(
      "MAPLE_TIMER_REMOTE_RECOGNITION_V1_TEST_ARM=1",
    );
    expect(scripts["build:cloudflare:preview:remote-v1"]).toContain(
      "MAPLE_TIMER_REMOTE_RECOGNITION_V1_TEST_BUILD_MODE=reviewed-preview",
    );
    expect(scripts["build:cloudflare:preview:remote-v1"]).toContain(
      "npm run build:remote-v1:checked",
    );
    expect(
      scripts["build:cloudflare:preview:remote-v1"].endsWith("npm run build"),
    ).toBe(false);
    expect(scripts["deploy:cloudflare:preview:remote-v1"]).toContain(
      "preflight:cloudflare:preview:remote-v1",
    );
    expect(scripts["deploy:cloudflare:preview:remote-v1"]).toContain(
      "verify:cloudflare:preview:remote-v1",
    );
  });

  it("rejects production deployment outside main or from a dirty worktree", () => {
    expect(
      validateDeployContext({
        channel: "production",
        branch: "codex/feature",
        status: " M src/App.tsx",
      }),
    ).toEqual([
      "production deployment requires main, got codex/feature",
      "deployment requires a clean git worktree",
    ]);
  });

  it("accepts a clean preview feature branch", () => {
    expect(
      validateDeployContext({
        channel: "preview",
        branch: "codex/feature",
        status: "",
      }),
    ).toEqual([]);
  });

  it("requires production main to match its configured upstream", () => {
    expect(
      validateDeployContext({
        channel: "production",
        branch: "main",
        status: "",
        commitSha: "local",
        upstreamSha: "remote",
      }),
    ).toEqual([
      "production main must be pushed and match its upstream commit",
    ]);
    expect(
      validateDeployContext({
        channel: "production",
        branch: "main",
        status: "",
        commitSha: "same",
        upstreamSha: "same",
      }),
    ).toEqual([]);
  });

  it("admits the armed V1 path only for the exact reviewed preview git identity", () => {
    expect(
      validateRemoteRecognitionV1TestArmContext({
        expectedArm: true,
        channel: "preview",
        branch: EXPECTED.branch,
        commitSha: EXPECTED.commitSha,
        armValue: "1",
        buildModeValue: "reviewed-preview",
        reviewedCommit: EXPECTED.commitSha,
        reviewedBranch: EXPECTED.branch,
      }),
    ).toEqual([]);
    expect(
      validateRemoteRecognitionV1TestArmContext({
        expectedArm: true,
        channel: "production",
        branch: "main",
        commitSha: EXPECTED.commitSha,
        armValue: "0",
        buildModeValue: "wrong-mode",
        reviewedCommit: "short",
        reviewedBranch: EXPECTED.branch,
      }),
    ).toEqual([
      "remote V1 test-arm deployment requires preview channel",
      "remote V1 test-arm deployment requires MAPLE_TIMER_REMOTE_RECOGNITION_V1_TEST_ARM=1",
      "remote V1 test-arm deployment requires reviewed-preview build mode",
      "remote V1 reviewed commit must be a full lowercase commit SHA",
      "remote V1 reviewed branch must match the current git branch",
    ]);
    expect(
      validateRemoteRecognitionV1TestArmContext({
        expectedArm: true,
        channel: "preview",
        branch: "codex/remote+v1",
        commitSha: EXPECTED.commitSha,
        armValue: "1",
        buildModeValue: "reviewed-preview",
        reviewedCommit: EXPECTED.commitSha,
        reviewedBranch: "codex/remote+v1",
      }),
    ).toEqual(["remote V1 reviewed branch is invalid"]);
  });

  it("refuses an inherited arm flag on the standard deployment path", () => {
    expect(
      validateRemoteRecognitionV1TestArmContext({
        expectedArm: false,
        channel: "preview",
        branch: EXPECTED.branch,
        commitSha: EXPECTED.commitSha,
        armValue: "1",
        buildModeValue: "reviewed-preview",
        reviewedCommit: EXPECTED.commitSha,
        reviewedBranch: EXPECTED.branch,
      }),
    ).toEqual([
      "standard deployment refuses MAPLE_TIMER_REMOTE_RECOGNITION_V1_TEST_ARM=1",
      "standard deployment refuses remote V1 reviewed-preview build mode",
    ]);
  });

  it("validates the complete deployed build-info contract", () => {
    expect(validateDeploymentBuildInfo(createBuildInfo(), EXPECTED)).toEqual([]);
    expect(
      validateDeploymentBuildInfo(
        createBuildInfo({ commitSha: "stale", shortCommit: "stale" }),
        EXPECTED,
      ),
    ).toEqual([
      `commitSha expected "${EXPECTED.commitSha}", got "stale"`,
      `shortCommit expected "${EXPECTED.commitSha.slice(0, 7)}", got "stale"`,
    ]);
    expect(
      validateDeploymentBuildInfo(
        createBuildInfo({ remoteRecognitionV1TestArm: true }),
        EXPECTED,
      ),
    ).toContain("remoteRecognitionV1TestArm expected false, got true");
    expect(
      validateDeploymentBuildInfo(
        createBuildInfo({ deploymentUrl: "not-a-url" }),
        EXPECTED,
      ),
    ).toEqual([
      `deploymentUrl expected "${EXPECTED.deploymentUrl}", got null`,
    ]);
  });

  it("validates the release feed identity and stable note contract", () => {
    expect(validateDeploymentReleaseNotesFeed(createReleaseFeed(), EXPECTED)).toEqual([]);
    expect(
      validateDeploymentReleaseNotesFeed(
        createReleaseFeed({
          build: { ...createReleaseFeed().build, commitSha: "stale" },
          notes: [createReleaseNote(), createReleaseNote()],
        }),
        EXPECTED,
      ),
    ).toEqual([
      `release commitSha expected "${EXPECTED.commitSha}", got "stale"`,
      "release note id is duplicated: release-note",
    ]);
  });

  it("accepts a matching armed build-info attestation", () => {
    const armedExpected = {
      ...EXPECTED,
      remoteRecognitionV1TestArm: true,
    };
    expect(
      validateDeploymentBuildInfo(
        createBuildInfo({ remoteRecognitionV1TestArm: true }),
        armedExpected,
      ),
    ).toEqual([]);
  });

  it("retries a stale alias until the intended build is visible", async () => {
    let buildAttempt = 0;
    const fetchImpl = vi.fn(async (input) => {
      const url = new URL(input);
      if (url.pathname.endsWith("release-notes.json")) {
        return createJsonResponse(createReleaseFeed());
      }
      buildAttempt += 1;
      return createJsonResponse(
        buildAttempt === 1
          ? createBuildInfo({ commitSha: "stale", shortCommit: "stale" })
          : createBuildInfo(),
      );
    });
    const sleep = vi.fn().mockResolvedValue(undefined);
    const log = vi.fn();

    const result = await verifyCloudflareDeployment({
      url: EXPECTED.deploymentUrl,
      expected: EXPECTED,
      fetchImpl,
      attempts: 2,
      delayMs: 1,
      requestTimeoutMs: 0,
      sleep,
      log,
    });

    expect(result.attempts).toBe(2);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(sleep).toHaveBeenCalledWith(1);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("commitSha expected"));
  });

  it("fails after the bounded retry window", async () => {
    const fetchImpl = vi.fn(async (input) => {
      const url = new URL(input);
      return createJsonResponse(
        url.pathname.endsWith("release-notes.json")
          ? createReleaseFeed()
          : createBuildInfo({ channel: "production" }),
      );
    });

    await expect(
      verifyCloudflareDeployment({
        url: EXPECTED.deploymentUrl,
        expected: EXPECTED,
        fetchImpl,
        attempts: 2,
        delayMs: 0,
        requestTimeoutMs: 0,
        log: vi.fn(),
      }),
    ).rejects.toThrow(
      "channel expected \"preview\", got \"production\"",
    );
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("fails when the release feed does not belong to the deployed build", async () => {
    const fetchImpl = vi.fn(async (input) => {
      const url = new URL(input);
      return createJsonResponse(
        url.pathname.endsWith("release-notes.json")
          ? createReleaseFeed({
              build: { ...createReleaseFeed().build, channel: "production" },
            })
          : createBuildInfo(),
      );
    });

    await expect(
      verifyCloudflareDeployment({
        url: EXPECTED.deploymentUrl,
        expected: EXPECTED,
        fetchImpl,
        attempts: 1,
        delayMs: 0,
        requestTimeoutMs: 0,
        log: vi.fn(),
      }),
    ).rejects.toThrow(
      "release channel expected \"preview\", got \"production\"",
    );
  });

  it("identifies the asset that returned non-JSON during propagation", async () => {
    const fetchImpl = vi.fn(async (input) => {
      const url = new URL(input);
      if (url.pathname.endsWith("release-notes.json")) {
        return {
          ok: true,
          status: 200,
          json: vi.fn().mockRejectedValue(new SyntaxError("HTML response")),
        };
      }
      return createJsonResponse(createBuildInfo());
    });

    await expect(
      verifyCloudflareDeployment({
        url: EXPECTED.deploymentUrl,
        expected: EXPECTED,
        fetchImpl,
        attempts: 1,
        delayMs: 0,
        requestTimeoutMs: 0,
        log: vi.fn(),
      }),
    ).rejects.toThrow("release-notes.json returned invalid JSON");
  });
});

function createBuildInfo(overrides = {}) {
  return {
    name: "maple-timer",
    version: "0.1.0",
    commitSha: EXPECTED.commitSha,
    shortCommit: EXPECTED.commitSha.slice(0, 7),
    branch: EXPECTED.branch,
    deploymentUrl: EXPECTED.deploymentUrl,
    buildTime: "2026-07-15T20:33:19.522Z",
    channel: EXPECTED.channel,
    remoteRecognitionV1TestArm: EXPECTED.remoteRecognitionV1TestArm,
    ...overrides,
  };
}

function createReleaseFeed(overrides = {}) {
  return {
    schema: "maple-timer.release-notes",
    version: 1,
    build: {
      branch: EXPECTED.branch,
      buildTime: "2026-07-15T20:33:19.522Z",
      channel: EXPECTED.channel,
      commitSha: EXPECTED.commitSha,
      shortCommit: EXPECTED.commitSha.slice(0, 7),
    },
    generatedAt: "2026-07-15T20:33:19.522Z",
    notes: [createReleaseNote()],
    ...overrides,
  };
}

function createReleaseNote(overrides = {}) {
  return {
    id: "release-note",
    date: "2026-07-31",
    content: "사용자가 알아야 하는 업데이트입니다.",
    contentHash: "a".repeat(64),
    ...overrides,
  };
}

function createJsonResponse(body) {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue(body),
  };
}

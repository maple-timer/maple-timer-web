import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  collectSourceFiles,
  compareBoundaryBaseline,
  extractModuleSpecifiers,
  extractWorkerConstructors,
  findBoundaryViolations,
  findWorkerConstructionViolations,
  resolveLocalModule,
} from "./check-architecture-boundaries.mjs";

describe("architecture boundary checker", () => {
  it("extracts static, dynamic, require, and worker URL dependencies", () => {
    const source = `
      import "./static";
      export { value } from "./exported";
      const lazy = import("./lazy");
      const legacy = require("./legacy");
      const worker = new Worker(new URL("./sample.worker.ts", import.meta.url));
    `;

    expect(extractModuleSpecifiers("sample.ts", source)).toEqual([
      { kind: "module", value: "./static" },
      { kind: "module", value: "./exported" },
      { kind: "dynamic-import", value: "./lazy" },
      { kind: "require", value: "./legacy" },
      { kind: "asset-url", value: "./sample.worker.ts" },
    ]);
  });

  it("extracts browser worker constructors without treating URLs as workers", () => {
    const source = `
      const worker = new Worker(new URL("./sample.worker.ts", import.meta.url));
      const shared = new SharedWorker("./shared.worker.js");
      const asset = new URL("./asset.bin", import.meta.url);
    `;

    expect(extractWorkerConstructors("sample.ts", source)).toEqual(["Worker", "SharedWorker"]);
  });

  it("resolves extensionless files and directory indexes without resolving packages", () => {
    const importer = path.resolve("/repo/src/features/alpha/example.ts");
    const knownFiles = new Set([
      path.resolve("/repo/src/features/beta/value.ts"),
      path.resolve("/repo/src/shared/tool/index.tsx"),
    ]);

    expect(resolveLocalModule(importer, "../beta/value", knownFiles)).toBe(
      path.resolve("/repo/src/features/beta/value.ts"),
    );
    expect(resolveLocalModule(importer, "../../shared/tool", knownFiles)).toBe(
      path.resolve("/repo/src/shared/tool/index.tsx"),
    );
    expect(resolveLocalModule(importer, "react", knownFiles)).toBeNull();
  });

  it("finds cross-feature and lower-layer dependency violations", () => {
    const violations = findBoundaryViolations([
      {
        from: "src/application/reporting/policy.ts",
        to: "src/features/reports/Dialog.tsx",
        kind: "module",
      },
      {
        from: "src/contracts/profile.ts",
        to: "src/features/settings/model.ts",
        kind: "module",
      },
      {
        from: "src/contracts/reporting/evidence.ts",
        to: "src/application/reporting/coordinator.ts",
        kind: "module",
      },
      {
        from: "src/contracts/profile.ts",
        to: "src/domain/general-timer/generalTimers.ts",
        kind: "module",
      },
      {
        from: "src/domain/general-timer/generalTimers.ts",
        to: "src/features/general-timer/GeneralTimerPanel.tsx",
        kind: "module",
      },
      {
        from: "src/features/alpha/Panel.tsx",
        to: "src/app/monitoring/MonitoringWorkspace.tsx",
        kind: "module",
      },
      {
        from: "src/features/alpha/Panel.tsx",
        to: "src/features/beta/model.ts",
        kind: "module",
      },
      {
        from: "src/shared/components/Picker.tsx",
        to: "src/features/beta/context.tsx",
        kind: "module",
      },
      {
        from: "src/lib/profile.ts",
        to: "src/features/alpha/defaults.ts",
        kind: "module",
      },
      {
        from: "src/recognition/matching/runtime.ts",
        to: "src/lib/legacyMatcher.ts",
        kind: "module",
      },
      {
        from: "src/recognition/parser/workerAdapter.ts",
        to: "src/runtime/monitoring/frame.ts",
        kind: "module",
      },
      {
        from: "src/features/alpha/Panel.tsx",
        to: "src/shared/components/Button.tsx",
        kind: "module",
      },
    ]);

    expect(violations).toEqual([
      {
        rule: "application-imports-feature",
        from: "src/application/reporting/policy.ts",
        to: "src/features/reports/Dialog.tsx",
      },
      {
        rule: "contracts-imports-feature",
        from: "src/contracts/profile.ts",
        to: "src/features/settings/model.ts",
      },
      {
        rule: "contracts-imports-higher-layer",
        from: "src/contracts/profile.ts",
        to: "src/domain/general-timer/generalTimers.ts",
      },
      {
        rule: "contracts-imports-higher-layer",
        from: "src/contracts/reporting/evidence.ts",
        to: "src/application/reporting/coordinator.ts",
      },
      {
        rule: "cross-feature-import",
        from: "src/features/alpha/Panel.tsx",
        to: "src/features/beta/model.ts",
      },
      {
        rule: "domain-imports-feature",
        from: "src/domain/general-timer/generalTimers.ts",
        to: "src/features/general-timer/GeneralTimerPanel.tsx",
      },
      {
        rule: "lib-imports-feature",
        from: "src/lib/profile.ts",
        to: "src/features/alpha/defaults.ts",
      },
      {
        rule: "non-app-imports-app",
        from: "src/features/alpha/Panel.tsx",
        to: "src/app/monitoring/MonitoringWorkspace.tsx",
      },
      {
        rule: "recognition-imports-higher-layer",
        from: "src/recognition/matching/runtime.ts",
        to: "src/lib/legacyMatcher.ts",
      },
      {
        rule: "recognition-imports-higher-layer",
        from: "src/recognition/parser/workerAdapter.ts",
        to: "src/runtime/monitoring/frame.ts",
      },
      {
        rule: "shared-imports-feature",
        from: "src/shared/components/Picker.tsx",
        to: "src/features/beta/context.tsx",
      },
    ]);
  });

  it("requires production worker construction to live under the platform owner", () => {
    const rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "architecture-workers-"));
    const featurePath = path.join(rootDirectory, "src/features/alpha/createWorker.ts");
    const platformPath = path.join(
      rootDirectory,
      "src/platform/runtime-workers/alpha/createWorker.ts",
    );
    const testPath = path.join(rootDirectory, "src/features/alpha/createWorker.test.ts");

    fs.mkdirSync(path.dirname(featurePath), { recursive: true });
    fs.mkdirSync(path.dirname(platformPath), { recursive: true });
    fs.writeFileSync(featurePath, "export const worker = new Worker('feature.js');\n");
    fs.writeFileSync(platformPath, "export const worker = new Worker('platform.js');\n");
    fs.writeFileSync(testPath, "export const worker = new Worker('test.js');\n");

    try {
      const sourceFiles = collectSourceFiles(rootDirectory);
      expect(findWorkerConstructionViolations(rootDirectory, sourceFiles)).toEqual([
        {
          rule: "worker-construction-outside-platform",
          from: "src/features/alpha/createWorker.ts",
          to: "src/platform/runtime-workers/",
        },
      ]);
    } finally {
      fs.rmSync(rootDirectory, { recursive: true, force: true });
    }
  });

  it("fails for new debt, stale exceptions, missing reasons, and duplicate entries", () => {
    const approved = {
      rule: "cross-feature-import",
      from: "src/features/alpha/Panel.tsx",
      to: "src/features/beta/model.ts",
    };
    const unapproved = {
      rule: "lib-imports-feature",
      from: "src/lib/profile.ts",
      to: "src/features/alpha/defaults.ts",
    };
    const stale = {
      rule: "shared-imports-feature",
      from: "src/shared/components/Old.tsx",
      to: "src/features/alpha/Old.tsx",
      reason: "Temporary legacy dependency",
    };
    const baselineEntry = { ...approved, reason: "" };

    const comparison = compareBoundaryBaseline(
      [approved, unapproved],
      [baselineEntry, baselineEntry, stale],
    );

    expect(comparison.unapproved).toEqual([unapproved]);
    expect(comparison.stale).toEqual([stale]);
    expect(comparison.missingReasons).toEqual([baselineEntry, baselineEntry]);
    expect(comparison.duplicateBaselineEntries).toEqual([baselineEntry]);
  });
});

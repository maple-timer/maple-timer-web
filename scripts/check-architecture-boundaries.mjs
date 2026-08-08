import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const SOURCE_DIRECTORIES = ["src", "functions"];
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const BASELINE_PATH = "scripts/architecture-boundaries.json";
const FEATURE_INDEPENDENT_ROOT_RULES = [
  ["src/application/", "application-imports-feature"],
  ["src/contracts/", "contracts-imports-feature"],
  ["src/domain/", "domain-imports-feature"],
  ["src/lib/", "lib-imports-feature"],
  ["src/platform/", "platform-imports-feature"],
  ["src/recognition/", "recognition-imports-feature"],
  ["src/runtime/", "runtime-imports-feature"],
  ["src/shared/", "shared-imports-feature"],
];
const APP_DEPENDENT_SOURCE_ROOTS = [
  "src/application/",
  "src/contracts/",
  "src/domain/",
  "src/features/",
  "src/lib/",
  "src/platform/",
  "src/recognition/",
  "src/runtime/",
  "src/shared/",
];
const CONTRACT_HIGHER_LAYER_ROOTS = [
  "src/application/",
  "src/domain/",
  "src/platform/",
  "src/recognition/",
  "src/runtime/",
];
const RECOGNITION_HIGHER_LAYER_ROOTS = [
  "src/application/",
  "src/domain/",
  "src/lib/",
  "src/runtime/",
];
const RUNTIME_WORKER_OWNER_ROOT = "src/platform/runtime-workers/";

export function collectSourceFiles(rootDirectory) {
  return SOURCE_DIRECTORIES.flatMap((relativeDirectory) =>
    walkSourceFiles(path.join(rootDirectory, relativeDirectory)),
  )
    .filter((filePath) => !isTestSourceFile(filePath))
    .sort();
}

export function extractModuleSpecifiers(filePath, sourceText) {
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    getScriptKind(filePath),
  );
  const specifiers = [];

  const addStringLiteral = (node, kind) => {
    if (node && ts.isStringLiteralLike(node)) {
      specifiers.push({ kind, value: node.text });
    }
  };

  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      addStringLiteral(node.moduleSpecifier, "module");
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      addStringLiteral(node.arguments[0], "dynamic-import");
    } else if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "require"
    ) {
      addStringLiteral(node.arguments[0], "require");
    } else if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "URL"
    ) {
      addStringLiteral(node.arguments?.[0], "asset-url");
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return specifiers;
}

export function extractWorkerConstructors(filePath, sourceText) {
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    getScriptKind(filePath),
  );
  const constructors = [];

  const visit = (node) => {
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      (node.expression.text === "Worker" || node.expression.text === "SharedWorker")
    ) {
      constructors.push(node.expression.text);
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return constructors;
}

export function resolveLocalModule(importerPath, specifier, knownFiles) {
  if (!specifier.startsWith(".")) {
    return null;
  }

  const unresolvedPath = path.resolve(path.dirname(importerPath), specifier);
  const candidates = path.extname(unresolvedPath)
    ? [unresolvedPath]
    : [
        ...SOURCE_EXTENSIONS.map((extension) => `${unresolvedPath}${extension}`),
        ...SOURCE_EXTENSIONS.map((extension) => path.join(unresolvedPath, `index${extension}`)),
      ];

  return candidates.find((candidate) => knownFiles.has(normalizePath(candidate))) ?? null;
}

export function buildImportEdges(rootDirectory, sourceFiles) {
  const knownFiles = new Set(sourceFiles.map(normalizePath));
  const edges = [];

  for (const absoluteFilePath of sourceFiles) {
    const sourceText = fs.readFileSync(absoluteFilePath, "utf8");
    for (const specifier of extractModuleSpecifiers(absoluteFilePath, sourceText)) {
      const resolvedPath = resolveLocalModule(absoluteFilePath, specifier.value, knownFiles);
      if (!resolvedPath) {
        continue;
      }
      edges.push({
        from: toRepositoryPath(rootDirectory, absoluteFilePath),
        to: toRepositoryPath(rootDirectory, resolvedPath),
        kind: specifier.kind,
      });
    }
  }

  return edges;
}

export function findBoundaryViolations(edges) {
  const violations = [];

  for (const edge of edges) {
    const fromFeature = getFeatureRoot(edge.from);
    const toFeature = getFeatureRoot(edge.to);

    for (const [sourceRoot, rule] of FEATURE_INDEPENDENT_ROOT_RULES) {
      if (edge.from.startsWith(sourceRoot) && edge.to.startsWith("src/features/")) {
        violations.push(createViolation(rule, edge));
      }
    }
    if (
      APP_DEPENDENT_SOURCE_ROOTS.some((sourceRoot) => edge.from.startsWith(sourceRoot)) &&
      edge.to.startsWith("src/app/")
    ) {
      violations.push(createViolation("non-app-imports-app", edge));
    }
    if (
      edge.from.startsWith("src/contracts/") &&
      CONTRACT_HIGHER_LAYER_ROOTS.some((targetRoot) => edge.to.startsWith(targetRoot))
    ) {
      violations.push(createViolation("contracts-imports-higher-layer", edge));
    }
    if (
      edge.from.startsWith("src/recognition/") &&
      RECOGNITION_HIGHER_LAYER_ROOTS.some((targetRoot) => edge.to.startsWith(targetRoot))
    ) {
      violations.push(createViolation("recognition-imports-higher-layer", edge));
    }
    if (fromFeature && toFeature && fromFeature !== toFeature) {
      violations.push(createViolation("cross-feature-import", edge));
    }
    if (edge.from.startsWith("src/") && edge.to.startsWith("functions/")) {
      violations.push(createViolation("client-imports-server", edge));
    }
    if (edge.from.startsWith("functions/") && edge.to.startsWith("src/")) {
      violations.push(createViolation("server-imports-client", edge));
    }
  }

  return uniqueViolations(violations);
}

export function findWorkerConstructionViolations(rootDirectory, sourceFiles) {
  const violations = [];

  for (const absoluteFilePath of sourceFiles) {
    const repositoryPath = toRepositoryPath(rootDirectory, absoluteFilePath);
    if (repositoryPath.startsWith(RUNTIME_WORKER_OWNER_ROOT)) {
      continue;
    }

    const sourceText = fs.readFileSync(absoluteFilePath, "utf8");
    if (extractWorkerConstructors(absoluteFilePath, sourceText).length > 0) {
      violations.push({
        rule: "worker-construction-outside-platform",
        from: repositoryPath,
        to: RUNTIME_WORKER_OWNER_ROOT,
      });
    }
  }

  return uniqueViolations(violations);
}

export function compareBoundaryBaseline(violations, baselineEntries) {
  const actualByKey = new Map(violations.map((violation) => [violationKey(violation), violation]));
  const baselineByKey = new Map();
  const duplicateBaselineEntries = [];

  for (const entry of baselineEntries) {
    const key = violationKey(entry);
    if (baselineByKey.has(key)) {
      duplicateBaselineEntries.push(entry);
    }
    baselineByKey.set(key, entry);
  }

  return {
    unapproved: violations.filter((violation) => !baselineByKey.has(violationKey(violation))),
    stale: baselineEntries.filter((entry) => !actualByKey.has(violationKey(entry))),
    missingReasons: baselineEntries.filter(
      (entry) => typeof entry.reason !== "string" || entry.reason.trim().length === 0,
    ),
    duplicateBaselineEntries,
  };
}

export function runArchitectureBoundaryCheck({
  rootDirectory = process.cwd(),
  baselinePath = BASELINE_PATH,
} = {}) {
  const sourceFiles = collectSourceFiles(rootDirectory);
  const edges = buildImportEdges(rootDirectory, sourceFiles);
  const violations = uniqueViolations([
    ...findBoundaryViolations(edges),
    ...findWorkerConstructionViolations(rootDirectory, sourceFiles),
  ]);
  const baseline = readBaseline(path.join(rootDirectory, baselinePath));
  const comparison = compareBoundaryBaseline(violations, baseline.allowedViolations);
  const failed = Object.values(comparison).some((entries) => entries.length > 0);

  return {
    sourceFileCount: sourceFiles.length,
    edgeCount: edges.length,
    violationCount: violations.length,
    baselineCount: baseline.allowedViolations.length,
    violations,
    comparison,
    failed,
  };
}

function readBaseline(filePath) {
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (parsed.version !== 1 || !Array.isArray(parsed.allowedViolations)) {
    throw new Error(`Invalid architecture baseline: ${filePath}`);
  }
  return parsed;
}

function walkSourceFiles(directory) {
  if (!fs.existsSync(directory)) {
    return [];
  }

  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkSourceFiles(absolutePath));
    } else if (
      entry.isFile() &&
      SOURCE_EXTENSIONS.some((extension) => entry.name.endsWith(extension))
    ) {
      files.push(normalizePath(absolutePath));
    }
  }
  return files;
}

function getScriptKind(filePath) {
  if (filePath.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (filePath.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (filePath.endsWith(".js") || filePath.endsWith(".mjs") || filePath.endsWith(".cjs")) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

function isTestSourceFile(filePath) {
  return /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(filePath) || filePath.includes(`${path.sep}test${path.sep}`);
}

function getFeatureRoot(filePath) {
  const match = /^src\/features\/([^/]+)\//.exec(filePath);
  return match?.[1] ?? null;
}

function createViolation(rule, edge) {
  return {
    rule,
    from: edge.from,
    to: edge.to,
  };
}

function uniqueViolations(violations) {
  return Array.from(
    new Map(violations.map((violation) => [violationKey(violation), violation])).values(),
  ).sort((left, right) => violationKey(left).localeCompare(violationKey(right)));
}

function violationKey({ rule, from, to }) {
  return `${rule}|${from}|${to}`;
}

function normalizePath(filePath) {
  return path.normalize(filePath);
}

function toRepositoryPath(rootDirectory, filePath) {
  return path.relative(rootDirectory, filePath).split(path.sep).join("/");
}

function printViolations(title, entries) {
  if (entries.length === 0) {
    return;
  }
  console.error(`\n${title} (${entries.length})`);
  for (const entry of entries) {
    console.error(`- [${entry.rule}] ${entry.from} -> ${entry.to}`);
  }
}

function printBaselineTemplate(violations) {
  console.log(
    JSON.stringify(
      {
        version: 1,
        allowedViolations: violations.map((violation) => ({
          ...violation,
          reason: "TODO: explain why this existing dependency remains temporarily allowed",
        })),
      },
      null,
      2,
    ),
  );
}

function main() {
  const result = runArchitectureBoundaryCheck();
  if (process.argv.includes("--print-baseline")) {
    printBaselineTemplate(result.violations);
    return;
  }

  console.log(
    `Architecture boundaries: ${result.sourceFileCount} files, ${result.edgeCount} local edges, ` +
      `${result.violationCount} detected violations`,
  );
  printViolations("Unapproved dependency violations", result.comparison.unapproved);
  printViolations("Stale baseline entries", result.comparison.stale);
  printViolations("Baseline entries without reasons", result.comparison.missingReasons);
  printViolations("Duplicate baseline entries", result.comparison.duplicateBaselineEntries);

  if (result.failed) {
    process.exitCode = 1;
  }
}

const isDirectExecution =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isDirectExecution) {
  main();
}

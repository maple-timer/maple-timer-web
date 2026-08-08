#!/usr/bin/env node

import { createSign } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

const DEFAULT_PROPERTY_ID = "538363254";
const DEFAULT_DAYS = 28;
const ANALYTICS_READONLY_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DATA_API_BASE_URL = "https://analyticsdata.googleapis.com/v1beta";
const ADMIN_API_BASE_URL = "https://analyticsadmin.googleapis.com/v1beta";
const GOOGLE_SYSTEM_EVENTS = new Set([
  "click",
  "file_download",
  "first_visit",
  "form_start",
  "page_view",
  "scroll",
  "session_start",
  "user_engagement",
]);
const RECOMMENDED_CUSTOM_DIMENSION_PARAMS = new Set([
  "action",
  "alert_detail",
  "app_branch",
  "app_channel",
  "app_commit",
  "app_version",
  "capture_match",
  "capture_resolution",
  "capture_surface",
  "countdown_source",
  "detection_mode",
  "enabled",
  "feature",
  "game_resolution",
  "group",
  "item",
  "report_type",
  "scope",
  "setting",
  "source",
]);

const SOURCE_FILES = {
  packageJson: "package.json",
  analyticsEvents: "src/lib/analyticsEvents.ts",
  analyticsRuntime: "src/lib/analytics.ts",
  indexHtml: "index.html",
  viteConfig: "vite.config.ts",
};

function parseArgs(argv) {
  const options = {
    days: DEFAULT_DAYS,
    propertyId: process.env.GA_DATA_PROPERTY_ID || process.env.GA_PROPERTY_ID || DEFAULT_PROPERTY_ID,
    localOnly: false,
    requireLive: false,
    strict: false,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--days" && next) {
      options.days = Number(next);
      index += 1;
    } else if (arg === "--property-id" && next) {
      options.propertyId = next;
      index += 1;
    } else if (arg === "--local-only") {
      options.localOnly = true;
    } else if (arg === "--require-live") {
      options.requireLive = true;
    } else if (arg === "--strict") {
      options.strict = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isInteger(options.days) || options.days < 1 || options.days > 365) {
    throw new Error("--days must be an integer between 1 and 365.");
  }
  if (!options.propertyId.trim()) {
    throw new Error("--property-id or GA_DATA_PROPERTY_ID is required.");
  }

  return options;
}

function printHelp() {
  console.log(`Usage: npm run audit:ga -- [options]

Audits Maple Timer's local Google Analytics instrumentation and, when Google
Analytics credentials are available, compares it with the live GA4 property.

Options:
  --property-id <id>  GA4 property ID. Default: ${DEFAULT_PROPERTY_ID}
  --days <n>          Recent report range. Default: ${DEFAULT_DAYS}
  --local-only        Skip live GA API checks.
  --require-live      Fail if live GA credentials are unavailable.
  --strict            Exit non-zero when critical or warning issues are found.
  --json              Print machine-readable JSON.

Credential lookup order:
  1. GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN
  2. GOOGLE_SERVICE_ACCOUNT_JSON
  3. GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY
  4. GOOGLE_APPLICATION_CREDENTIALS
  5. ~/.config/gcloud/application_default_credentials.json
`);
}

function loadLocalEnvFiles() {
  for (const fileName of [".env.local", ".env", ".dev.vars"]) {
    if (!existsSync(fileName)) {
      continue;
    }
    const contents = readFileSync(fileName, "utf8");
    for (const line of contents.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }
      const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) {
        continue;
      }
      const [, key, rawValue] = match;
      if (process.env[key] !== undefined) {
        continue;
      }
      process.env[key] = parseShellValue(rawValue);
    }
  }
}

function parseShellValue(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).replace(/\\n/g, "\n").replace(/\\"/g, '"');
  }
  return trimmed.replace(/\\n/g, "\n").replace(/\\(.)/g, "$1");
}

function readText(path) {
  return readFileSync(resolve(path), "utf8");
}

function readJson(path) {
  return JSON.parse(readText(path));
}

function collectLocalState() {
  const packageJson = readJson(SOURCE_FILES.packageJson);
  const analyticsEventsSource = readText(SOURCE_FILES.analyticsEvents);
  const analyticsRuntimeSource = readText(SOURCE_FILES.analyticsRuntime);
  const indexHtml = readText(SOURCE_FILES.indexHtml);
  const viteConfig = readText(SOURCE_FILES.viteConfig);

  const productionBuildScript = packageJson.scripts?.["build:cloudflare:production"] || "";
  const previewBuildScript = packageJson.scripts?.["build:cloudflare:preview"] || "";
  const productionMeasurementId = extractMeasurementId(productionBuildScript);
  const previewMeasurementId = extractMeasurementId(previewBuildScript);
  const eventNames = extractConstStringValues(analyticsEventsSource, "AnalyticsEvent");
  const paramNames = extractConstStringValues(analyticsEventsSource, "AnalyticsParam");
  const trackedCallSites = countMatches(analyticsEventsSource, "trackAnalyticsEvent(");
  const indexBootstrapsGa = indexHtml.includes("window.gtag(\"config\"");
  const runtimeBootstrapsGa = analyticsRuntimeSource.includes("window.gtag?.(\"config\"");
  const hasBootstrapGuard =
    indexHtml.includes("__MAPLE_TIMER_GA_BOOTSTRAPPED__") &&
    analyticsRuntimeSource.includes("__MAPLE_TIMER_GA_BOOTSTRAPPED__");
  const viteInjectsMeasurementId = viteConfig.includes("__MAPLE_TIMER_GA_MEASUREMENT_ID__");

  const issues = [];
  const warnings = [];
  if (!productionMeasurementId) {
    issues.push("Production build does not inject VITE_GA_MEASUREMENT_ID.");
  }
  if (previewMeasurementId) {
    warnings.push("Preview build injects GA measurement ID; preview traffic may mix with production.");
  }
  if (indexBootstrapsGa && runtimeBootstrapsGa && !hasBootstrapGuard) {
    issues.push("GA is bootstrapped in index.html and runtime without a shared guard.");
  }
  if (!viteInjectsMeasurementId) {
    issues.push("Vite HTML transform does not replace the GA measurement ID placeholder.");
  }
  if (eventNames.length === 0) {
    issues.push("No analytics events were extracted from src/lib/analyticsEvents.ts.");
  }

  return {
    measurementIds: {
      production: productionMeasurementId || null,
      preview: previewMeasurementId || null,
    },
    eventNames,
    paramNames,
    trackedCallSites,
    bootstrap: {
      indexHtml: indexBootstrapsGa,
      runtime: runtimeBootstrapsGa,
      hasSharedGuard: hasBootstrapGuard,
      viteInjectsMeasurementId,
    },
    issues,
    warnings,
  };
}

function extractMeasurementId(text) {
  const match = text.match(/\bVITE_GA_MEASUREMENT_ID=(G-[A-Z0-9]+)\b/);
  return match?.[1] || "";
}

function extractConstStringValues(source, constName) {
  const match = source.match(new RegExp(`const\\s+${constName}\\s*=\\s*\\{([\\s\\S]*?)\\}\\s+as\\s+const`));
  if (!match) {
    return [];
  }
  return [...match[1].matchAll(/:\s*"([^"]+)"/g)].map((entry) => entry[1]).sort();
}

function countMatches(text, needle) {
  let count = 0;
  let index = 0;
  while ((index = text.indexOf(needle, index)) !== -1) {
    count += 1;
    index += needle.length;
  }
  return count;
}

async function collectLiveState({ propertyId, days, localState }) {
  const accessToken = await getGoogleAccessToken();
  const property = normalizePropertyId(propertyId);
  const [metadata, customDimensions, dataStreams, keyEvents, expectedEvents, topEvents, realtime] =
    await Promise.all([
      getGaMetadata(accessToken, property),
      listCustomDimensions(accessToken, property),
      listDataStreams(accessToken, property),
      listKeyEvents(accessToken, property),
      runExpectedEventReport(accessToken, property, days, localState.eventNames),
      runTopEventReport(accessToken, property, days),
      runRealtimeReportSafe(accessToken, property, localState.eventNames),
    ]);

  const availableMetadataDimensions = new Set(
    (metadata.dimensions || []).map((dimension) => dimension.apiName),
  );
  const availableAdminDimensionParams = new Set(
    (customDimensions.customDimensions || []).map((dimension) => dimension.parameterName),
  );
  const missingCustomDimensions = localState.paramNames.filter((name) => {
    if (!RECOMMENDED_CUSTOM_DIMENSION_PARAMS.has(name)) {
      return false;
    }
    return !availableMetadataDimensions.has(`customEvent:${name}`) && !availableAdminDimensionParams.has(name);
  });
  const eventCounts = summarizeEventReport(expectedEvents);
  const missingRecentEvents = localState.eventNames.filter((eventName) => !eventCounts.has(eventName));
  const unexpectedTopEvents = [...summarizeEventReport(topEvents).entries()]
    .filter(([eventName]) => !localState.eventNames.includes(eventName) && !GOOGLE_SYSTEM_EVENTS.has(eventName))
    .slice(0, 20)
    .map(([eventName, metrics]) => ({ eventName, ...metrics }));

  const issues = [];
  const warnings = [];
  if (missingCustomDimensions.length > 0) {
    warnings.push(
      `Missing recommended custom dimensions: ${missingCustomDimensions
        .map((name) => `customEvent:${name}`)
        .join(", ")}`,
    );
  }
  if (missingRecentEvents.length > 0) {
    warnings.push(
      `No recent events in the last ${days} days: ${missingRecentEvents.join(", ")}`,
    );
  }

  return {
    property,
    days,
    metadataDimensionCount: metadata.dimensions?.length || 0,
    customDimensions: {
      recommendedParams: localState.paramNames.filter((name) =>
        RECOMMENDED_CUSTOM_DIMENSION_PARAMS.has(name),
      ),
      registered: (customDimensions.customDimensions || []).map((dimension) => ({
        displayName: dimension.displayName,
        parameterName: dimension.parameterName,
        scope: dimension.scope,
      })),
      missingRecommended: missingCustomDimensions,
    },
    dataStreams: (dataStreams.dataStreams || []).map((stream) => ({
      name: stream.name,
      displayName: stream.displayName,
      type: stream.type,
      webDefaultUri: stream.webStreamData?.defaultUri || null,
      measurementId: stream.webStreamData?.measurementId || null,
    })),
    keyEvents: (keyEvents.keyEvents || []).map((event) => ({
      eventName: event.eventName,
      countingMethod: event.countingMethod || null,
    })),
    eventCounts: Object.fromEntries(eventCounts),
    missingRecentEvents,
    unexpectedTopEvents,
    realtime,
    issues,
    warnings,
  };
}

function normalizePropertyId(propertyId) {
  const trimmed = String(propertyId).trim();
  return trimmed.startsWith("properties/") ? trimmed : `properties/${trimmed}`;
}

async function getGoogleAccessToken() {
  const credential = loadGoogleCredential();
  if (!credential) {
    throw new Error(
      "Google Analytics credentials were not found. Set OAuth refresh-token env vars, GOOGLE_SERVICE_ACCOUNT_JSON, GOOGLE_APPLICATION_CREDENTIALS, or gcloud ADC.",
    );
  }

  if (credential.type === "authorized_user") {
    return refreshAuthorizedUserToken(credential);
  }
  if (credential.type === "service_account") {
    return refreshServiceAccountToken(credential);
  }
  throw new Error(`Unsupported Google credential type: ${credential.type || "unknown"}`);
}

function loadGoogleCredential() {
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN) {
    return {
      type: "authorized_user",
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
    };
  }

  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  }

  if (process.env.GOOGLE_CLIENT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
    return {
      type: "service_account",
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY,
    };
  }

  const credentialPaths = [
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
    `${homedir()}/.config/gcloud/application_default_credentials.json`,
  ].filter(Boolean);

  for (const credentialPath of credentialPaths) {
    if (existsSync(credentialPath)) {
      return JSON.parse(readFileSync(credentialPath, "utf8"));
    }
  }
  return null;
}

async function refreshAuthorizedUserToken(credential) {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: credential.client_id,
      client_secret: credential.client_secret,
      refresh_token: credential.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reason = body.error_description || body.error || response.statusText;
    throw new Error(`OAuth token request failed: ${reason} (${response.status}).`);
  }
  return body.access_token;
}

async function refreshServiceAccountToken(credential) {
  const now = Math.floor(Date.now() / 1000);
  const assertion = [
    base64UrlEncodeJson({ alg: "RS256", typ: "JWT" }),
    base64UrlEncodeJson({
      iss: credential.client_email,
      scope: ANALYTICS_READONLY_SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    }),
  ].join(".");
  const signer = createSign("RSA-SHA256");
  signer.update(assertion);
  signer.end();
  const signature = signer.sign(normalizePrivateKey(credential.private_key), "base64url");
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${assertion}.${signature}`,
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reason = body.error_description || body.error || response.statusText;
    throw new Error(`Service account token request failed: ${reason} (${response.status}).`);
  }
  return body.access_token;
}

function normalizePrivateKey(privateKey) {
  return String(privateKey).replace(/\\n/g, "\n");
}

function base64UrlEncodeJson(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

async function gaDataRequest(accessToken, property, path, body) {
  const response = await fetch(`${DATA_API_BASE_URL}/${property}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error?.message || `GA Data API request failed (${response.status}).`);
  }
  return data;
}

async function gaAdminRequest(accessToken, property, path) {
  const response = await fetch(`${ADMIN_API_BASE_URL}/${property}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error?.message || `GA Admin API request failed (${response.status}).`);
  }
  return data;
}

function inListFilter(fieldName, values) {
  return {
    filter: {
      fieldName,
      inListFilter: {
        values,
      },
    },
  };
}

async function getGaMetadata(accessToken, property) {
  return gaDataRequest(accessToken, property, "/metadata");
}

async function listCustomDimensions(accessToken, property) {
  return gaAdminRequest(accessToken, property, "/customDimensions?pageSize=200").catch((error) => ({
    customDimensions: [],
    warning: error.message,
  }));
}

async function listDataStreams(accessToken, property) {
  return gaAdminRequest(accessToken, property, "/dataStreams?pageSize=200").catch((error) => ({
    dataStreams: [],
    warning: error.message,
  }));
}

async function listKeyEvents(accessToken, property) {
  return gaAdminRequest(accessToken, property, "/keyEvents?pageSize=200").catch(() => ({
    keyEvents: [],
  }));
}

async function runExpectedEventReport(accessToken, property, days, eventNames) {
  return gaDataRequest(accessToken, property, ":runReport", {
    dateRanges: [{ startDate: `${days - 1}daysAgo`, endDate: "today" }],
    dimensions: [{ name: "eventName" }],
    metrics: [{ name: "eventCount" }, { name: "activeUsers" }],
    dimensionFilter: inListFilter("eventName", eventNames),
    orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
    limit: "250",
  });
}

async function runTopEventReport(accessToken, property, days) {
  return gaDataRequest(accessToken, property, ":runReport", {
    dateRanges: [{ startDate: `${days - 1}daysAgo`, endDate: "today" }],
    dimensions: [{ name: "eventName" }],
    metrics: [{ name: "eventCount" }, { name: "activeUsers" }],
    orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
    limit: "100",
  });
}

async function runRealtimeReportSafe(accessToken, property, eventNames) {
  try {
    const [eventReport, userReport] = await Promise.all([
      gaDataRequest(accessToken, property, ":runRealtimeReport", {
        dimensions: [{ name: "eventName" }],
        metrics: [{ name: "eventCount" }],
        dimensionFilter: inListFilter("eventName", eventNames),
        orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
        limit: "50",
      }),
      gaDataRequest(accessToken, property, ":runRealtimeReport", {
        metrics: [{ name: "activeUsers" }],
      }),
    ]);
    return {
      warning: null,
      activeUsers: Number(userReport.rows?.[0]?.metricValues?.[0]?.value || 0),
      events: [...summarizeEventReport(eventReport)].map(([eventName, metrics]) => ({
        eventName,
        ...metrics,
      })),
    };
  } catch (error) {
    return {
      warning: error instanceof Error ? error.message : "Realtime report failed.",
      activeUsers: null,
      events: [],
    };
  }
}

function summarizeEventReport(report) {
  const summary = new Map();
  const metricNames = (report.metricHeaders || []).map((header) => header.name);
  for (const row of report.rows || []) {
    const eventName = row.dimensionValues?.[0]?.value || "";
    if (!eventName) {
      continue;
    }
    const eventCountIndex = metricNames.indexOf("eventCount");
    const activeUsersIndex = metricNames.indexOf("activeUsers");
    summary.set(eventName, {
      eventCount: Number(row.metricValues?.[eventCountIndex >= 0 ? eventCountIndex : 0]?.value || 0),
      activeUsers:
        activeUsersIndex >= 0
          ? Number(row.metricValues?.[activeUsersIndex]?.value || 0)
          : null,
    });
  }
  return summary;
}

function renderReport(report) {
  const lines = [];
  lines.push("Maple Timer GA audit");
  lines.push("");
  lines.push("Local instrumentation");
  lines.push(`- production measurement id: ${report.local.measurementIds.production || "(missing)"}`);
  lines.push(`- preview measurement id: ${report.local.measurementIds.preview || "(none)"}`);
  lines.push(`- expected events: ${report.local.eventNames.length}`);
  lines.push(`- expected params: ${report.local.paramNames.length}`);
  lines.push(
    `- GA bootstrap: index=${formatBool(report.local.bootstrap.indexHtml)}, runtime=${formatBool(
      report.local.bootstrap.runtime,
    )}, guard=${formatBool(report.local.bootstrap.hasSharedGuard)}`,
  );
  lines.push("");

  if (!report.live) {
    lines.push("Live GA property");
    lines.push(`- skipped: ${report.liveSkippedReason || "local-only mode"}`);
  } else {
    lines.push(`Live GA property ${report.live.property}`);
    lines.push(`- data streams: ${report.live.dataStreams.length}`);
    for (const stream of report.live.dataStreams) {
      lines.push(
        `  - ${stream.displayName || stream.name}: ${stream.measurementId || "(no measurement id)"} ${
          stream.webDefaultUri || ""
        }`.trimEnd(),
      );
    }
    lines.push(`- registered custom dimensions: ${report.live.customDimensions.registered.length}`);
    if (report.live.customDimensions.missingRecommended.length > 0) {
      lines.push(
        `- missing recommended custom dimensions: ${report.live.customDimensions.missingRecommended
          .map((name) => `customEvent:${name}`)
          .join(", ")}`,
      );
    } else {
      lines.push("- missing recommended custom dimensions: none");
    }
    lines.push(`- missing recent expected events (${report.live.days}d): ${report.live.missingRecentEvents.length}`);
    if (report.live.missingRecentEvents.length > 0) {
      lines.push(`  ${report.live.missingRecentEvents.join(", ")}`);
    }
    lines.push("- expected event counts:");
    for (const [eventName, metrics] of Object.entries(report.live.eventCounts).slice(0, 40)) {
      lines.push(`  - ${eventName}: ${metrics.eventCount} events, ${metrics.activeUsers} users`);
    }
    if (report.live.unexpectedTopEvents.length > 0) {
      lines.push("- unexpected top custom events:");
      for (const item of report.live.unexpectedTopEvents) {
        lines.push(`  - ${item.eventName}: ${item.eventCount} events, ${item.activeUsers} users`);
      }
    }
    if (report.live.realtime.warning) {
      lines.push(`- realtime warning: ${report.live.realtime.warning}`);
    } else if (report.live.realtime.events.length > 0) {
      if (report.live.realtime.activeUsers !== null) {
        lines.push(`- realtime active users: ${report.live.realtime.activeUsers}`);
      }
      lines.push("- realtime expected events:");
      for (const item of report.live.realtime.events) {
        lines.push(`  - ${item.eventName}: ${item.eventCount} events`);
      }
    }
  }

  const allIssues = [...report.local.issues, ...(report.live?.issues || [])];
  const allWarnings = [...report.local.warnings, ...(report.live?.warnings || [])];
  lines.push("");
  lines.push(`Issues: ${allIssues.length}`);
  for (const issue of allIssues) {
    lines.push(`- ${issue}`);
  }
  lines.push(`Warnings: ${allWarnings.length}`);
  for (const warning of allWarnings) {
    lines.push(`- ${warning}`);
  }
  return `${lines.join("\n")}\n`;
}

function formatBool(value) {
  return value ? "yes" : "no";
}

async function main() {
  loadLocalEnvFiles();
  const options = parseArgs(process.argv.slice(2));
  const local = collectLocalState();
  const report = {
    generatedAt: new Date().toISOString(),
    options: {
      propertyId: options.propertyId,
      days: options.days,
      localOnly: options.localOnly,
    },
    local,
    live: null,
    liveSkippedReason: "",
  };

  if (!options.localOnly) {
    try {
      report.live = await collectLiveState({
        propertyId: options.propertyId,
        days: options.days,
        localState: local,
      });
    } catch (error) {
      report.liveSkippedReason = error instanceof Error ? error.message : "Live GA API check failed.";
      if (options.requireLive) {
        throw error;
      }
    }
  }

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(renderReport(report));
  }

  const issueCount =
    local.issues.length +
    local.warnings.length +
    (report.live?.issues.length || 0) +
    (report.live?.warnings.length || 0);
  if (options.strict && issueCount > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

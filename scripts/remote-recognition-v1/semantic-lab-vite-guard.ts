import type { Plugin } from "vite";

export const SEMANTIC_LAB_VITE_FS_DENY = Object.freeze([
  "**/output/**",
  "**/.git/**",
  ".env",
  ".env.*",
  "*.{crt,pem}",
]);

const BLOCKED_MARKERS = Object.freeze([
  "/remote-recognition-v1-semantic-lab.html",
  "/src/remote-recognition-v1-semantic-lab.tsx",
  "/src/platform/remote-recognition/semantic-lab/",
]);

export function createRemoteRecognitionV1SemanticLabViteGuard(
  enabled: boolean,
): Plugin {
  return {
    name: "maple-timer-remote-v1-semantic-lab-guard",
    enforce: "pre",
    configureServer(server) {
      if (enabled) return;
      server.middlewares.use((request, response, next) => {
        if (!isBlockedSemanticLabDevRequest(request.url)) {
          next();
          return;
        }
        response.statusCode = 404;
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("Content-Type", "text/plain; charset=utf-8");
        response.end("not-found\n");
      });
    },
  };
}

export function isBlockedSemanticLabDevRequest(value: unknown): boolean {
  if (typeof value !== "string" || value.length === 0 || value.length > 8_192) {
    return true;
  }
  let pathname = value.split(/[?#]/, 1)[0].replace(/\\/g, "/");
  for (let index = 0; index < 2; index += 1) {
    try {
      pathname = decodeURIComponent(pathname).replace(/\\/g, "/");
    } catch {
      return true;
    }
  }
  const lower = pathname.toLowerCase();
  return BLOCKED_MARKERS.some(
    (marker) => lower === marker || lower.includes(marker),
  );
}

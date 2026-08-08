export function buildDebugSampleLinks(requestUrl, id) {
  const url = new URL(requestUrl);
  const encodedId = encodeURIComponent(id);
  return {
    sampleUrl: `${url.origin}/api/debug-samples?id=${encodedId}`,
    sampleViewerUrl: `${url.origin}/debug-tools/debug-sample-viewer.html?sample=${encodedId}`,
    troubleshooterUrl: `${url.origin}/debug-tools/timer-report-troubleshooter.html?sample=${encodedId}`,
  };
}

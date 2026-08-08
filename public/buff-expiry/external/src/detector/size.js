import { median } from "./geometry.js?v=row-detector-v3-20260524";

export function inferSizeClusters(candidates) {
  if (!candidates.length) {
    return [];
  }

  const sorted = [...candidates].sort((a, b) => a.side - b.side);
  const clusters = [];

  for (const candidate of sorted) {
    const tolerance = Math.max(2, Math.round(candidate.side * 0.07));
    const cluster = clusters.find((entry) => Math.abs(entry.side - candidate.side) <= tolerance);
    if (cluster) {
      cluster.items.push(candidate);
      cluster.side = median(cluster.items.map((item) => item.side));
      cluster.score += candidate.score;
    } else {
      clusters.push({
        side: candidate.side,
        items: [candidate],
        score: candidate.score,
      });
    }
  }

  return clusters
    .map((cluster) => ({
      side: Math.round(cluster.side),
      count: cluster.items.length,
      score: cluster.score,
      items: cluster.items,
    }))
    .sort((a, b) => b.score - a.score || b.count - a.count);
}

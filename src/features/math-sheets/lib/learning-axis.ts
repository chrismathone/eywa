/** Each numbered goal occupies one unit; progress within that goal is fractional. */
export function learningAxisPosition(block: number, stops: readonly { blockCount: number }[]): number {
  if (!Number.isFinite(block) || block <= 0) return 0;
  let previous = 0;
  for (const [index, stop] of stops.entries()) {
    if (block <= stop.blockCount) return index + (block - previous) / (stop.blockCount - previous);
    previous = stop.blockCount;
  }
  return stops.length;
}

export function learningAxisLabel(position: number): string {
  return String(Math.round(position * 100) / 100);
}

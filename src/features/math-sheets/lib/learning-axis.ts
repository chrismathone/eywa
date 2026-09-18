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

/** Each minor interval is one teaching block, even when goals span different amounts of work. */
export function learningAxisTicks(stops: readonly { blockCount: number }[]): { block: number; position: number; goal: boolean }[] {
  const ticks: { block: number; position: number; goal: boolean }[] = [];
  let previous = 0;
  for (const [index, stop] of stops.entries()) {
    for (let block = previous + 1; block <= stop.blockCount; block++) {
      ticks.push({ block, position: index + (block - previous) / (stop.blockCount - previous), goal: block === stop.blockCount });
    }
    previous = stop.blockCount;
  }
  return ticks;
}

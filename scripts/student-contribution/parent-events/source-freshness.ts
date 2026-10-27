import { kstDateOf } from "../../../src/lib/date-kst";
import { normalizedGrid, type EventSourcePack } from "./bundle";
import { hash } from "./source-values";
import type { SourceSheet } from "./source-types";

/** A read-only MCP adapter can materialize its complete current reads; never substitute the old source pack. */
export type FreshSourceSnapshot = { capturedAt: string; sources: SourceSheet[] };
export function verifySourceSnapshot(pack: EventSourcePack, fresh: FreshSourceSnapshot, today: string) {
  if (!Number.isFinite(Date.parse(fresh.capturedAt)) || kstDateOf(fresh.capturedAt) !== today) throw new Error("Current-day Drive reads are required");
  const key = (s: SourceSheet) => `${s.fileId}:${s.gid}`;
  const bySource = new Map(fresh.sources.map(s => [key(s), s]));
  if (bySource.size !== fresh.sources.length || bySource.size !== pack.sources.length) throw new Error("Incomplete fresh Drive snapshot");
  for (const source of pack.sources) {
    const next = bySource.get(key(source));
    if (!next || next.title !== source.title || next.sheet !== source.sheet
      || hash(normalizedGrid(next.values)) !== hash(normalizedGrid(source.values))) throw new Error("Drive source changed; prepare a new reviewed source pack");
  }
  return fresh.capturedAt;
}

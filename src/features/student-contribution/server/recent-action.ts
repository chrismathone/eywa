"use server";
import { z } from "zod";
import { kstMonth, shiftMonth } from "@/lib/date-kst";
import { getContributionSnapshot } from "./directory";
import { getContributionScoreRoster } from "./score-roster";
import { cachedContributionTotals } from "./snapshot-cache";

const schema = z.object({ period: z.union([z.literal(1), z.literal(3), z.literal(6), z.literal(12)]),
  month: z.string().regex(/^\d{4}-\d{2}$/), refreshedAt: z.string().nullable(), revision: z.number().int().nonnegative() });
/** Read-only: reuse the aggregate RPC; no billing scan, refresh job or AI call on period selection. */
export async function readContributionRecent(input: unknown) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: "조회 기간을 확인해 주세요." };
  try {
    const [directory, snapshot] = await Promise.all([getContributionScoreRoster(), getContributionSnapshot()]);
    if (!directory || !snapshot?.ready) return { error: "기여도 기록을 열람할 수 없습니다." };
    const { period, month, refreshedAt, revision } = parsed.data;
    if (month !== kstMonth() || refreshedAt !== snapshot.refreshedAt || revision !== snapshot.revision)
      return { error: "집계 기준이 바뀌었습니다. 새로고침 후 조회해 주세요.", code: "stale" as const };
    const totals = await cachedContributionTotals(directory.gate.tenantId, directory.rows.map((s) => s.id), shiftMonth(month, 1 - period), refreshedAt);
    return { rows: totals.map((r) => ({ studentId: r.studentId, recent: r.recent })) };
  } catch { return { error: "기간별 변화를 불러오지 못했습니다. 다시 시도해 주세요." }; }
}

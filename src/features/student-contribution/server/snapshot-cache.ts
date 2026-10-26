import "server-only";
import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadContributionTotals, MONTHS_TABLE } from "./store";
import { fetchAllPagedInChunks } from "@/lib/supabase/batch";
import { normalizeStoredRaws } from "../model/normalize-raws";

export const contributionSnapshotTag = (tenant: string) => `student-contribution-snapshot:${tenant}`;

/** 호출자는 매 요청 권한과 현재 원생 집합을 확인한다. 캐시 안에서는 쿠키를 읽지 않는다. */
export async function cachedContributionTotals(tenant: string, ids: string[], since: string, refreshedAt: string | null) {
  const rows = await unstable_cache(async (students: string[], from: string) =>
    loadContributionTotals(createAdminClient(), tenant, students, from),
  ["student-contribution-totals-v2", tenant, refreshedAt ?? "initial"], { tags: [contributionSnapshotTag(tenant)], revalidate: 60 })(ids, since);
  // A persistent cache hit bypasses the DB loader, including its compatibility normalization.
  return rows.map(row => ({ ...row, raws: normalizeStoredRaws(row.raws), recent: normalizeStoredRaws(row.recent) }));
}

/** Only the latest month's small scalar is read. Opening the list never scans billing history. */
export function cachedEnrolledMonths(tenant: string, ids: string[], month: string, refreshedAt: string | null) {
  return unstable_cache(async (students: string[], through: string) => {
    const db = createAdminClient();
    const rows = await fetchAllPagedInChunks<{ student_id: string; enrolled_months: unknown }>(students,
      (chunk, a, b) => db.from(MONTHS_TABLE).select("student_id, enrolled_months:payload->enrolledMonths")
        .eq("tenant_id", tenant).eq("month", through).in("student_id", chunk).order("student_id").range(a, b));
    return rows.filter((r): r is { student_id: string; enrolled_months: number } => typeof r.enrolled_months === "number" && Number.isSafeInteger(r.enrolled_months) && r.enrolled_months >= 0);
  }, ["student-contribution-enrolled-months-v1", tenant, refreshedAt ?? "initial"],
  { tags: [contributionSnapshotTag(tenant)], revalidate: 60 })(ids, month);
}

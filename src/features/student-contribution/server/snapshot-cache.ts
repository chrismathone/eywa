import "server-only";
import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadContributionTotals } from "./store";

export const contributionSnapshotTag = (tenant: string) => `student-contribution-snapshot:${tenant}`;

/** 호출자는 매 요청 권한과 현재 원생 집합을 확인한다. 캐시 안에서는 쿠키를 읽지 않는다. */
export function cachedContributionTotals(tenant: string, ids: string[], since: string, refreshedAt: string | null) {
  return unstable_cache(async (students: string[], from: string) =>
    loadContributionTotals(createAdminClient(), tenant, students, from),
  ["student-contribution-totals-v1", tenant, refreshedAt ?? "initial"], { tags: [contributionSnapshotTag(tenant)], revalidate: 60 })(ids, since);
}

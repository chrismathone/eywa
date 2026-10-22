import "server-only";
import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { projectOntologyViews, type OntologySnapshot } from "../model/ontology-views";
import { contributionSnapshotTag } from "./snapshot-cache";
import { MONTHS_TABLE } from "./store";

// 학원·월·집계 버전과 현재 병합 연결·대상 원생·원본 열람 범위를 모두 캐시 키에 포함한다.
export function cachedOntologyViews(tenant: string, month: string, eligible: string[], identity: [string, string][],
  readable: string[] | null, refreshedAt: string | null) {
  return unstable_cache(async (monthKey: string, eligibleIds: string[], identities: [string, string][], readableIds: string[] | null) => {
    const db = createAdminClient();
    const rows = await fetchAllPaged<OntologySnapshot>((a, b) => db.from(MONTHS_TABLE).select("student_id, computed_at, facts:payload->facts")
      .eq("tenant_id", tenant).eq("month", monthKey).order("student_id").range(a, b).returns<OntologySnapshot[]>());
    const canonicalIds = new Map(identities);
    return projectOntologyViews(tenant, rows, new Set(eligibleIds), (id) => {
      const canonical = canonicalIds.get(id);
      if (!canonical) throw new Error("원생의 연결을 확인해 주세요");
      return canonical;
    }, readableIds === null ? null : new Set(readableIds));
  }, ["student-contribution-ontology-v1", tenant, refreshedAt ?? "initial"], { tags: [contributionSnapshotTag(tenant)], revalidate: 60 })(
    month, [...eligible].sort(), [...identity].sort(([a], [b]) => a.localeCompare(b)), readable === null ? null : [...readable].sort());
}

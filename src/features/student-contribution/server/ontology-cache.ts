import "server-only";
import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { projectOntologyViews, type OntologySnapshot } from "../model/ontology-views";
import { contributionSnapshotTag } from "./snapshot-cache";
import { MONTHS_TABLE } from "./store";
import { latestStudentSourceFacts } from "@/features/students/ontology/visible-facts";
import { gzip, gunzip } from "node:zlib";
import { promisify } from "node:util";
const compress = promisify(gzip), decompress = promisify(gunzip);

/** Raw monthly facts exceed the cache entry limit; compress them and never send them to the client. */
async function cachedMonthRows(tenant: string, month: string, refreshedAt: string | null): Promise<OntologySnapshot[]> {
  const encoded = await unstable_cache(async () => {
    const db = createAdminClient();
    const rows = await fetchAllPaged<OntologySnapshot>((a, b) => db.from(MONTHS_TABLE).select("student_id, computed_at, facts:payload->facts")
      .eq("tenant_id", tenant).eq("month", month).order("student_id").range(a, b).returns<OntologySnapshot[]>());
    return (await compress(JSON.stringify(rows))).toString("base64");
  }, ["student-contribution-month-sources-v1", tenant, month, refreshedAt ?? "initial"], { tags: [contributionSnapshotTag(tenant)], revalidate: 60 })();
  return JSON.parse((await decompress(Buffer.from(encoded, "base64"))).toString("utf8")) as OntologySnapshot[];
}

// 원본 조회만 공유한다. 현재 권한·병합·필터는 매 요청마다 다시 적용한다.
export async function cachedOntologyViews(tenant: string, month: string, eligible: string[], identity: [string, string][],
  readable: string[] | null, refreshedAt: string | null, quarantined: string[] = []) {
    const rows = await cachedMonthRows(tenant, month, refreshedAt);
    const canonicalIds = new Map(identity);
    const invalid = new Set(quarantined);
    const unknown = new Set<string>();
    const known = (id: string) => {
      if (invalid.has(id)) return false;
      if (canonicalIds.has(id)) return true;
      unknown.add(id); return false;
    };
    for (const row of rows) known(row.student_id);
    // Select the newest source before quarantine; otherwise a removed newest record can resurrect an older one.
    const latest = latestStudentSourceFacts(tenant, rows.map((r) => ({ computedAt: r.computed_at, facts: r.facts ?? [] })));
    const safeRows = [{ student_id: "", computed_at: "", facts: latest.filter((f) => known(f.studentId)
      && f.evidence.every((e) => known(e.studentId)) && f.related.every((e) => e.kind !== "student" || known(e.id))) }];
    const views = projectOntologyViews(tenant, safeRows, new Set(eligible), (id) => {
      const canonical = canonicalIds.get(id);
      if (!canonical) throw new Error("원생의 연결을 확인해 주세요");
      return canonical;
    }, readable === null ? null : new Set(readable));
    return { views, unresolved: unknown.size };
}

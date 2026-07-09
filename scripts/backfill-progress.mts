// 진도 컨테이너 백필(실 데이터) — 테넌트의 math(네이티브) + null-subject(legacy 임포트) 보고서를
// report_date ASC로 순회하며 ingest(멱등). positionOf가 커리큘럼 매핑되는 초·중 진도만 실제 반영(고등 제외).
// service-role(RLS bypass) + 실 ingestReport(3a 코어). 재실행 안전(엔트리 기반 멱등).
//   실행: node_modules/.bin/tsx scripts/backfill-progress.mts
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { ingestReport } from "../src/features/progress/server/ingest";
import { describePosition } from "../src/features/progress/curriculum-position";

config({ path: ".env.local" });
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!.trim(), process.env.SUPABASE_SERVICE_ROLE_KEY!.trim(), {
  auth: { persistSession: false, autoRefreshToken: false },
});

type Row = { id: string; tenant_id: string; student_id: string; report_date: string; subject: string | null; progress: string | null };

const rows: Row[] = [];
const PAGE = 1000;
for (let f = 0; ; f += PAGE) {
  const { data, error } = await sb
    .from("lesson_reports")
    .select("id, tenant_id, student_id, report_date, subject, progress")
    .or("subject.eq.math,subject.is.null")
    .order("report_date", { ascending: true })
    .order("created_at", { ascending: true })
    .range(f, f + PAGE - 1);
  if (error) {
    console.error("read error:", error.message);
    process.exit(1);
  }
  rows.push(...((data as Row[]) ?? []));
  if (!data || data.length < PAGE) break;
}
console.log(`대상 보고서 ${rows.length}건 백필 시작…`);

const evt: Record<string, number> = {};
const skip: Record<string, number> = {};
let ingested = 0;
let i = 0;
for (const r of rows) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await ingestReport(sb as any, {
    id: r.id,
    tenantId: r.tenant_id,
    studentId: r.student_id,
    reportDate: r.report_date,
    subject: r.subject,
    progress: r.progress,
  });
  if (res.skipped) skip[res.skipped] = (skip[res.skipped] ?? 0) + 1;
  if (res.event) {
    evt[res.event] = (evt[res.event] ?? 0) + 1;
    ingested++;
  }
  if (++i % 500 === 0) console.log(`  …${i}/${rows.length}`);
}
console.log("반영:", ingested, "· 이벤트:", evt, "· skip:", skip);

const cnt = async (t: string) => (await sb.from(t).select("*", { count: "exact", head: true })).count ?? 0;
console.log("생성 —", {
  containers: await cnt("progress_containers"),
  entries: await cnt("progress_entries"),
  events: await cnt("progress_events"),
});

// 컨테이너 있는 실 학생 수 + 샘플
const { data: cs } = await sb.from("progress_containers").select("student_id, track, last_position, chapter_count, status").eq("status", "active").order("chapter_count", { ascending: false }).limit(10);
const uniq = new Set((cs ?? []).map((c) => c.student_id));
console.log(`활성 컨테이너 보유 학생(샘플 상위 10 기준 ${uniq.size}명):`);
for (const c of cs ?? []) {
  const { data: stu } = await sb.from("students").select("name, grade").eq("id", c.student_id).maybeSingle();
  const d = describePosition(c.last_position);
  console.log(`  ${stu?.name}(${stu?.grade}) [${c.track}] ${c.chapter_count}개 · ${d ? d.grade + " " + d.lesson : "?"}`);
}
process.exit(0);

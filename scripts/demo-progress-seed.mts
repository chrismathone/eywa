// 진도 컨테이너 데모 시딩 — '진도데모_*' 학생 5명 + realistic math 보고서 시퀀스 생성 후 ingest.
// service-role(RLS bypass) + 실 ingestReport 재사용(3a 코어). 재실행 안전(먼저 기존 데모 삭제).
// 정리: scripts/demo-progress-cleanup.mts (또는 delete from students where name like '진도데모_%').
//   실행: node_modules/.bin/tsx scripts/demo-progress-seed.mts
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { MATH_CURRICULUM } from "../src/features/onescreen/curriculum";
import { ingestReport } from "../src/features/progress/server/ingest";
import { describePosition, positionOf } from "../src/features/progress/curriculum-position";

config({ path: ".env.local" });
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!.trim(), process.env.SUPABASE_SERVICE_ROLE_KEY!.trim(), {
  auth: { persistSession: false, autoRefreshToken: false },
});

const gradeLessons = (g: string): string[] => (MATH_CURRICULUM[g] ?? []).flatMap((u) => u.lessons);
const isoDaysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

// 테넌트 = 기존 보고서 소유 테넌트(injaewon)
const { data: anyReport } = await sb.from("lesson_reports").select("tenant_id").limit(1).maybeSingle();
const tenantId = anyReport?.tenant_id as string | undefined;
if (!tenantId) {
  console.error("테넌트를 찾지 못함(lesson_reports 없음)");
  process.exit(1);
}

// 재실행 안전: 기존 데모 삭제(cascade)
await sb.from("students").delete().eq("tenant_id", tenantId).like("name", "진도데모_%");

// 데모 학생 정의 — 현행 3명(속도 차) + 선행 1명 + 점프 1명
type Demo = { name: string; grade: string; lessons: string[] };
const c2 = gradeLessons("중2");
const m1 = gradeLessons("중1");
const demos: Demo[] = [
  { name: "진도데모_현행A", grade: "중2", lessons: c2.slice(12, 20) }, // 8건 · +1/회(보통)
  { name: "진도데모_현행B", grade: "중2", lessons: [12, 14, 16, 18, 20, 22, 24, 26].map((i) => c2[i]!).filter(Boolean) }, // 빠름(+2/회)
  { name: "진도데모_현행C", grade: "중2", lessons: c2.slice(12, 17) }, // 5건(느림/적음)
  { name: "진도데모_선행D", grade: "초6", lessons: m1.slice(0, 6) }, // 초6이 중1 진도 → ahead
  { name: "진도데모_점프E", grade: "중1", lessons: [m1[0]!, m1[1]!, m1[2]!, m1[3]!, m1[m1.length - 1]!] }, // 마지막에 큰 점프
];

let totalReports = 0;
for (const d of demos) {
  const { data: stu, error: sErr } = await sb
    .from("students")
    .insert({ tenant_id: tenantId, name: d.name, grade: d.grade, status: "enrolled" })
    .select("id")
    .single();
  if (sErr || !stu) {
    console.error(`학생 생성 실패(${d.name}):`, sErr?.message);
    process.exit(1);
  }
  const n = d.lessons.length;
  const evt: Record<string, number> = {};
  for (let i = 0; i < n; i++) {
    const progress = `수학 ${d.lessons[i]}`;
    const reportDate = isoDaysAgo((n - 1 - i) * 3 + 1); // 최근 ~3주, 3일 간격
    const { data: rep } = await sb
      .from("lesson_reports")
      .insert({ tenant_id: tenantId, student_id: stu.id, report_date: reportDate, subject: "math", progress, teacher_name: "진도데모", source: "demo-seed" })
      .select("id")
      .single();
    if (!rep) continue;
    totalReports++;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await ingestReport(sb as any, { id: rep.id, tenantId, studentId: stu.id, reportDate, subject: "math", progress, teacherName: "진도데모" });
    if (res.event) evt[res.event] = (evt[res.event] ?? 0) + 1;
  }
  const last = d.lessons[n - 1] ? positionOf(`수학 ${d.lessons[n - 1]}`) : null;
  console.log(`  ${d.name}(${d.grade}) ${n}건 → ${JSON.stringify(evt)} · 현재 ${last ? describePosition(last.position)?.grade + " " + describePosition(last.position)?.lesson : "?"}`);
}

// 요약 + 검증
const cnt = async (t: string, col: string, prefix: string) => {
  const { data } = await sb.from("students").select("id").eq("tenant_id", tenantId).like("name", "진도데모_%");
  const ids = (data ?? []).map((s) => s.id);
  const { count } = await sb.from(t).select("*", { count: "exact", head: true }).in(col, ids);
  void prefix;
  return count ?? 0;
};
console.log(`\n데모 ${demos.length}명 · 보고서 ${totalReports}건`);
console.log("컨테이너:", await cnt("progress_containers", "student_id", ""), "· 엔트리:", await cnt("progress_entries", "student_id", ""), "· 이벤트:", await cnt("progress_events", "student_id", ""));
process.exit(0);

/**
 * 읽기 전용 실측 — 운영실 '재원생 구성' 막대 숫자와 원생목록 필터(미수강·학교급×구성) 건수가 같은가(2026-09-28).
 * 쓰기 없음. 자격증명은 출력하지 않는다. 실행: npx tsx scripts/_oneoff/_probe-unenrolled-parity.mts
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import {
  activeStudentIds,
  compositionStudentIds,
  composeEnrolled,
  notYetStartedStudentIds,
  summarizePrograms,
  type ActiveEnrollmentRow,
} from "../../src/features/students/enrolled-composition";
import { levelSubjectSplit } from "../../src/features/dashboard/overview/student-composition";
import { levelKeyOfLabel, type StudentLevel } from "../../src/features/students/list-filter-values";

const env = Object.fromEntries(
  readFileSync("D:/eywa_refactoring/.env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim().replace(/^"|"$/g, "")]),
);
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function all<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
const { data: tenant } = await db.from("tenants").select("id").eq("slug", "cs").single();
const tenantId = tenant!.id as string;
const { data: settingsRow } = await db.from("tenant_settings").select("data").eq("tenant_id", tenantId).maybeSingle();
const subjects = ((settingsRow?.data as { operations?: { subjects?: { key: string; label: string }[] } })?.operations?.subjects) ?? [];

const students = await all<{ id: string; grade: string | null; school: string | null }>((f, t) =>
  db.from("students").select("id, grade, school").eq("tenant_id", tenantId).eq("status", "enrolled").order("id").range(f, t),
);
const rows = await all<ActiveEnrollmentRow>((f, t) =>
  db
    .from("enrollments")
    .select("id, student_id, start_date, class:class_id!inner ( subject, english_track ), student:student_id!inner ( status )")
    .eq("tenant_id", tenantId)
    .is("end_date", null)
    .eq("on_hold", false)
    .eq("student.status", "enrolled")
    .order("id")
    .range(f, t),
);

// 운영실(막대)
const composition = composeEnrolled({ students, rows, scope: null, subjects, today });
const split = levelSubjectSplit(composition.students, composition.programs);
const summary = summarizePrograms(composition.students.map((s) => s.id), composition.programs, composition.active);

// 원생목록(필터) — 목록 모집단 = 재원 − 시작 전(hideNotStarted), 그 위에 판정 함수.
const notStarted = notYetStartedStudentIds(rows, today);
const universe = students.filter((s) => !notStarted.has(s.id));
const active = activeStudentIds(rows, null, today);
const listedNone = universe.filter((s) => !active.has(s.id)).length;

console.log(`기준일 ${today} · 재원생(실시간) ${composition.students.length} · 목록 모집단 ${universe.length}`);
console.log(`미수강: 막대 ${summary.noEnrollment} · 목록 ${listedNone}`);
let mismatch = summary.noEnrollment === listedNone ? 0 : 1;
for (const row of split.rows) {
  const level = levelKeyOfLabel(row.label) as StudentLevel;
  const universeIds = new Set(universe.map((s) => s.id));
  for (const mix of ["englishOnly", "both", "mathOnly"] as const) {
    const listed = [...compositionStudentIds(composition, { levels: [level], mixes: [mix] })].filter((id) => universeIds.has(id)).length;
    if (listed !== row[mix]) mismatch += 1;
    console.log(`${row.label} ${mix}: 막대 ${row[mix]} · 목록 ${listed}`);
  }
}
const otherOnly = split.rows.reduce((s, r) => s + r.neither, 0) - summary.noEnrollment;
const listedOther = compositionStudentIds(composition, { levels: [], mixes: ["other"] }).size;
if (otherOnly !== listedOther) mismatch += 1;
console.log(`기타 과목: 막대 ${otherOnly} · 목록 ${listedOther}`);
console.log(mismatch === 0 ? "✅ 전 조각 일치" : `❌ 불일치 ${mismatch}건`);

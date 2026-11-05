/**
 * **보강 보고서 반 = 보강 출결 행 반 = 발송 반** — 운영 데이터의 어긋남을 센다(원장 2026-09-30 *"모든 기록에 동일한 반이 매핑되어야함"*).
 *
 *   pnpm tsx scripts/_reports/makeup-class-drift.mts                 (드라이런 — 조회만, 기본)
 *   pnpm tsx scripts/_reports/makeup-class-drift.mts --since=2026-09-01
 *   pnpm tsx scripts/_reports/makeup-class-drift.mts --apply          (🔴 원장 승인 뒤에만 — 이 세션에선 실행하지 않았다)
 *
 * 판정 = 앱과 **같은 순수 함수**(`makeupInvariantViolations`, src/features/onescreen/makeup-anchor.ts). 대상 = 반 없는 보강 보고서
 * (`makeup = true` ∧ `class_id is null`). 한 건의 칸 = 그날 그 학생의 **유효** 출결(정정 이력은 최신 한 행) 중
 * 앵커 반의 칸 + 앵커 밖의 같은 과목 `makeup` 칸 + 소유 강사의 보이지 않는 보강 반 칸.
 *
 * 분류와 고치는 안(`--apply`일 때만 쓴다):
 *  A. 발송 완료(게시 기록 있음) — **출석부를 발송 반으로 옮긴다**(학부모가 본 반이 사실이다). 발송 반 = 적힌 '보낼 반' ?? 보강 반.
 *     보고서의 보강 반도 발송 반으로 맞춘다(메타만 — 본문은 안 건드린다).
 *  B. 미발송 — **보고서를 출석부 반에 맞춘다**: 앵커 밖 보강 칸이 정확히 하나이고 그 반이 보이지 않는 보강 반이 아니면
 *     `makeup_class_id = classnote_class_id = 그 반`. 칸이 여럿·보강 반뿐이면 사람 몫(목록만).
 *  C. 앵커는 있는데 칸이 아무 데도 없음(관리자 작성분 등, C8) — 앵커 반에 보강 칸 **생성**(시수 기본 1, 귀속은 비움).
 *     🔴 발송 '성공' 보고서는 빼고 목록만 — 2026-11-05부터 출석부에서 그 칸을 일부러 지울 수 있다(급여 시수 · 보고서는 그대로).
 *  D. 반 미정(반별 발송 대상인데 앵커 없음) — 건수·예시만(사람이 원스크린에서 고른다).
 * 출력 = 분류별 건수 + 예시 5건(학생 이름·날짜·과목·반 이름만 — 🔴 연락처·본문 없음).
 *
 * 🔴 **되돌리기 SQL은 여기(주석)에만** 둔다 — 메시지 본문에 붙이지 않는다(적용 SQL로 오인해 실행한 전례, 2026-09-12).
 *    --apply가 남기는 로그(`scripts/_reports/logs/makeup-class-drift-<시각>.json`)에 바꾼 행의 옛 값이 있다. 그 파일로:
 *      -- A·B 보고서 반 되돌리기(로그의 reports[]마다):
 *      -- update lesson_reports set makeup_class_id = '<old_makeup>', classnote_class_id = '<old_send>' where id = '<id>';
 *      -- A 칸 옮기기 되돌리기(로그의 moved[]마다):
 *      -- update attendance_records set class_id = '<old_class>' where id = '<id>';
 *      -- C 생성 되돌리기(로그의 created[]마다):
 *      -- delete from attendance_records where id = '<id>';
 */
import { config } from "dotenv";
import { mkdirSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { makeupInvariantViolations, type MakeupInvariantViolation } from "../../src/features/onescreen/makeup-anchor";
import { classRouteActive, SEND_CLASS_SUBJECTS } from "../../src/features/onescreen/send-class";
import { resolveSettings } from "../../src/features/owner/resolve";
import { LEGACY_REPORT_SUBJECT } from "../../src/features/timetable/lib/report-subject";

config({ path: ".env.local", quiet: true });
const arg = (key: string) => process.argv.find((a) => a.startsWith(`--${key}=`))?.slice(key.length + 3);
const since = arg("since") ?? "2026-01-01";
const apply = process.argv.includes("--apply");
if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) throw new Error("--since=YYYY-MM-DD");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
if (!url || !key) throw new Error(".env.local에 Supabase URL·service role 키가 없습니다");
const sb = createClient(url, key, { auth: { persistSession: false } });

type Report = {
  id: string;
  tenant_id: string;
  student_id: string;
  report_date: string;
  subject: string | null;
  makeup_class_id: string | null;
  classnote_class_id: string | null;
  classnote_status: string | null;
  classnote_sent_at: string | null;
  created_by: string | null;
  source: string | null;
};
type Att = { id: string; class_id: string; student_id: string; session_date: string; status: string; slot_start: string | null; recorded_at: string };

async function pageAll<T>(q: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await q(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if ((data ?? []).length < 1000) return out;
  }
}
const chunks = <T,>(xs: T[], n = 100) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

// ── 조회(전부 select) ─────────────────────────────────────────────────────────
const reports = await pageAll<Report>((f, t) =>
  sb
    .from("lesson_reports")
    .select("id, tenant_id, student_id, report_date, subject, makeup_class_id, classnote_class_id, classnote_status, classnote_sent_at, created_by, source")
    .eq("makeup", true)
    .is("class_id", null)
    .gte("report_date", since)
    .order("id")
    .range(f, t),
);
const studentIds = [...new Set(reports.map((r) => r.student_id))];
const att: Att[] = [];
for (const ids of chunks(studentIds))
  att.push(
    ...(await pageAll<Att>((f, t) =>
      sb
        .from("attendance_records")
        .select("id, class_id, student_id, session_date, status, slot_start, recorded_at")
        .in("student_id", ids)
        .gte("session_date", since)
        .order("id")
        .range(f, t),
    )),
  );
const classIds = [...new Set([...att.map((a) => a.class_id), ...reports.flatMap((r) => [r.makeup_class_id, r.classnote_class_id].filter((x): x is string => !!x))])];
const classes = new Map<string, { name: string; subject: string | null; pool: boolean; teacher: string | null }>();
for (const ids of chunks(classIds)) {
  const { data, error } = await sb.from("classes").select("id, class_name, subject, is_makeup_pool, teacher_id").in("id", ids);
  if (error) throw new Error(error.message);
  for (const c of data ?? [])
    classes.set(c.id as string, { name: (c.class_name as string) ?? "", subject: (c.subject as string | null) ?? null, pool: !!c.is_makeup_pool, teacher: (c.teacher_id as string | null) ?? null });
}
const names = new Map<string, string>();
for (const ids of chunks(studentIds)) {
  const { data, error } = await sb.from("students").select("id, name").in("id", ids);
  if (error) throw new Error(error.message);
  for (const s of data ?? []) names.set(s.id as string, s.name as string);
}
const tenantIds = [...new Set(reports.map((r) => r.tenant_id))];
const settingsByTenant = new Map<string, ReturnType<typeof resolveSettings>>();
for (const tid of tenantIds) {
  const { data } = await sb.from("tenant_settings").select("data").eq("tenant_id", tid).maybeSingle();
  settingsByTenant.set(tid, resolveSettings(data?.data ?? null, { name: "" }));
}

// 유효 행 = (학생·반·날짜·교시) 최신 한 행(effective-records.ts와 같은 규칙).
const effective = new Map<string, Att>();
for (const a of att) {
  const k = `${a.student_id}|${a.class_id}|${a.session_date}|${a.slot_start ?? ""}`;
  const p = effective.get(k);
  if (!p || a.recorded_at > p.recorded_at || (a.recorded_at === p.recorded_at && a.id > p.id)) effective.set(k, a);
}
const effByStudentDate = new Map<string, Att[]>();
for (const a of effective.values()) {
  const k = `${a.student_id}|${a.session_date}`;
  (effByStudentDate.get(k) ?? effByStudentDate.set(k, []).get(k)!).push(a);
}

// ── 판정 ────────────────────────────────────────────────────────────────────
type Row = { r: Report; subject: string; violations: MakeupInvariantViolation[]; cells: Att[]; outside: Att[] };
const rows: Row[] = [];
for (const r of reports) {
  const subject = (r.subject ?? "").trim() || LEGACY_REPORT_SUBJECT;
  const day = effByStudentDate.get(`${r.student_id}|${r.report_date}`) ?? [];
  const isOwnerPool = (cid: string) => {
    const c = classes.get(cid);
    return !!c?.pool && (!r.created_by || c.teacher === r.created_by);
  };
  const cells = day.filter(
    (a) => a.class_id === r.makeup_class_id || isOwnerPool(a.class_id) || (a.status === "makeup" && classes.get(a.class_id)?.subject === subject),
  );
  const settings = settingsByTenant.get(r.tenant_id)!;
  const requireAnchor = SEND_CLASS_SUBJECTS.has(subject) && classRouteActive(settings);
  const violations = makeupInvariantViolations({
    report: { makeup: true, classId: null, makeupClassId: r.makeup_class_id, classnoteClassId: r.classnote_class_id },
    cells: cells.map((a) => ({ classId: a.class_id, status: a.status })),
    requireAnchor,
  });
  rows.push({ r, subject, violations, cells, outside: cells.filter((a) => a.class_id !== r.makeup_class_id) });
}

const sent = (r: Report) => !!r.classnote_sent_at || r.classnote_status === "success";
const bad = rows.filter((x) => x.violations.length > 0);
const undecided = bad.filter((x) => x.violations.includes("no_anchor"));
const noCellsAnywhere = bad.filter((x) => x.r.makeup_class_id && x.cells.length === 0);
// 2026-11-05: 발송 '성공' 보고서의 칸은 출석부에서 일부러 지울 수 있다(원장 — 급여 시수 · 보고서는 그대로) → 칸을 다시 만들지 않는다(목록만).
const noCellsKept = noCellsAnywhere.filter((x) => x.r.classnote_status === "success");
const noCellsToCreate = noCellsAnywhere.filter((x) => x.r.classnote_status !== "success");
const sentMismatch = bad.filter((x) => sent(x.r) && !x.violations.includes("no_anchor") && !noCellsAnywhere.includes(x));
const unsentMismatch = bad.filter((x) => !sent(x.r) && !x.violations.includes("no_anchor") && !noCellsAnywhere.includes(x));
const noAnchorAll = rows.filter((x) => !x.r.makeup_class_id);

const cname = (id: string | null) => (id ? classes.get(id)?.name || "(이름 없음)" : "(없음)");
const example = (x: Row) =>
  `${names.get(x.r.student_id) ?? "(이름 없음)"} · ${x.r.report_date} · ${x.subject} · 보강 반 ${cname(x.r.makeup_class_id)} · 보낼 반 ${cname(x.r.classnote_class_id)} · 칸 ${x.cells.map((a) => cname(a.class_id)).join("/") || "없음"} · ${x.violations.join(",") || "-"}${x.r.source === "admin" ? " · 관리자 작성" : ""}`;
const byKind = (k: MakeupInvariantViolation) => bad.filter((x) => x.violations.includes(k)).length;

console.log(`\n보강 보고서(반 없음) ${rows.length}건 — ${since} 이후 · 테넌트 ${tenantIds.length}곳 · ${apply ? "🔴 적용 모드" : "드라이런(조회만)"}`);
console.log(`불변식 위반 ${bad.length}건: 반 미정 ${byKind("no_anchor")} · 앵커 반에 칸 없음 ${byKind("no_cell_in_anchor")} · 앵커 밖 보강 칸 ${byKind("cell_outside_anchor")} · 보낼 반 ≠ 보강 반 ${byKind("send_class_differs")}`);
console.log(`반 미정 보강 전체(반별 발송 대상 여부 무관) ${noAnchorAll.length}건 · 그중 반별 발송 대상(위반) ${undecided.length}건`);
const show = (title: string, xs: Row[]) => {
  console.log(`\n■ ${title} — ${xs.length}건`);
  for (const x of xs.slice(0, 5)) console.log(`  · ${example(x)}`);
};
show("A. 발송 완료 — 출석부를 발송 반으로 옮기는 안", sentMismatch);
show("B. 미발송 — 보고서를 출석부 반에 맞추는 안", unsentMismatch);
show("C. 앵커는 있는데 칸이 아무 데도 없음 — 앵커 반에 칸 생성 안(관리자 작성분 포함)", noCellsToCreate);
show("C′. 발송 성공인데 칸 없음 — 출석부에서 일부러 지운 칸일 수 있어 그대로 둔다(목록만 · 2026-11-05)", noCellsKept);
show("D. 반 미정(반별 발송 대상) — 사람이 원스크린에서 고른다", undecided);
console.log(`  └ A 중 반 보드로 게시(보낼 반 있음) ${sentMismatch.filter((x) => x.r.classnote_class_id).length}건 · 1인 보드 게시(보강 반 기준) ${sentMismatch.filter((x) => !x.r.classnote_class_id).length}건`);
console.log(`  └ D 중 미발송 ${undecided.filter((x) => !sent(x.r)).length}건(다음 저장·발송 때 반을 고르게 된다) · 발송 완료 ${undecided.filter((x) => sent(x.r)).length}건(과거분 — 고칠 수 없는 이력)`);
console.log(`  └ 관리자 작성 보강 ${rows.filter((x) => x.r.source === "admin").length}건 중 위반 ${bad.filter((x) => x.r.source === "admin").length}건`);

if (!apply) {
  console.log("\n드라이런입니다 — 아무것도 바꾸지 않았습니다.");
  process.exit(0);
}

// ── 적용(원장 승인 뒤에만) ────────────────────────────────────────────────────
const log: { reports: unknown[]; moved: unknown[]; created: unknown[]; skipped: unknown[] } = { reports: [], moved: [], created: [], skipped: [] };
for (const x of sentMismatch) {
  const target = x.r.classnote_class_id ?? x.r.makeup_class_id;
  if (!target || classes.get(target)?.pool) {
    log.skipped.push({ id: x.r.id, why: "발송 반을 모름" });
    continue;
  }
  const toMove = x.outside.filter((a) => a.status === "makeup" || classes.get(a.class_id)?.pool);
  const targetHas = x.cells.some((a) => a.class_id === target);
  if (toMove.length > 1 || (toMove.length === 1 && targetHas)) {
    log.skipped.push({ id: x.r.id, why: "옮길 칸이 여럿이거나 발송 반에 칸이 이미 있음" });
    continue;
  }
  for (const a of toMove) {
    const { error } = await sb.from("attendance_records").update({ class_id: target }).eq("id", a.id).eq("class_id", a.class_id);
    if (error) throw new Error(error.message);
    log.moved.push({ id: a.id, old_class: a.class_id, new_class: target });
  }
  if (x.r.makeup_class_id !== target) {
    const { error } = await sb.from("lesson_reports").update({ makeup_class_id: target }).eq("id", x.r.id);
    if (error) throw new Error(error.message);
    log.reports.push({ id: x.r.id, old_makeup: x.r.makeup_class_id, old_send: x.r.classnote_class_id });
  }
}
for (const x of unsentMismatch) {
  const real = x.outside.filter((a) => !classes.get(a.class_id)?.pool);
  if (real.length !== 1 || x.cells.some((a) => a.class_id === x.r.makeup_class_id)) {
    log.skipped.push({ id: x.r.id, why: "출석부 반을 하나로 정할 수 없음" });
    continue;
  }
  const target = real[0]!.class_id;
  const { error } = await sb
    .from("lesson_reports")
    .update({ makeup_class_id: target, classnote_class_id: target })
    .eq("id", x.r.id)
    .is("classnote_sent_at", null);
  if (error) throw new Error(error.message);
  log.reports.push({ id: x.r.id, old_makeup: x.r.makeup_class_id, old_send: x.r.classnote_class_id });
}
for (const x of noCellsToCreate) {
  const { data, error } = await sb
    .from("attendance_records")
    .insert({ tenant_id: x.r.tenant_id, class_id: x.r.makeup_class_id, student_id: x.r.student_id, session_date: x.r.report_date, status: "makeup", recorded_by: x.r.created_by })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  log.created.push({ id: data.id, report: x.r.id });
}
mkdirSync("scripts/_reports/logs", { recursive: true });
const file = `scripts/_reports/logs/makeup-class-drift-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
writeFileSync(file, JSON.stringify(log, null, 2));
console.log(`\n적용 끝 — 보고서 ${log.reports.length} · 칸 이동 ${log.moved.length} · 칸 생성 ${log.created.length} · 건너뜀 ${log.skipped.length} · 로그 ${file}`);

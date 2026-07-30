"use server";

// ECS "시트에서 가져오기" — 반별 구글 시트(수업계획서/출석부) → class_sheet_*.
// ⚠️ 시트와 **병행 운영하는 동안의 임시 경로**다(원장 2026-07-30). 시트를 접으면 이 액션과 버튼을 지운다.
//
// 게이트 2단(구조 import 선례와 동일): ① 시트 경로 자격 `canManageSheetSync`(sheet_sync=full — 전 학원
// 명단이 오가는 경로라 scoped 강사는 통과 금지) ② 반 단위 ECS 쓰기 자격 `requireEcsClassAccess(write)`.
//
// ⚠️ 반복 실행 안전(멱등): 계획행은 시트가 채운 (날짜·교시·시기) **그룹 단위로 교체**한다 — 시트가 진실원본인
//    기간이라 시트 쪽 삭제도 반영돼야 한다. 시트가 아무 말 없는 그룹은 건드리지 않는다(eywa 단독 입력 보존).
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canManageSheetSync, SHEET_ACCESS_DENIED_MSG } from "@/features/integrations/server/sheet-access";
import {
  claimSheetSyncLease,
  isSheetSyncBusy,
  releaseSheetSyncLease,
  SHEET_SYNC_BUSY_MSG,
  touchSheetSyncLease,
} from "@/features/integrations/server/sheet-sync-lease";
import { sheetsProvider } from "@/features/integrations/sheets-provider";
import { isEnrollmentActiveOn, enrollmentAttendsOnDay } from "@/features/enrollments/eligibility";
import { fetchInChunks } from "@/lib/supabase/batch";
import { buildWeekRows, splitStudentLabel, type BuildContext, type SlotRow } from "../import/build-rows";
import { addIssue, type EcsClassImportReport, type EcsImportIssue, type EcsSheetTarget } from "../import/types";
import { parseWeekTab } from "../import/parse-week-tab";
import { dowKeyOf } from "../lib/week";
import { requireEcsClassAccess } from "./access";
import { listMasterClassSheets, readClassSheetWeeks } from "./sheet-source";

type Fail = { ok: false; error: string };

/**
 * ECS 가져오기가 쓰는 동시 실행 리스 = **영어 시트 동기화와 같은 행**(`google_sheets:english`).
 *
 * 왜 전용 provider 행을 새로 만들지 않는가:
 *  ① **구글 API 읽기 할당량(분당 60회)이 프로젝트 단위로 공유**된다 — 시간표 '시트 반영'과 ECS 가져오기가
 *     동시에 돌면 서로를 429로 떨어뜨린다. 같은 행을 잠가 직렬화하는 게 과보호가 아니라 정확한 보호다.
 *  ② 🔴 `user_integrations`에 행을 추가하면 **cron 자동 반영이 그 행을 내보내기 대상으로 순회**한다
 *     (`api/cron/sheets-sync`). 원장 마스터 시트를 가리키는 행을 만들면 자동 반영이 **마스터를 덮어쓸 수 있다**.
 */
const ECS_LEASE_PROVIDER = sheetsProvider("english");

/** 지금 다른 사람이 시트 작업 중인가 — 버튼 선제 비활성용(서버 액션 거부는 2차 방어로 그대로). */
export async function isEcsImportBusy(): Promise<boolean> {
  const user = await getCurrentUser();
  if (!user) return false;
  const supabase = await createClient();
  return isSheetSyncBusy(supabase, ECS_LEASE_PROVIDER);
}

/**
 * 순회 시작 — 리스를 선점한다. 미리보기·반영 **각 회차마다** 잡고 끝나면 놓는다
 * (사람이 결과를 읽는 사이엔 잠그지 않는다 — 그 시간엔 API를 안 쓰므로 남을 막을 이유가 없다).
 * `norow`(시트 미연동 테넌트)는 지킬 시트가 없으니 통과 — 기존 리스 호출부와 같은 규약.
 */
export async function beginEcsImportRun(): Promise<{ ok: true } | Fail> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  if (!(await canManageSheetSync(user.systemRole))) return { ok: false, error: SHEET_ACCESS_DENIED_MSG };
  const supabase = await createClient();
  const lease = await claimSheetSyncLease(supabase, ECS_LEASE_PROVIDER);
  if (lease === "busy") return { ok: false, error: SHEET_SYNC_BUSY_MSG };
  return { ok: true };
}

/** 순회 종료 — best-effort(실패해도 3분 stale로 자가 회복). */
export async function endEcsImportRun(): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;
  if (!(await canManageSheetSync(user.systemRole))) return;
  const supabase = await createClient();
  await releaseSheetSyncLease(supabase, ECS_LEASE_PROVIDER);
}

export type ListTargetsResult =
  | { ok: true; year: number; targets: EcsSheetTarget[]; unmatched: string[] }
  | Fail;

/**
 * 1단계 — 마스터 시트의 반 시트 링크를 모아 eywa 반과 맞춘다(시트 읽기 2~수 콜, DB 쓰기 0).
 * 반 이름이 정확히 일치할 때만 대상. 못 맞춘 라벨은 `unmatched`로 올려 화면에 보여준다(자동 생성 금지).
 */
export async function listEcsImportTargets(): Promise<ListTargetsResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  if (!(await canManageSheetSync(user.systemRole))) return { ok: false, error: SHEET_ACCESS_DENIED_MSG };

  let master: Awaited<ReturnType<typeof listMasterClassSheets>>;
  try {
    master = await listMasterClassSheets();
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const admin = createAdminClient();
  const { data: classes, error } = await admin
    .from("classes")
    .select("id, class_name")
    .eq("tenant_id", user.tenantId)
    .eq("subject", "english");
  if (error) return { ok: false, error: `반 목록을 읽지 못했습니다: ${error.message}` };
  const byName = new Map((classes ?? []).map((c) => [c.class_name.trim(), c]));

  const targets: EcsSheetTarget[] = [];
  const unmatched: string[] = [];
  // 같은 반이 두 문서에 걸리면(옛 월 탭의 죽은 시트) 어느 쪽이 진짜인지 알 수 없다 → 둘 다 대상에서 빼고 보고.
  const seenClass = new Map<string, number>();
  for (const link of master.links) {
    const cls = byName.get(link.label.trim());
    if (!cls) {
      unmatched.push(link.label || link.spreadsheetId);
      continue;
    }
    seenClass.set(cls.id, (seenClass.get(cls.id) ?? 0) + 1);
    targets.push({
      spreadsheetId: link.spreadsheetId,
      sheetLabel: link.label,
      classId: cls.id,
      className: cls.class_name,
    });
  }
  const dup = targets.filter((t) => t.classId && (seenClass.get(t.classId) ?? 0) > 1);
  for (const d of dup) unmatched.push(`${d.className} — 시트가 2개 이상 연결돼 있어 건너뜁니다`);
  return {
    ok: true,
    year: master.year,
    targets: targets.filter((t) => t.classId && (seenClass.get(t.classId) ?? 0) === 1),
    unmatched,
  };
}

export type ImportClassResult = { ok: true; report: EcsClassImportReport } | Fail;

/**
 * 2단계 — 반 1개의 주차 탭 전부를 읽어 미리보기(dryRun) 또는 반영.
 * 반복은 **호출부(다이얼로그)가 한 반씩** 한다 — Sheets 읽기 할당량이 분당 60회라 서버에서 28반을
 * 한 번에 돌면 초과한다(sheet-source.ts 주석 참조).
 */
export async function importEcsClassSheet(input: {
  classId: string;
  spreadsheetId: string;
  year: number;
  dryRun: boolean;
}): Promise<ImportClassResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  if (!(await canManageSheetSync(user.systemRole))) return { ok: false, error: SHEET_ACCESS_DENIED_MSG };
  const gate = await requireEcsClassAccess(input.classId, { write: true });
  if (!gate.ok) return { ok: false, error: gate.error };
  const { tenantId, classId, className, skillAreas } = gate.access;

  // 리스 heartbeat — 반 28개 순회가 1분+라 갱신 없이는 순회 중에 stale이 지나 남이 끼어든다.
  // (이미 잡힌 리스만 갱신하므로 해제된 리스를 되살리지 않는다. 실패해도 본 작업을 막지 않는다.)
  await touchSheetSyncLease(await createClient(), ECS_LEASE_PROVIDER);

  let sheet: Awaited<ReturnType<typeof readClassSheetWeeks>>;
  try {
    sheet = await readClassSheetWeeks(input.spreadsheetId);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const admin = createAdminClient();
  const [schedRes, enrRes] = await Promise.all([
    admin
      .from("class_schedules")
      .select("day_of_week, start_time, valid_from, valid_to")
      .eq("tenant_id", tenantId)
      .eq("class_id", classId),
    admin
      .from("enrollments")
      .select("student_id, start_date, end_date, on_hold, is_transferred, attendance_days, students!inner(id, name, english_name, withdrawn_at)")
      .eq("tenant_id", tenantId)
      .eq("class_id", classId),
  ]);
  if (schedRes.error) return { ok: false, error: `시간표를 읽지 못했습니다: ${schedRes.error.message}` };
  if (enrRes.error) return { ok: false, error: `수강 명단을 읽지 못했습니다: ${enrRes.error.message}` };

  const slots: SlotRow[] = (schedRes.data ?? []).map((s) => ({
    day: s.day_of_week as SlotRow["day"],
    start: s.start_time as string,
    validFrom: s.valid_from as string,
    validTo: (s.valid_to as string | null) ?? null,
  }));

  type EnrRow = {
    student_id: string;
    start_date: string;
    end_date: string | null;
    on_hold: boolean | null;
    is_transferred: boolean | null;
    attendance_days: string[] | null;
    students: { id: string; name: string; english_name: string | null; withdrawn_at: string | null };
  };
  const enrs = (enrRes.data ?? []) as unknown as EnrRow[];
  const rosterIds = new Set(enrs.map((e) => e.student_id));
  const eligibleOn = (studentId: string, date: string): boolean =>
    enrs.some(
      (e) =>
        e.student_id === studentId &&
        !e.students.withdrawn_at &&
        isEnrollmentActiveOn(
          {
            startDate: e.start_date,
            endDate: e.end_date,
            onHold: e.on_hold ?? false,
            isTransferred: e.is_transferred ?? false,
          },
          date,
        ) &&
        enrollmentAttendsOnDay(e.attendance_days, dowKeyOf(date)),
    );

  // 이름 후보 — 반 수강생 + 시트에 나오는 이름 중 명단 밖(퇴원·타반)까지 조회해야 "확정 실패"와
  // "명단 밖"을 구분해 안내할 수 있다(같은 '넣지 않음'이어도 원장이 할 일이 다르다).
  const labels = new Set<string>();
  for (const t of sheet.tabs) for (const m of parseWeekTab(t.rows).marks) labels.add(m.studentLabel);
  const koreanNames = [...new Set([...labels].map((l) => splitStudentLabel(l).korean))];
  const found = koreanNames.length
    ? await fetchInChunks<{ id: string; name: string; english_name: string | null }>(koreanNames, (chunk) =>
        admin
          .from("students")
          .select("id, name, english_name")
          .eq("tenant_id", tenantId)
          .in("name", chunk),
      )
    : [];
  const studentsByName = new Map<string, { id: string; englishName: string | null }[]>();
  const push = (name: string, id: string, englishName: string | null) => {
    const k = name.replace(/\s+/g, "");
    const arr = studentsByName.get(k) ?? [];
    if (!arr.some((x) => x.id === id)) arr.push({ id, englishName });
    studentsByName.set(k, arr);
  };
  for (const s of found) push(s.name, s.id, s.english_name);
  for (const e of enrs) push(e.students.name, e.students.id, e.students.english_name);

  const ctx: BuildContext = {
    year: input.year,
    className,
    skillAreas,
    slots,
    studentsByName,
    rosterIds,
    eligibleOn,
  };

  const issues: EcsImportIssue[] = [];
  const allWeeks = sheet.tabs.map((t) => buildWeekRows(t.title, t.rows, ctx, issues));

  // 🔴 같은 주를 가리키는 탭이 둘 이상일 수 있다("7/20-24 …의 사본"). 둘 다 쓰면 같은 (날짜·교시)에
  //    두 벌이 들어가 UNIQUE·upsert가 깨진다 → 사본이 아닌 쪽만 쓰고 나머지는 건너뛴다.
  const byMonday = new Map<string, typeof allWeeks>();
  for (const w of allWeeks) {
    if (!w.monday) continue;
    byMonday.set(w.monday, [...(byMonday.get(w.monday) ?? []), w]);
  }
  const chosen = new Set<string>();
  for (const [monday, list] of byMonday) {
    const sorted = [...list].sort((a, b) => Number(/사본/.test(a.tab)) - Number(/사본/.test(b.tab)));
    chosen.add(sorted[0]!.tab);
    for (const skip of sorted.slice(1)) {
      addIssue(issues, "week-duplicate", `${className} · '${skip.tab}' (${monday} 주 — '${sorted[0]!.tab}'만 반영)`);
    }
  }
  const weeks = allWeeks.map((w) =>
    w.monday && !chosen.has(w.tab) ? { ...w, skipped: "같은 주 탭 중복", planRows: [], goalRows: [], markRows: [] } : w,
  );

  // 반 단위 line_no 재부여 — 주차별로 매긴 번호를 (날짜·교시·시기) 그룹 기준으로 다시 1..N으로.
  const seq = new Map<string, number>();
  const planRows = weeks
    .flatMap((w) => w.planRows)
    .map((r) => {
      const k = `${r.planDate}|${r.slotStart}|${r.termMode}`;
      const n = (seq.get(k) ?? 0) + 1;
      seq.set(k, n);
      return { ...r, lineNo: n };
    })
    .filter((r) => r.lineNo <= 20);
  // 🔴 upsert 배치 안에 같은 자연키가 두 번 있으면 Postgres가 통째로 거부한다
  //    ("ON CONFLICT DO UPDATE command cannot affect row a second time", 2026-07-30 실측 13반).
  //    월간 목표는 그 달 모든 주차 탭에 같은 내용으로 반복되므로 **반 단위로 중복을 접어야** 한다.
  const dedupe = <T>(rows: T[], key: (r: T) => string): T[] => {
    const m = new Map<string, T>();
    for (const r of rows) m.set(key(r), r); // 뒤에 온 값이 이김(마지막 주차 탭 기준)
    return [...m.values()];
  };
  const goalRows = dedupe(
    weeks.flatMap((w) => w.goalRows),
    (g) => `${g.scope}|${g.periodStart}|${g.role}|${g.skillArea}`,
  );
  const markRows = dedupe(
    weeks.flatMap((w) => w.markRows),
    (m) => `${m.studentId}|${m.markDate}|${m.slotStart}`,
  );

  const report: EcsClassImportReport = {
    classId,
    className,
    spreadsheetId: input.spreadsheetId,
    weeks: weeks.map((w) => ({ tab: w.tab, monday: w.monday, skipped: w.skipped })),
    counts: { planLines: planRows.length, goals: goalRows.length, marks: markRows.length },
    written: null,
    issues,
  };
  if (input.dryRun) return { ok: true, report };

  const now = new Date().toISOString();
  const written = { planLines: 0, goals: 0, marks: 0 };
  // ⚠️ 세 항목은 **서로 독립으로** 쓴다. 예전엔 하나가 실패하면 즉시 return이라 목표 오류 하나로
  //    그 반 학생 기록이 통째로 안 들어갔다(2026-07-30 실측 13반) — 실패는 이슈로 올리고 나머지는 진행한다.

  // ① 계획행 — 시트가 채운 (날짜·교시·시기) 그룹만 교체. 그룹 밖은 무접촉.
  //    삭제와 삽입을 **그룹 단위로 붙여** 실패가 그 그룹에만 갇히게 한다(전체 삭제 후 삽입 실패 = 유실).
  const byGroup = new Map<string, typeof planRows>();
  for (const r of planRows) {
    const k = `${r.planDate}|${r.slotStart}|${r.termMode}`;
    byGroup.set(k, [...(byGroup.get(k) ?? []), r]);
  }
  for (const [k, rows] of byGroup) {
    const [planDate, slotStart, termMode] = k.split("|") as [string, string, "regular" | "exam"];
    const del = await admin
      .from("class_sheet_plan_lines")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("class_id", classId)
      .eq("plan_date", planDate)
      .eq("slot_start", slotStart)
      .eq("term_mode", termMode);
    if (del.error) {
      addIssue(issues, "save-failed", `${className} · ${planDate} 계획 정리 실패 — ${del.error.message}`);
      continue;
    }
    const ins = await admin.from("class_sheet_plan_lines").insert(
      rows.map((r) => ({
        tenant_id: tenantId,
        class_id: classId,
        plan_date: r.planDate,
        slot_start: r.slotStart,
        term_mode: r.termMode,
        skill_area: r.skillArea,
        line_no: r.lineNo,
        textbook: r.textbook,
        page_range: r.pageRange,
        progress: r.progress,
        homework: r.homework,
        updated_by: user.id,
        updated_at: now,
      })),
    );
    if (ins.error) addIssue(issues, "save-failed", `${className} · ${planDate} 계획 저장 실패 — ${ins.error.message}`);
    else written.planLines += rows.length;
  }
  // ② 목표 · ③ 학생 기록 — 자연키 upsert(시트가 이김).
  if (goalRows.length) {
    const { error } = await admin.from("class_sheet_goals").upsert(
      goalRows.map((r) => ({
        tenant_id: tenantId,
        class_id: classId,
        scope: r.scope,
        period_start: r.periodStart,
        role: r.role,
        skill_area: r.skillArea,
        textbook: r.textbook,
        target_progress: r.targetProgress,
        updated_by: user.id,
        updated_at: now,
      })),
      { onConflict: "tenant_id,class_id,scope,period_start,role,skill_area" },
    );
    if (error) addIssue(issues, "save-failed", `${className} · 목표 저장 실패 — ${error.message}`);
    else written.goals = goalRows.length;
  }
  if (markRows.length) {
    const { error } = await admin.from("class_sheet_student_marks").upsert(
      markRows.map((r) => ({
        tenant_id: tenantId,
        class_id: classId,
        student_id: r.studentId,
        mark_date: r.markDate,
        slot_start: r.slotStart,
        status: r.status,
        progress_note: r.progressNote,
        updated_by: user.id,
        updated_at: now,
      })),
      { onConflict: "tenant_id,class_id,student_id,mark_date,slot_start" },
    );
    if (error) addIssue(issues, "save-failed", `${className} · 학생 기록 저장 실패 — ${error.message}`);
    else written.marks = markRows.length;
  }

  report.written = written;
  return { ok: true, report };
}

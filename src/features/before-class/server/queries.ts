import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { monthRange } from "@/lib/date-kst";
import { fetchInChunks } from "@/lib/supabase/batch";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { attendsClassOn } from "../roster";
import { classDatesInMonth } from "../dates";
import { checkFromRow, type BeforeClassCheck } from "../items";
import { loadAutoExcusedKeys } from "./prev-absence";
import { loadOffDays } from "./off-days";
import { loadReportLevels } from "./report-levels";
import { checkKey, type ChecklistTarget, type ClassMonth, type RosterStudent } from "../types";

/**
 * 비포클래스체크리스트 조회 — 서버 전용 표(s2_0003, 정책 0개)라 admin 클라이언트 + **tenant_id 명시 필터**([[#104]]).
 * 권한(메뉴 `before_class_checklist`)은 페이지의 requireAccess가 먼저 본다. 반·명단도 같은 클라이언트로 읽는다 —
 * 보는 사람(예: 다른 반 담임)이 그 반 담당이 아니어도, 이 메뉴를 연 사람은 시험 반 4개를 함께 본다(원장 2026-10-28).
 * ⚠️ 표가 아직 없으면(SQL 미적용) `ready: false`로 돌려 화면이 안내를 띄운다([[#95]]).
 */


export function isMissingTable(e: { code?: string; message?: string } | null | undefined): boolean {
  return !!e && (e.code === "42P01" || e.code === "PGRST205");
}

/** 칸이 없다(SQL 미적용) — 제외 칸(s2_0016) 읽기·쓰기를 옛 모양으로 되돌릴 때 본다([[#95]]). */
export function isMissingColumn(e: { code?: string; message?: string } | null | undefined): boolean {
  return !!e && (e.code === "42703" || e.code === "PGRST204");
}

/** 체크 행 읽는 칸 — 제외 칸(s2_0016)까지. 그 칸이 없으면 `CHECK_COLUMNS_V1`로 다시 읽는다. */
export const CHECK_COLUMNS = "missed, absent, card, excused, excuse_reason, excuse_note";
export const CHECK_COLUMNS_V1 = "missed, absent, card";

export async function loadTargets(tenantId: string): Promise<{ ready: boolean; targets: ChecklistTarget[] }> {
  const admin = createAdminClient();
  const { data, error } = await admin.from("before_class_targets").select("class_id").eq("tenant_id", tenantId);
  if (error) {
    if (isMissingTable(error)) return { ready: false, targets: [] };
    throw new Error(`before_class_targets: ${error.message}`);
  }
  const ids = (data ?? []).map((r) => r.class_id as string);
  if (ids.length === 0) return { ready: true, targets: [] };
  const { data: classes, error: cErr } = await admin
    .from("classes").select("id, class_name, teacher_id").eq("tenant_id", tenantId).in("id", ids);
  if (cErr) throw new Error(`classes: ${cErr.message}`);
  const teacherIds = [...new Set((classes ?? []).map((c) => c.teacher_id).filter((v): v is string => !!v))];
  const { data: teachers, error: tErr } = teacherIds.length
    ? await admin.from("users").select("id, display_name").eq("tenant_id", tenantId).in("id", teacherIds)
    : { data: [], error: null };
  if (tErr) throw new Error(`users: ${tErr.message}`);
  const nameOf = new Map((teachers ?? []).map((t) => [t.id as string, t.display_name as string]));
  const targets = (classes ?? []).map((c) => ({
    id: c.id as string,
    name: c.class_name as string,
    teacherName: nameOf.get(c.teacher_id as string) ?? "",
  }));
  // 담임 이름 → 반 이름 차례(시간표에서 보는 묶음과 같게).
  targets.sort((a, b) => a.teacherName.localeCompare(b.teacherName, "ko") || a.name.localeCompare(b.name, "ko"));
  return { ready: true, targets };
}

/** 이 반에서 체크를 처음 한 날(추적 시작, stats.ts `isRecordedDay`) — 체크가 없거나 표가 없으면 null. */
export async function loadTrackingStart(tenantId: string, classId: string): Promise<string | null> {
  const { data, error } = await createAdminClient().from("before_class_checks").select("check_date")
    .eq("tenant_id", tenantId).eq("class_id", classId).order("check_date", { ascending: true }).limit(1).maybeSingle();
  if (error) {
    if (isMissingTable(error)) return null;
    throw new Error(`before_class_checks: ${error.message}`);
  }
  return (data?.check_date as string | undefined) ?? null;
}

type EnrollmentRow = {
  student_id: string; start_date: string; end_date: string | null; is_transferred: boolean; on_hold: boolean; attendance_days: string[] | null;
};

export async function loadClassMonth(tenantId: string, classId: string, month: string): Promise<ClassMonth> {
  const admin = createAdminClient();
  const { from, to } = monthRange(month);
  const readChecks = (cols: string) => admin.from("before_class_checks")
    .select(`student_id, check_date, ${cols}`)
    .eq("tenant_id", tenantId).eq("class_id", classId).gte("check_date", from).lte("check_date", to);
  const [cls, sched, enr, chkFirst, trackingStart, autoKeys, offDays] = await Promise.all([
    admin.from("classes").select("subject").eq("tenant_id", tenantId).eq("id", classId).maybeSingle(),
    admin.from("class_schedules").select("day_of_week, valid_from, valid_to").eq("tenant_id", tenantId).eq("class_id", classId),
    admin.from("enrollments")
      .select("student_id, start_date, end_date, is_transferred, on_hold, attendance_days")
      .eq("tenant_id", tenantId).eq("class_id", classId).lte("start_date", to).or(`end_date.is.null,end_date.gte.${from}`),
    readChecks(CHECK_COLUMNS),
    loadTrackingStart(tenantId, classId),
    loadAutoExcusedKeys(tenantId, [classId], from, to),
    loadOffDays(tenantId, [classId], from, to),
  ]);
  const chk = isMissingColumn(chkFirst.error) ? await readChecks(CHECK_COLUMNS_V1) : chkFirst;
  if (cls.error) throw new Error(`classes: ${cls.error.message}`);
  if (sched.error) throw new Error(`class_schedules: ${sched.error.message}`);
  if (enr.error) throw new Error(`enrollments: ${enr.error.message}`);
  if (chk.error && !isMissingTable(chk.error)) throw new Error(`before_class_checks: ${chk.error.message}`);

  const dates = classDatesInMonth(month, sched.data ?? []);
  const byStudent = new Map<string, EnrollmentRow[]>();
  for (const e of (enr.data ?? []) as EnrollmentRow[]) byStudent.set(e.student_id, [...(byStudent.get(e.student_id) ?? []), e]);

  const enrolledIds = [...byStudent.keys()];
  // 보고서 값(보고서 시안)은 명단과 함께 읽는다 — 서로 기다리지 않는다(B4). 과목을 모르는 반이면 읽지 않는다.
  const subject = (cls.data?.subject as string | null | undefined) ?? null;
  const [studentRows, reportLevels] = await Promise.all([
    fetchInChunks(enrolledIds, (ids) =>
      admin.from("students").select("id, name, school, grade, is_test").eq("tenant_id", tenantId).in("id", ids)),
    subject ? loadReportLevels(tenantId, enrolledIds, subject, from, to) : Promise.resolve({}),
  ]);

  // 테스트 학생은 실제 반 명단에서 뺀다 — 단 **테스트 학생만 있는 반**(학원이·학원삼 테스트 반)은 그대로 세운다
  // (원장 2026-10-30 *"학원 이 삼 쪽도 체크리스트 추가해서 그걸로 테스트"*).
  const testOnlyClass = studentRows.length > 0 && studentRows.every((s) => s.is_test);
  const students: RosterStudent[] = studentRows
    .filter((s) => testOnlyClass || !s.is_test)
    .map((s) => {
      const rows = byStudent.get(s.id as string) ?? [];
      const activeDates = dates.filter((d) => attendsClassOn(rows, d));
      return {
        id: s.id as string,
        name: s.name as string,
        schoolGrade: schoolGradeLabel(s.school as string | null, s.grade as string | null),
        onHold: rows.some((e) => e.on_hold && !e.end_date),
        activeDates,
      };
    })
    .filter((s) => s.activeDates.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));

  const checks: Record<string, BeforeClassCheck> = {};
  for (const c of (chk.data ?? []) as unknown as ({ student_id: string; check_date: string } & Parameters<typeof checkFromRow>[0])[]) {
    checks[checkKey(c.student_id, c.check_date)] = checkFromRow(c);
  }
  const prefix = `${classId}|`;
  const autoExcused = [...autoKeys].filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length));
  return { dates, students, checks, reportLevels, trackingStart, autoExcused, offDays: offDays.get(classId) ?? {} };
}

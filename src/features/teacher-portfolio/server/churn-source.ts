import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays } from "@/lib/date-kst";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { isMergedStudent, MERGE_NOTE_PREFIX } from "@/features/students/status/merged";
import { DEFAULT_CHURN_OPTIONS } from "../evaluation/config";
import { kstDateOf } from "../model/dates";
import type { SnapshotClass, SnapshotEnrollment, SnapshotSchedule, SnapshotTransition } from "../model/types";
import { loadEvaluationConfig } from "./evaluation-store";
import { loadTeacherAliases, loadTenure, loadTeacherChanges } from "./tenure";

/**
 * 강사평가 스냅숏(`snapshot.ts`)과 시간표 X 겹침이 **같은 조회 정의**로 읽는 퇴원율 재료 — 한쪽만 바꾸면 같은 퇴원이 화면마다
 * 다른 선생님에게 붙는다(원장 2026-10-14 *"모든 데이터가 일치해야함"*). 🔴 admin 클라이언트 → 모든 조회에 tenant_id(#104) ·
 * 전건 페이징(B2).
 */
type Admin = SupabaseClient;
export const SCHEDULE_COLUMNS = "id, class_id, day_of_week, start_time, end_time, teacher_id, slot_teacher_label, lab_separate, valid_from, valid_to";
export const CLASS_COLUMNS = "id, class_name, subject, english_track, teacher_id, is_active, closed_at, report_optout, is_makeup_pool, is_special";
export const ENROLLMENT_COLUMNS = "id, student_id, class_id, start_date, end_date, on_hold, attendance_days, is_transferred, is_transferred_in, withdrawal_reason";
const TRANSITION_COLUMNS = "target_label, created_at, class_id:metadata->>classId, teacher_id:metadata->>newTeacherId, previous_teacher_id:metadata->>previousTeacherId, effective_date:metadata->>effectiveDate";
export type TransitionRow = {
  target_label: string | null; created_at: string; class_id: string | null; teacher_id: string | null;
  previous_teacher_id: string | null; effective_date: string | null;
};

export const paged = <T,>(run: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>) =>
  fetchAllPaged<T>(run as (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>);
export const byId = <T extends { id: string }>(...lists: T[][]): T[] => [...new Map(lists.flat().map((row) => [row.id, row])).values()];

/** 테스트 학생·병합된 학생 id — 기록에서 뺀다. 병합은 접두로 좁히고 모양(`isMergedStudent`)으로 다시 본다('중복 병합: 확인 요망' 같은 메모는 병합이 아니다). */
export async function nonRealStudents(admin: Admin, tenantId: string): Promise<Set<string>> {
  const rows = await paged<{ id: string; is_test: boolean | null; notes: string | null }>((a, b) => admin.from("students").select("id, is_test, notes")
    .eq("tenant_id", tenantId).or(`is_test.eq.true,notes.like.${MERGE_NOTE_PREFIX}%`).order("id").range(a, b));
  return new Set(rows.filter((s) => s.is_test || isMergedStudent(s.notes)).map((s) => s.id));
}
export const transitionRows = (admin: Admin, tenantId: string) =>
  paged<TransitionRow>((a, b) => admin.from("audit_logs").select(TRANSITION_COLUMNS).eq("tenant_id", tenantId)
    .in("action", ["class_handover_apply", "class_update"]).not("metadata->>newTeacherId", "is", null).order("created_at").order("id").range(a, b));
export function toTransitions(rows: readonly TransitionRow[]): SnapshotTransition[] {
  return rows.flatMap((t): SnapshotTransition[] => {
    const date = t.effective_date?.slice(0, 10) || kstDateOf(t.created_at);
    return t.teacher_id && date ? [{ class_id: t.class_id, target_label: t.target_label, teacher_id: t.teacher_id, previous_teacher_id: t.previous_teacher_id, date }] : [];
  });
}
/** 퇴원율 — 재료 끝 다음 31일 안에 시작하는 수강(말일에 끝나고 1일에 같은 과목 반을 시작한 학생). */
export const futureEnrollmentRows = (admin: Admin, tenantId: string, end: string) =>
  paged<SnapshotEnrollment>((a, b) => admin.from("enrollments").select(ENROLLMENT_COLUMNS).eq("tenant_id", tenantId)
    .gt("start_date", end).lte("start_date", addDays(end, 31)).order("id").range(a, b));
/** 퇴원율 — 학생의 퇴원 사유(퇴원관리와 같은 곳) · 퇴원일(옛 퇴원의 사유를 다른 그만둠에 쓰지 않게). */
export const studentReasonRows = (admin: Admin, tenantId: string) =>
  paged<{ id: string; reason: string | null; withdrawn_at: string | null }>((a, b) => admin.from("students").select("id, reason:withdrawal_metadata->>reason, withdrawn_at")
    .eq("tenant_id", tenantId).not("withdrawal_metadata", "is", null).order("id").range(a, b));

/**
 * 강사평가 퇴원율(`buildChurnModel`)의 재료만 + 원장이 고른 세는 법 — 시간표 X 겹침이 퇴원 담당 선생님을 강사평가와 같은 계산으로
 * 낸다. `from` 전에 끝난 수강·배치는 [from, end] 안의 퇴원율 결과를 바꾸지 않아(분모는 그 기간 수업일, 분자는 그 기간 종료) 읽지 않는다.
 */
export async function loadChurnSource(admin: Admin, tenantId: string, input: { from: string; end: string }) {
  const { from, end } = input;
  const inTenant = (name: string, columns: string) => admin.from(name).select(columns).eq("tenant_id", tenantId);
  const [test, classes, liveSchedules, endedSchedules, enrollments, transitions, futureEnrollments, studentReasons, evaluation, teacherChanges, tenure, aliases] = await Promise.all([
    nonRealStudents(admin, tenantId),
    paged<SnapshotClass>((a, b) => inTenant("classes", CLASS_COLUMNS).order("id").range(a, b)),
    paged<SnapshotSchedule>((a, b) => inTenant("class_schedules", SCHEDULE_COLUMNS).lte("valid_from", end).is("valid_to", null).order("id").range(a, b)),
    paged<SnapshotSchedule>((a, b) => inTenant("class_schedules", SCHEDULE_COLUMNS).lte("valid_from", end).gte("valid_to", from).order("id").range(a, b)),
    paged<SnapshotEnrollment>((a, b) => inTenant("enrollments", ENROLLMENT_COLUMNS).lte("start_date", end).or(`end_date.is.null,end_date.gte.${from}`).order("id").range(a, b)),
    transitionRows(admin, tenantId),
    futureEnrollmentRows(admin, tenantId, end),
    studentReasonRows(admin, tenantId),
    loadEvaluationConfig(admin, tenantId),
    // 강사평가 스냅숏과 같은 담임 이력 보강 · 재직 기간(같은 함수 — 화면마다 담당이 갈리지 않게).
    loadTeacherChanges(admin, tenantId),
    loadTenure(admin, tenantId),
    loadTeacherAliases(admin, tenantId),
  ]);
  const real = (rows: SnapshotEnrollment[]) => rows.filter((e) => !test.has(e.student_id));
  return {
    from, end, classes, schedules: byId(liveSchedules, endedSchedules), enrollments: real(enrollments), transitions: toTransitions(transitions),
    futureEnrollments: real(futureEnrollments), studentReasons, options: evaluation.config.metrics.churn.churn ?? DEFAULT_CHURN_OPTIONS,
    teacherChanges, tenure, aliases,
  };
}

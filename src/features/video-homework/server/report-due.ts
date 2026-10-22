import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPagedInChunks } from "@/lib/supabase/batch";
import { buildHolidayMap } from "@/features/attendance/calendar";
import { getTenantSettingsByTenantId } from "@/features/owner/server/queries";
import { assignmentKey } from "../assignment";
import { isCustomDue } from "../due";
import { nextLessonDate } from "../issue-window";
import type { LedgerEnrollment, LedgerSchedule } from "../ledger-roster";

/**
 * 영상 숙제 마감(`lesson_reports.video_homework_due`, 0425a — 규칙은 due.ts)의 서버 쪽 읽기·계산.
 *
 * 🔴 #95: SQL은 원장이 손으로 적용해 push와 적용 사이에 간격이 있다 — 칸이 없으면 마감은 전부 7일이다(토글이 안 보이고, 저장에
 *    싣지 않고, 읽는 곳은 7일로 읽는다). 원스크린 로스터(전원 핫패스) select에는 넣지 않고 따로 읽는다. 캐시는 양성만(칸은 생기기만 한다).
 */
type Db = ReturnType<typeof createAdminClient>;
let columnKnownReady = false;

export async function videoHomeworkDueColumnReady(db: Db = createAdminClient()): Promise<boolean> {
  if (columnKnownReady) return true;
  const { error } = await db.from("lesson_reports").select("video_homework_due").limit(1);
  if (!error) {
    columnKnownReady = true;
    return true;
  }
  const message = error.message ?? "";
  if (!(/video_homework_due/.test(message) && /(does not exist|column|schema cache)/i.test(message)))
    console.warn(JSON.stringify({ level: "warn", scope: "videoHomeworkDueColumnReady", reason: "probe_failed_transient", message }));
  return false;
}

/** 테스트 전용 — 모듈 캐시 리셋. */
export function _resetVideoHomeworkDueProbeForTest(): void {
  columnKnownReady = false;
}

/**
 * 보고서 저장의 '다음 수업' — 시간표로 그 학생이 그 반에 오는 다음 수업일(휴원일 제외 · 숙제일 뒤 14일 안).
 * 종강한 반은 장부(`buildVideoHomeworkLessonPairs`)와 같게 본다 — 운영을 멈춘 반(is_active=false)은 다음 수업이 없고, 종강일 뒤는 수업일이 아니다
 * (종강 반은 시간표 줄이 남아 있다 — [[#88]]). 없으면 null(호출부가 7일로 저장하고 화면에 알린다).
 * 시간표·수강·반·학원 설정(휴원일)을 못 읽으면 던진다(기본 휴원일로 계산하거나 7일로 조용히 바꾸지 않는다 — 화면이 알린다).
 */
export async function resolveNextLessonDue(db: Db, input: { tenantId: string; classId: string; studentId: string; reportDate: string }): Promise<string | null> {
  const scoped = (table: string, columns: string) => db.from(table).select(columns).eq("tenant_id", input.tenantId).eq("class_id", input.classId);
  const [schedules, enrollments, cls, settings] = await Promise.all([
    scoped("class_schedules", "class_id,day_of_week,valid_from,valid_to"),
    scoped("enrollments", "class_id,student_id,start_date,end_date,on_hold,is_transferred,attendance_days").eq("student_id", input.studentId),
    db.from("classes").select("is_active,closed_at").eq("tenant_id", input.tenantId).eq("id", input.classId).maybeSingle(),
    getTenantSettingsByTenantId(input.tenantId, { failOnReadError: true }),
  ]);
  if (schedules.error || enrollments.error || cls.error) throw new Error("수업 시간표를 읽지 못했습니다");
  const klass = cls.data as { is_active: boolean | null; closed_at: string | null } | null;
  if (!klass || klass.is_active === false) return null;
  const closedAt = klass.closed_at ? String(klass.closed_at).slice(0, 10) : null;
  const holidays = buildHolidayMap(settings.operations.holidays);
  return nextLessonDate({
    homeworkDate: input.reportDate,
    schedules: (schedules.data ?? []) as unknown as LedgerSchedule[],
    enrollments: (enrollments.data ?? []) as unknown as LedgerEnrollment[],
    // 휴원일과 종강일 뒤는 수업일이 아니다.
    isHoliday: (date) => date in holidays || (!!closedAt && date > closedAt),
  });
}

/** 원스크린에 내려 줄 것 — 토글을 그려도 되나(칸 있음 + 읽음)와 그날 저장된 '다음 수업' 마감(`학생|날짜|반 → 날짜`). */
export type VideoHomeworkDueUi = { ready: boolean; dues: Record<string, string> };
const NOT_READY: VideoHomeworkDueUi = { ready: false, dues: {} };
type DueRow = { student_id: string; class_id: string | null; report_date: string; video_homework_due: string | null };

/**
 * 원스크린용 — 그날 이 학생들의 보고서에 저장된 마감. 🔴 전원 핫패스라 어떤 실패도 `ready: false`로 떨어진다 — 토글이 안 보이고
 * 화면은 마감을 **보내지 않아** 저장돼 있던 마감을 덮지 않는다(`getSubmitLinkUi`와 같은 결).
 */
export async function getVideoHomeworkDues(tenantId: string, studentIds: string[], date: string): Promise<VideoHomeworkDueUi> {
  try {
    const db = createAdminClient();
    if (!(await videoHomeworkDueColumnReady(db))) return NOT_READY;
    const ids = [...new Set(studentIds)];
    if (!ids.length || !date) return { ready: true, dues: {} };
    const rows = await fetchAllPagedInChunks<DueRow>(ids, (chunk, from, to) => db
      .from("lesson_reports")
      .select("student_id,class_id,report_date,video_homework_due")
      .eq("tenant_id", tenantId)
      .in("student_id", chunk)
      .eq("report_date", date)
      .not("video_homework_due", "is", null)
      .order("id", { ascending: true })
      .range(from, to));
    const dues: Record<string, string> = {};
    for (const row of rows) if (row.class_id && isCustomDue(row.report_date, row.video_homework_due)) dues[assignmentKey(row.student_id, row.report_date, row.class_id)] = row.video_homework_due;
    return { ready: true, dues };
  } catch (e) {
    console.warn(JSON.stringify({ level: "warn", scope: "getVideoHomeworkDues", message: e instanceof Error ? e.message : String(e) }));
    return NOT_READY;
  }
}

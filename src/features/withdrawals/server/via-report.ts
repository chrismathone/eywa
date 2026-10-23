import "server-only";

import { fetchAllPaged, fetchInChunks } from "@/lib/supabase/batch";
import { logDbError } from "@/lib/supabase/db-error";
import type { createClient } from "@/lib/supabase/server";
import { endsLastCourse, LAST_COURSE_VIA_REPORT, lastCourseGateApplies, type EndRow } from "../via-report";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * 학생의 수강 전부(과목 불문 · 끝난 것 포함) + 상태·퇴원일 — 종료 판정 재료. 시간표 '수강 종료' 확인 문구와 서버 게이트가 같이 쓴다.
 * 🔴 모르면 던진다 — 반 하나라도 과목을 못 읽으면 판정하지 않는다(빠진 반 때문에 '퇴원'이라 말하거나 막지 못하는 것이 더 나쁘다).
 * ⚠️ 세션 클라이언트(RLS) — 호출부가 원생 상태 변경 권한을 먼저 본다.
 */
export async function loadEndRows(
  supabase: Supabase,
  studentId: string,
): Promise<{ status: string; withdrawnAt: string | null; rows: EndRow[] }> {
  const [studentRes, enrollments] = await Promise.all([
    supabase.from("students").select("status, withdrawn_at").eq("id", studentId).maybeSingle(),
    fetchAllPaged<{ id: string; class_id: string; start_date: string; end_date: string | null; is_transferred: boolean | null }>(
      (from, to) =>
        supabase
          .from("enrollments")
          .select("id, class_id, start_date, end_date, is_transferred")
          .eq("student_id", studentId)
          .order("id")
          .range(from, to),
    ),
  ]);
  if (studentRes.error) throw studentRes.error;
  if (!studentRes.data) throw new Error("학생을 찾지 못했습니다");
  const classIds = [...new Set(enrollments.map((e) => e.class_id))];
  const classes = await fetchInChunks<{ id: string; class_name: string; subject: string | null }>(classIds, (chunk) =>
    supabase.from("classes").select("id, class_name, subject").in("id", chunk),
  );
  const byId = new Map(classes.map((c) => [c.id, c]));
  if (classIds.some((id) => !byId.has(id))) throw new Error("수강 반 정보를 확인하지 못했습니다");
  return {
    status: String(studentRes.data.status),
    withdrawnAt: (studentRes.data.withdrawn_at as string | null) ?? null,
    rows: enrollments.map((e) => ({
      id: e.id,
      classId: e.class_id,
      className: byId.get(e.class_id)!.class_name,
      subject: byId.get(e.class_id)!.subject,
      start: e.start_date,
      end: e.end_date,
      isTransferred: e.is_transferred ?? undefined,
    })),
  };
}

/**
 * **마지막 반 종료 게이트** — 고른 수강을 끝내면 재원·휴원 학생에게 이어지는 반이 하나도 없으면(사실상 퇴원) 거절 문구를 돌려준다.
 * 원장 2026-10-23 *"퇴원 보고서를 써야 퇴원처리가 가능하도록"* — 마지막 반을 '수강 종료'로 끝내 수강 없는 재원생으로 만든 뒤 따로 정리하면
 * 보고서 없는 퇴원이 된다. 그 길도 퇴원보고서(강사 작성 요청 또는 관리자 바로 처리)로 보낸다.
 * 반 이동(같은 과목 반이 이어받음) · 특강이 끝나도 다른 반을 계속 다님 · 한 과목만 끝냄은 그대로(판정 = `endScopeOf`, 시간표 확인 문구와 같다).
 * 학생이 이미 퇴원(남은 수강 정리)·예비·상담이면 대상이 아니다. 이번 변경 전에 걸린 **퇴원 예약**이 있는 재원·휴원 학생도 대상이 아니다 —
 * 퇴원은 이미 정해졌고(그날 cron이 처리) 예약 학생은 퇴원보고서를 시작할 수 없어, 막으면 남은 반을 정리할 길이 없다(판정 `lastCourseGateApplies`).
 * `studentId`를 모르면 첫 수강의 학생으로 찾는다(시간표는 학생 id 없이 보낼 수 있다). 수강을 못 찾으면 null — 종료 함수가 '찾을 수 없음'을 말한다.
 * 🔴 조회 실패는 통과시키지 않는다(막을지 모르는 채로 끝내면 게이트가 아니다).
 */
export async function lastCourseViaReport(
  supabase: Supabase,
  input: { studentId?: string | null; enrollmentIds: readonly string[]; date: string },
): Promise<string | null> {
  try {
    let studentId = input.studentId || null;
    if (!studentId) {
      const first = input.enrollmentIds[0];
      if (!first) return null;
      const { data, error } = await supabase.from("enrollments").select("student_id").eq("id", first).maybeSingle();
      if (error) throw error;
      studentId = (data?.student_id as string | null) ?? null;
      if (!studentId) return null;
    }
    const { status, withdrawnAt, rows } = await loadEndRows(supabase, studentId);
    if (!lastCourseGateApplies(status, withdrawnAt)) return null;
    return endsLastCourse(rows, input.enrollmentIds, input.date, withdrawnAt) ? LAST_COURSE_VIA_REPORT : null;
  } catch (error) {
    logDbError(error, "withdrawals.viaReport.lastCourse", { enrollmentIds: input.enrollmentIds });
    return "수강 정보를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.";
  }
}

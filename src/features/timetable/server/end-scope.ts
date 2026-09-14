import "server-only";

import { clipToWithdrawal, endScopeOf, type OtherSpan } from "@/features/attendance/enrollment-span";
import { fetchAllPaged, fetchInChunks } from "@/lib/supabase/batch";
import { createClient } from "@/lib/supabase/server";
import type { EndScopeResult } from "../lib/end-scope-text";

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 수강 한 건을 그 날짜로 끝내면 **무엇이 되는지**(이 반만 종강 / 그 과목 수강종료 / 퇴원) — 시간표 확인 팝업용.
 *
 * 그 학생의 **다른 수강 전부**(과목 불문)를 읽어 [`endScopeOf`](@/features/attendance/enrollment-span)에 넘긴다.
 * 화면이 가진 데이터로는 못 정한다 — 시간표는 **보고 있는 과목·그 주 배치**만 들고 있어서, 다른 과목 반이나 그 주에
 * 배치가 없는 같은 과목 반을 모른다(모르는 채 '퇴원'이라 말하면 그게 이번에 고치는 거짓이다).
 *
 * 🔴 **모르면 null**(팝업은 중립 문구) — 반 하나라도 과목을 못 읽으면 판정하지 않는다(빠진 반 때문에 '퇴원'이라
 *    말하는 것이 문구가 없는 것보다 나쁘다).
 * ⚠️ 세션 클라이언트(RLS) — 호출부(라우트)가 학생 기록 권한(students full)을 먼저 본다.
 */
export async function loadEndScope(input: {
  enrollmentId: string;
  date: string;
}): Promise<EndScopeResult | null> {
  const { enrollmentId, date } = input;
  if (!enrollmentId || !YMD_RE.test(date)) return null;
  try {
    const supabase = await createClient();
    const { data: row, error } = await supabase
      .from("enrollments")
      .select("id, student_id, class_id, start_date")
      .eq("id", enrollmentId)
      .maybeSingle();
    if (error) {
      console.error("[timetable] 수강 종료 범위 — 수강 행 조회 실패", error);
      return null;
    }
    if (!row) return null;
    const studentId = row.student_id as string;

    const [rows, studentRes] = await Promise.all([
      fetchAllPaged<{
        class_id: string;
        start_date: string;
        end_date: string | null;
        is_transferred: boolean | null;
      }>((from, to) =>
        supabase
          .from("enrollments")
          .select("id, class_id, start_date, end_date, is_transferred")
          .eq("student_id", studentId)
          .neq("id", enrollmentId)
          // 같은 반의 다른 수강 행(재등록)은 '다른 반'이 아니다 — 뱃지·ECS와 같은 축.
          .neq("class_id", row.class_id as string)
          .order("id")
          .range(from, to),
      ),
      supabase.from("students").select("withdrawn_at").eq("id", studentId).maybeSingle(),
    ]);
    if (studentRes.error) {
      console.error("[timetable] 수강 종료 범위 — 학생 조회 실패", studentRes.error);
      return null;
    }

    const classIds = [...new Set([row.class_id as string, ...rows.map((r) => r.class_id)])];
    const classes = await fetchInChunks<{ id: string; class_name: string; subject: string | null }>(
      classIds,
      (chunk) => supabase.from("classes").select("id, class_name, subject").in("id", chunk),
    );
    const byId = new Map(classes.map((c) => [c.id, c]));
    if (classIds.some((id) => !byId.has(id))) return null;

    const withdrawnAt = (studentRes.data?.withdrawn_at as string | null) ?? null;
    const others: OtherSpan[] = rows.map((r) => {
      const c = byId.get(r.class_id)!;
      return clipToWithdrawal(
        {
          start: r.start_date,
          end: r.end_date,
          isTransferred: r.is_transferred ?? undefined,
          classId: c.id,
          className: c.class_name,
          subject: c.subject,
        },
        withdrawnAt,
      );
    });
    // 저장은 미래 시작 수강의 종료일을 시작일로 당긴다(`endEnrollmentById`) — 판정 날짜도 같게 맞춘다.
    const start = row.start_date as string;
    const leftOn = start > date ? start : date;
    const res = endScopeOf(leftOn, byId.get(row.class_id as string)!.subject, others);
    return { scope: res.scope, otherClassName: res.other?.className ?? null, transfer: res.transfer };
  } catch (e) {
    console.error("[timetable] 수강 종료 범위 판정 실패", e);
    return null;
  }
}

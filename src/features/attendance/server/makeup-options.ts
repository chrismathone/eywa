import "server-only";

/**
 * 보강이 메울 **결석 후보** 조회 — 확인창의 목록 재료(원장 2026-08-19 *"이전 수업을 이월해 보강"*).
 *
 * 🔴 **수강 여부로 거르지 않는다.** 반을 옮긴 학생의 옛 반 결석이 곧 이월 보강 대상이므로, 출결 기록
 *    자체를 후보로 삼는다. 지금 수강 중이 아닌 반은 화면에 '이전 반'으로 밝힌다(고르는 사람이 알아야 한다).
 * ⚠️ 창을 90일로 둔다 — 더 넓히면 고를 게 너무 많고, 좁히면 방학 낀 이월이 잘린다.
 * ⚠️ 결석만이 아니라 **공결(excused)** 도 넣는다 — 사유 있는 결석도 보강 대상이다.
 */

import { createClient } from "@/lib/supabase/server";
import { addDays } from "@/lib/date-kst";
import { buildAbsenceOptions, type AbsenceRow, type MakeupAbsenceOption } from "../makeup-options";

const WINDOW_DAYS = 90;
/** 한 학생 90일 결석은 실측 수십 행 — 상한을 둬도 잘릴 일이 없지만 방어로 둔다(B2). */
const MAX_ROWS = 400;

export async function getMakeupAbsenceOptions(
  studentId: string,
  makeupDate: string,
): Promise<MakeupAbsenceOption[]> {
  if (!studentId || !/^\d{4}-\d{2}-\d{2}$/.test(makeupDate)) return [];
  const supabase = await createClient();
  const from = addDays(makeupDate, -WINDOW_DAYS);

  const [{ data: rows, error }, { data: enrolls }] = await Promise.all([
    supabase
      .from("attendance_records")
      // ⚠️ 임베드는 FK 이름을 명시한다(#94 — 컬럼이 늘면 맨몸 임베드는 300으로 죽는다).
      .select("class_id, session_date, classes!attendance_records_class_id_fkey(class_name)")
      .eq("student_id", studentId)
      .in("status", ["absent", "excused"])
      .gte("session_date", from)
      .lte("session_date", makeupDate)
      .order("session_date", { ascending: false })
      .limit(MAX_ROWS),
    // 지금 수강 중인 반 — '이전 반' 표시용(없어도 목록은 나온다).
    supabase.from("enrollments").select("class_id").eq("student_id", studentId).is("end_date", null),
  ]);
  if (error) {
    // 조용히 빈 목록으로 두면 "결석이 없네?"로 오해된다 — 로그를 남기고 화면은 직접 입력으로 폴백한다.
    console.error("[makeup-options] 결석 후보 조회 실패", error.message);
    return [];
  }

  const current = new Set((enrolls ?? []).map((e) => e.class_id as string));
  const raw: AbsenceRow[] = (rows ?? []).map((r) => {
    const c = r.classes as { class_name?: string | null } | { class_name?: string | null }[] | null;
    return {
      classId: r.class_id as string,
      className: (Array.isArray(c) ? c[0]?.class_name : c?.class_name) ?? null,
      date: String(r.session_date),
    };
  });
  return buildAbsenceOptions(raw, makeupDate, current);
}

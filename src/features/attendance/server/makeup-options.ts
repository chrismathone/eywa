import "server-only";

/**
 * 보강이 메울 **결석 후보** 조회 — 확인창의 목록 재료(원장 2026-08-19 *"이전 수업을 이월해 보강"*).
 *
 * 🔴 **수강 여부로 거르지 않는다.** 반을 옮긴 학생의 옛 반 결석이 곧 이월 보강 대상이므로, 출결 기록
 *    자체를 후보로 삼는다. 지금 수강 중이 아닌 반은 화면에 '이전 반'으로 밝힌다(고르는 사람이 알아야 한다).
 * ⚠️ 창은 **1년**이다(아래 WINDOW_DAYS) — 90일로 좁혔더니 실측 이월 후보 249쌍 중 174쌍이 창 밖이었다.
 * ⚠️ 결석만이 아니라 **공결(excused)** 도 넣는다 — 사유 있는 결석도 보강 대상이다.
 */

import { createClient } from "@/lib/supabase/server";
import { addDays } from "@/lib/date-kst";
import { buildAbsenceOptions, type AbsenceRow, type MakeupAbsenceOption } from "../makeup-options";

// 이월 보강은 지난 학기 결석까지 거슬러 간다 — 90일로 자르면 실측 이월 후보(지금 수강 아닌 반의 결석)
// 249쌍 중 174쌍(70%)이 창 밖으로 떨어졌다. 1년으로 연다.
const WINDOW_DAYS = 365;
/** 한 학생 1년 결석은 실측 최다 수십 행 — 상한은 방어용이다(B2). */
const MAX_ROWS = 1000;

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
      // ⚠️ FK 힌트 이름은 **그 표의 실제 제약 이름**이다(#94). drizzle 명명이라 `_fkey`가 아니라
      //    `attendance_records_class_id_classes_id_fk` — 옆 파일(lesson_reports)의 이름을 베끼면
      //    PostgREST가 400(PGRST200)을 뱉고 목록이 **언제나 비어** "결석 기록이 없습니다"로 위장한다.
      .select("class_id, session_date, note, slot_start, classes!attendance_records_class_id_classes_id_fk(class_name)")
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
      // 이미 보강으로 메운 결석은 그 칸 메모에 표시가 남는다 — 목록에서 '보강 완료'로 가른다.
      note: (r.note as string | null) ?? null,
      // 교시 — 하루 여러 교시를 도는 반에서 어느 수업의 결석인지 화면이 밝힌다(라벨은 순수부에서).
      slotStart: (r.slot_start as string | null) ?? null,
    };
  });
  return buildAbsenceOptions(raw, makeupDate, current);
}

import "server-only";
import { createClient } from "@/lib/supabase/server";
import { kstToday } from "@/lib/date-kst";
import { fetchAllPaged, fetchAllPagedInChunks } from "@/lib/supabase/batch";
import {
  classifyScheduled,
  scheduledChangesForClass,
  type ScheduledChange,
  type ScheduledEnrollmentRow,
} from "../scheduled-changes";

/**
 * **예약된 수강 변경** 조회 — 학생 상세·반 상세 배너의 재료.
 *
 * 🔑 진실 원천은 `enrollments` 행이다(스냅샷이 아니라). 예약을 만드는 창구가 셋인데
 * (기본뷰 편집모드 드래그 · 학생 상세 '반 이동' · 시트 가져오기) **전부 이 표에 직접 쓰므로**,
 * 행에서 도출하면 어느 창구로 만든 예약이든 따로 배선하지 않아도 보인다.
 *
 * ⚠️ 조회 범위는 **미래에 걸친 행만**(`start_date > 오늘` 또는 `end_date > 오늘`) — 한 학생/한 반
 *    기준이라 행이 적다(B2: 세거나 집계하는 쿼리가 아니라 표시용 목록이다).
 * ⚠️ 임베드는 **컬럼 이름**(`class:class_id`)으로 건다 — 관계 이름(`classes(...)`)으로 걸면 남이 FK를
 *    하나 더 추가하는 날 PGRST201로 죽는다([[#94]]).
 * ⚠️ 조회 실패는 **빈 배열**로 떨어뜨린다 — 배너가 없어서 못 보는 것이지, 화면 전체를 막을 일은 아니다.
 */

type Raw = {
  id: string;
  class_id: string;
  student_id: string;
  start_date: string;
  end_date: string | null;
  is_transferred: boolean | null;
  is_transferred_in: boolean | null;
  class: { class_name?: string } | { class_name?: string }[] | null;
  student: { name?: string } | { name?: string }[] | null;
};

const one = <T,>(v: T | T[] | null): T | undefined => (Array.isArray(v) ? v[0] : (v ?? undefined));

function toRows(data: Raw[] | null): ScheduledEnrollmentRow[] {
  return (data ?? []).map((r) => ({
    enrollmentId: r.id,
    classId: r.class_id,
    className: one(r.class)?.class_name ?? "?",
    studentId: r.student_id,
    studentName: one(r.student)?.name ?? "?",
    startDate: String(r.start_date),
    endDate: r.end_date ? String(r.end_date) : null,
    isTransferred: r.is_transferred ?? false,
    isTransferredIn: r.is_transferred_in ?? false,
  }));
}

const SELECT = "id, class_id, student_id, start_date, end_date, is_transferred, is_transferred_in, class:class_id ( class_name ), student:student_id ( name )";

/** 이 학생에게 예약된 변경(합류·이동·종료 예정). 없으면 빈 배열. */
export async function getScheduledForStudent(studentId: string): Promise<ScheduledChange[]> {
  const today = kstToday();
  const supabase = await createClient();
  try {
    const data = await fetchAllPaged<Raw>((from, to) => supabase
      .from("enrollments")
      .select(SELECT)
      .eq("student_id", studentId)
      .or(`start_date.gt.${today},end_date.gt.${today}`)
      .order("id").range(from, to));
    return classifyScheduled(toRows(data), today);
  } catch (error) {
    console.error("[scheduled] 학생 예약 조회 실패:", error);
    return [];
  }
}

/** 이 반에 예약된 변경(합류·이동·종료 예정). 없으면 빈 배열. */
export async function getScheduledForClass(classId: string): Promise<ScheduledChange[]> {
  const today = kstToday();
  const supabase = await createClient();
  try {
    const data = await fetchAllPaged<Raw>((from, to) => supabase
      .from("enrollments")
      .select(SELECT)
      .eq("class_id", classId)
      .or(`start_date.gt.${today},end_date.gt.${today}`)
      .order("id").range(from, to));
    if (data.length === 0) return [];
    // 이동 반대편까지 읽어야 이 화면에서 취소해도 이전 반을 함께 복구할 수 있다.
    const studentIds = [...new Set(data.map((r) => r.student_id))];
    const related = await fetchAllPagedInChunks<Raw>(studentIds, (chunk, from, to) => supabase
      .from("enrollments")
      .select(SELECT)
      .in("student_id", chunk)
      .or(`start_date.gt.${today},end_date.gt.${today}`)
      .order("id").range(from, to));
    return scheduledChangesForClass(classifyScheduled(toRows(related), today), classId);
  } catch (error) {
    console.error("[scheduled] 반 예약 조회 실패:", error);
    return [];
  }
}

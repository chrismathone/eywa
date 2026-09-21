import type { createClient } from "@/lib/supabase/server";

/**
 * 수강 배정의 공용 도우미 — 한 명 배정(`createEnrollment`)과 단체 배정(`createEnrollmentsBulk`)이 **같은 규칙**을 쓴다.
 * 🔴 `"use server"` 파일 밖에 둔다 — 그 파일에서 export하면 전부 서버 액션(클라에서 부를 수 있는 문)이 되고,
 *    동기 값(DAY_ORDER)은 export 자체가 빌드를 깨뜨린다([[#119]]).
 */

export const DAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export const VALID_DAYS = new Set<string>(DAY_ORDER);
const DAY_LABEL: Record<string, string> = {
  mon: "월", tue: "화", wed: "수", thu: "목", fri: "금", sat: "토", sun: "일",
};

/**
 * 겹친 **기존 수강을 실제로 찾아** "언제부터·무슨 요일"까지 알려준다.
 * 막연한 "겹칩니다"로는 원장이 무엇을 고쳐야 할지 알 수 없다(제보 2026-07-28).
 *
 * 조회는 (학생, 반) 한 쌍 + 겹침 조건까지 DB에서 좁힌 뒤 3건만 — 전건 fetch·JS 집계 아님(B2).
 * 겹침 조건은 GiST와 동일한 반열림: `end_date is null or end_date > 새 시작` + `start_date < 새 종료`.
 *
 * @param excludeId 날짜 수정처럼 **자기 자신**이 후보에 섞이면 안 되는 경우의 제외 대상.
 */
export async function describeOverlapConflict(
  supabase: Awaited<ReturnType<typeof createClient>>,
  studentId: string,
  classId: string,
  startDate: string,
  endDate: string | null,
  excludeId?: string,
): Promise<string> {
  let query = supabase
    .from("enrollments")
    .select("start_date, end_date, attendance_days")
    .eq("student_id", studentId)
    .eq("class_id", classId)
    .or(`end_date.is.null,end_date.gt.${startDate}`);
  if (endDate) query = query.lt("start_date", endDate);
  if (excludeId) query = query.neq("id", excludeId);
  const { data } = await query.order("start_date", { ascending: true }).limit(3);

  const hit = (data ?? [])[0];
  if (!hit) return "이미 이 반에 기간이 겹치는 수강이 있어 중복 배정할 수 없습니다.";

  const period = hit.end_date ? `${hit.start_date} ~ ${hit.end_date}` : `${hit.start_date}부터`;
  const days: string[] = hit.attendance_days ?? [];
  const daysLabel = days.length > 0 ? ` · ${days.map((d) => DAY_LABEL[d] ?? d).join("·")}만 등원` : "";
  return (
    `이미 이 반에 배정되어 있습니다 (${period}${daysLabel}). 같은 반에 기간이 겹치는 배정은 만들 수 없습니다 — ` +
    `기존 수강을 학생 상세 '수업' 탭에서 수정하거나, 겹치지 않는 시작일을 선택해 주세요.`
  );
}

/**
 * 분리등원 요일 정규화 — 선택 요일을 수업 운영 요일 교집합으로 좁히고 요일순 정렬한다.
 * 비어있거나 수업의 전 요일을 다 고르면 [] 반환(= 전 요일 등원, 분리등원 아님 — GiST 충돌·표시 일관).
 */
export async function normalizeAttendanceDays(
  supabase: Awaited<ReturnType<typeof createClient>>,
  classId: string,
  picked: string[],
): Promise<string[]> {
  if (picked.length === 0) return [];
  const { data: scheds } = await supabase
    .from("class_schedules")
    .select("day_of_week")
    .eq("class_id", classId);
  const classDays = new Set<string>((scheds ?? []).map((s) => s.day_of_week as string));
  if (classDays.size === 0) return []; // 스케줄 없는 반 — 요일 제약 의미 없음
  const within = picked.filter((d) => classDays.has(d));
  // 전 요일을 다 골랐으면 제약 없음(=[]).
  if (within.length === 0 || within.length >= classDays.size) return [];
  return DAY_ORDER.filter((d) => within.includes(d));
}

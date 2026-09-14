import "server-only";

/**
 * 보강 예약(0264a)을 **어느 반까지 보여 줄 것인가** — 운영실 '보강예정' 카드와 시간표 '보강' 탭이 **같은 함수**로
 * 반 집합을 정한다(CLAUDE.md 운영실 KPI 규약: 카드 숫자 = 자세히 보기 = 바로가기 화면).
 *
 *  · 관리자(스코프 없음) = 이 학원의 **활성 반 전부**.
 *  · 강사(또는 겸직 강사뷰) = **담임 반 ∪ 위임 반**(`getTeachingClasses`) ∪ 그 기간에 **교시를 맡은 반**
 *    (`class_schedules.teacher_id` — 영어는 교시마다 담당이 갈린다, teacher-axis 규약).
 * 🔴 예약 표를 따로 스코핑하지 않는다 — 화면이 보는 반 집합을 그대로 넘겨 남의 반 예약이 새지 않게(#77).
 * ⚠️ 시간표는 여기에 **과목 필터**를 얹는다(탭이 과목별) — 카드(전 과목 합)와 탭(과목별)은 그 축만 다르다.
 */
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged, fetchInChunks } from "@/lib/supabase/batch";
import { getTeachingClasses } from "@/features/classes/server/delegation";

export type MakeupScopeClass = {
  id: string;
  className: string;
  subject: string;
  teacherName: string | null;
};

type ClassRow = {
  id: string;
  class_name: string;
  subject: string;
  teacher: { display_name: string | null } | { display_name: string | null }[] | null;
};

const SELECT = "id, class_name, subject, teacher:teacher_id ( display_name )";

function toScopeClass(r: ClassRow): MakeupScopeClass {
  const t = Array.isArray(r.teacher) ? r.teacher[0] : r.teacher;
  return { id: r.id, className: r.class_name, subject: String(r.subject ?? ""), teacherName: t?.display_name ?? null };
}

/**
 * @param teacherId 강사 스코프(null = 관리자 = 전 활성 반)
 * @param range 교시 담당 판정 기간(주 범위) — 그 기간에 유효한 교시가 있는 반
 */
export const listMakeupScopeClasses = cache(async function listMakeupScopeClasses(
  teacherId: string | null,
  range: { start: string; end: string },
): Promise<MakeupScopeClass[]> {
  const supabase = await createClient();
  if (!teacherId) {
    // 활성 반 전부 — 반 수는 수십~백 단위라 페이지네이션이면 충분하다(B2).
    const rows = await fetchAllPaged<ClassRow>((from, to) =>
      supabase.from("classes").select(SELECT).eq("is_active", true).order("id").range(from, to),
    );
    return rows.map(toScopeClass);
  }
  const [teaching, slotRes] = await Promise.all([
    getTeachingClasses(supabase, teacherId, range.start),
    supabase
      .from("class_schedules")
      .select("class_id")
      .eq("teacher_id", teacherId)
      .lte("valid_from", range.end)
      .or(`valid_to.is.null,valid_to.gte.${range.start}`),
  ]);
  const ids = [...new Set([...teaching.map((c) => c.id), ...(slotRes.data ?? []).map((r) => r.class_id as string)])];
  if (ids.length === 0) return [];
  const rows = await fetchInChunks<ClassRow>(ids, (chunk) =>
    supabase.from("classes").select(SELECT).in("id", chunk).eq("is_active", true),
  );
  return rows.map(toScopeClass);
});

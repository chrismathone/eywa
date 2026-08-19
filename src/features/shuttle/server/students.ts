import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { reportError } from "@/lib/observability/report-error";

/**
 * 셔틀에 배정할 수 있는 학생 풀 — 드래그 원본이 되는 목록.
 *
 * 🔑 **재원생만**. makeedu 셔틀 명단엔 퇴원 2명·휴원 1명·예비 1명이 그대로 남아 있었고(실측
 *    2026-08-19, 71명 중 4명), 그게 "셔틀을 eywa로 가져오면 좋겠다"의 이유 중 하나다. 새 배정은
 *    재원생에서만 고르게 하고, 이미 배정된 비재원생은 편성 화면이 회색으로 표시해 정리를 유도한다
 *    (기존 배정을 **자동으로 지우지는 않는다** — 휴원 뒤 복귀가 흔하다).
 *
 * ⚠️ 전건이 필요하므로 `fetchAllPaged`(무페이징 select는 1000행 silent 절단, B2). 실측 재원생은
 *    수백 명 규모라 한 페이지에 들어오지만, 학원이 커지면 조용히 잘리는 자리다.
 */

export type AssignableStudent = {
  id: string;
  name: string;
  schoolGrade: string;
  /** 검색용 — 이름+학교/학년을 공백 없이 소문자로. */
  searchKey: string;
};

export async function getAssignableStudents(): Promise<AssignableStudent[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  const supabase = await createClient();
  try {
    const rows = await fetchAllPaged<{
      id: string;
      name: string;
      school: string | null;
      grade: string | null;
    }>((from, to) =>
      supabase
        .from("students")
        .select("id, name, school, grade")
        .eq("status", "enrolled")
        .order("name")
        .order("id") // OFFSET 페이지가 흔들리지 않게 unique tie-break(batch.ts 규약)
        .range(from, to),
    );
    return rows.map((r) => {
      const schoolGrade = schoolGradeLabel(r.school, r.grade);
      return {
        id: r.id,
        name: r.name,
        schoolGrade,
        searchKey: `${r.name}${schoolGrade}`.replace(/\s+/g, "").toLowerCase(),
      };
    });
  } catch (e) {
    reportError(e, { scope: "shuttle.assignableStudents" });
    return [];
  }
}

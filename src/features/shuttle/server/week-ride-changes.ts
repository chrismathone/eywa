import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged, fetchInChunks } from "@/lib/supabase/batch";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { reportError } from "@/lib/observability/report-error";
import type { WeekRideChange } from "../run-cards";
import { isDirection, type DayCode } from "../types";

/**
 * 탑승 학생 시간표의 **그날만 변경** — 그 주(월~금) `shuttle_ride_exceptions`(사용자 2026-11-04).
 * 오늘 등하원 [등하원 수정]·[안함]·[결석]과 학부모 '수정하기'가 쓰는 같은 표다(새 표 없음).
 * 🔒 부르는 쪽이 로그인·권한을 확인한 뒤 그 학원으로 부른다 — admin이라 **tenant_id 필터 필수**([[#104]]).
 * ⚠️ 실패하면 null — 빈 배열로 삼키면 "그 주 변경 없음"이라는 거짓 시트가 된다(부르는 쪽이 안내한다).
 */
export async function loadWeekRideChanges(tenantId: string, week: readonly { day: DayCode; ymd: string }[]): Promise<WeekRideChange[] | null> {
  if (week.length === 0) return [];
  const dayOf = new Map(week.map((w) => [w.ymd, w.day]));
  const ymds = week.map((w) => w.ymd).sort();
  try {
    const admin = createAdminClient();
    // 1000줄 침묵 절단 방지(B2) — id 순 페이지로 전부.
    const data = await fetchAllPaged<{ student_id: string; on_date: string; io_kind: string; kind: string; run_stop_id: string | null }>((from, to) =>
      admin
        .from("shuttle_ride_exceptions")
        .select("student_id, on_date, io_kind, kind, run_stop_id")
        .eq("tenant_id", tenantId)
        .gte("on_date", ymds[0]!)
        .lte("on_date", ymds.at(-1)!)
        .order("id")
        .range(from, to),
    );
    const rows = data.filter((r) => dayOf.has(r.on_date as string) && isDirection(r.io_kind) && (r.kind === "skip" || r.kind === "add"));
    const ids = [...new Set(rows.map((r) => r.student_id as string))];
    const students = await fetchInChunks(ids, (chunk) =>
      admin.from("students").select("id, name, school, grade").eq("tenant_id", tenantId).in("id", chunk),
    );
    const who = new Map(students.map((s) => [s.id as string, s]));
    return rows.map((r) => {
      const s = who.get(r.student_id as string);
      return {
        day: dayOf.get(r.on_date as string)!,
        studentId: r.student_id as string,
        studentName: (s?.name as string | undefined) ?? "",
        schoolGrade: s ? schoolGradeLabel(s.school as string | null, s.grade as string | null) : "",
        ioKind: r.io_kind as WeekRideChange["ioKind"],
        kind: r.kind as WeekRideChange["kind"],
        runStopId: (r.run_stop_id as string | null) ?? null,
      };
    });
  } catch (e) {
    reportError(e, { scope: "shuttle.weekRideChanges" });
    return null;
  }
}

import "server-only";

/**
 * **다른 반 대신 보강 칸** — 월별 출석부 강사 보기의 읽기 전용 목록 재료(적대 리뷰 2026-09-30, 원장 결정 3).
 *
 * 위임 없이 남의 반(B반) 학생을 대신 보강하면 칸은 **B반**에 서고(보고서 반 = 출석부 반) 시수는 **보강한 강사(A)** 몫이다
 * (`attendance_records.taught_by`, 0315a). 정산(명세서·출석부 정산액·수납 정산 면)은 그 칸을 A 몫으로 넣는데, A의 강사 보기
 * 격자에는 B반이 없다 — 칸이 안 보이면 **화면 시수와 정산액이 말없이 갈린다**. 그래서 A의 강사 보기가 그 칸을 목록으로 보인다.
 * 🔴 판정 재료는 정산 조립(`collectTierRows`)과 같다 — 귀속 칸 `taught_by` · 교시별 유효 행(`effectiveAttendanceRecords`) ·
 *    결석·공결 0 · 자리 행 제외. 금액은 여기서 계산하지 않는다(정산 함수 한 벌).
 * ⚠️ 표시 전용이다 — 조회 실패·0315a 미적용이면 빈 목록(격자는 산다, [[#95]]). admin + `tenant_id` 필터([[#104]]).
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged, fetchInChunks } from "@/lib/supabase/batch";
import { effectiveAttendanceRecords } from "@/features/attendance/effective-records";
import { monthBounds } from "@/features/payroll/server/tier-rows";
import { taughtByColumnReady } from "./taught-by-db";

export type SubstituteCell = {
  classId: string;
  className: string;
  studentId: string;
  studentName: string;
  date: string;
  status: string;
  /** 정산이 세는 시수(결석·공결 = 0 · 비었으면 1). */
  units: number;
};

type Row = {
  id: string;
  class_id: string;
  student_id: string;
  session_date: string;
  slot_start: string | null;
  status: string;
  session_units: number | string | null;
  seat_label: string | null;
  recorded_at: string;
};

/**
 * 그 강사가 그 달 **표에 없는 반**에서 한 대신 보강 칸(날짜순).
 * @param excludeClassIds 강사 보기 격자에 이미 선 반 — 그 반의 칸은 격자가 보여 준다(교시 담당 반의 대신 보강 등).
 */
export async function loadSubstituteCells(input: {
  tenantId: string;
  teacherId: string;
  month: string;
  excludeClassIds: readonly string[];
}): Promise<SubstituteCell[]> {
  if (!/^\d{4}-\d{2}$/.test(input.month)) return [];
  try {
    if (!(await taughtByColumnReady())) return [];
    const admin = createAdminClient();
    const { from, to } = monthBounds(input.month);
    const rows = await fetchAllPaged<Row>((f, t) =>
      admin
        .from("attendance_records")
        .select("id, class_id, student_id, session_date, slot_start, status, session_units, seat_label, recorded_at")
        .eq("tenant_id", input.tenantId)
        .eq("taught_by", input.teacherId)
        .gte("session_date", from)
        .lte("session_date", to)
        .order("id", { ascending: true })
        .range(f, t),
    );
    const shown = new Set(input.excludeClassIds);
    const effective = effectiveAttendanceRecords(rows).filter((r) => !shown.has(r.class_id) && !r.seat_label);
    if (effective.length === 0) return [];
    const classIds = [...new Set(effective.map((r) => r.class_id))];
    const studentIds = [...new Set(effective.map((r) => r.student_id))];
    const [classes, students] = await Promise.all([
      fetchInChunks<{ id: string; class_name: string | null }>(classIds, (chunk) =>
        admin.from("classes").select("id, class_name").eq("tenant_id", input.tenantId).in("id", chunk),
      ),
      fetchInChunks<{ id: string; name: string | null }>(studentIds, (chunk) =>
        admin.from("students").select("id, name").eq("tenant_id", input.tenantId).in("id", chunk),
      ),
    ]);
    const className = new Map(classes.map((c) => [c.id, c.class_name ?? ""]));
    const studentName = new Map(students.map((s) => [s.id, s.name ?? ""]));
    return effective
      .map((r) => {
        const raw = r.session_units === null || r.session_units === undefined ? 1 : Number(r.session_units);
        const counted = r.status === "absent" || r.status === "excused" || !Number.isFinite(raw) || raw <= 0 ? 0 : raw;
        return {
          classId: r.class_id,
          className: className.get(r.class_id) ?? "",
          studentId: r.student_id,
          studentName: studentName.get(r.student_id) ?? "",
          date: r.session_date,
          status: r.status,
          units: counted,
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date) || a.className.localeCompare(b.className, "ko") || a.studentName.localeCompare(b.studentName, "ko"));
  } catch (e) {
    console.error("[substitute-cells] 대신 보강 칸 조회 실패 — 목록 없이 그린다", e instanceof Error ? e.message : e);
    return [];
  }
}

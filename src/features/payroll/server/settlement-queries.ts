import "server-only";
import { createClient } from "@/lib/supabase/server";
import { effectiveAttendanceRecords } from "@/features/attendance/effective-records";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canReadSalary } from "./salary-access";
import { fetchAllPaged, fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import {
  computeTeacherSettlements,
  totalSettlements,
  type SettlementRowInput,
  type SalaryType,
  type TeacherComp,
  type TeacherSettlement,
  type SettlementTotals,
} from "../settlement";
import { parseGroupRates } from "../salary-group";
import { dowApportionRatio, type SessionUnit } from "../apportion";

export type SettlementView = {
  rows: TeacherSettlement[];
  totals: SettlementTotals;
  splitCount: number; // 그 달 저장된 splits 행 수(0이면 스냅샷 없음 안내)
};

/**
 * 청구월의 강사 정산 참고 — **저장된 splits 스냅샷**(invoice_teacher_splits)을 담당 강사(teacher_id) 단위로
 * 묶어 급여 정책(users.salary_type/commission_rate/monthly_base)을 적용. 읽기전용, 저장 0.
 * (B2: splits 전건 fetchAllPaged / B3: users는 청크 조회)
 * ⚠️ live 확정치가 아니라 저장된 스냅샷을 읽는다 — 지급은 동결된 기록 기준(P5 스냅샷 규율).
 */
export async function getTeacherSettlementView(period: string): Promise<SettlementView> {
  const supabase = await createClient();

  const splits = await fetchAllPaged<{
    teacher_id: string | null;
    teacher_name: string | null;
    class_id: string;
    confirmed_amount: number | string;
    actual_amount: number | string;
    pricing_mode: string;
  }>((from, to) =>
    supabase
      .from("invoice_teacher_splits")
      .select("teacher_id, teacher_name, class_id, confirmed_amount, actual_amount, pricing_mode")
      .eq("period", period)
      .order("id")
      .range(from, to),
  );

  // 반 이름(과정 자동 판정) + 반별 수동 설정(과정·비율) — 둘 다 splits에 등장한 반만 청크 조회(B3).
  // class_salary_settings는 master 전용 RLS라 비-master가 부르면 빈 배열 → 반별 override 없이 계산된다.
  const classIds = [...new Set(splits.map((s) => s.class_id).filter(Boolean))];
  // 원장·총괄(canReadSalary)이면 admin + 명시 tenant_id로 읽는다 — 총괄(비-master)이 RLS로 0행을 받아
  // 반별 override 없이 **조용히 다른 금액**을 보지 않게([[#104]]). 게이트 밖이면 종전처럼 빈 배열.
  const viewer = await getCurrentUser();
  const salaryDb = viewer && (await canReadSalary()) ? createAdminClient() : null;
  const [classRows, classSettings] = await Promise.all([
    classIds.length > 0
      ? fetchInChunks<{ id: string; class_name: string | null }>(classIds, (chunk) =>
          supabase.from("classes").select("id, class_name").in("id", chunk),
        )
      : Promise.resolve([]),
    classIds.length > 0 && salaryDb && viewer
      ? fetchInChunks<{
          class_id: string;
          salary_group: string | null;
          commission_rate: number | string | null;
          applies_dows: string[] | null;
        }>(
          classIds,
          (chunk) =>
            salaryDb
              .from("class_salary_settings")
              .select("class_id, salary_group, commission_rate, applies_dows")
              .eq("tenant_id", viewer.tenantId)
              .in("class_id", chunk),
        )
      : Promise.resolve([]),
  ]);
  const classNameById = new Map(classRows.map((c) => [c.id, c.class_name ?? null]));
  const settingByClassId = new Map(classSettings.map((c) => [c.class_id, c]));

  // ── 요일 안분(0132a) — "그 반의 주말 수업분만 비율제". applies_dows가 지정된 반만 출결 시수를 본다.
  // ⚠️ 지정된 반이 없으면 쿼리 자체를 안 한다(대부분의 학원은 이 설정이 0건 — 불필요한 조회 금지, B4).
  const dowClassIds = classSettings.filter((c) => (c.applies_dows?.length ?? 0) > 0).map((c) => c.class_id);
  const sessionsByClass = new Map<string, SessionUnit[]>();
  // 반별 시간표 요일 — "주말 반인데 주말 출석 미입력"을 0이 아니라 보류로 승격하기 위한 신호(apportion opts.scheduledDows).
  const scheduledDowsByClass = new Map<string, string[]>();
  if (dowClassIds.length > 0) {
    // 그 달 = period("YYYY-MM")의 1일~말일. 시수는 attendance_records(session_units, null=기본 1).
    const from = `${period}-01`;
    const [y, m] = period.split("-").map(Number);
    const to = new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10);
    const rawRecs = await fetchAllPagedInChunks<{
      id: string;
      student_id: string;
      class_id: string;
      session_date: string;
      slot_start: string | null;
      recorded_at: string;
      session_units: number | string | null;
      status: string;
      seat_label: string | null;
    }>(dowClassIds, (chunk, f, t) =>
      supabase
        .from("attendance_records")
        .select("id, student_id, class_id, session_date, slot_start, recorded_at, session_units, status, seat_label")
        .in("class_id", chunk)
        .gte("session_date", from)
        .lte("session_date", to)
        .order("id", { ascending: true })
        .range(f, t),
    );
    // 🔴 정정 줄은 최신 하나만(공용 `effectiveAttendanceRecords`) — 원본 줄을 다 더하면 정정한 칸이 두 번 들어가
    //    주말/평일 비율이 틀어지고 급여가 움직였다(점검 2026-09-28).
    for (const r of effectiveAttendanceRecords(rawRecs)) {
      // 결석은 시수를 소비하지 않는다(COUNTABLE_STATUSES와 같은 기준) — 안분 분모에서도 뺀다.
      if (r.status === "absent" || r.status === "excused") continue;
      // 자리(랩실·JJ실) 수업은 담임 시수가 아니다(0208a) — 안분 분모에서도 뺀다. tier-rows.ts와 같은 규칙.
      if (r.seat_label) continue;
      const units = r.session_units === null || r.session_units === undefined ? 1 : Number(r.session_units);
      const list = sessionsByClass.get(r.class_id) ?? [];
      list.push({ date: r.session_date, units: Number.isFinite(units) && units > 0 ? units : 1 });
      sessionsByClass.set(r.class_id, list);
    }

    // 시간표 요일(class_schedules.day_of_week) — 안분 반만. "주말 반인데 주말 시수 0 = 출석 미입력"을 보류로 만든다(B3 청크).
    // ⚠️ **그 달에 유효한 행만** 본다(valid_from/valid_to) — 이 테넌트는 스케줄 1,060행 중 493행(46%)이
    //    이미 만료다. 필터를 빼면 "예전엔 토요일 반이었다"는 옛 행 때문에 평일 전용으로 바뀐 반이
    //    영원히 보류로 남고, 한 반만 보류여도 `commissionOfRows`가 그 **강사 정산 전체**를 null로 만든다.
    //    (refreshPlannedTerms가 이미 같은 필터를 쓴다 — 판정 소스를 어긋나게 두지 말 것.)
    const schedules = await fetchInChunks<{ class_id: string; day_of_week: string | null }>(dowClassIds, (chunk) =>
      supabase
        .from("class_schedules")
        .select("class_id, day_of_week")
        .in("class_id", chunk)
        .lte("valid_from", to)
        .or(`valid_to.is.null,valid_to.gte.${from}`),
    );
    for (const sc of schedules) {
      if (!sc.day_of_week) continue;
      const list = scheduledDowsByClass.get(sc.class_id) ?? [];
      if (!list.includes(sc.day_of_week)) list.push(sc.day_of_week);
      scheduledDowsByClass.set(sc.class_id, list);
    }
  }

  const rows: SettlementRowInput[] = splits.map((s) => {
    const setting = settingByClassId.get(s.class_id);
    return {
      teacherId: s.teacher_id,
      teacherName: s.teacher_name,
      classId: s.class_id,
      confirmedAmount: Number(s.confirmed_amount) || 0,
      actualAmount: Number(s.actual_amount) || 0,
      // 실측이 아직 기록되지 않은 행(시수 검증 전)은 0으로 깎지 않고 청구액을 쓴다 — 0을 지어내지 않는다.
      actualMissing: s.actual_amount === null || s.actual_amount === undefined,
      className: classNameById.get(s.class_id) ?? null,
      manualGroup: setting?.salary_group ?? null,
      dowRatio:
        s.pricing_mode !== "monthly" && (setting?.applies_dows?.length ?? 0) > 0
          ? dowApportionRatio(sessionsByClass.get(s.class_id) ?? [], setting!.applies_dows, {
              scheduledDows: scheduledDowsByClass.get(s.class_id) ?? null,
            })
          : undefined,
      classRate:
        setting?.commission_rate === null || setting?.commission_rate === undefined
          ? null
          : Number(setting.commission_rate),
    };
  });

  // 급여 정책 — 등장한 강사만 청크 조회(B3).
  const teacherIds = [...new Set(rows.map((r) => r.teacherId).filter((id): id is string => !!id))];
  const users =
    teacherIds.length > 0
      ? await fetchInChunks<{
          id: string;
          salary_type: string | null;
          commission_rate: number | string | null;
          commission_rates: unknown;
          monthly_base: number | string | null;
        }>(teacherIds, (chunk) =>
          supabase
            .from("users")
            .select("id, salary_type, commission_rate, commission_rates, monthly_base")
            .in("id", chunk),
        )
      : [];
  const compByTeacherId = new Map<string, TeacherComp>(
    users.map((u) => [
      u.id,
      {
        salaryType: (u.salary_type as SalaryType | null) ?? null,
        commissionRate: u.commission_rate === null || u.commission_rate === undefined ? null : Number(u.commission_rate),
        monthlyBase: Number(u.monthly_base) || 0,
        groupRates: parseGroupRates(u.commission_rates),
      },
    ]),
  );

  const settlementRows = computeTeacherSettlements(rows, compByTeacherId);
  return {
    rows: settlementRows,
    totals: totalSettlements(settlementRows),
    splitCount: splits.length,
  };
}

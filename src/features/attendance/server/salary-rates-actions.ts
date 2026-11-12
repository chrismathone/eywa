"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { monthRange } from "@/lib/date-kst";
import { loadClassAxisRows } from "./teacher-axis-queries";
import { requireAttendanceSalaryAdmin } from "./salary-rates";
import { SALARY_SHEET_PERIOD, SALARY_SHEET_VIEW_TABLE } from "./salary-visibility";
import { parseAttendanceRates, type AttendanceSalaryRates } from "../salary-rates";
import { explainDbError } from "@/lib/supabase/db-error";
import { logAction } from "@/features/audit/server/log";
import { hasFreelancePart, isMixedEmployment } from "@/features/staff/employment";

const FREELANCE_ONLY = "프리랜서·혼합 계약 선생님만 설정할 수 있습니다";

/**
 * '합계 및 실급여 보여주기' — **선생님 × 달** 스위치(0352a · 달별 0353a, 원장 2026-10-07). 켜면 그 선생님의 **그 달** 출석부에
 * 실급여 열과 합계가 관리자 화면과 **선생님 본인 화면** 양쪽에 선다. 끄면 양쪽 모두 감춘다(서버가 값을 싣지 않는다).
 * 달마다 따로다 — *"9월에 보여주기 눌렀다고해서 10월에 보여주는건 아님"*.
 *
 * 🔴 누르는 사람의 보기 설정이 아니다 — 그 선생님에게 급여 숫자를 여는 결정이라 급여 비율 설정을 **고칠 수 있는** 사람만 바꾼다
 *    ('다른 강사 뷰'는 열람 전용이라 `requireAttendanceSalaryAdmin`이 거절한다).
 */
export async function saveAttendanceSalaryVisible(input: { teacherId: string; month: string; visible: boolean }): Promise<{ ok: boolean; error?: string }> {
  const user = await requireAttendanceSalaryAdmin();
  if (!user) return { ok: false, error: "급여 비율을 설정할 수 있는 사람만 관리자용 출석부에서 바꿀 수 있습니다" };
  if (!input || !/^[0-9a-f-]{36}$/i.test(String(input.teacherId)) || !SALARY_SHEET_PERIOD.test(String(input.month)) || typeof input.visible !== "boolean") {
    return { ok: false, error: "선생님과 달을 다시 선택한 뒤 눌러 주세요" };
  }
  const db = createAdminClient();
  const { data: teacher, error: teacherError } = await db.from("users").select("employment_type, display_name")
    .eq("tenant_id", user.tenantId).eq("id", input.teacherId).maybeSingle();
  // 조회 실패를 "프리랜서가 아니다"로 읽지 않는다 — 일시 오류에 틀린 이유를 말하게 된다([[#138]]).
  if (teacherError) {
    return { ok: false, error: explainDbError(teacherError, { scope: "attendance.salaryVisible.teacher", fallback: "선생님 정보를 불러오지 못했습니다. 잠시 후 다시 눌러 주세요", context: { teacherId: input.teacherId } }).message };
  }
  if (!teacher || !hasFreelancePart(teacher.employment_type)) return { ok: false, error: FREELANCE_ONLY };
  // 혼합인데 용역 학년을 안 골랐으면 켜지 않는다 — 선생님 화면에 근로 몫 학생까지 실급여가 서게 된다(화면은 스위치를 세우지 않지만 서버가 다시 본다).
  if (input.visible && isMixedEmployment(teacher.employment_type)) {
    const { data: saved, error: ratesError } = await db.from("attendance_salary_rates").select("rates")
      .eq("tenant_id", user.tenantId).eq("teacher_id", input.teacherId).maybeSingle();
    if (ratesError) {
      return { ok: false, error: explainDbError(ratesError, { scope: "attendance.salaryVisible.rates", fallback: "급여 비율을 불러오지 못했습니다. 잠시 후 다시 눌러 주세요", context: { teacherId: input.teacherId } }).message };
    }
    if (!parseAttendanceRates(saved?.rates)?.levels?.length) return { ok: false, error: "혼합 계약은 용역 학년을 먼저 골라 주세요(비율 설정)" };
  }
  const { error } = await db.from(SALARY_SHEET_VIEW_TABLE).upsert({
    tenant_id: user.tenantId, teacher_id: input.teacherId, period: input.month, visible: input.visible, updated_at: new Date().toISOString(), updated_by: user.id,
  }, { onConflict: "tenant_id,teacher_id,period" });
  if (error) {
    return { ok: false, error: explainDbError(error, {
      scope: "attendance.salaryVisible.save", fallback: "설정을 저장하지 못했습니다. 잠시 후 다시 눌러 주세요", context: { teacherId: input.teacherId },
      // 달별 저장으로 바꾸는 사이(0353b 적용 전) 다른 달 줄이 있는 선생님은 옛 키에 걸린다 — "이미 저장돼 있다"로 읽히지 않게.
      constraints: { attendance_salary_teacher_view_pkey: { message: "설정을 바꾸는 중입니다. 잠시 후 다시 눌러 주세요" } },
    }).message };
  }
  await logAction({
    action: "payroll_sheet_visible_set",
    targetType: "user",
    targetLabel: typeof teacher.display_name === "string" ? teacher.display_name : null,
    metadata: { userId: input.teacherId, period: input.month, visible: input.visible },
  });
  revalidatePath("/attendance");
  return { ok: true };
}

export async function saveAttendanceSalaryRates(input: { teacherId: string; month: string; rates: AttendanceSalaryRates }): Promise<{ ok: boolean; error?: string }> {
  const user = await requireAttendanceSalaryAdmin();
  if (!user) return { ok: false, error: "관리자용 출석부에서만 급여 비율을 설정할 수 있습니다" };
  // 대상 학년을 하나도 안 고른 요청 — 비율 오류와 다른 이유라 따로 말한다(화면도 막지만 서버가 다시 본다).
  if (Array.isArray((input.rates as { levels?: unknown } | null)?.levels) && (input.rates.levels as unknown[]).length === 0) {
    return { ok: false, error: "대상 학년을 하나 이상 골라 주세요" };
  }
  const rates = parseAttendanceRates(input.rates);
  if (!rates || !/^[0-9a-f-]{36}$/i.test(input.teacherId) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month)) {
    return { ok: false, error: "비율은 0~100 사이의 숫자로 입력해 주세요" };
  }
  const db = createAdminClient();
  const { data: teacher, error: teacherError } = await db.from("users").select("employment_type, display_name")
    .eq("tenant_id", user.tenantId).eq("id", input.teacherId).maybeSingle();
  if (teacherError || !teacher || !hasFreelancePart(teacher.employment_type)) return { ok: false, error: FREELANCE_ONLY };
  // 혼합(근로 + 용역) — 대상 학년이 곧 용역 학년이다. 전부(= 저장 안 함)면 근로 몫 학생까지 프리랜서 금액이 된다(화면도 막지만 서버가 다시 본다).
  if (isMixedEmployment(teacher.employment_type) && !rates.levels?.length) {
    return { ok: false, error: "혼합 계약은 용역 학년만 골라 주세요(전부 고르면 프리랜서와 같습니다)" };
  }
  const { from, to } = monthRange(input.month);
  const [classes, old] = await Promise.all([
    loadClassAxisRows(from, to),
    db.from("attendance_salary_rates").select("rates").eq("tenant_id", user.tenantId).eq("teacher_id", input.teacherId).maybeSingle(),
  ]);
  if (old.error) return { ok: false, error: explainDbError(old.error, { scope: "attendance.salary-rates-actions.saveAttendanceSalaryRates", fallback: "확인하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };
  const existing = parseAttendanceRates(old.data?.rates);
  // 근로 요일을 싣지 않은 요청(배포 전에 열어 둔 창 등)은 저장된 근로 요일을 그대로 둔다 — 비율만 고쳤는데 근로 요일이 지워지지 않게.
  // 지우려면 빈 목록을 보낸다(`parseAttendanceRates`가 빈 목록은 저장하지 않는다).
  if ((input.rates as { workDays?: unknown }).workDays === undefined && existing?.workDays) rates.workDays = existing.workDays;
  const allowed = new Set(classes.filter((c) => c.taughtBy.includes(input.teacherId)).map((c) => c.id));
  if (Object.entries(rates.classes).some(([id, rate]) => !allowed.has(id) && existing?.classes[id] !== rate)) {
    return { ok: false, error: "해당 선생님이 담당하는 반의 비율만 설정할 수 있습니다" };
  }
  const { error } = await db.from("attendance_salary_rates").upsert({
    tenant_id: user.tenantId, teacher_id: input.teacherId, rates, updated_at: new Date().toISOString(), updated_by: user.id,
  }, { onConflict: "tenant_id,teacher_id" });
  if (error) return { ok: false, error: explainDbError(error, { scope: "attendance.salary-rates-actions.saveAttendanceSalaryRates", fallback: "저장하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };
  // 대상 학년이 바뀌었을 때만 남긴다 — 누구의 명세서가 어느 학년까지인지가 달라지는 결정이다(비율 숫자는 남기지 않는다).
  const before = existing?.levels ?? [];
  const after = rates.levels ?? [];
  if (before.join("|") !== after.join("|")) {
    await logAction({
      action: "payroll_sheet_levels_set",
      targetType: "user",
      targetLabel: typeof teacher.display_name === "string" ? teacher.display_name : null,
      metadata: { userId: input.teacherId, levels: after, before },
    });
  }
  // 근로 요일(혼합 계약의 근로 몫 — 강사평가 근태가 세는 요일)이 바뀌었을 때만 남긴다.
  const daysBefore = existing?.workDays ?? [];
  const daysAfter = rates.workDays ?? [];
  if (daysBefore.join("|") !== daysAfter.join("|")) {
    await logAction({
      action: "payroll_contract_work_days_set",
      targetType: "user",
      targetLabel: typeof teacher.display_name === "string" ? teacher.display_name : null,
      metadata: { userId: input.teacherId, workDays: daysAfter, before: daysBefore },
    });
  }
  if (!!existing?.includeSpecial !== !!rates.includeSpecial) {
    await logAction({
      action: "payroll_sheet_special_scope_set",
      targetType: "user",
      targetLabel: typeof teacher.display_name === "string" ? teacher.display_name : null,
      metadata: { userId: input.teacherId, includeSpecial: !!rates.includeSpecial, before: !!existing?.includeSpecial },
    });
  }
  revalidatePath("/attendance");
  return { ok: true };
}

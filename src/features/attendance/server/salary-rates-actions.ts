"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { monthRange } from "@/lib/date-kst";
import { loadClassAxisRows } from "./teacher-axis-queries";
import { requireAttendanceSalaryAdmin } from "./salary-rates";
import { parseAttendanceRates, type AttendanceSalaryRates } from "../salary-rates";

export async function saveAttendanceSalaryRates(input: { teacherId: string; month: string; rates: AttendanceSalaryRates }): Promise<{ ok: boolean; error?: string }> {
  const user = await requireAttendanceSalaryAdmin();
  if (!user) return { ok: false, error: "관리자용 출석부에서만 급여 비율을 설정할 수 있습니다" };
  const rates = parseAttendanceRates(input.rates);
  if (!rates || !/^[0-9a-f-]{36}$/i.test(input.teacherId) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month)) {
    return { ok: false, error: "비율은 0~100 사이의 숫자로 입력해 주세요" };
  }
  const db = createAdminClient();
  const { data: teacher, error: teacherError } = await db.from("users").select("employment_type")
    .eq("tenant_id", user.tenantId).eq("id", input.teacherId).maybeSingle();
  if (teacherError || teacher?.employment_type !== "프리랜서") return { ok: false, error: "프리랜서 선생님만 설정할 수 있습니다" };
  const { from, to } = monthRange(input.month);
  const [classes, old] = await Promise.all([
    loadClassAxisRows(from, to),
    db.from("attendance_salary_rates").select("rates").eq("tenant_id", user.tenantId).eq("teacher_id", input.teacherId).maybeSingle(),
  ]);
  if (old.error) return { ok: false, error: old.error.message };
  const existing = parseAttendanceRates(old.data?.rates);
  const allowed = new Set(classes.filter((c) => c.taughtBy.includes(input.teacherId)).map((c) => c.id));
  if (Object.entries(rates.classes).some(([id, rate]) => !allowed.has(id) && existing?.classes[id] !== rate)) {
    return { ok: false, error: "해당 선생님이 담당하는 반의 비율만 설정할 수 있습니다" };
  }
  const { error } = await db.from("attendance_salary_rates").upsert({
    tenant_id: user.tenantId, teacher_id: input.teacherId, rates, updated_at: new Date().toISOString(), updated_by: user.id,
  }, { onConflict: "tenant_id,teacher_id" });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/attendance");
  return { ok: true };
}

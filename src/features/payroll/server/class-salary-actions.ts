"use server";

// 반별 급여 설정(과정·배분율) 편집 — 원장 전용. 저장소는 class_salary_settings(0130a, master 전용 RLS).
// ⚠️ classes 테이블에 넣지 않는 이유: classes는 강사도 읽는 표라 급여 값이 섞이면 어떤 쿼리 실수로도 샌다(#77).

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { humanizeDbError } from "@/lib/supabase/db-error";
import { logAction } from "@/features/audit/server/log";
import { isSalaryGroup } from "../salary-group";
import { canManageSalary } from "./salary-access";

const DOW_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export type SaveClassSalaryState = { ok?: true; error?: string; nonce?: number } | undefined;

export async function saveClassSalary(
  _prev: SaveClassSalaryState,
  formData: FormData,
): Promise<SaveClassSalaryState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  // 급여 = 원장·총괄 전용(감사 D6 — 총괄은 모든 게이트를 자동 통과).
  if (!(await canManageSalary())) return { error: "급여 설정 변경 권한이 없습니다" };

  const classId = String(formData.get("classId") ?? "").trim();
  if (!classId) return { error: "대상 반이 지정되지 않았습니다" };

  const rawGroup = String(formData.get("salaryGroup") ?? "").trim();
  const salaryGroup = rawGroup === "" ? null : rawGroup;
  if (salaryGroup !== null && !isSalaryGroup(salaryGroup)) return { error: "잘못된 과정입니다" };

  const rawRate = String(formData.get("commissionRate") ?? "").trim();
  let commissionRate: number | null = null;
  if (rawRate !== "") {
    const n = Number(rawRate.replace(/,/g, ""));
    if (!Number.isFinite(n) || n < 0 || n > 100) return { error: "배분율은 0~100 사이여야 합니다" };
    commissionRate = Math.round(n * 100) / 100;
  }

  // 적용 요일(0132a) — "그 반의 주말 수업분만 비율제". 아무것도 안 고르면 null(전 요일).
  const dows = DOW_KEYS.filter((d) => formData.get(`dow_${d}`) === "on");
  const appliesDows = dows.length === 0 || dows.length === DOW_KEYS.length ? null : dows;

  // 🔴 admin + 명시 tenant_id — class_salary_settings는 master 전용 RLS(0130a)라 총괄(비-master)이 세션으로 쓰면 막힌다.
  //    게이트(canManageSalary)를 통과한 뒤에만 여기 온다.
  const supabase = createAdminClient();
  // 같은 테넌트의 반인지 확인 — admin이라 RLS가 막아 주지 않는다(남의 반 id로 행을 만들지 못하게).
  const { data: klass } = await supabase
    .from("classes")
    .select("id, tenant_id, class_name")
    .eq("id", classId)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  if (!klass) return { error: "대상 반을 찾을 수 없습니다" };

  // 감사 M2 — 누가 무엇에서 무엇으로 바꿨는지 되짚도록 이전 값을 먼저 읽는다(감사로그는 원장·총괄만 읽는다, 0253a).
  const { data: before, error: beforeError } = await supabase
    .from("class_salary_settings")
    .select("salary_group, commission_rate, applies_dows")
    .eq("tenant_id", user.tenantId)
    .eq("class_id", classId)
    .maybeSingle();
  if (beforeError) return { error: humanizeDbError(beforeError.message) };

  const { error } = await supabase.from("class_salary_settings").upsert(
    {
      tenant_id: user.tenantId,
      class_id: classId,
      salary_group: salaryGroup,
      commission_rate: commissionRate,
      applies_dows: appliesDows,
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    },
    { onConflict: "class_id" },
  );
  if (error) return { error: humanizeDbError(error.message) };

  await logAction({
    action: "class_salary_update",
    targetType: "class",
    targetLabel: klass.class_name ?? null,
    metadata: {
      classId,
      before: before
        ? {
            salaryGroup: before.salary_group ?? null,
            commissionRate: before.commission_rate === null ? null : Number(before.commission_rate),
            appliesDows: before.applies_dows ?? null,
          }
        : null,
      after: { salaryGroup, commissionRate, appliesDows },
    },
  });
  revalidatePath("/billing");
  return { ok: true, nonce: Date.now() };
}

"use server";

// 강사 급여 정책 편집 — 급여 연계 v1. docs/payroll-linkage-plan.md.
// ⚠️ 급여는 원장(master) 전용 PII — 이 액션은 master만. (canManageStaff는 admin/manager도 포함하므로 부적합.)

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import type { SalaryType } from "../settlement";

const SALARY_TYPES: SalaryType[] = ["commission", "fixed", "hybrid"];

// nonce = 성공 확정 신호(에디터가 저장 후 접히도록). ⚠️ 급여 변경은 users의 log_activity 트리거가
// 이미 감사기록(0120a에서 salary_type/commission_rate는 redact) — 여기서 별도 audit_logs 기록 안 함(급여 PII 이중노출 방지).
export type SaveCompState = { error?: string; ok?: true; nonce?: number } | undefined;

/**
 * 강사 급여 정책 저장(master 전용). salary_type + commission_rate + monthly_base.
 * 미설정으로 되돌리려면 salaryType="" (null 저장). 비율제/혼합은 배분율 필수.
 */
export async function saveTeacherComp(
  _prev: SaveCompState,
  formData: FormData,
): Promise<SaveCompState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  // 급여 = 원장 전용. master만 편집(admin/manager 불가).
  if (user.systemRole !== "master") return { error: "급여 정책은 원장만 설정할 수 있습니다" };

  const targetId = String(formData.get("userId") ?? "").trim();
  if (!targetId) return { error: "대상 강사가 지정되지 않았습니다" };

  const rawType = String(formData.get("salaryType") ?? "").trim();
  const salaryType = rawType === "" ? null : rawType;
  if (salaryType !== null && !SALARY_TYPES.includes(salaryType as SalaryType)) {
    return { error: "잘못된 급여 방식입니다" };
  }

  const isCommissiony = salaryType === "commission" || salaryType === "hybrid";
  const needsBase = salaryType === "fixed" || salaryType === "hybrid";

  // 배분율 — 비율제/혼합에서만 의미. 빈 값=null. 0~100 정수·소수 허용.
  const rateRaw = String(formData.get("commissionRate") ?? "").trim();
  let commissionRate: number | null = null;
  if (rateRaw !== "") {
    const n = Number(rateRaw.replace(/,/g, ""));
    if (!Number.isFinite(n) || n < 0 || n > 100) return { error: "배분율은 0~100 사이여야 합니다" };
    commissionRate = Math.round(n * 100) / 100;
  }
  if (isCommissiony && commissionRate === null) {
    return { error: "비율제·혼합은 배분율(%)이 필요합니다" };
  }
  // ⚠️ 비율제/혼합이 아니면 배분율을 null로 정리 — 이전 값이 남지 않게(폼 hidden이 옛 값을 실어보내도 무시).
  if (!isCommissiony) commissionRate = null;

  // 기본급(월) — 급여제/혼합에서 의미. 급여제는 이게 전 급여라 필수(>0). 혼합은 0 허용(배분액만).
  const baseRaw = String(formData.get("monthlyBase") ?? "").trim();
  let monthlyBase = 0;
  if (baseRaw !== "") {
    const n = Number(baseRaw.replace(/,/g, ""));
    if (!Number.isFinite(n) || n < 0) return { error: "기본급은 0 이상이어야 합니다" };
    monthlyBase = Math.round(n);
  }
  if (salaryType === "fixed" && monthlyBase <= 0) {
    return { error: "급여제는 월 기본급(0 초과)이 필요합니다" };
  }

  const supabase = await createClient();
  // 같은 테넌트 소속만(RLS가 이미 tenant 격리하나 명시 방어).
  const { data: target } = await supabase
    .from("users")
    .select("id, tenant_id")
    .eq("id", targetId)
    .maybeSingle();
  if (!target || target.tenant_id !== user.tenantId) {
    return { error: "대상 강사를 찾을 수 없습니다" };
  }

  const patch: Record<string, unknown> = {
    salary_type: salaryType,
    commission_rate: commissionRate, // 비율제/혼합만 값, 그 외 null(위에서 정리)
  };
  // 급여제/혼합일 때만 기본급 저장(비율제·미설정에선 monthly_base 안 건드림 — 시간모델 값 보존).
  if (needsBase) patch.monthly_base = monthlyBase;

  const { error } = await supabase.from("users").update(patch).eq("id", targetId);
  if (error) return { error: error.message };

  // 감사기록은 users의 log_activity 트리거에 위임(급여 컬럼은 0120a에서 redact = "바뀜"만 기록, 값 미노출).
  // 여기서 별도 audit_logs를 남기지 않는다 — /owner 감사 화면이 admin/manager에도 열려 배분율 PII가 샐 수 있어서.
  revalidatePath("/billing");
  return { ok: true, nonce: Date.now() };
}

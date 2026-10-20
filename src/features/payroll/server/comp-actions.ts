"use server";

// 강사 급여 정책 편집 — 급여 연계 v1. docs/payroll-linkage-plan.md.
// ⚠️ 급여는 원장(master) 전용 PII — 이 액션은 master만. (canManageStaff는 admin/manager도 포함하므로 부적합.)

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { humanizeDbError } from "@/lib/supabase/db-error";
import { logAction } from "@/features/audit/server/log";
import { canManageSalary } from "./salary-access";
import { SALARY_GROUPS } from "../salary-group";
import type { SalaryType } from "../settlement";

const SALARY_TYPES: SalaryType[] = ["commission", "fixed", "hybrid"];

// nonce = 성공 확정 신호(에디터가 저장 후 접히도록). ⚠️ 감사로그(audit_logs)에는 **누구의 정책을 저장했는지만** 남긴다
// (급여 방식·배분율·기본급 값은 물론 칸 목록도 안 담는다 — 급여 PII). 아래 저장부 주석 참조.
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
  // 급여 = 원장·총괄 전용(admin/manager 불가 · 감사 D6 — 총괄은 자동 통과).
  if (!(await canManageSalary())) return { error: "급여 정책 변경 권한이 없습니다" };

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

  // 원장은 종전대로 세션 클라이언트(users의 log_activity 트리거가 auth.uid()로 행위자를 남긴다 — admin으로 바꾸면
  // 그 활동 기록의 행위자가 비어 버린다). 총괄(비-master)만 admin + 명시 tenant_id로 쓴다(D6).
  const supabase = user.systemRole === "master" ? await createClient() : createAdminClient();
  // 같은 테넌트 소속만 — admin이라 RLS가 막아 주지 않으므로 여기서 막는다.
  const { data: target } = await supabase
    .from("users")
    .select("id, tenant_id, display_name")
    .eq("id", targetId)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  if (!target) {
    return { error: "대상 강사를 찾을 수 없습니다" };
  }

  // 과정별 배분율(초·중·고·수능·특강) — 비율제/혼합에서만 의미. 각 칸은 비워둘 수 있고(그러면 기본 비율로 폴백),
  // 값이 있으면 0~100. ⚠️ 비율제가 아니면 통째로 null로 정리(옛 값이 남아 잘못 계산되는 것 방지 — 기본 비율과 동일 규율).
  let groupRates: Record<string, number> | null = null;
  if (isCommissiony) {
    const acc: Record<string, number> = {};
    for (const g of SALARY_GROUPS) {
      const raw = String(formData.get(`rate_${g}`) ?? "").trim();
      if (raw === "") continue;
      const n = Number(raw.replace(/,/g, ""));
      if (!Number.isFinite(n) || n < 0 || n > 100) return { error: `${g} 배분율은 0~100 사이여야 합니다` };
      acc[g] = Math.round(n * 100) / 100;
    }
    groupRates = Object.keys(acc).length > 0 ? acc : null;
  }

  const patch: Record<string, unknown> = {
    salary_type: salaryType,
    commission_rate: commissionRate, // 비율제/혼합만 값, 그 외 null(위에서 정리)
    commission_rates: groupRates,
  };
  // 급여제/혼합일 때만 기본급 저장(비율제·미설정에선 monthly_base 안 건드림 — 시간모델 값 보존).
  if (needsBase) patch.monthly_base = monthlyBase;

  const { error } = await supabase.from("users").update(patch).eq("id", targetId).eq("tenant_id", user.tenantId);
  if (error) return { error: humanizeDbError(error.message) };

  // 감사로그 — 🔴 **누구의 급여 정책을 저장했는지만**. 값은 물론 칸 목록도 담지 않는다(기본급 칸은 급여제·혼합에서만 저장돼
  //    칸 목록만으로 급여 방식이 드러난다 — 급여 방식·배분율·기본급 = 급여 PII).
  // users의 log_activity 트리거(0120a, 급여 컬럼 redact)는 auth.uid()로 행위자를 남기는데, 총괄 경로는 admin
  // 클라이언트라 트리거가 행위자를 못 본다 → 누가 바꿨는지는 이 줄이 유일한 기록이다(원장 경로도 같은 모양으로 남긴다).
  await logAction({
    action: "teacher_comp_update",
    targetType: "staff",
    targetLabel: (target.display_name as string | null) ?? null,
    metadata: { userId: targetId },
  });
  revalidatePath("/billing");
  return { ok: true, nonce: Date.now() };
}

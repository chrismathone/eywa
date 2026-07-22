"use server";

// 반별 급여 설정(과정·배분율) 편집 — 원장 전용. 저장소는 class_salary_settings(0130a, master 전용 RLS).
// ⚠️ classes 테이블에 넣지 않는 이유: classes는 강사도 읽는 표라 급여 값이 섞이면 어떤 쿼리 실수로도 샌다(#77).

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { isSalaryGroup } from "../salary-group";

const DOW_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export type SaveClassSalaryState = { ok?: true; error?: string; nonce?: number } | undefined;

export async function saveClassSalary(
  _prev: SaveClassSalaryState,
  formData: FormData,
): Promise<SaveClassSalaryState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  // 급여 = 원장 전용(RLS로도 막히지만 여기서 먼저 분명한 메시지를 준다).
  if (user.systemRole !== "master") return { error: "반별 급여 설정은 원장만 변경할 수 있습니다" };

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

  const supabase = await createClient();
  // 같은 테넌트의 반인지 확인(RLS가 이미 막지만 명시 방어 — 남의 반 id로 행을 만들지 못하게).
  const { data: klass } = await supabase.from("classes").select("id, tenant_id").eq("id", classId).maybeSingle();
  if (!klass || klass.tenant_id !== user.tenantId) return { error: "대상 반을 찾을 수 없습니다" };

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
  if (error) return { error: error.message };

  revalidatePath("/billing");
  return { ok: true, nonce: Date.now() };
}

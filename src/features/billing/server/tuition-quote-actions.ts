"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { humanizeDbError, explainDbError } from "@/lib/supabase/db-error";
import { getCurrentUser } from "@/lib/auth/current-user";
import type { SystemRole } from "@/lib/permissions";
import { accessLevelTenant } from "@/lib/auth/perm-matrix";
import { logAction } from "@/features/audit/server/log";

export type SaveQuoteState = { error?: string; ok?: boolean; id?: string } | undefined;

// 견적 저장/삭제 권한 = billing "full"(master/admin/accountant). 단가표·교재단가표와 동일 게이트.
async function canWrite(role: SystemRole): Promise<boolean> {
  return (await accessLevelTenant(role, "billing")) === "full";
}

function parseArr(v: FormDataEntryValue | null): unknown[] {
  try {
    const p = JSON.parse(String(v ?? "[]"));
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
}

const won = (v: FormDataEntryValue | null): number =>
  Number(String(v ?? "0").replace(/[,\s]/g, "")) || 0;

export async function saveTuitionQuote(
  _prev: SaveQuoteState,
  formData: FormData,
): Promise<SaveQuoteState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWrite(user.systemRole))) return { error: "견적 저장 권한이 없습니다" };

  const studentName = String(formData.get("studentName") ?? "").trim();
  if (!studentName) return { error: "학생 이름을 입력해주세요" };

  const courses = parseArr(formData.get("courses"));
  if (courses.length === 0) return { error: "수강 과목을 1개 이상 추가해주세요" };

  const school = String(formData.get("school") ?? "").trim() || null;
  const grade = String(formData.get("grade") ?? "").trim() || null;
  const consultant = String(formData.get("consultant") ?? "").trim() || null;
  const startDate = String(formData.get("startDate") ?? "").trim() || null;
  const endDate = String(formData.get("endDate") ?? "").trim() || null;
  const extras = parseArr(formData.get("extras"));
  const discounts = parseArr(formData.get("discounts"));
  const totalAmount = won(formData.get("totalAmount"));

  const row = {
    student_name: studentName,
    school,
    grade,
    consultant,
    start_date: startDate,
    end_date: endDate,
    courses,
    extras,
    discounts,
    total_amount: totalAmount,
  };

  const supabase = await createClient();

  // 🔴 저장된 견적을 고쳐 저장하면 **덮어쓴다**. 예전엔 무조건 insert라 수정할 때마다 사본이
  //    하나씩 쌓였고, 목록에 같은 학생 견적이 여러 개 남아 어느 것이 학부모에게 나간 것인지
  //    알 수 없었다(적대 리뷰 2026-08-07).
  //    ⚠️ tenant_id를 함께 걸어 남의 학원 견적을 id만으로 고치지 못하게 한다.
  const quoteId = String(formData.get("quoteId") ?? "").trim();
  if (quoteId) {
    const { data, error } = await supabase
      .from("tuition_quotes")
      .update(row)
      .eq("id", quoteId)
      .eq("tenant_id", user.tenantId)
      .select("id")
      .maybeSingle();
    if (error) return { error: humanizeDbError(error.message, "저장") };
    // 그 사이 지워졌거나 남의 테넌트 id면 0행 — 조용히 사라지지 않게 알린다.
    if (!data) return { error: "저장할 견적을 찾지 못했습니다 — 목록에서 다시 열어주세요" };
    // 🔴 금액(총액·할인·추가 항목)은 담지 않는다 — 몇 과목짜리 견적인지만.
    await logAction({
      action: "tuition_quote_save",
      targetType: "tuition_quote",
      targetLabel: studentName,
      metadata: { quoteId: data.id, mode: "update", courseCount: courses.length },
    });
    revalidatePath("/billing");
    return { ok: true, id: data.id };
  }

  const { data, error } = await supabase
    .from("tuition_quotes")
    .insert({ tenant_id: user.tenantId, ...row })
    .select("id")
    .single();
  if (error) return { error: humanizeDbError(error.message, "저장") };

  await logAction({
    action: "tuition_quote_save",
    targetType: "tuition_quote",
    targetLabel: studentName,
    metadata: { quoteId: data.id, mode: "create", courseCount: courses.length },
  });
  revalidatePath("/billing");
  return { ok: true, id: data.id };
}

export async function deleteTuitionQuote(
  _prev: SaveQuoteState,
  formData: FormData,
): Promise<SaveQuoteState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWrite(user.systemRole))) return { error: "견적 삭제 권한이 없습니다" };

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "견적 ID가 누락되었습니다" };

  const supabase = await createClient();
  const { data: removed, error } = await supabase.from("tuition_quotes").delete().eq("id", id).select("student_name");
  if (error) return { error: explainDbError(error, { scope: "billing.tuition-quote-actions.deleteTuitionQuote", fallback: "삭제하지 못했습니다 — 잠시 후 다시 시도해 주세요", op: "delete" }).message };

  if (removed?.length) {
    await logAction({
      action: "tuition_quote_delete",
      targetType: "tuition_quote",
      targetLabel: (removed[0].student_name as string | null) ?? null,
      metadata: { quoteId: id },
    });
  }
  revalidatePath("/billing");
  return { ok: true };
}

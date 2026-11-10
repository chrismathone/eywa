"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import type { SystemRole } from "@/lib/permissions";
import { accessLevelTenant } from "@/lib/auth/perm-matrix";
import { normalizePricingMode, type PricingMode } from "@/features/billing/tuition-catalog";
import { logAction } from "@/features/audit/server/log";
import { explainDbError } from "@/lib/supabase/db-error";

export type TuitionCatalogActionState = { error?: string; ok?: boolean } | undefined;

// 수납 쓰기 권한 = billing "full"(master/admin/accountant). 교재 단가표와 동일 게이트.
async function canWrite(role: SystemRole): Promise<boolean> {
  return (await accessLevelTenant(role, "billing")) === "full";
}

type Fields = {
  category: string;
  name: string;
  price: string;
  pricingMode: PricingMode | null;
  note: string | null;
  error?: string;
};

function readForm(formData: FormData): Fields {
  const category = String(formData.get("category") ?? "").trim() || "기타";
  const name = String(formData.get("name") ?? "").trim();
  const price = String(formData.get("price") ?? "").trim() || "0";
  const pricingMode = normalizePricingMode(String(formData.get("pricing_mode") ?? ""));
  const note = String(formData.get("note") ?? "").trim() || null;
  return { category, name, price, pricingMode, note, error: name ? undefined : "항목명을 입력해주세요" };
}

export async function createTuitionItem(
  _prev: TuitionCatalogActionState,
  formData: FormData,
): Promise<TuitionCatalogActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWrite(user.systemRole))) return { error: "단가표 관리 권한이 없습니다" };

  const f = readForm(formData);
  if (f.error) return { error: f.error };

  const supabase = await createClient();
  const { error } = await supabase.from("tuition_catalog").insert({
    tenant_id: user.tenantId,
    category: f.category,
    name: f.name,
    price: f.price,
    pricing_mode: f.pricingMode,
    note: f.note,
  });
  if (error) return { error: explainDbError(error, { scope: "billing.tuition-catalog-actions.createTuitionItem", fallback: "저장하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };

  // 🔴 단가(price)·비고(note)는 담지 않는다 — 감사로그의 일은 "누가 무엇을 바꿨나"다.
  await logAction({
    action: "tuition_catalog_create",
    targetType: "tuition_catalog",
    targetLabel: f.name,
    metadata: { pricingMode: f.pricingMode },
  });
  revalidatePath("/billing");
  return { ok: true };
}

export async function updateTuitionItem(
  _prev: TuitionCatalogActionState,
  formData: FormData,
): Promise<TuitionCatalogActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWrite(user.systemRole))) return { error: "단가표 관리 권한이 없습니다" };

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "항목 ID가 누락되었습니다" };
  const f = readForm(formData);
  if (f.error) return { error: f.error };

  const supabase = await createClient();
  const { data: updated, error } = await supabase
    .from("tuition_catalog")
    .update({ category: f.category, name: f.name, price: f.price, pricing_mode: f.pricingMode, note: f.note })
    .eq("id", id)
    .select("id"); // 0행(이미 지워진 항목)이면 감사로그를 남기지 않는다.
  if (error) return { error: explainDbError(error, { scope: "billing.tuition-catalog-actions.updateTuitionItem", fallback: "저장하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };

  if (updated?.length) {
    await logAction({
      action: "tuition_catalog_update",
      targetType: "tuition_catalog",
      targetLabel: f.name,
      metadata: { itemId: id, pricingMode: f.pricingMode },
    });
  }
  revalidatePath("/billing");
  return { ok: true };
}

export async function deleteTuitionItem(
  _prev: TuitionCatalogActionState,
  formData: FormData,
): Promise<TuitionCatalogActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWrite(user.systemRole))) return { error: "단가표 관리 권한이 없습니다" };

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "항목 ID가 누락되었습니다" };

  const supabase = await createClient();
  const { data: removed, error } = await supabase.from("tuition_catalog").delete().eq("id", id).select("name");
  if (error) return { error: explainDbError(error, { scope: "billing.tuition-catalog-actions.deleteTuitionItem", fallback: "삭제하지 못했습니다 — 잠시 후 다시 시도해 주세요", op: "delete" }).message };

  if (removed?.length) {
    await logAction({
      action: "tuition_catalog_delete",
      targetType: "tuition_catalog",
      targetLabel: (removed[0].name as string | null) ?? null,
      metadata: { itemId: id },
    });
  }
  revalidatePath("/billing");
  return { ok: true };
}

/**
 * 단가 종류만 바꾼다 — **목록에서 한 번에**(원장 2026-08-07 *"단가표에도 구분해줘야겠는걸"*).
 *
 * 🔴 수정 다이얼로그를 열어 고치게 두면 안 된다: 아직 안 고른 항목이 31건 남아 있는데(수학 18·영어 11·
 *    국어 2, 2026-08-07 실측) 한 건에 다이얼로그 한 번이면 그 일은 끝나지 않는다. 목록 행에서 바로 누른다.
 * ⚠️ `updateTuitionItem`을 재사용하지 않는다 — 그건 분류·항목명·단가·비고를 **전부** 받아 덮으므로,
 *    행에서 부르려면 숨은 input에 전 필드를 실어야 하고 하나만 어긋나도 다른 칸이 조용히 덮인다.
 * ⚠️ 빈 값("")은 **미지정으로 되돌리기**다(normalizePricingMode가 null로 정규화) — 잘못 고른 값을
 *    되돌릴 문이 있어야 한다.
 */
export async function setTuitionPricingMode(
  _prev: TuitionCatalogActionState,
  formData: FormData,
): Promise<TuitionCatalogActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWrite(user.systemRole))) return { error: "단가표 관리 권한이 없습니다" };

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "항목 ID가 누락되었습니다" };
  const pricingMode = normalizePricingMode(String(formData.get("pricing_mode") ?? ""));

  const supabase = await createClient();
  const { data: changed, error } = await supabase
    .from("tuition_catalog")
    .update({ pricing_mode: pricingMode })
    .eq("id", id)
    .select("name");
  if (error) return { error: explainDbError(error, { scope: "billing.tuition-catalog-actions.setTuitionPricingMode", fallback: "저장하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };

  if (changed?.length) {
    await logAction({
      action: "tuition_catalog_pricing_mode",
      targetType: "tuition_catalog",
      targetLabel: (changed[0].name as string | null) ?? null,
      metadata: { itemId: id, pricingMode },
    });
  }
  revalidatePath("/billing");
  return { ok: true };
}

export async function toggleTuitionActive(
  _prev: TuitionCatalogActionState,
  formData: FormData,
): Promise<TuitionCatalogActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWrite(user.systemRole))) return { error: "단가표 관리 권한이 없습니다" };

  const id = String(formData.get("id") ?? "").trim();
  const next = String(formData.get("next") ?? "") === "true";
  if (!id) return { error: "항목 ID가 누락되었습니다" };

  const supabase = await createClient();
  const { data: toggled, error } = await supabase
    .from("tuition_catalog")
    .update({ is_active: next })
    .eq("id", id)
    .select("name");
  if (error) return { error: explainDbError(error, { scope: "billing.tuition-catalog-actions.toggleTuitionActive", fallback: "저장하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };

  if (toggled?.length) {
    await logAction({
      action: "tuition_catalog_toggle",
      targetType: "tuition_catalog",
      targetLabel: (toggled[0].name as string | null) ?? null,
      metadata: { itemId: id, active: next },
    });
  }
  revalidatePath("/billing");
  return { ok: true };
}

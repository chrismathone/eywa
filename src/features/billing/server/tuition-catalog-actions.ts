"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import type { SystemRole } from "@/lib/permissions";
import { accessLevelTenant } from "@/lib/auth/perm-matrix";
import { normalizePricingMode, type PricingMode } from "@/features/billing/tuition-catalog";

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
  if (error) return { error: error.message };

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
  const { error } = await supabase
    .from("tuition_catalog")
    .update({ category: f.category, name: f.name, price: f.price, pricing_mode: f.pricingMode, note: f.note })
    .eq("id", id);
  if (error) return { error: error.message };

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
  const { error } = await supabase.from("tuition_catalog").delete().eq("id", id);
  if (error) return { error: error.message };

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
  const { error } = await supabase.from("tuition_catalog").update({ is_active: next }).eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/billing");
  return { ok: true };
}

"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import type { SystemRole } from "@/lib/permissions";
import { accessLevelTenant } from "@/lib/auth/perm-matrix";

export type CatalogActionState = { error?: string; ok?: boolean } | undefined;

// 수납 쓰기 권한 = billing "full" (master/admin/accountant). readonly(manager)·none 제외.
async function canWrite(role: SystemRole): Promise<boolean> {
  return (await accessLevelTenant(role, "billing")) === "full";
}

type Fields = {
  title: string;
  bookDetail: string | null;
  gradeLevel: string | null;
  subject: string | null;
  publisher: string | null;
  price: string;
  error?: string;
};

function readForm(formData: FormData): Fields {
  const title = String(formData.get("title") ?? "").trim();
  const bookDetail = String(formData.get("bookDetail") ?? "").trim() || null;
  const gradeLevel = String(formData.get("gradeLevel") ?? "").trim() || null;
  const subject = String(formData.get("subject") ?? "").trim() || null;
  const publisher = String(formData.get("publisher") ?? "").trim() || null;
  const price = String(formData.get("price") ?? "").trim() || "0";
  return { title, bookDetail, gradeLevel, subject, publisher, price, error: title ? undefined : "교재명을 입력해주세요" };
}

export async function createCatalogItem(
  _prev: CatalogActionState,
  formData: FormData,
): Promise<CatalogActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWrite(user.systemRole))) return { error: "단가표 관리 권한이 없습니다" };

  const f = readForm(formData);
  if (f.error) return { error: f.error };

  const supabase = await createClient();
  const { error } = await supabase.from("textbook_catalog").insert({
    tenant_id: user.tenantId,
    title: f.title,
    book_detail: f.bookDetail,
    grade_level: f.gradeLevel,
    subject: f.subject,
    publisher: f.publisher,
    price: f.price,
  });
  if (error) return { error: error.message };

  revalidatePath("/billing");
  return { ok: true };
}

export async function updateCatalogItem(
  _prev: CatalogActionState,
  formData: FormData,
): Promise<CatalogActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWrite(user.systemRole))) return { error: "단가표 관리 권한이 없습니다" };

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "교재 ID가 누락되었습니다" };
  const f = readForm(formData);
  if (f.error) return { error: f.error };

  const supabase = await createClient();
  const { error } = await supabase
    .from("textbook_catalog")
    .update({
      title: f.title,
      book_detail: f.bookDetail,
      grade_level: f.gradeLevel,
      subject: f.subject,
      publisher: f.publisher,
      price: f.price,
    })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/billing");
  return { ok: true };
}

export async function deleteCatalogItem(
  _prev: CatalogActionState,
  formData: FormData,
): Promise<CatalogActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWrite(user.systemRole))) return { error: "단가표 관리 권한이 없습니다" };

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "교재 ID가 누락되었습니다" };

  const supabase = await createClient();
  const { error } = await supabase.from("textbook_catalog").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/billing");
  return { ok: true };
}

export async function toggleCatalogActive(
  _prev: CatalogActionState,
  formData: FormData,
): Promise<CatalogActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWrite(user.systemRole))) return { error: "단가표 관리 권한이 없습니다" };

  const id = String(formData.get("id") ?? "").trim();
  const next = String(formData.get("next") ?? "") === "true";
  if (!id) return { error: "교재 ID가 누락되었습니다" };

  const supabase = await createClient();
  const { error } = await supabase.from("textbook_catalog").update({ is_active: next }).eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/billing");
  return { ok: true };
}

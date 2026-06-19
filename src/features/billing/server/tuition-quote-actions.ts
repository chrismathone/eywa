"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import type { SystemRole } from "@/lib/permissions";
import { accessLevelTenant } from "@/lib/auth/perm-matrix";

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

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tuition_quotes")
    .insert({
      tenant_id: user.tenantId,
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
    })
    .select("id")
    .single();
  if (error) return { error: error.message };

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
  const { error } = await supabase.from("tuition_quotes").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/billing");
  return { ok: true };
}

"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";

// 교재신청(textbook_orders) CRUD — invoices actions 골격 본뜸. 상태 전환 시 해당 타임스탬프를
// 진입 시각으로 채운다(ijw timestamp-on-toggle). tenant_id는 RLS 강제(INSERT엔 명시).
export type TextbookState =
  | { error?: string; fieldErrors?: Record<string, string>; ok?: boolean }
  | undefined;

const STATUSES = new Set(["requested", "ordered", "delivered", "billed", "paid"]);
const STATUS_TS: Record<string, string | undefined> = {
  ordered: "ordered_at",
  delivered: "delivered_at",
  billed: "billed_at",
  paid: "paid_at",
};

function won(v: FormDataEntryValue | null): number {
  return Number(String(v ?? "0").replace(/[,\s]/g, "")) || 0;
}

function parse(formData: FormData) {
  return {
    bookName: String(formData.get("bookName") ?? "").trim(),
    bookDetail: String(formData.get("bookDetail") ?? "").trim() || null,
    studentId: String(formData.get("studentId") ?? "").trim() || null,
    teacherName: String(formData.get("teacherName") ?? "").trim() || null,
    price: won(formData.get("price")),
    requestDate: String(formData.get("requestDate") ?? "").trim() || null,
    notes: String(formData.get("notes") ?? "").trim() || null,
  };
}

async function resolveStudentName(
  supabase: Awaited<ReturnType<typeof createClient>>,
  studentId: string | null,
): Promise<string | null> {
  if (!studentId) return null;
  const { data } = await supabase.from("students").select("name").eq("id", studentId).single();
  return data?.name ?? null;
}

export async function createTextbookOrder(_prev: TextbookState, formData: FormData): Promise<TextbookState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  const f = parse(formData);
  if (!f.bookName) return { fieldErrors: { bookName: "교재명을 입력해주세요" } };

  const supabase = await createClient();
  const studentName = await resolveStudentName(supabase, f.studentId);
  const { error } = await supabase.from("textbook_orders").insert({
    tenant_id: user.tenantId,
    student_id: f.studentId,
    student_name: studentName,
    teacher_name: f.teacherName,
    book_name: f.bookName,
    book_detail: f.bookDetail,
    price: f.price,
    status: "requested",
    request_date: f.requestDate ?? new Date().toISOString().slice(0, 10),
    notes: f.notes,
  });
  if (error) return { error: error.message };

  revalidatePath("/billing");
  return { ok: true };
}

export async function updateTextbookOrder(_prev: TextbookState, formData: FormData): Promise<TextbookState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "교재신청 ID가 누락되었습니다" };
  const f = parse(formData);
  if (!f.bookName) return { fieldErrors: { bookName: "교재명을 입력해주세요" } };

  const supabase = await createClient();
  const studentName = await resolveStudentName(supabase, f.studentId);
  const { error } = await supabase
    .from("textbook_orders")
    .update({
      student_id: f.studentId,
      student_name: studentName,
      teacher_name: f.teacherName,
      book_name: f.bookName,
      book_detail: f.bookDetail,
      price: f.price,
      request_date: f.requestDate,
      notes: f.notes,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/billing");
  return { ok: true };
}

export async function setTextbookStatus(_prev: TextbookState, formData: FormData): Promise<TextbookState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  const id = String(formData.get("id") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();
  if (!id) return { error: "교재신청 ID가 누락되었습니다" };
  if (!STATUSES.has(status)) return { error: "잘못된 상태입니다" };

  const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
  const tsCol = STATUS_TS[status];
  if (tsCol) patch[tsCol] = new Date().toISOString();

  const supabase = await createClient();
  const { error } = await supabase.from("textbook_orders").update(patch).eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/billing");
  return { ok: true };
}

export async function deleteTextbookOrder(_prev: TextbookState, formData: FormData): Promise<TextbookState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "교재신청 ID가 누락되었습니다" };

  const supabase = await createClient();
  const { error } = await supabase.from("textbook_orders").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/billing");
  return { ok: true };
}

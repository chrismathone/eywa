"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";

// 교재신청(textbook_orders) CRUD — invoices actions 골격 본뜸. 상태 전환 시 해당 타임스탬프를
// 진입 시각으로 채운다(ijw timestamp-on-toggle). tenant_id는 RLS 강제(INSERT엔 명시).
export type TextbookState =
  | { error?: string; fieldErrors?: Record<string, string>; ok?: boolean }
  | undefined;

// ijw식 3개 독립 체크(등록/주문/납부) → 각자 타임스탬프 컬럼. status는 체크에서 파생.
const CHECK_COLS: Record<string, string> = {
  registered: "registered_at",
  ordered: "ordered_at",
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
    status_at: new Date().toISOString(),
    status_by_name: user.displayName,
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

// 체크 토글(등록/주문/납부) — 해당 타임스탬프를 켜고(now)/끄고(null), 마지막 변경자·시각 기록.
// status는 체크에서 파생: 납부>주문>신청 (등록은 status 무관 = 독립 운영 플래그, ijw와 동일).
export async function toggleTextbookCheck(_prev: TextbookState, formData: FormData): Promise<TextbookState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  const id = String(formData.get("id") ?? "").trim();
  const field = String(formData.get("field") ?? "").trim();
  const checked = String(formData.get("checked") ?? "") === "true";
  if (!id) return { error: "교재신청 ID가 누락되었습니다" };
  const col = CHECK_COLS[field];
  if (!col) return { error: "잘못된 체크 항목입니다" };

  const supabase = await createClient();
  // 다른 체크 상태가 있어야 status를 재도출 → 현재 행 조회(RLS 격리).
  const { data: row } = await supabase
    .from("textbook_orders")
    .select("registered_at, ordered_at, paid_at")
    .eq("id", id)
    .single();
  if (!row) return { error: "교재신청을 찾을 수 없습니다" };

  const now = new Date().toISOString();
  const next: Record<string, string | null> = {
    registered_at: row.registered_at,
    ordered_at: row.ordered_at,
    paid_at: row.paid_at,
  };
  next[col] = checked ? now : null;
  const status = next.paid_at ? "paid" : next.ordered_at ? "ordered" : "requested";

  const { error } = await supabase
    .from("textbook_orders")
    .update({
      [col]: next[col],
      status,
      status_at: now,
      status_by_name: user.displayName,
      updated_at: now,
    })
    .eq("id", id);
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

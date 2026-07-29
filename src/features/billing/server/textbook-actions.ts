"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { getTeacherScope } from "@/lib/auth/teacher-scope";
import { effectiveTeacherId } from "@/lib/auth/view-mode";
import { kstToday } from "@/lib/date-kst";
import { createClient } from "@/lib/supabase/server";
import { ownsTextbookRequest } from "../textbook-ownership";

// 교재신청(textbook_orders) CRUD — invoices actions 골격 본뜸. 상태 전환 시 해당 타임스탬프를
// 진입 시각으로 채운다(ijw timestamp-on-toggle). tenant_id는 RLS 강제(INSERT엔 명시).
export type TextbookState =
  | {
      error?: string;
      fieldErrors?: Record<string, string>;
      ok?: boolean;
      createdId?: string;
      /** 일괄 요청 시 생성된 각 학생의 요청(학생별 요청서 PNG 자동 발행용). */
      created?: { id: string; studentName: string | null }[];
    }
  | undefined;

// ijw식 3개 독립 체크(등록/주문/납부) → 각자 타임스탬프 컬럼. status는 체크에서 파생.
const CHECK_COLS: Record<string, string> = {
  registered: "registered_at",
  ordered: "ordered_at",
  paid: "paid_at",
};

function won(v: FormDataEntryValue | null): number {
  // 금액은 음수 불가 — 클라 min=0을 우회하는 직접 호출(FormData 수동 조립)에도 서버에서 0으로 클램프.
  return Math.max(0, Number(String(v ?? "0").replace(/[,\s]/g, "")) || 0);
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
  if (!(await canWriteTenant(user.systemRole, "billing"))) return { error: "교재 관리 권한이 없습니다" };
  const f = parse(formData);
  if (!f.bookName) return { fieldErrors: { bookName: "교재명을 입력해주세요" } };

  const supabase = await createClient();
  const studentName = await resolveStudentName(supabase, f.studentId);
  // 생성 id를 돌려받는다 — 다이얼로그의 '클래스노트 발송'이 **방금 저장한 그 건**을 대상으로 열려면 필요.
  const { data, error } = await supabase
    .from("textbook_orders")
    .insert({
      tenant_id: user.tenantId,
      student_id: f.studentId,
      student_name: studentName,
      teacher_name: f.teacherName,
      book_name: f.bookName,
      book_detail: f.bookDetail,
      price: f.price,
      status: "requested",
      request_date: f.requestDate ?? kstToday(),
      status_at: new Date().toISOString(),
      status_by_name: user.displayName,
      notes: f.notes,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };

  revalidatePath("/billing");
  return { ok: true, createdId: (data?.id as string | undefined) ?? undefined };
}

/**
 * 강사 교재 요청(강사 미니셸 '교재 요청' 면) — 본인 담당 학생에 대해서만 요청 생성.
 * 사무실용 createTextbookOrder(billing 게이트)와 분리: 이건 textbook_requests 게이트 + 강사 스코프 검증.
 * 생성된 요청은 사무실이 /billing 교재 면에서 처리(주문/납부 체크). teacher_name=요청 강사 본인.
 */
export async function requestTextbook(_prev: TextbookState, formData: FormData): Promise<TextbookState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "textbook_requests"))) return { error: "교재 요청 권한이 없습니다" };
  const f = parse(formData);
  if (!f.bookName) return { fieldErrors: { bookName: "교재명을 입력해주세요" } };
  // 같은 교재를 여러 학생에게 일괄 요청 — studentId를 복수(hidden input N개)로 받는다(중복·빈값 제거).
  const studentIds = [...new Set(formData.getAll("studentId").map((v) => String(v).trim()).filter(Boolean))];
  if (studentIds.length === 0) return { fieldErrors: { studentId: "학생을 선택해주세요" } };
  // 강사(또는 겸직-강사뷰)는 본인 담당 학생만 요청 가능 — 하나라도 스코프 밖이면 전체 거부(intra-tenant PII 스코프).
  const tId = await effectiveTeacherId();
  if (tId) {
    const { studentIds: scoped } = await getTeacherScope(tId);
    const scopedSet = new Set(scoped);
    if (!studentIds.every((id) => scopedSet.has(id))) {
      return { error: "담당 학생만 교재를 요청할 수 있습니다" };
    }
  }

  const supabase = await createClient();
  // 학생 이름 일괄 조회(N 단건 대신 1쿼리) — student_name 스냅샷 컬럼 채움.
  const { data: studentRows } = await supabase.from("students").select("id, name").in("id", studentIds);
  const nameById = new Map((studentRows ?? []).map((s) => [s.id as string, (s.name as string | null) ?? null]));

  const nowIso = new Date().toISOString();
  const teacherName = f.teacherName || user.displayName;
  const requestDate = f.requestDate ?? kstToday();
  const rows = studentIds.map((sid) => ({
    tenant_id: user.tenantId,
    student_id: sid,
    student_name: nameById.get(sid) ?? null,
    // ijw 패리티 — 폼의 '담임 선생님'(기본=요청자 본인, 자유 표시명·대리 작성 가능). 미입력이면 요청자.
    teacher_name: teacherName,
    book_name: f.bookName,
    book_detail: f.bookDetail,
    price: f.price,
    status: "requested",
    request_date: requestDate,
    status_at: nowIso,
    status_by_name: user.displayName,
    notes: f.notes,
  }));
  const { data, error } = await supabase
    .from("textbook_orders")
    .insert(rows)
    .select("id, student_name");
  if (error) return { error: error.message };

  revalidatePath("/textbook-requests");
  revalidatePath("/billing"); // 사무실 교재 면에도 즉시 반영
  // 생성 직후 학생별 요청서 자동 발행용.
  const created = (data ?? []).map((r) => ({
    id: r.id as string,
    studentName: (r.student_name as string | null) ?? null,
  }));
  return { ok: true, created };
}

/**
 * 강사 교재 요청 수정/삭제 — 사무실이 **아무것도 처리하지 않은**(등록/주문/납부 체크 0) 요청만 허용.
 * 사무실이 처리를 시작하면 잠금(강사가 임의 변경 불가). 강사는 본인 담당 학생 요청만.
 * (사무실은 기존 /billing 교재 면의 updateTextbookOrder/deleteTextbookOrder로 잠금 없이 처리.)
 */
async function loadEditableRequest(
  supabase: Awaited<ReturnType<typeof createClient>>,
  id: string,
): Promise<{ error: string } | { ok: true }> {
  const { data: row } = await supabase
    .from("textbook_orders")
    .select("student_id, teacher_name, registered_at, ordered_at, paid_at")
    .eq("id", id)
    .single();
  if (!row) return { error: "교재 요청을 찾을 수 없습니다" };
  // 강사(또는 겸직-강사뷰)는 본인 담당 학생 + **본인 요청**만.
  // 🔴 담당 학생만으로는 부족하다(2026-07-29): 수학·영어를 같이 듣는 학생은 두 강사 모두의 담당이라
  //    영어 강사가 수학 강사의 요청을 수정·삭제할 수 있었다. 소유 판정은 ownsTextbookRequest 단일 소스.
  const tId = await effectiveTeacherId();
  if (tId) {
    const user = await getCurrentUser();
    const { studentIds } = await getTeacherScope(tId);
    if (!row.student_id || !studentIds.includes(row.student_id)) return { error: "담당 학생의 요청만 수정·삭제할 수 있습니다" };
    if (!ownsTextbookRequest(row.teacher_name, user?.displayName))
      return { error: `본인이 낸 요청만 수정·삭제할 수 있습니다${row.teacher_name ? ` (이 요청: ${row.teacher_name})` : ""}` };
  }
  // 사무실이 하나라도 처리(등록/주문/납부)했으면 잠금.
  if (row.registered_at || row.ordered_at || row.paid_at) {
    return { error: "사무실에서 처리 중인 요청은 수정·삭제할 수 없습니다" };
  }
  return { ok: true };
}

export async function updateTextbookRequest(_prev: TextbookState, formData: FormData): Promise<TextbookState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "textbook_requests"))) return { error: "교재 요청 권한이 없습니다" };
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "교재 요청 ID가 누락되었습니다" };
  const f = parse(formData);
  if (!f.bookName) return { fieldErrors: { bookName: "교재명을 입력해주세요" } };

  const supabase = await createClient();
  const gate = await loadEditableRequest(supabase, id);
  if ("error" in gate) return { error: gate.error };

  const { error } = await supabase
    .from("textbook_orders")
    .update({
      book_name: f.bookName,
      book_detail: f.bookDetail,
      notes: f.notes,
      price: f.price, // 미처리(untouched) 요청만 이 경로에 오므로 강사가 금액 정정 가능(폼이 항상 전송)
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/textbook-requests");
  revalidatePath("/billing");
  return { ok: true };
}

export async function deleteTextbookRequest(_prev: TextbookState, formData: FormData): Promise<TextbookState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "textbook_requests"))) return { error: "교재 요청 권한이 없습니다" };
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "교재 요청 ID가 누락되었습니다" };

  const supabase = await createClient();
  const gate = await loadEditableRequest(supabase, id);
  if ("error" in gate) return { error: gate.error };

  const { error } = await supabase.from("textbook_orders").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/textbook-requests");
  revalidatePath("/billing");
  return { ok: true };
}

export async function updateTextbookOrder(_prev: TextbookState, formData: FormData): Promise<TextbookState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "billing"))) return { error: "교재 관리 권한이 없습니다" };
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
  if (!(await canWriteTenant(user.systemRole, "billing"))) return { error: "교재 관리 권한이 없습니다" };
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

  const patch: Record<string, string | null> = {
    [col]: next[col],
    status,
    status_at: now,
    status_by_name: user.displayName,
    updated_at: now,
  };
  // 등록/납부 해제 = "사람 소유" 마커(0079a) — makeedu 자동 체크(mirror-textbook-checks)가 이 신청을
  // 영구 제외해 해제↔재체크 핑퐁을 막는다(환불·오체크 정정 존중). 주문 해제는 자동화 무관이라 마커 안 찍음.
  if (!checked && (col === "registered_at" || col === "paid_at")) patch.check_dismissed_at = now;

  const { error } = await supabase.from("textbook_orders").update(patch).eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/billing");
  return { ok: true };
}

export async function deleteTextbookOrder(_prev: TextbookState, formData: FormData): Promise<TextbookState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "billing"))) return { error: "교재 관리 권한이 없습니다" };
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "교재신청 ID가 누락되었습니다" };

  const supabase = await createClient();
  const { error } = await supabase.from("textbook_orders").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/billing");
  return { ok: true };
}

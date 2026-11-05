"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser, type CurrentUser } from "@/lib/auth/current-user";
import { canAccessTenant, canWriteTenant } from "@/lib/auth/perm-matrix";
import { textbookRequestStudentIds } from "./textbook-scope";
import { effectiveTeacherId, viewAsTeacher } from "@/lib/auth/view-mode";
import { kstToday } from "@/lib/date-kst";
import { explainDbError } from "@/lib/supabase/db-error";
import { logAction } from "@/features/audit/server/log";
import {
  TEXTBOOK_CHECK_LABEL,
  diffTextbookOrder,
  textbookAuditTarget,
  type TextbookAuditSnapshot,
} from "../textbook-audit";
import { ownsTextbookRequest } from "../textbook-ownership";
import { handOverTextbookNoticeLink } from "./textbook-notice-handover";
import { teacherViewReadDb, writeSessionFirst, type TeacherViewDb } from "./teacher-view-db";

// 교재신청(textbook_orders) CRUD — invoices actions 골격 본뜸. 상태 전환 시 해당 타임스탬프를
// 진입 시각으로 채운다(ijw timestamp-on-toggle). tenant_id는 RLS 강제 + **모든 조회·변경에 명시**(아래 textbookDb).

type TextbookDb = TeacherViewDb;

/**
 * 교재 요청 **읽기** 클라이언트 — 평소엔 세션(RLS 그대로), '다른 강사 뷰'일 때만 관리 클라이언트(teacher-view-db.ts).
 * **쓰기**는 `writeSessionFirst` — 실제 계정 A의 세션으로 먼저 쓰고 RLS에 막힐 때만 관리 클라이언트로 내려간다(활동 기록의 행위자를 남기려고).
 * 🔴 DB의 `auth.uid()`는 강사뷰에서도 A다. RLS(0168a insert: `created_by = auth.uid()` · 0174a 수정·삭제: 강사면
 *    `teacher_name = A 표시명 or created_by = A`)는 대상 강사 X 명의의 저장과 X 요청의 수정·삭제를 거절한다.
 * 부르는 쪽은 앱 게이트를 먼저 지난다 — `canWriteTenant`(읽기 강사뷰는 여기서 막힌다) + 강사 범위·소유(`loadEditableRequest`)
 * + 사무 처리면 `textbookTeacherViewParity`(DB 규칙을 X 기준으로). 이 파일의 모든 조회·변경은 `tenant_id`를 명시한다.
 */
async function textbookDb(): Promise<TextbookDb> {
  return (await teacherViewReadDb()).db;
}

/**
 * 강사뷰 교재 주문 쓰기의 **DB 규칙(0168a·0174a)을 대상 X 기준으로** 앱에서 — DB는 실제 계정 A의 역할·이름으로만 본다
 * (A가 원장이면 A의 세션은 다 통과하고, 관리 클라이언트는 아예 보지 않는다).
 *   ① `auth_textbook_can_use()` = 교재 요청 메뉴 접근(`textbook_requests` ≠ none)
 *   ② 수정·삭제는 X가 **강사**면 본인 요청만 — `teacher_name = X 표시명 or created_by = X`(ownsTextbookRequest)
 * `next`(수정 후 값)를 주면 WITH CHECK처럼 바뀐 뒤의 행도 X의 것이어야 한다. 강사뷰가 아니면 DB가 같은 규칙을 로그인
 * 계정으로 보므로 여기서는 보지 않는다(null).
 */
async function textbookTeacherViewParity(
  user: CurrentUser,
  row: { teacher_name?: string | null; created_by?: string | null } | null,
  next?: { teacher_name?: string | null },
): Promise<string | null> {
  if (!(await viewAsTeacher())) return null;
  if (!(await canAccessTenant(user.systemRole, "textbook_requests"))) return "교재 요청 권한이 없습니다";
  if (!row || user.systemRole !== "teacher") return null;
  const owns = (name: string | null | undefined) => ownsTextbookRequest(name, user.displayName, row.created_by, user.id);
  if (!owns(row.teacher_name) || (next && !owns(next.teacher_name)))
    return `본인이 낸 요청만 처리할 수 있습니다${row.teacher_name ? ` (이 요청: ${row.teacher_name})` : ""}`;
  return null;
}

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
/**
 * 삭제가 **0행**으로 끝났을 때의 문구. 원인은 거의 항상 RLS 소유 게이트(0168a/0174a)다 —
 * 강사는 `내가 만든 것 OR 내 이름으로 된 것`만 지울 수 있고, 옛 요청서는 `created_by`가 없어
 * 이름이 안 맞으면 여기로 떨어진다. 그때 할 수 있는 일(관리자 요청)을 같이 적는다.
 */
const DELETE_BLOCKED_MSG =
  "이 요청서를 지울 권한이 없습니다 — 요청서에 적힌 담당 선생님 이름이 본인과 다르면 관리자에게 요청해주세요.";

/**
 * 감사 기록에 담을 칸 — **바꾸기 전에** 이 모양으로 한 번 읽는다(원장 2026-09-09 *"이거 전부 다 감사로그에
 * 남겨 — 금액 수정같은거"*). 지우는 경로에서도 같은 스냅샷을 남겨야 "무엇을 지웠나"가 남는다.
 */
const AUDIT_COLS = "student_id, student_name, teacher_name, book_name, book_detail, price, request_date, notes";

type AuditRow = {
  student_name?: string | null;
  teacher_name?: string | null;
  book_name?: string | null;
  book_detail?: string | null;
  price?: number | string | null;
  request_date?: string | null;
  notes?: string | null;
};

function snapshotOf(row: AuditRow | null | undefined): TextbookAuditSnapshot {
  return {
    studentName: row?.student_name ?? null,
    teacherName: row?.teacher_name ?? null,
    bookName: row?.book_name ?? null,
    bookDetail: row?.book_detail ?? null,
    price: row?.price ?? null,
    requestDate: row?.request_date ?? null,
    notes: row?.notes ?? null,
  };
}

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
  supabase: TextbookDb,
  tenantId: string,
  studentId: string | null,
): Promise<string | null> {
  if (!studentId) return null;
  const { data } = await supabase.from("students").select("name").eq("tenant_id", tenantId).eq("id", studentId).single();
  return data?.name ?? null;
}

export async function createTextbookOrder(_prev: TextbookState, formData: FormData): Promise<TextbookState> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "billing"))) return { error: "교재 관리 권한이 없습니다" };
  const f = parse(formData);
  if (!f.bookName) return { fieldErrors: { bookName: "교재명을 입력해주세요" } };

  const parity = await textbookTeacherViewParity(user, null);
  if (parity) return { error: parity };

  const supabase = await textbookDb();
  const studentName = await resolveStudentName(supabase, user.tenantId, f.studentId);
  // 생성 id를 돌려받는다 — 다이얼로그의 '클래스노트 발송'이 **방금 저장한 그 건**을 대상으로 열려면 필요.
  // created_by = 대상 X라 강사뷰에선 세션(0168a: created_by = auth.uid())이 막고 관리 클라이언트로 내려간다(writeSessionFirst).
  const { data, error } = await writeSessionFirst("insert", (db) => db
    .from("textbook_orders")
    .insert({
      tenant_id: user.tenantId,
      // 실제 저장한 계정(감사·위조 방지, 0168a). ⚠️ **소유자가 아니다** — 소유 판정은 teacher_name이
      // 단일 소스다(대리 작성이 의도된 동작이라 둘은 다른 사실. textbook-ownership.ts 참조).
      created_by: user.id,
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
    .single());
  if (error) return { error: explainDbError(error, { scope: "billing.textbookOrder.create", fallback: "교재 주문을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요." }).message };

  await logAction({
    action: "textbook_order_create",
    targetType: "textbook_order",
    targetLabel: textbookAuditTarget({ studentName, bookName: f.bookName }),
    metadata: {
      orderId: data?.id ?? null,
      target: textbookAuditTarget({ studentName, bookName: f.bookName }),
      price: f.price,
      surface: "billing",
    },
  });
  revalidatePath("/billing");
  return { ok: true, createdId: (data?.id as string | undefined) ?? undefined };
}

/**
 * 강사 교재 요청(강사 미니셸 '교재 요청' 면) — 본인 담당 학생에 대해서만 요청 생성.
 * 사무실용 createTextbookOrder(billing 게이트)와 분리: 이건 textbook_requests 게이트 + 강사 스코프 검증.
 * 생성된 요청은 사무실이 /billing 교재 면에서 처리(주문/납부 체크). teacher_name=요청 강사 본인.
 */
export async function requestTextbook(_prev: TextbookState, formData: FormData): Promise<TextbookState> {
  const user = await getCurrentUser({ teacherView: true });
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
    const scopedSet = new Set(await textbookRequestStudentIds(tId));
    if (!studentIds.every((id) => scopedSet.has(id))) {
      return { error: "담당 학생만 교재를 요청할 수 있습니다" };
    }
  }

  const supabase = await textbookDb();
  // 학생 이름 일괄 조회(N 단건 대신 1쿼리) — student_name 스냅샷 컬럼 채움.
  const { data: studentRows } = await supabase.from("students").select("id, name").eq("tenant_id", user.tenantId).in("id", studentIds);
  const nameById = new Map((studentRows ?? []).map((s) => [s.id as string, (s.name as string | null) ?? null]));

  const nowIso = new Date().toISOString();
  const teacherName = f.teacherName || user.displayName;
  const requestDate = f.requestDate ?? kstToday();
  const rows = studentIds.map((sid) => ({
    tenant_id: user.tenantId,
    // 실제 저장한 계정(0168a) — teacher_name(소유자)과 다른 사실이다. 아래 주석 참조.
    created_by: user.id,
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
  // created_by = 대상 X라 강사뷰에선 세션이 막고 관리 클라이언트로 내려간다(writeSessionFirst).
  const { data, error } = await writeSessionFirst("insert", (db) => db
    .from("textbook_orders")
    .insert(rows)
    .select("id, student_name"));
  if (error) return { error: explainDbError(error, { scope: "billing.textbookRequest.create", fallback: "교재 요청을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요." }).message };

  await logAction({
    action: "textbook_order_create",
    targetType: "textbook_order",
    targetLabel: textbookAuditTarget({
      studentName: studentIds.length === 1 ? (nameById.get(studentIds[0]!) ?? null) : null,
      bookName: f.bookName,
    }),
    metadata: {
      // 일괄이면 학생마다 행이 생기지만 기록은 한 줄 — 대상 수를 함께 남긴다(행 id 전부).
      orderIds: (data ?? []).map((r) => r.id as string),
      target: textbookAuditTarget({
        studentName: studentIds.length === 1 ? (nameById.get(studentIds[0]!) ?? null) : null,
        bookName: f.bookName,
      }),
      price: f.price,
      count: studentIds.length,
      surface: "request",
    },
  });
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
  supabase: TextbookDb,
  tenantId: string,
  id: string,
): Promise<{ error: string } | { ok: true; before: TextbookAuditSnapshot }> {
  // 감사 기록용 스냅샷을 **같은 조회에서** 함께 받는다(바꾸기 전 값이 있어야 "누가 뭘 고쳤나"를 적는다).
  const { data: row } = await supabase
    .from("textbook_orders")
    // ⚠️ `AUDIT_COLS`가 이미 student_id를 담는다 — 여기서 또 적으면 같은 칸을 두 번 요청하게 된다.
    .select(`created_by, registered_at, ordered_at, paid_at, ${AUDIT_COLS}`)
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .single();
  if (!row) return { error: "교재 요청을 찾을 수 없습니다" };
  // 강사(또는 겸직-강사뷰)는 본인 담당 학생 + **본인 요청**만.
  // 🔴 담당 학생만으로는 부족하다(2026-07-29): 수학·영어를 같이 듣는 학생은 두 강사 모두의 담당이라
  //    영어 강사가 수학 강사의 요청을 수정·삭제할 수 있었다. 소유 판정은 ownsTextbookRequest 단일 소스.
  const tId = await effectiveTeacherId();
  if (tId) {
    const user = await getCurrentUser({ teacherView: true });
    // 본인이 만든 요청(created_by)은 담당 범위 밖 학생이어도 목록에 뜨므로(D5) 여기서도 고칠 수 있어야 한다.
    const studentIds = await textbookRequestStudentIds(tId);
    const createdByViewer = !!row.created_by && row.created_by === user?.id;
    if (!createdByViewer && (!row.student_id || !studentIds.includes(row.student_id)))
      return { error: "담당 학생의 요청만 수정·삭제할 수 있습니다" };
    if (!ownsTextbookRequest(row.teacher_name, user?.displayName, row.created_by, user?.id))
      return { error: `본인이 낸 요청만 수정·삭제할 수 있습니다${row.teacher_name ? ` (이 요청: ${row.teacher_name})` : ""}` };
  }
  // 사무실이 하나라도 처리(등록/주문/납부)했으면 잠금.
  if (row.registered_at || row.ordered_at || row.paid_at) {
    return { error: "사무실에서 처리 중인 요청은 수정·삭제할 수 없습니다" };
  }
  return { ok: true, before: snapshotOf(row as AuditRow) };
}

export async function updateTextbookRequest(_prev: TextbookState, formData: FormData): Promise<TextbookState> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "textbook_requests"))) return { error: "교재 요청 권한이 없습니다" };
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "교재 요청 ID가 누락되었습니다" };
  const f = parse(formData);
  if (!f.bookName) return { fieldErrors: { bookName: "교재명을 입력해주세요" } };

  const supabase = await textbookDb();
  const gate = await loadEditableRequest(supabase, user.tenantId, id);
  if ("error" in gate) return { error: gate.error };

  // 쓰기는 세션 먼저(활동 기록의 행위자) — 강사뷰에서 A의 RLS(0174a)가 0행으로 거르면 관리 클라이언트로(teacher-view-db.ts).
  const { error } = await writeSessionFirst("mutate", (db) => db
    .from("textbook_orders")
    .update({
      book_name: f.bookName,
      book_detail: f.bookDetail,
      notes: f.notes,
      price: f.price, // 미처리(untouched) 요청만 이 경로에 오므로 강사가 금액 정정 가능(폼이 항상 전송)
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", user.tenantId).eq("id", id)
    .select("id"));
  if (error) return { error: explainDbError(error, { scope: "billing.textbookRequest.update", fallback: "교재 요청을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요." }).message };
  const changes = diffTextbookOrder(gate.before, {
    bookName: f.bookName,
    bookDetail: f.bookDetail,
    price: f.price,
    notes: f.notes,
  });
  if (changes.length > 0) {
    const target = textbookAuditTarget({ studentName: gate.before.studentName, bookName: f.bookName });
    await logAction({
      action: "textbook_order_update",
      targetType: "textbook_order",
      targetLabel: target,
      metadata: { orderId: id, target, changes, surface: "request" },
    });
  }
  revalidatePath("/textbook-requests");
  revalidatePath("/billing");
  return { ok: true };
}

export async function deleteTextbookRequest(_prev: TextbookState, formData: FormData): Promise<TextbookState> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "textbook_requests"))) return { error: "교재 요청 권한이 없습니다" };
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "교재 요청 ID가 누락되었습니다" };

  const supabase = await textbookDb();
  const gate = await loadEditableRequest(supabase, user.tenantId, id);
  if ("error" in gate) return { error: gate.error };

  // 🔴 `.select("id")`가 핵심 — PostgREST는 **RLS에 막힌 행을 에러 없이 건너뛴다**(0행 삭제).
  //    예전엔 error만 보고 ok를 돌려줘서, 권한에 막힌 삭제가 "성공했는데 목록은 그대로"로 보였다
  //    (원장 2026-08-03 "삭제가 안 되는 것 같은데"). 지운 행 수를 직접 확인해야 진실을 말할 수 있다.
  // 지운 행의 공지 연결도 함께 돌려받는다 — 발송한 요청이면 같은 요청의 남은 행으로 옮긴다(textbook-notice-handover).
  const { data: gone, error } = await writeSessionFirst("mutate", (db) => db
    .from("textbook_orders")
    .delete()
    .eq("tenant_id", user.tenantId).eq("id", id)
    .select("id, student_id, book_name, request_date, classnote_notice_id"));
  if (error) return { error: explainDbError(error, { scope: "billing.textbookRequest.delete", fallback: "교재 요청을 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.", op: "delete" }).message };
  if (!gone?.length) return { error: DELETE_BLOCKED_MSG };
  const noticeMovedTo = await handOverTextbookNoticeLink(user.tenantId, gone[0]!);
  const deletedTarget = textbookAuditTarget(gate.before);
  await logAction({
    action: "textbook_order_delete",
    targetType: "textbook_order",
    targetLabel: deletedTarget,
    // 지운 뒤엔 행에서 되짚을 수 없다 — 금액까지 남긴다. 발송 연결을 옮겼으면 어디로 옮겼는지도.
    metadata: {
      orderId: id,
      target: deletedTarget,
      price: Number(gate.before.price ?? 0),
      surface: "request",
      noticeId: gone[0]!.classnote_notice_id ?? null,
      noticeMovedTo,
    },
  });
  revalidatePath("/textbook-requests");
  revalidatePath("/billing");
  return { ok: true };
}

export async function updateTextbookOrder(_prev: TextbookState, formData: FormData): Promise<TextbookState> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "billing"))) return { error: "교재 관리 권한이 없습니다" };
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "교재신청 ID가 누락되었습니다" };
  const f = parse(formData);
  if (!f.bookName) return { fieldErrors: { bookName: "교재명을 입력해주세요" } };

  const supabase = await textbookDb();
  const studentName = await resolveStudentName(supabase, user.tenantId, f.studentId);
  // 바꾸기 전 값 — 감사 기록의 '이전' 칸(원장 2026-09-09 "금액 수정같은거 전부 감사로그에").
  const { data: beforeRow } = await supabase
    .from("textbook_orders")
    .select(`created_by, ${AUDIT_COLS}`)
    .eq("tenant_id", user.tenantId).eq("id", id)
    .single();
  // 강사뷰 — DB 규칙(0174a)을 X 기준으로: 강사면 본인 요청만, 바꾼 뒤의 담임 이름도 X의 것(teacherViewParity).
  const parity = await textbookTeacherViewParity(user, (beforeRow as { teacher_name?: string | null; created_by?: string | null } | null) ?? { teacher_name: null, created_by: null }, { teacher_name: f.teacherName });
  if (parity) return { error: parity };
  const before = snapshotOf(beforeRow as AuditRow | null);
  const { error } = await writeSessionFirst("mutate", (db) => db
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
    .eq("tenant_id", user.tenantId).eq("id", id)
    .select("id"));
  if (error) return { error: explainDbError(error, { scope: "billing.textbookOrder.update", fallback: "교재 주문을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요." }).message };

  const changes = diffTextbookOrder(before, {
    studentName,
    teacherName: f.teacherName,
    bookName: f.bookName,
    bookDetail: f.bookDetail,
    price: f.price,
    requestDate: f.requestDate,
    notes: f.notes,
  });
  if (changes.length > 0) {
    const target = textbookAuditTarget({ studentName, bookName: f.bookName });
    await logAction({
      action: "textbook_order_update",
      targetType: "textbook_order",
      targetLabel: target,
      metadata: { orderId: id, target, changes, surface: "billing" },
    });
  }
  revalidatePath("/billing");
  return { ok: true };
}

// 체크 토글(등록/주문/납부) — 해당 타임스탬프를 켜고(now)/끄고(null), 마지막 변경자·시각 기록.
// status는 체크에서 파생: 납부>주문>신청 (등록은 status 무관 = 독립 운영 플래그, ijw와 동일).
export async function toggleTextbookCheck(_prev: TextbookState, formData: FormData): Promise<TextbookState> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "billing"))) return { error: "교재 관리 권한이 없습니다" };
  const id = String(formData.get("id") ?? "").trim();
  const field = String(formData.get("field") ?? "").trim();
  const checked = String(formData.get("checked") ?? "") === "true";
  if (!id) return { error: "교재신청 ID가 누락되었습니다" };
  const col = CHECK_COLS[field];
  if (!col) return { error: "잘못된 체크 항목입니다" };

  const supabase = await textbookDb();
  // 다른 체크 상태가 있어야 status를 재도출 → 현재 행 조회(RLS 격리).
  const { data: row } = await supabase
    .from("textbook_orders")
    .select(`registered_at, ordered_at, paid_at, created_by, ${AUDIT_COLS}`)
    .eq("tenant_id", user.tenantId).eq("id", id)
    .single();
  if (!row) return { error: "교재신청을 찾을 수 없습니다" };
  const parity = await textbookTeacherViewParity(user, row as { teacher_name?: string | null; created_by?: string | null });
  if (parity) return { error: parity };

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

  const { error } = await writeSessionFirst("mutate", (db) => db.from("textbook_orders").update(patch).eq("tenant_id", user.tenantId).eq("id", id).select("id"));
  if (error) return { error: explainDbError(error, { scope: "billing.textbookOrder.check", fallback: "체크를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요." }).message };

  const checkTarget = textbookAuditTarget(snapshotOf(row as AuditRow));
  await logAction({
    action: "textbook_order_check",
    targetType: "textbook_order",
    targetLabel: checkTarget,
    // 체크는 돈이 오간 사실(납부)까지 담는다 — 해제도 같은 무게로 남긴다.
    metadata: {
      orderId: id,
      target: checkTarget,
      field,
      fieldLabel: TEXTBOOK_CHECK_LABEL[field] ?? field,
      checked,
      status,
    },
  });
  revalidatePath("/billing");
  return { ok: true };
}

export async function deleteTextbookOrder(_prev: TextbookState, formData: FormData): Promise<TextbookState> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "billing"))) return { error: "교재 관리 권한이 없습니다" };
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "교재신청 ID가 누락되었습니다" };

  const supabase = await textbookDb();
  // 지우기 전 스냅샷 — 지운 뒤엔 무엇을 지웠는지 되짚을 방법이 없다.
  const { data: beforeRow } = await supabase
    .from("textbook_orders")
    .select(`created_by, ${AUDIT_COLS}`)
    .eq("tenant_id", user.tenantId).eq("id", id)
    .single();
  const parity = await textbookTeacherViewParity(user, (beforeRow as { teacher_name?: string | null; created_by?: string | null } | null) ?? { teacher_name: null, created_by: null });
  if (parity) return { error: parity };
  // 위와 같은 이유로 지운 행 수를 확인한다(0행 = 권한에 막힘, 에러는 안 난다).
  const { data: gone, error } = await writeSessionFirst("mutate", (db) => db
    .from("textbook_orders")
    .delete()
    .eq("tenant_id", user.tenantId).eq("id", id)
    .select("id, student_id, book_name, request_date, classnote_notice_id"));
  if (error) return { error: explainDbError(error, { scope: "billing.textbookOrder.delete", fallback: "교재 주문을 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.", op: "delete" }).message };
  if (!gone?.length) return { error: DELETE_BLOCKED_MSG };

  const noticeMovedTo = await handOverTextbookNoticeLink(user.tenantId, gone[0]!);
  const before = snapshotOf(beforeRow as AuditRow | null);
  const deletedTarget = textbookAuditTarget(before);
  await logAction({
    action: "textbook_order_delete",
    targetType: "textbook_order",
    targetLabel: deletedTarget,
    metadata: {
      orderId: id,
      target: deletedTarget,
      price: Number(before.price ?? 0),
      surface: "billing",
      noticeId: gone[0]!.classnote_notice_id ?? null,
      noticeMovedTo,
    },
  });
  revalidatePath("/billing");
  return { ok: true };
}

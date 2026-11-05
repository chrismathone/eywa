"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser, type CurrentUser } from "@/lib/auth/current-user";
import { logAction } from "@/features/audit/server/log";
import { canAccessTenant, canWriteTenant } from "@/lib/auth/perm-matrix";
import { viewAsTeacher } from "@/lib/auth/view-as";
import { kstToday } from "@/lib/date-kst";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createUploadTicket,
  MEDIA_KIND,
  removeObject,
  resolveTenantReadUrl,
  resolveTenantReadUrls,
  verifyUploadedObject,
} from "@/lib/storage/media-storage";
import type { UploadTicket } from "@/lib/storage/types";
import { normalizeApprovalChecks } from "./expense-queries";
import { expenseWriteScope } from "./expense-scope";
import { DEFAULT_CURRENCY, isValidCurrency, roundMoney } from "../currencies";

const RECEIPTS_BUCKET = "expense-receipts";
const RECEIPT_TYPES = new Set([
  "영수증",
  "세금계산서",
  "견적서",
  "계산서",
  "카드전표",
  "현금영수증",
  "기타",
]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.[A-Za-z0-9]+$/;

// 증빙 파일 경로가 "이 테넌트 + (선택)이 지출"의 단일 객체키인지 검증 — {tenant}/{expenseId}/{file} 3세그먼트만.
// admin(서비스롤)으로 signed URL을 발급/삭제하므로 prefix만 보면 다른 테넌트 객체를 노출할 수 있어 엄격히 검사.
function isTenantReceiptPath(path: string, tenantId: string, expenseId?: string): boolean {
  const parts = path.split("/");
  if (parts.length !== 3) return false;
  const [t, eid, file] = parts;
  if (t !== tenantId || !UUID_RE.test(eid) || !SAFE_FILE_RE.test(file)) return false;
  return expenseId ? eid === expenseId : true;
}

type Receipt = { path: string; name: string };
function parseReceipts(raw: unknown): Receipt[] {
  let arr: unknown = raw;
  if (typeof arr === "string") {
    try {
      arr = JSON.parse(arr);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(arr)) return [];
  return arr
    .map((r) => {
      const o = (r ?? {}) as Record<string, unknown>;
      return {
        path: typeof o.path === "string" ? o.path : "",
        name: typeof o.name === "string" ? o.name : "",
      };
    })
    .filter((r) => r.path);
}

// 지출(expenses) CRUD — invoices의 updateInvoicePayment 골격을 그대로 본뜸
// (getCurrentUser 가드 → FormData 파싱·검증 → supabase(RLS) → revalidatePath). tenant_id는
// RLS가 강제하지만 INSERT엔 명시 필요.
export type ExpenseState =
  | { error?: string; fieldErrors?: Record<string, string>; ok?: boolean }
  | undefined;

const VALID_CATEGORIES = new Set(["인건비", "운영비", "매입", "마케팅", "기타"]);

function won(v: FormDataEntryValue | null): number {
  return Number(String(v ?? "0").replace(/[,\s]/g, "")) || 0;
}

const VALID_ROLES = new Set(["author", "director", "ceo", "executor"]);
// 감사로그에 "누가 어느 칸을 체크/해제했나"를 한글로 남기기 위한 라벨. ⚠️ 화면 쪽 같은 표(expenses-table.tsx
// TOGGLE_ROLES)는 `"use client"` 모듈이라 서버에서 import하면 런타임 undefined다([[#81]]) → 여기 따로 둔다.
const APPROVAL_ROLE_LABEL: Record<string, string> = {
  author: "작성",
  director: "원장",
  ceo: "대표",
  executor: "집행자",
};
const today = () => kstToday();

/**
 * 지출결의서 DB 클라이언트 — 평소엔 세션(RLS 그대로), '다른 강사 뷰'일 때만 관리 클라이언트(원장 2026-11-05 강사뷰 전수).
 * 🔴 DB의 `auth.uid()`는 강사뷰에서도 실제 계정 A다. RLS(expenses_role_gate_*: A의 지출 권한 or `created_by = auth.uid()`)는
 *    A에게 지출 권한이 없으면 대상 X 명의(created_by = X)의 작성과 X 결의서의 수정·증빙 변경을 거절한다.
 * 부르는 쪽은 앱 게이트를 먼저 지난다 — `expenseWriteScope`/`canWriteTenant`(읽기 강사뷰는 여기서 막힌다) + own이면
 * `guardOwnExpense`(X 본인 작성분). 관리 클라이언트는 RLS를 우회하므로 이 파일의 모든 조회·변경은 `tenant_id`를 명시한다.
 */
type ExpenseDb = Awaited<ReturnType<typeof createClient>> | ReturnType<typeof createAdminClient>;
async function expenseDb(): Promise<{ db: ExpenseDb; viaAdmin: boolean }> {
  return (await viewAsTeacher()) ? { db: createAdminClient(), viaAdmin: true } : { db: await createClient(), viaAdmin: false };
}

/**
 * 관리 클라이언트로 읽은 결의서가 행위자(X)에게 보이는 행인가 — RLS `expenses_role_gate_select`(지출 열람 권한 or 본인 작성분)를
 * 앱에서 같은 모양으로. 세션 클라이언트일 때는 RLS가 이미 걸렀으므로 부르지 않는다(viaAdmin일 때만).
 */
async function visibleToActor(row: { created_by?: string | null }, user: CurrentUser): Promise<boolean> {
  return (await canAccessTenant(user.systemRole, "billing")) || row.created_by === user.id;
}

// 지출결의서 쓰기 스코프(full=사무실 전건 / own=강사 본인 것) — 화면과 같은 한 함수(./expense-scope.ts).
// ⚠️ 결재 승인 토글(toggleExpenseApproval)은 이 스코프가 아니라 billing 쓰기만 통과 → 강사가 자기 결의서를 셀프 승인 못 함.

// own 스코프(강사)가 기존 결의서를 수정/삭제/증빙변경할 수 있는지 — 본인 작성분(created_by=본인) + 사무실 결재 착수 전.
// 사무실이 원장/대표 결재를 시작(체크)하면 강사 편집을 잠근다(제출 후 변조 방지). 반환: 에러 메시지(불가) 또는 null(가능).
async function guardOwnExpense(id: string, userId: string, tenantId: string): Promise<string | null> {
  const { db: supabase } = await expenseDb();
  const { data: row } = await supabase
    .from("expenses")
    .select("created_by, approval_checks")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();
  if (!row) return "지출을 찾을 수 없습니다";
  if (row.created_by !== userId) return "본인이 작성한 지출결의서만 수정할 수 있습니다";
  const checks = normalizeApprovalChecks(row.approval_checks);
  if (checks.director?.checked || checks.ceo?.checked) {
    return "사무실 결재가 시작되어 수정할 수 없습니다 — 사무실에 문의하세요.";
  }
  return null;
}

function parse(formData: FormData) {
  const categoryRaw = String(formData.get("category") ?? "기타").trim();
  let lineItems: Array<Record<string, unknown>> | null = null;
  const liRaw = String(formData.get("lineItems") ?? "").trim();
  if (liRaw) {
    try {
      const v = JSON.parse(liRaw);
      lineItems = Array.isArray(v) && v.length > 0 ? v : null;
    } catch {
      lineItems = null;
    }
  }
  // 거래처(vendor)는 라인아이템별로 입력 → 목록/폴백용 top-level vendor는 첫 라인 거래처에서 유도.
  const firstVendor = lineItems?.find((l) => typeof l.vendor === "string" && l.vendor.trim())?.vendor;
  const formVendor = String(formData.get("vendor") ?? "").trim();
  const curRaw = String(formData.get("currency") ?? "").trim();
  const currency = isValidCurrency(curRaw) ? curRaw : DEFAULT_CURRENCY;
  return {
    title: String(formData.get("title") ?? "").trim(),
    category: VALID_CATEGORIES.has(categoryRaw) ? categoryRaw : "기타",
    // 통화 정밀도로 반올림 — 클라가 이미 roundMoney하지만 직접 제출 방어 + numeric(12,2) 정합.
    amount: roundMoney(won(formData.get("amount")), currency),
    currency,
    expenseDate: String(formData.get("expenseDate") ?? "").trim(),
    vendor: (typeof firstVendor === "string" ? firstVendor : formVendor) || null,
    department: String(formData.get("department") ?? "").trim() || null,
    author: String(formData.get("author") ?? "").trim() || null,
    position: String(formData.get("position") ?? "").trim() || null,
    paymentMethod: String(formData.get("paymentMethod") ?? "").trim() || null,
    bankName: String(formData.get("bankName") ?? "").trim() || null,
    accountNumber: String(formData.get("accountNumber") ?? "").trim() || null,
    memo: String(formData.get("memo") ?? "").trim() || null,
    lineItems,
  };
}

function validate(f: ReturnType<typeof parse>): ExpenseState {
  if (!f.title) return { fieldErrors: { title: "항목명을 입력해주세요" } };
  if (!f.expenseDate) return { fieldErrors: { expenseDate: "지출일을 입력해주세요" } };
  // 음수도 받는다(원장 2026-10-26 "지출결의서 값 - 도 되게" — 환급·취소분 · DB에 0 이상 제약 없음 · 옛 자료에도 음수 지출이 있다).
  if (!Number.isFinite(f.amount)) {
    return { fieldErrors: { amount: "숫자만 입력해주세요" } };
  }
  return undefined;
}

export async function createExpense(_prev: ExpenseState, formData: FormData): Promise<ExpenseState> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await expenseWriteScope(user.systemRole))) return { error: "지출결의서 작성 권한이 없습니다" };
  const f = parse(formData);
  const invalid = validate(f);
  if (invalid) return invalid;

  const { db: supabase } = await expenseDb();
  // ⚠️ `.maybeSingle()` — 강사(own)도 자기 행은 select 정책을 통과하지만(0158a: delete/select 조건 동일),
  //    혹시 표현이 안 돌아와도 **저장 성공을 에러로 뒤집지 않게** single()은 쓰지 않는다.
  const { data: created, error } = await supabase
    .from("expenses")
    .insert({
      tenant_id: user.tenantId,
      title: f.title,
      category: f.category,
      amount: f.amount,
      currency: f.currency,
      expense_date: f.expenseDate,
      vendor: f.vendor,
      department: f.department,
      author: f.author ?? user.displayName,
      position: f.position,
      payment_method: f.paymentMethod,
      bank_name: f.bankName,
      account_number: f.accountNumber,
      memo: f.memo,
      line_items: f.lineItems,
      // 작성자 user id — 강사 "본인 것만" 스코프 소스(사무실이 만들어도 기록 = 실제 작성자 추적).
      created_by: user.id,
      // 작성 단계는 저장 즉시 체크(ijw 패리티). 원장/대표/집행자는 목록에서 토글.
      approval_checks: { author: { checked: true, date: today() } },
    })
    .select("id")
    .maybeSingle();
  if (error) return { error: error.message };

  await logAction({
    action: "expense_create",
    targetType: "expense",
    targetLabel: f.title,
    // 🔴 계좌번호(bank_name·account_number)는 담지 않는다 — 계좌는 "누가 무엇을 했나"에 아무것도 더하지
    //    않으면서, 로그가 새는 순간 가장 크게 새는 값이다. (2026-09-09에 감사로그 읽기를 master·super_admin
    //    으로 좁혔지만[0253a] 그건 자물쇠고, 자물쇠가 생겼다고 안 넣어도 될 것을 넣지는 않는다.)
    metadata: {
      expenseId: created?.id ?? null,
      amount: f.amount,
      currency: f.currency,
      category: f.category,
      expenseDate: f.expenseDate,
    },
  });
  revalidatePath("/billing");
  revalidatePath("/expense-requests");
  return { ok: true };
}

export async function updateExpense(_prev: ExpenseState, formData: FormData): Promise<ExpenseState> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" };
  const scope = await expenseWriteScope(user.systemRole);
  if (!scope) return { error: "지출 관리 권한이 없습니다" };
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "지출 ID가 누락되었습니다" };
  // 강사(own)는 본인 작성분 + 사무실 결재 착수 전만 수정 가능. 사무실(full)은 전건.
  if (scope === "own") {
    const denied = await guardOwnExpense(id, user.id, user.tenantId);
    if (denied) return { error: denied };
  }
  const f = parse(formData);
  const invalid = validate(f);
  if (invalid) return invalid;

  const { db: supabase } = await expenseDb();
  // 감사로그용 이전값 — 금액이 언제 얼마에서 얼마로 바뀌었는지가 "왜 다른가"의 답이다(교재 신청 감사와 같은 결).
  const { data: before } = await supabase
    .from("expenses")
    .select("title, amount, currency, category, expense_date")
    .eq("tenant_id", user.tenantId).eq("id", id)
    .maybeSingle();
  const { error } = await supabase
    .from("expenses")
    .update({
      title: f.title,
      // 작성자를 비우고 저장해도 기존 값 보존(실수로 null 덮어쓰기 방지). 비어있지 않을 때만 갱신.
      ...(f.author ? { author: f.author } : {}),
      category: f.category,
      amount: f.amount,
      currency: f.currency,
      expense_date: f.expenseDate,
      vendor: f.vendor,
      department: f.department,
      position: f.position,
      payment_method: f.paymentMethod,
      bank_name: f.bankName,
      account_number: f.accountNumber,
      memo: f.memo,
      line_items: f.lineItems,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", user.tenantId).eq("id", id);
  if (error) return { error: error.message };

  await logAction({
    action: "expense_update",
    targetType: "expense",
    targetLabel: f.title,
    metadata: {
      expenseId: id,
      amount: f.amount,
      currency: f.currency,
      category: f.category,
      expenseDate: f.expenseDate,
      // 이전값은 **바뀐 것만** — 안 바뀐 칸까지 실으면 진짜 변경이 묻힌다.
      ...(before && Number(before.amount) !== f.amount ? { amountBefore: Number(before.amount) } : {}),
      ...(before && before.title !== f.title ? { titleBefore: before.title } : {}),
      ...(before && before.category !== f.category ? { categoryBefore: before.category } : {}),
      ...(before && before.expense_date !== f.expenseDate ? { expenseDateBefore: before.expense_date } : {}),
    },
  });
  revalidatePath("/billing");
  revalidatePath("/expense-requests");
  return { ok: true };
}

export async function deleteExpense(_prev: ExpenseState, formData: FormData): Promise<ExpenseState> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" };
  const scope = await expenseWriteScope(user.systemRole);
  if (!scope) return { error: "지출 관리 권한이 없습니다" };
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "지출 ID가 누락되었습니다" };
  // 강사(own)는 본인 작성분 + 사무실 결재 착수 전만 삭제 가능. 사무실(full)은 전건.
  if (scope === "own") {
    const denied = await guardOwnExpense(id, user.id, user.tenantId);
    if (denied) return { error: denied };
  }

  const { db: supabase } = await expenseDb();
  // 첨부 증빙 파일도 함께 정리(고아 객체 방지) — RLS로 같은 테넌트 행만 읽힌다.
  // 🔴 제목·금액도 **여기서** 읽는다 — 지운 뒤엔 행에서 되짚을 수 없다(textbook_order_delete와 같은 규약).
  const { data: row } = await supabase
    .from("expenses")
    .select("receipt_urls, title, amount, currency, category, expense_date")
    .eq("tenant_id", user.tenantId).eq("id", id)
    .maybeSingle();
  const paths = parseReceipts(row?.receipt_urls)
    .map((r) => r.path)
    .filter((p) => isTenantReceiptPath(p, user.tenantId, id));
  for (const p of paths) {
    await removeObject(p, { bucket: RECEIPTS_BUCKET }).catch(() => {});
  }

  // `.select("id")` = 실제로 지워진 행 확인. RLS에 막히면 PostgREST가 **에러 없이 0행**을 지운다 —
  // 그때 로그를 남기면 감사로그가 일어나지 않은 삭제를 사실로 적는다(안 지워졌으면 기록도 안 남긴다).
  const { data: gone, error } = await supabase.from("expenses").delete().eq("tenant_id", user.tenantId).eq("id", id).select("id");
  if (error) return { error: error.message };

  if (gone?.length) {
    await logAction({
      action: "expense_delete",
      targetType: "expense",
      targetLabel: row?.title ?? null,
      // 삭제는 되짚을 원본이 없다 — 금액·증빙 수까지 남긴다(계좌번호는 여전히 제외).
      metadata: {
        expenseId: id,
        amount: Number(row?.amount ?? 0),
        currency: row?.currency ?? null,
        category: row?.category ?? null,
        expenseDate: row?.expense_date ?? null,
        receiptsRemoved: paths.length,
      },
    });
  }
  revalidatePath("/billing");
  revalidatePath("/expense-requests");
  return { ok: true };
}

// 결재 단계 토글(작성/원장/대표/집행자) — ijw approvalChecks 패리티. 기존 jsonb를 읽어 merge 후 갱신하고,
// approval_status는 (원장 && 대표) 결재 시 approved로 파생(문서 결재완료 배지·요약 일관). 권한은 페이지의
// requireAccess("billing")가 이미 게이트(aywa엔 expenseRole 개념 없음 → billing 쓰기 가능자면 토글 가능).
export async function toggleExpenseApproval(
  _prev: ExpenseState,
  formData: FormData,
): Promise<ExpenseState> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "billing"))) return { error: "지출 관리 권한이 없습니다" };
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "지출 ID가 누락되었습니다" };
  const role = String(formData.get("role") ?? "").trim();
  if (!VALID_ROLES.has(role)) return { error: "잘못된 결재 역할입니다" };
  const checked = String(formData.get("checked") ?? "") === "true";

  const { db: supabase } = await expenseDb();
  const { data: row, error: readErr } = await supabase
    .from("expenses")
    .select("approval_checks, title") // title = 감사로그 '대상' 라벨(같은 왕복에서 함께 읽는다)
    .eq("tenant_id", user.tenantId).eq("id", id)
    .maybeSingle();
  if (readErr) return { error: readErr.message };
  if (!row) return { error: "지출을 찾을 수 없습니다" };
  const title = row.title as string | null;

  // 기존 결재 상태를 정규화(문자열 이중 인코딩 파싱 + 유효 역할만)해 merge — 잡키·문자열 오염 방지.
  const base = normalizeApprovalChecks(row.approval_checks);
  base[role as keyof typeof base] = checked ? { checked: true, date: today() } : { checked: false };
  const approvalStatus = base.director?.checked && base.ceo?.checked ? "approved" : "pending";

  const { error } = await supabase
    .from("expenses")
    .update({ approval_checks: base, approval_status: approvalStatus, updated_at: new Date().toISOString() })
    .eq("tenant_id", user.tenantId).eq("id", id);
  if (error) return { error: error.message };

  // 🔴 **방향을 반드시 남긴다** — "누가 결재를 눌렀나"만큼 "누가 해제했나"가 중요하다(해제는 이미 승인된
  //    지출을 되돌리는 행위라, 방향 없이 "결재 변경"만 남기면 역검수에서 둘을 구분할 수 없다).
  await logAction({
    action: "expense_approval",
    targetType: "expense",
    targetLabel: title ?? null,
    metadata: {
      expenseId: id,
      role,
      roleLabel: APPROVAL_ROLE_LABEL[role] ?? role,
      checked,
      direction: checked ? "승인" : "해제",
      approvalStatus,
    },
  });
  revalidatePath("/billing");
  return { ok: true };
}

// 복제(duplicate) — 기존 결의서를 새 결의서로. 날짜=오늘, 작성자=현재 사용자, 결재 체크는 작성만(원장/대표/집행자
// 초기화), 제목·항목·메모·정산정보는 그대로. ijw "매월 반복 결의서 빠른 입력" 패리티.
export async function duplicateExpense(_prev: ExpenseState, formData: FormData): Promise<ExpenseState> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" };
  const scope = await expenseWriteScope(user.systemRole);
  if (!scope) return { error: "지출 관리 권한이 없습니다" };
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "지출 ID가 누락되었습니다" };

  const { db: supabase } = await expenseDb();
  const { data: src, error: readErr } = await supabase
    .from("expenses")
    .select(
      "title, category, amount, currency, vendor, department, payment_method, bank_name, account_number, memo, line_items, created_by",
    )
    .eq("tenant_id", user.tenantId).eq("id", id)
    .maybeSingle();
  if (readErr) return { error: readErr.message };
  if (!src) return { error: "원본 지출을 찾을 수 없습니다" };
  // 강사(own)는 본인이 작성한 결의서만 복제 가능(타인 결의서 열람·복제 차단).
  if (scope === "own" && src.created_by !== user.id) {
    return { error: "본인이 작성한 지출결의서만 복제할 수 있습니다" };
  }

  const { data: created, error } = await supabase
    .from("expenses")
    .insert({
      tenant_id: user.tenantId,
      title: src.title,
      category: src.category,
      amount: src.amount,
      currency: src.currency ?? DEFAULT_CURRENCY,
      expense_date: today(),
      vendor: src.vendor,
      department: src.department,
      author: user.displayName,
      position: null,
      payment_method: src.payment_method,
      bank_name: src.bank_name,
      account_number: src.account_number,
      memo: src.memo,
      line_items: src.line_items,
      created_by: user.id,
      approval_status: "pending",
      approval_checks: { author: { checked: true, date: today() } },
    })
    .select("id")
    .maybeSingle();
  if (error) return { error: error.message };

  // 복제는 **같은 금액의 지출이 하나 더 생기는** 일이라 create와 갈라 둔다 — 중복 지출을 되짚을 때
  // "새로 쓴 것"과 "복제한 것"이 구분돼야 하고, 원본 id(sourceId)가 그 대조의 유일한 실마리다.
  await logAction({
    action: "expense_duplicate",
    targetType: "expense",
    targetLabel: src.title as string | null,
    metadata: {
      expenseId: created?.id ?? null,
      sourceId: id,
      amount: Number(src.amount ?? 0),
      currency: src.currency ?? DEFAULT_CURRENCY,
      category: src.category ?? null,
      expenseDate: today(),
    },
  });
  revalidatePath("/billing");
  revalidatePath("/expense-requests");
  return { ok: true };
}

// ── 증빙(증빙유형 + 첨부파일) ──────────────────────────────────────────────
// 증빙 유형 설정(영수증/세금계산서 등). 빈 값이면 해제(null).
export async function setExpenseReceiptType(
  _prev: ExpenseState,
  formData: FormData,
): Promise<ExpenseState> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" };
  const scope = await expenseWriteScope(user.systemRole);
  if (!scope) return { error: "지출 관리 권한이 없습니다" };
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "지출 ID가 누락되었습니다" };
  if (scope === "own") {
    const denied = await guardOwnExpense(id, user.id, user.tenantId);
    if (denied) return { error: denied };
  }
  const type = String(formData.get("receiptType") ?? "").trim();
  if (type && !RECEIPT_TYPES.has(type)) return { error: "잘못된 증빙 유형입니다" };

  const { db: supabase } = await expenseDb();
  const { error } = await supabase
    .from("expenses")
    .update({ receipt_type: type || null, updated_at: new Date().toISOString() })
    .eq("tenant_id", user.tenantId).eq("id", id);
  if (error) return { error: error.message };

  await logAction({
    action: "expense_receipt_type",
    targetType: "expense",
    metadata: { expenseId: id, receiptType: type || null },
  });
  revalidatePath("/billing");
  revalidatePath("/expense-requests");
  return { ok: true };
}

// 증빙 업로드 티켓 발급 — billing 권한 + expense 소유(내 테넌트) + 형식·크기 검증 후 signed 업로드 URL.
export type IssueReceiptTicketState = { ticket?: UploadTicket; error?: string } | undefined;
export async function issueReceiptUploadTicket(
  _prev: IssueReceiptTicketState,
  formData: FormData,
): Promise<IssueReceiptTicketState> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" };
  const scope = await expenseWriteScope(user.systemRole);
  if (!scope) return { error: "지출 관리 권한이 없습니다" };

  const expenseId = String(formData.get("expenseId") ?? "").trim();
  if (!UUID_RE.test(expenseId)) return { error: "잘못된 지출 ID입니다" };
  // 강사(own)는 본인 작성분 + 결재 착수 전만 증빙 첨부 가능.
  if (scope === "own") {
    const denied = await guardOwnExpense(expenseId, user.id, user.tenantId);
    if (denied) return { error: denied };
  }
  // 소유 확인 — RLS 스코프로 내 테넌트의 expense인지.
  const { db: supabase } = await expenseDb();
  const { data: exp } = await supabase.from("expenses").select("id").eq("tenant_id", user.tenantId).eq("id", expenseId).maybeSingle();
  if (!exp) return { error: "지출을 찾을 수 없습니다" };

  const contentType = String(formData.get("contentType") ?? "");
  if (!MEDIA_KIND.receipt.allowCT(contentType)) return { error: "이미지 또는 PDF만 첨부할 수 있습니다" };
  const size = Number(formData.get("size") ?? 0);
  if (!Number.isFinite(size) || size <= 0 || size > MEDIA_KIND.receipt.maxBytes) {
    return { error: "파일이 너무 큽니다 (최대 10MB)" };
  }
  const ext = String(formData.get("ext") ?? "").toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
  const path = `${user.tenantId}/${expenseId}/${crypto.randomUUID()}.${ext}`;
  if (!isTenantReceiptPath(path, user.tenantId, expenseId)) return { error: "경로 생성 실패" };

  try {
    return { ticket: await createUploadTicket({ kind: "receipt", path, contentType }) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "업로드 티켓 발급 실패" };
  }
}

// 첨부 등록 — 클라가 ticket으로 업로드한 객체를 검증(exists·size·CT)한 뒤 DB에 경로 등록.
export async function addExpenseReceipt(
  _prev: ExpenseState,
  formData: FormData,
): Promise<ExpenseState> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" };
  const scope = await expenseWriteScope(user.systemRole);
  if (!scope) return { error: "지출 관리 권한이 없습니다" };
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "지출 ID가 누락되었습니다" };
  if (scope === "own") {
    const denied = await guardOwnExpense(id, user.id, user.tenantId);
    if (denied) return { error: denied };
  }
  const path = String(formData.get("path") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  if (!isTenantReceiptPath(path, user.tenantId, id)) return { error: "파일 경로가 잘못되었습니다" };

  // 업로드 객체 검증 — 위반/부재면 객체 cleanup(서버측, GCS는 클라가 못 지움) 후 에러.
  try {
    await verifyUploadedObject("receipt", path);
  } catch (e) {
    await removeObject(path, { bucket: RECEIPTS_BUCKET }).catch(() => {});
    return { error: e instanceof Error ? e.message : "첨부 검증 실패" };
  }

  const { db: supabase } = await expenseDb();
  const { data: row } = await supabase.from("expenses").select("receipt_urls").eq("tenant_id", user.tenantId).eq("id", id).maybeSingle();
  if (!row) {
    await removeObject(path, { bucket: RECEIPTS_BUCKET }).catch(() => {});
    return { error: "지출을 찾을 수 없습니다" };
  }
  const list = parseReceipts(row.receipt_urls);
  if (!list.some((r) => r.path === path)) {
    list.push({ path, name: name || path.split("/").pop() || path });
  }
  const { error } = await supabase
    .from("expenses")
    .update({ receipt_urls: list, updated_at: new Date().toISOString() })
    .eq("tenant_id", user.tenantId).eq("id", id);
  if (error) {
    await removeObject(path, { bucket: RECEIPTS_BUCKET }).catch(() => {});
    return { error: error.message };
  }

  await logAction({
    action: "expense_receipt_add",
    targetType: "expense",
    // 파일 이름은 남기되 경로(테넌트/지출/uuid)는 남기지 않는다 — 감사로그를 읽는 사람이 알아야 할 건 "무엇이 붙었나"다.
    metadata: { expenseId: id, fileName: name || path.split("/").pop() || null, receiptCount: list.length },
  });
  revalidatePath("/billing");
  revalidatePath("/expense-requests");
  return { ok: true };
}

// 첨부 삭제 — DB 목록에서 제거 + Storage 객체 삭제(admin).
export async function removeExpenseReceipt(
  _prev: ExpenseState,
  formData: FormData,
): Promise<ExpenseState> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" };
  const scope = await expenseWriteScope(user.systemRole);
  if (!scope) return { error: "지출 관리 권한이 없습니다" };
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "지출 ID가 누락되었습니다" };
  if (scope === "own") {
    const denied = await guardOwnExpense(id, user.id, user.tenantId);
    if (denied) return { error: denied };
  }
  const path = String(formData.get("path") ?? "").trim();
  // 레거시 http(s) 증빙(ijw Firebase URL)은 우리 스토리지 객체가 아니라 목록에서만 제거(경로검증·객체삭제 건너뜀).
  const isLegacy = /^https?:\/\//i.test(path);
  if (!isLegacy && !isTenantReceiptPath(path, user.tenantId, id)) return { error: "파일 경로가 잘못되었습니다" };

  const { db: supabase } = await expenseDb();
  const { data: row } = await supabase.from("expenses").select("receipt_urls").eq("tenant_id", user.tenantId).eq("id", id).maybeSingle();
  if (!row) return { error: "지출을 찾을 수 없습니다" };
  const current = parseReceipts(row.receipt_urls);
  const removed = current.find((r) => r.path === path); // 감사로그에 남길 파일 이름(지운 뒤엔 못 읽는다)
  const list = current.filter((r) => r.path !== path);
  const { error } = await supabase
    .from("expenses")
    .update({ receipt_urls: list, updated_at: new Date().toISOString() })
    .eq("tenant_id", user.tenantId).eq("id", id);
  if (error) return { error: error.message };

  if (!isLegacy) await removeObject(path, { bucket: RECEIPTS_BUCKET }).catch(() => {});

  // 🔴 증빙 삭제는 **되돌릴 수 없다**(스토리지 객체까지 지운다) — "영수증이 언제 사라졌나"의 유일한 답이다.
  await logAction({
    action: "expense_receipt_remove",
    targetType: "expense",
    metadata: {
      expenseId: id,
      fileName: removed?.name || path.split("/").pop() || null,
      legacy: isLegacy,
      receiptCount: list.length,
    },
  });
  revalidatePath("/billing");
  revalidatePath("/expense-requests");
  return { ok: true };
}

// 비공개 버킷 — 열람용 단기 signed URL 발급(5분). 경로 테넌트 검증 후 admin으로 서명.
export type SignReceiptState = { url?: string; error?: string } | undefined;
// 첨부 썸네일용 — 한 지출의 등록된 모든 첨부를 한 번에 서명(round-trip 1회). RLS로 그 지출이 내
// 테넌트인지 확인 후 admin이 일괄 서명(createSignedUrls). path→url 맵 반환(이미지 미리보기에 사용).
export type SignReceiptsState = { urls?: Record<string, string>; error?: string } | undefined;
export async function signExpenseReceipts(
  _prev: SignReceiptsState,
  formData: FormData,
): Promise<SignReceiptsState> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" };
  const expenseId = String(formData.get("id") ?? "").trim();
  if (!expenseId) return { error: "지출 ID가 누락되었습니다" };

  const { db: supabase, viaAdmin } = await expenseDb();
  const { data: row } = await supabase
    .from("expenses")
    .select("receipt_urls, created_by")
    .eq("tenant_id", user.tenantId).eq("id", expenseId)
    .maybeSingle();
  if (!row) return { error: "지출을 찾을 수 없습니다" };
  // 강사뷰(관리 클라이언트)면 RLS 대신 같은 규칙을 앱에서 — X가 못 보는 결의서의 증빙은 서명하지 않는다.
  if (viaAdmin && !(await visibleToActor(row, user))) return { error: "지출을 찾을 수 없습니다" };

  // 레거시 http(s) 증빙(ijw Firebase 다운로드 URL)은 이미 공개 토큰 URL이라 그대로 통과(서명 불필요),
  // 테넌트 스토리지 경로만 서명(임의 객체 서명 차단). 깨진 경로는 조용히 제외.
  const out: Record<string, string> = {};
  const tenantPaths: string[] = [];
  for (const r of parseReceipts(row.receipt_urls)) {
    if (/^https?:\/\//i.test(r.path)) out[r.path] = r.path;
    else if (isTenantReceiptPath(r.path, user.tenantId, expenseId)) tenantPaths.push(r.path);
  }
  if (tenantPaths.length > 0) {
    Object.assign(out, await resolveTenantReadUrls(tenantPaths, "receipt", user.tenantId, 10 * 60 * 1000));
  }
  return { urls: out };
}

export async function signExpenseReceipt(
  _prev: SignReceiptState,
  formData: FormData,
): Promise<SignReceiptState> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" };
  const path = String(formData.get("path") ?? "").trim();
  if (!isTenantReceiptPath(path, user.tenantId)) return { error: "파일 경로가 잘못되었습니다" };

  // 방어심층: admin(서비스롤)이 RLS를 우회해 서명하므로, 경로 형식만 믿지 말고 그 expense에 **실제 등록된**
  // 첨부인지 RLS 스코프 조회로 확인(임의/열거 경로 서명 차단). 경로의 2번째 세그먼트 = expense id.
  const expenseId = path.split("/")[1];
  const { db: supabase, viaAdmin } = await expenseDb();
  const { data: row } = await supabase
    .from("expenses")
    .select("receipt_urls, created_by")
    .eq("tenant_id", user.tenantId).eq("id", expenseId)
    .maybeSingle();
  if (!row) return { error: "지출을 찾을 수 없습니다" };
  // 강사뷰(관리 클라이언트)면 RLS 대신 같은 규칙을 앱에서 — X가 못 보는 결의서의 증빙은 서명하지 않는다.
  if (viaAdmin && !(await visibleToActor(row, user))) return { error: "지출을 찾을 수 없습니다" };
  if (!parseReceipts(row.receipt_urls).some((r) => r.path === path)) {
    return { error: "등록되지 않은 파일입니다" };
  }

  try {
    return { url: await resolveTenantReadUrl(path, "receipt", user.tenantId, 5 * 60 * 1000) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "signed URL 생성 실패" };
  }
}

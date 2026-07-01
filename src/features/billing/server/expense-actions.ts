"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { accessLevelTenant, canWriteTenant } from "@/lib/auth/perm-matrix";
import { kstToday } from "@/lib/date-kst";
import { createClient } from "@/lib/supabase/server";
import {
  createUploadTicket,
  getMediaBackend,
  MEDIA_KIND,
  removeObject,
  resolveTenantReadUrl,
  resolveTenantReadUrls,
  verifyUploadedObject,
} from "@/lib/storage/media-storage";
import type { UploadTicket } from "@/lib/storage/types";
import { normalizeApprovalChecks } from "./expense-queries";
import { DEFAULT_CURRENCY, isValidCurrency } from "../currencies";

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
const today = () => kstToday();

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
  return {
    title: String(formData.get("title") ?? "").trim(),
    category: VALID_CATEGORIES.has(categoryRaw) ? categoryRaw : "기타",
    amount: won(formData.get("amount")),
    currency: isValidCurrency(curRaw) ? curRaw : DEFAULT_CURRENCY,
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
  if (!Number.isFinite(f.amount) || f.amount < 0) {
    return { fieldErrors: { amount: "0 이상 숫자만 입력해주세요" } };
  }
  return undefined;
}

export async function createExpense(_prev: ExpenseState, formData: FormData): Promise<ExpenseState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "billing"))) return { error: "지출 관리 권한이 없습니다" };
  const f = parse(formData);
  const invalid = validate(f);
  if (invalid) return invalid;

  const supabase = await createClient();
  const { error } = await supabase.from("expenses").insert({
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
    // 작성 단계는 저장 즉시 체크(ijw 패리티). 원장/대표/집행자는 목록에서 토글.
    approval_checks: { author: { checked: true, date: today() } },
  });
  if (error) return { error: error.message };

  revalidatePath("/billing");
  return { ok: true };
}

export async function updateExpense(_prev: ExpenseState, formData: FormData): Promise<ExpenseState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "billing"))) return { error: "지출 관리 권한이 없습니다" };
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "지출 ID가 누락되었습니다" };
  const f = parse(formData);
  const invalid = validate(f);
  if (invalid) return invalid;

  const supabase = await createClient();
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
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/billing");
  return { ok: true };
}

export async function deleteExpense(_prev: ExpenseState, formData: FormData): Promise<ExpenseState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "billing"))) return { error: "지출 관리 권한이 없습니다" };
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "지출 ID가 누락되었습니다" };

  const supabase = await createClient();
  // 첨부 증빙 파일도 함께 정리(고아 객체 방지) — RLS로 같은 테넌트 행만 읽힌다.
  const { data: row } = await supabase.from("expenses").select("receipt_urls").eq("id", id).maybeSingle();
  const paths = parseReceipts(row?.receipt_urls)
    .map((r) => r.path)
    .filter((p) => isTenantReceiptPath(p, user.tenantId, id));
  const backend = getMediaBackend();
  for (const p of paths) {
    await removeObject(p, { backend, bucket: RECEIPTS_BUCKET }).catch(() => {});
  }

  const { error } = await supabase.from("expenses").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/billing");
  return { ok: true };
}

// 결재 단계 토글(작성/원장/대표/집행자) — ijw approvalChecks 패리티. 기존 jsonb를 읽어 merge 후 갱신하고,
// approval_status는 (원장 && 대표) 결재 시 approved로 파생(문서 결재완료 배지·요약 일관). 권한은 페이지의
// requireAccess("billing")가 이미 게이트(eywa엔 expenseRole 개념 없음 → billing 쓰기 가능자면 토글 가능).
export async function toggleExpenseApproval(
  _prev: ExpenseState,
  formData: FormData,
): Promise<ExpenseState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "billing"))) return { error: "지출 관리 권한이 없습니다" };
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "지출 ID가 누락되었습니다" };
  const role = String(formData.get("role") ?? "").trim();
  if (!VALID_ROLES.has(role)) return { error: "잘못된 결재 역할입니다" };
  const checked = String(formData.get("checked") ?? "") === "true";

  const supabase = await createClient();
  const { data: row, error: readErr } = await supabase
    .from("expenses")
    .select("approval_checks")
    .eq("id", id)
    .maybeSingle();
  if (readErr) return { error: readErr.message };
  if (!row) return { error: "지출을 찾을 수 없습니다" };

  // 기존 결재 상태를 정규화(문자열 이중 인코딩 파싱 + 유효 역할만)해 merge — 잡키·문자열 오염 방지.
  const base = normalizeApprovalChecks(row.approval_checks);
  base[role as keyof typeof base] = checked ? { checked: true, date: today() } : { checked: false };
  const approvalStatus = base.director?.checked && base.ceo?.checked ? "approved" : "pending";

  const { error } = await supabase
    .from("expenses")
    .update({ approval_checks: base, approval_status: approvalStatus, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/billing");
  return { ok: true };
}

// 복제(duplicate) — 기존 결의서를 새 결의서로. 날짜=오늘, 작성자=현재 사용자, 결재 체크는 작성만(원장/대표/집행자
// 초기화), 제목·항목·메모·정산정보는 그대로. ijw "매월 반복 결의서 빠른 입력" 패리티.
export async function duplicateExpense(_prev: ExpenseState, formData: FormData): Promise<ExpenseState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "billing"))) return { error: "지출 관리 권한이 없습니다" };
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "지출 ID가 누락되었습니다" };

  const supabase = await createClient();
  const { data: src, error: readErr } = await supabase
    .from("expenses")
    .select(
      "title, category, amount, currency, vendor, department, payment_method, bank_name, account_number, memo, line_items",
    )
    .eq("id", id)
    .maybeSingle();
  if (readErr) return { error: readErr.message };
  if (!src) return { error: "원본 지출을 찾을 수 없습니다" };

  const { error } = await supabase.from("expenses").insert({
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
    approval_status: "pending",
    approval_checks: { author: { checked: true, date: today() } },
  });
  if (error) return { error: error.message };

  revalidatePath("/billing");
  return { ok: true };
}

// ── 증빙(증빙유형 + 첨부파일) ──────────────────────────────────────────────
// 증빙 유형 설정(영수증/세금계산서 등). 빈 값이면 해제(null).
export async function setExpenseReceiptType(
  _prev: ExpenseState,
  formData: FormData,
): Promise<ExpenseState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "billing"))) return { error: "지출 관리 권한이 없습니다" };
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "지출 ID가 누락되었습니다" };
  const type = String(formData.get("receiptType") ?? "").trim();
  if (type && !RECEIPT_TYPES.has(type)) return { error: "잘못된 증빙 유형입니다" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("expenses")
    .update({ receipt_type: type || null, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/billing");
  return { ok: true };
}

// 증빙 업로드 티켓 발급 — billing 권한 + expense 소유(내 테넌트) + 형식·크기 검증 후 signed 업로드 URL.
export type IssueReceiptTicketState = { ticket?: UploadTicket; error?: string } | undefined;
export async function issueReceiptUploadTicket(
  _prev: IssueReceiptTicketState,
  formData: FormData,
): Promise<IssueReceiptTicketState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  const lvl = await accessLevelTenant(user.systemRole, "billing");
  if (lvl !== "full" && lvl !== "scoped") return { error: "지출 관리 권한이 없습니다" };

  const expenseId = String(formData.get("expenseId") ?? "").trim();
  if (!UUID_RE.test(expenseId)) return { error: "잘못된 지출 ID입니다" };
  // 소유 확인 — RLS 스코프로 내 테넌트의 expense인지.
  const supabase = await createClient();
  const { data: exp } = await supabase.from("expenses").select("id").eq("id", expenseId).maybeSingle();
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
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "billing"))) return { error: "지출 관리 권한이 없습니다" };
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "지출 ID가 누락되었습니다" };
  const path = String(formData.get("path") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  if (!isTenantReceiptPath(path, user.tenantId, id)) return { error: "파일 경로가 잘못되었습니다" };

  // 업로드 객체 검증 — 위반/부재면 객체 cleanup(서버측, GCS는 클라가 못 지움) 후 에러.
  try {
    await verifyUploadedObject("receipt", path);
  } catch (e) {
    await removeObject(path, { backend: getMediaBackend(), bucket: RECEIPTS_BUCKET }).catch(() => {});
    return { error: e instanceof Error ? e.message : "첨부 검증 실패" };
  }

  const supabase = await createClient();
  const { data: row } = await supabase.from("expenses").select("receipt_urls").eq("id", id).maybeSingle();
  if (!row) {
    await removeObject(path, { backend: getMediaBackend(), bucket: RECEIPTS_BUCKET }).catch(() => {});
    return { error: "지출을 찾을 수 없습니다" };
  }
  const list = parseReceipts(row.receipt_urls);
  if (!list.some((r) => r.path === path)) {
    list.push({ path, name: name || path.split("/").pop() || path });
  }
  const { error } = await supabase
    .from("expenses")
    .update({ receipt_urls: list, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    await removeObject(path, { backend: getMediaBackend(), bucket: RECEIPTS_BUCKET }).catch(() => {});
    return { error: error.message };
  }

  revalidatePath("/billing");
  return { ok: true };
}

// 첨부 삭제 — DB 목록에서 제거 + Storage 객체 삭제(admin).
export async function removeExpenseReceipt(
  _prev: ExpenseState,
  formData: FormData,
): Promise<ExpenseState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "billing"))) return { error: "지출 관리 권한이 없습니다" };
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "지출 ID가 누락되었습니다" };
  const path = String(formData.get("path") ?? "").trim();
  // 레거시 http(s) 증빙(ijw Firebase URL)은 우리 스토리지 객체가 아니라 목록에서만 제거(경로검증·객체삭제 건너뜀).
  const isLegacy = /^https?:\/\//i.test(path);
  if (!isLegacy && !isTenantReceiptPath(path, user.tenantId, id)) return { error: "파일 경로가 잘못되었습니다" };

  const supabase = await createClient();
  const { data: row } = await supabase.from("expenses").select("receipt_urls").eq("id", id).maybeSingle();
  if (!row) return { error: "지출을 찾을 수 없습니다" };
  const list = parseReceipts(row.receipt_urls).filter((r) => r.path !== path);
  const { error } = await supabase
    .from("expenses")
    .update({ receipt_urls: list, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };

  if (!isLegacy) await removeObject(path, { backend: getMediaBackend(), bucket: RECEIPTS_BUCKET }).catch(() => {});

  revalidatePath("/billing");
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
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  const expenseId = String(formData.get("id") ?? "").trim();
  if (!expenseId) return { error: "지출 ID가 누락되었습니다" };

  const supabase = await createClient();
  const { data: row } = await supabase
    .from("expenses")
    .select("receipt_urls")
    .eq("id", expenseId)
    .maybeSingle();
  if (!row) return { error: "지출을 찾을 수 없습니다" };

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
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  const path = String(formData.get("path") ?? "").trim();
  if (!isTenantReceiptPath(path, user.tenantId)) return { error: "파일 경로가 잘못되었습니다" };

  // 방어심층: admin(서비스롤)이 RLS를 우회해 서명하므로, 경로 형식만 믿지 말고 그 expense에 **실제 등록된**
  // 첨부인지 RLS 스코프 조회로 확인(임의/열거 경로 서명 차단). 경로의 2번째 세그먼트 = expense id.
  const expenseId = path.split("/")[1];
  const supabase = await createClient();
  const { data: row } = await supabase
    .from("expenses")
    .select("receipt_urls")
    .eq("id", expenseId)
    .maybeSingle();
  if (!row) return { error: "지출을 찾을 수 없습니다" };
  if (!parseReceipts(row.receipt_urls).some((r) => r.path === path)) {
    return { error: "등록되지 않은 파일입니다" };
  }

  try {
    return { url: await resolveTenantReadUrl(path, "receipt", user.tenantId, 5 * 60 * 1000) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "signed URL 생성 실패" };
  }
}

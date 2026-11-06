"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { isCurrentUserSuperAdmin } from "@/lib/auth/super-admin";
import { viewAsTeacher } from "@/lib/auth/view-as";
import { createAdminClient } from "@/lib/supabase/admin";
import { humanizeDbError } from "@/lib/supabase/db-error";
import { kstToday } from "@/lib/date-kst";
import { logAction } from "@/features/audit/server/log";
import { notifyUsers } from "@/features/notifications/server/notify";
import { leavePeriodLabel, resolveLeavePeriod } from "@/features/leave/accrual";
import { applyLeaveGrantOverride } from "@/features/leave/test-grants";
import { getTenantSettings } from "@/features/owner/server/queries";
import { isChinsanTenant } from "@/features/owner/preset";
import {
  countLeaveDays,
  formatLeaveDays,
  isLeaveKind,
  validateLeaveRange,
  type LeaveKind,
} from "@/features/leave/request-days";
import { formatSignedDays, grantedTotal, remainingDays } from "@/features/leave/balance";
import { sanitizeRichHtml } from "@/lib/html/sanitize";
import { nextDocNo } from "../doc-no";
import { normalizeLine, normalizeRefs, validateApprovalLine } from "../line";
import { isMissingRelation } from "./queries";
// 잔여 산식은 한 곳에서만 — 조정(0252a)이 붙은 뒤로 "화면은 18일인데 기안은 15일까지"가 생기지 않게
// 부여·사용 조회를 직원관리 '연차 관리' 화면과 **같은 함수**로 공유한다.
import { adjustmentDaysFor, reservedLeaveDays } from "@/features/leave/server/admin";
import {
  APPROVAL_FORM_LABEL,
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  stepRoleLabels,
  type ApprovalForm,
} from "../types";

/**
 * 전자결재 쓰기 — 기안·결재·회수.
 *
 * 🔴 **쓰기는 모두 여기서만** — 0213a는 authenticated 쓰기 정책을 두지 않았다(RLS는 읽기 격리 전용).
 *    ① 잔여 연차 검증과 ② 순차 단계 진행이 서버 판단이라, 클라가 행을 직접 만들 수 있으면 규칙이 뚫린다.
 * ⚠️ admin(service_role)은 RLS를 우회하므로 **모든 쿼리에 `tenant_id` 명시 필터**([[#104]]).
 * ⚠️ 게이트는 화면과 **같은 함수**(`canWriteTenant(role, "approvals")`) — 역할별 권한과 개인별 메뉴 권한이 한 매트릭스에
 *    합쳐져 있어 사이드바·페이지·액션이 한 판정을 공유한다([[#77]]).
 */

/** `docId` = 상신 성공 시 만들어진 문서 — 클라가 그 문서로 이동한다(#102: router.push 금지, window.location.assign). */
export type ApprovalActionState = { ok?: true; error?: string; notice?: string; docId?: string } | undefined;

const MAX_TEXT = 500;
/**
 * 사유 본문 상한 — 리치 텍스트(HTML)라 평문 500자와 자릿수가 다르다(표 하나만 넣어도 태그가 수백 자다).
 *
 * 🔴 상한을 넘으면 **자르지 않고 거절한다.** `slice`로 잘라내면 태그 한가운데가 끊겨
 *    깨진 HTML이 DB에 남고, 그걸 sanitize가 다시 손보면 사용자가 쓴 내용과 다른 문서가 저장된다.
 *    "너무 길다"는 사람이 줄이면 되는 문제라 조용히 훼손하는 쪽이 훨씬 나쁘다.
 */
const MAX_REASON_HTML = 20_000;
/** 문서 제목 상한 — 목록·알림 한 줄에 들어가는 길이. 초과는 자르지 않고 거절(제목이 잘리면 딴 문서다). */
const MAX_TITLE = 80;
/** 지출·수입결의서 금액 상한(공용) — 학원 단건 금액으로 10억을 넘으면 입력 실수다(0 하나 더 붙은 오타 차단). */
const MAX_MONEY_AMOUNT = 1_000_000_000;
const DOC_NO_RETRY = 3;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 위생처리된 HTML이 **사실상 빈 값**인가 — 순수 함수.
 *
 * 리치 에디터는 사용자가 아무것도 안 써도 빈 문단(`<p></p>`·`<p><br></p>`)을 내보낸다.
 * 그걸 그대로 저장하면 문서에 "사유: (빈 칸)"이 남아 `—`(미입력)와 구분되지 않으므로 null로 접는다.
 * ⚠️ 태그를 걷어낸 **텍스트**로 판정한다 — `<p>&nbsp;</p>`처럼 눈에 안 보이는 공백만 있는 경우도 빈 값이다.
 */
function isBlankHtml(html: string): boolean {
  return (
    html
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;| /g, " ")
      .trim().length === 0
  );
}

/** 폼의 JSON id 배열(`["uuid", …]`)을 안전하게 파싱 — 형식이 깨졌으면 빈 배열(검증이 걸러낸다). */
function parseIds(raw: FormDataEntryValue | null): string[] {
  try {
    const v = JSON.parse(String(raw ?? "[]"));
    return Array.isArray(v) ? v.map(String).filter((id) => UUID_RE.test(id)) : [];
  } catch {
    return [];
  }
}

/**
 * 리치 본문 파싱 — 모든 양식의 본문이 같은 규칙을 탄다: 상한 초과는 **자르지 않고 거절**
 * (MAX_REASON_HTML 주석 — slice는 태그를 끊어 쓴 것과 다른 문서를 남긴다) → 위생처리 →
 * 빈 껍데기(`<p></p>` 등)는 빈 문자열로 정규화.
 */
function parseRichBody(raw: FormDataEntryValue | null): { html: string } | { error: string } {
  const text = String(raw ?? "").trim();
  if (text.length > MAX_REASON_HTML) return { error: "본문이 너무 깁니다 — 줄여 주세요" };
  if (!text) return { html: "" };
  const html = sanitizeRichHtml(text);
  return { html: isBlankHtml(html) ? "" : html };
}

/** 문서 제목 파싱 — 필수·80자 상한(목록·알림 한 줄 길이). 초과는 거절. */
function parseTitle(raw: FormDataEntryValue | null): { title: string } | { error: string } {
  const title = String(raw ?? "").trim();
  if (!title) return { error: "제목을 입력하세요" };
  if (title.length > MAX_TITLE) return { error: `제목이 너무 깁니다 — ${MAX_TITLE}자 이내로 줄여 주세요` };
  return { title };
}

/** 기안·템플릿용 게이트 — **기안은** 전자결재 메뉴가 열린 사람만 한다(역할 칸 또는 개인별 메뉴 권한). */
async function requireApprovalWriter() {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" as const };
  if (!(await canWriteTenant(user.systemRole, "approvals"))) {
    return { error: "전자결재 권한이 없습니다" as const };
  }
  return { user };
}

/**
 * 결재·회수용 게이트 — **메뉴를 보지 않는다.** 결재 자격의 근거는 명단이 아니라 동결된 결재선 +
 * current_step(결정 로그)이고, 후보 풀이 전 직원이라(원장 2026-08-14) 전자결재 메뉴가 없는 직원도 자기
 * 차례의 문서는 벨 알림 링크로 들어와 결재해야 한다. 실제 자격 판정(내 차례인가/내 기안인가)은
 * 각 액션 본문이 문서·결재선 행으로 한다 — 여기는 로그인 확인만.
 * (강사 역할은 문서 화면 자체가 전자결재 권한을 요구한다 — 강사 화면의 가드가 그 주소를 메뉴로 판정한다.)
 */
async function requireSignedIn() {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" as const };
  // '다른 강사 뷰' 중에는 결재 · 회수를 하지 않는다 — 결재는 본인 서명이다(메뉴도 닫혀 있다 — perm-matrix.ts TEACHER_VIEW_CLOSED_MENUS).
  // 이 문은 메뉴를 보지 않으므로 여기서 따로 막는다(벨 링크 · 직접 호출).
  if (await viewAsTeacher()) return { error: TEACHER_VIEW_APPROVAL_ERROR };
  return { user };
}

const TEACHER_VIEW_APPROVAL_ERROR = "강사뷰에서는 전자결재를 처리할 수 없습니다. 강사뷰를 끝내고 본인 화면에서 처리해 주세요." as const;

/** 결재선·참조 후보 = **활성 직원 전원**(학생 제외) — 서버 검증용 id 집합(폼 조작 방어). */
async function activeStaffIds(tenantId: string): Promise<string[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("users")
    .select("id")
    .eq("tenant_id", tenantId) // admin은 RLS 우회 — tenant 명시 필수([[#104]])
    .neq("status", "inactive")
    .neq("system_role", "student")
    .limit(500); // 직원 수십 명 규모 — 절단 방지용 명시 상한(B2)
  if (error) throw new Error(`결재자 후보 확인 실패 — ${error.message}`);
  return (data ?? []).map((u) => String(u.id));
}

// ── 기안(상신) 공통 파이프라인 ───────────────────────────────────────────────

type DraftUser = { id: string; tenantId: string; displayName: string };

/**
 * 양식별 기안 액션이 **상세 검증만** 하고 이 헬퍼로 문서를 만든다:
 * [결재선 검증(활성 직원 대조) → 문서번호 채번(+충돌 재시도) → approval_documents insert →
 *  결재선·참조·양식 상세 insert(하나라도 실패하면 문서 롤백 — FK cascade가 steps·refs·상세를 함께
 *  지워 유령 문서가 안 남는다) → 1단계 결재자 알림 → 감사로그 → revalidate].
 *
 * ⚠️ 순차 결재라 알림은 **1단계 결재자에게만** — 뒤 차례는 자기 차례가 되면 받는다(decideDocument).
 */
async function createApprovalDocument(args: {
  user: DraftUser;
  form: ApprovalForm;
  /** approval_documents.title — 목록·알림에 그대로 뜬다. */
  title: string;
  /** normalizeLine 결과(순서 보존). 검증은 여기서 한다. */
  line: string[];
  /** normalizeRefs 결과. */
  refs: string[];
  /** 양식 상세 insert — 실패를 돌려주면 헬퍼가 문서를 롤백한다. */
  insertDetail: (docId: string) => Promise<{ error: { message: string } | null }>;
  /** 감사로그·알림 표시 라벨(기본 title). 사용자 제목 양식은 "양식명 — 제목"을 넘겨 무슨 문서인지 남긴다. */
  displayLabel?: string;
  auditMetadata?: Record<string, unknown>;
}): Promise<ApprovalActionState> {
  const { user, form, title, line, refs } = args;
  const label = args.displayLabel ?? title;

  // 결재선·참조 — 폼 조작 방어는 순수 검증(line.ts)이 **활성 직원 명단**과 대조해서 한다
  // (퇴직·학생 계정을 결재선에 못 끼운다).
  let candidateIds: string[];
  try {
    candidateIds = await activeStaffIds(user.tenantId);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "결재자 후보 확인 실패" };
  }
  const lineInvalid = validateApprovalLine({
    drafterId: user.id,
    approverIds: line,
    refIds: refs,
    candidateIds,
  });
  if (lineInvalid) return { error: lineInvalid };

  // 문서번호 채번 — 그 해 그 양식의 개수에서 잇는다. 동시 기안이 같은 번호를 잡으면 unique가 막고 재시도.
  const admin = createAdminClient();
  const today = kstToday();
  const year = today.slice(0, 4);
  const { count } = await admin
    .from("approval_documents")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", user.tenantId)
    .eq("form_type", form)
    .like("doc_no", `%-${year}-%`);

  let docId: string | null = null;
  let lastError = "";
  for (let attempt = 0; attempt < DOC_NO_RETRY && !docId; attempt += 1) {
    const { data, error } = await admin
      .from("approval_documents")
      .insert({
        tenant_id: user.tenantId,
        doc_no: nextDocNo(form, today, count ?? 0, attempt),
        form_type: form,
        title,
        drafter_id: user.id,
        status: "pending",
        current_step: 1,
      })
      .select("id")
      .single();
    if (data) docId = data.id as string;
    else {
      lastError = error?.message ?? "";
      if (!/23505|duplicate key/i.test(lastError)) break; // 번호 충돌이 아니면 재시도 무의미
    }
  }
  if (!docId) {
    const missing = /does not exist|Could not find the table|PGRST205/i.test(lastError);
    return {
      error: missing
        ? "전자결재 표가 아직 준비되지 않았습니다(마이그레이션 0213a 적용 필요)"
        : `상신 실패 — ${lastError || "알 수 없는 오류"}`,
    };
  }

  // 결재선·참조·양식 상세를 붙인다. 하나라도 실패하면 문서를 지운다(결재선 없는 유령 문서 방지).
  const roles = stepRoleLabels(line.length);
  const inserts = await Promise.all([
    admin.from("approval_steps").insert(
      line.map((approverId, i) => ({
        tenant_id: user.tenantId,
        document_id: docId,
        step_no: i + 1,
        approver_id: approverId,
        role_label: roles[i] ?? "승인",
      })),
    ),
    args.insertDetail(docId),
    refs.length > 0
      ? admin.from("approval_refs").insert(
          refs.map((userId) => ({ tenant_id: user.tenantId, document_id: docId, user_id: userId })),
        )
      : Promise.resolve({ error: null }),
  ]);
  const insertErr = inserts.find((r) => r.error)?.error;
  if (insertErr) {
    await admin.from("approval_documents").delete().eq("id", docId).eq("tenant_id", user.tenantId);
    const missing = /does not exist|Could not find the table|PGRST205/i.test(insertErr.message);
    // 반반차 check 위반(23514) = 0223a 미적용 배포([[#95]] expand/contract) — 제약 이름으로만 잡는다.
    if (/leave_forms_kind_valid/i.test(insertErr.message)) {
      return { error: "반반차는 DB 마이그레이션(0223a) 적용 후 신청할 수 있습니다" };
    }
    return {
      error: missing
        ? "이 양식의 표가 아직 준비되지 않았습니다(마이그레이션 0215a 적용 필요)"
        : `상신 실패 — ${insertErr.message}`,
    };
  }

  const firstApprover = line[0];
  if (firstApprover) {
    await notifyUsers([
      {
        tenantId: user.tenantId,
        recipientId: firstApprover,
        type: "approval_requested",
        title: "결재 요청",
        body: `${user.displayName} · ${label}`,
        link: `/approvals/${docId}`,
        actorId: user.id,
      },
    ]);
  }
  await logAction({
    action: "approval_submit",
    targetType: "approval_document",
    targetLabel: label,
    metadata: args.auditMetadata,
  });
  revalidatePath("/approvals");
  return {
    ok: true,
    docId,
    notice: `결재를 올렸습니다 — 결재 ${line.length}단계${refs.length > 0 ? ` · 참조 ${refs.length}명` : ""}`,
  };
}

/**
 * 휴가신청서 기안(상신). 잔여를 넘으면 **접수 자체를 거절한다**(원장 2026-08-14:
 * *"자동반려 필요없고 잔여없으면 신청 자체를 못하자나 어차피"*).
 */
export async function submitLeaveDraft(
  _prev: ApprovalActionState,
  formData: FormData,
): Promise<ApprovalActionState> {
  const gate = await requireApprovalWriter();
  if ("error" in gate) return { error: gate.error };
  const { user } = gate;

  const kindRaw = String(formData.get("kind") ?? "annual");
  const kind: LeaveKind = isLeaveKind(kindRaw) ? kindRaw : "annual";
  const start = String(formData.get("startDate") ?? "").trim();
  const end = kind === "half" ? start : String(formData.get("endDate") ?? "").trim() || start;

  // 사유 = 리치 텍스트(HTML) — 공통 규칙(parseRichBody). 휴가는 빈 사유를 null로 저장한다(미입력 "—").
  // 🔴 위생처리는 여기서 끝이 아니다 — 문서 화면이 렌더 직전에 한 번 더 통과시킨다
  // (옛 행·직접 INSERT 방어. 저장 시점의 선의를 믿고 innerHTML을 그리면 그게 곧 XSS 경로다).
  const body = parseRichBody(formData.get("reason"));
  if ("error" in body) return { error: "사유가 너무 깁니다 — 줄여 주세요" };
  const reason = body.html || null;

  const admin = createAdminClient();
  const { data: me } = await admin
    .from("users")
    .select("hire_date")
    .eq("id", user.id)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  const hireDate = (me?.hire_date as string | null) ?? null;

  const today = kstToday();
  // 화면(getMyLeaveBalance)과 같은 오버라이드를 지나야 잔여 판정·동결값(granted_days)이 일치한다.
  const period = applyLeaveGrantOverride(user.id, resolveLeavePeriod(hireDate, start || today, today), isChinsanTenant(await getTenantSettings()));
  if (!period) {
    return {
      error: "입사일이 등록되지 않아 연차를 계산할 수 없습니다 — 사무실(직원관리)에 등록을 요청하세요",
    };
  }

  const invalid = validateLeaveRange({ start, end, kind, periodEnd: period.end });
  if (invalid) return { error: invalid };
  const days = countLeaveDays(start, end, kind);

  // 부여 = 법정 계산 + **조정**(이월·특별휴가, 0252a) — 화면(getMyLeaveBalance)과 같은 식(balance.ts)이라
  // 잔여 숫자가 두 곳에서 갈리지 않는다. 조정 조회가 진짜로 실패하면 **거절하지 않고 알린다**
  // (조용히 0으로 떨어뜨리면 이월을 받은 사람이 이유도 모르고 기안을 못 한다).
  let reserved: number;
  let adjustment: number;
  try {
    [reserved, adjustment] = await Promise.all([
      reservedLeaveDays({ tenantId: user.tenantId, userId: user.id, period }),
      adjustmentDaysFor({ tenantId: user.tenantId, userId: user.id, period }),
    ]);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "잔여 연차 확인 실패" };
  }
  const granted = grantedTotal(period.granted, adjustment);
  const remaining = remainingDays({ granted, used: reserved, pending: 0 });
  if (days > remaining) {
    const grantedNote = adjustment === 0
      ? formatLeaveDays(granted)
      : `${formatLeaveDays(granted)}(법정 ${formatLeaveDays(period.granted)} · 조정 ${formatSignedDays(adjustment)})`;
    return {
      error:
        remaining <= 0
          ? `남은 연차가 없습니다 (${period.label} 부여 ${grantedNote} 전부 사용·결재중)`
          : `잔여 연차 ${formatLeaveDays(remaining)}보다 많이 신청할 수 없습니다 (신청 ${formatLeaveDays(days)})`,
    };
  }

  const title = `${APPROVAL_FORM_LABEL.leave} — ${start}${end !== start ? ` ~ ${end}` : ""} ${formatLeaveDays(days)}`;
  const line = normalizeLine(user.id, parseIds(formData.get("approverIds")));
  const refs = normalizeRefs(user.id, line, parseIds(formData.get("refIds")));

  return createApprovalDocument({
    user,
    form: "leave",
    title,
    line,
    refs,
    insertDetail: async (docId) =>
      admin.from("leave_forms").insert({
        document_id: docId,
        tenant_id: user.tenantId,
        user_id: user.id,
        leave_kind: kind,
        start_date: start,
        end_date: end,
        days,
        reason,
        period_start: period.start,
        period_end: period.end,
        // 🔑 동결값은 **그때 실제로 쓸 수 있던 부여**(법정 + 조정)다 — 법정분만 적으면 이월을 받은 사람의
        //    문서가 "부여 15일인데 18일째 사용"처럼 읽힌다.
        granted_days: granted,
      }),
    auditMetadata: { days, remaining, granted, period: leavePeriodLabel(period) },
  });
}

/**
 * 품의서 기안(상신) — 제목 + 리치 본문뿐인 **기본형 양식**(상세 표 approval_basic_forms).
 * 새 기본형 양식이 생기면 여기 formType 허용 목록에만 더한다(업무연락은 2026-08-18 원장 지시로 폐기 —
 * 문서 0건 실측이라 흔적 없이 뺐다).
 */
export async function submitBasicDraft(
  _prev: ApprovalActionState,
  formData: FormData,
): Promise<ApprovalActionState> {
  const gate = await requireApprovalWriter();
  if ("error" in gate) return { error: gate.error };
  const { user } = gate;

  const formRaw = String(formData.get("formType") ?? "");
  if (formRaw !== "proposal") return { error: "지원하지 않는 양식입니다" };
  const form: ApprovalForm = formRaw;

  const parsedTitle = parseTitle(formData.get("title"));
  if ("error" in parsedTitle) return parsedTitle;
  const body = parseRichBody(formData.get("body"));
  if ("error" in body) return body;

  const line = normalizeLine(user.id, parseIds(formData.get("approverIds")));
  const refs = normalizeRefs(user.id, line, parseIds(formData.get("refIds")));
  const admin = createAdminClient();

  return createApprovalDocument({
    user,
    form,
    title: parsedTitle.title,
    line,
    refs,
    // 감사로그·알림엔 양식명을 붙인다 — 사용자 제목만으로는 무슨 문서였는지 안 남는다.
    displayLabel: `${APPROVAL_FORM_LABEL[form]} — ${parsedTitle.title}`,
    insertDetail: async (docId) =>
      admin.from("approval_basic_forms").insert({
        document_id: docId,
        tenant_id: user.tenantId,
        body_html: body.html,
      }),
  });
}

/**
 * 지출결의서 기안(상신) — 금액·지출일·분류는 컬럼(합산·기간 필터 대비, B2), 본문은 리치 텍스트.
 * ⚠️ 기존 /billing 지출·expense_requests와 별개(0215a 주석) — 이 금액은 재무 집계에 닿지 않는다.
 */
export async function submitExpenseDraft(
  _prev: ApprovalActionState,
  formData: FormData,
): Promise<ApprovalActionState> {
  const gate = await requireApprovalWriter();
  if ("error" in gate) return { error: gate.error };
  const { user } = gate;

  const parsedTitle = parseTitle(formData.get("title"));
  if ("error" in parsedTitle) return parsedTitle;

  // 금액 — 화면이 콤마를 찍어 보내도 받는다(1,000,000). 파싱 실패·범위 밖은 자르지 않고 거절.
  const amountRaw = String(formData.get("amount") ?? "").replace(/[,\s]/g, "");
  if (!amountRaw) return { error: "금액을 입력하세요" };
  if (!/^\d+$/.test(amountRaw)) return { error: "금액은 숫자로 입력하세요" };
  const amount = Number(amountRaw);
  if (amount < 1 || amount > MAX_MONEY_AMOUNT) {
    return { error: "금액은 1원 이상 10억 원 이하로 입력하세요" };
  }

  const spendDate = String(formData.get("spendDate") ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(spendDate)) return { error: "지출일을 선택하세요" };

  // 분류 — 어휘의 주인은 /billing 지출(types.ts EXPENSE_CATEGORIES). 목록 밖 값은 "기타"로 접는다.
  const categoryRaw = String(formData.get("category") ?? "");
  const category = (EXPENSE_CATEGORIES as readonly string[]).includes(categoryRaw)
    ? categoryRaw
    : "기타";

  const body = parseRichBody(formData.get("body"));
  if ("error" in body) return body;

  const line = normalizeLine(user.id, parseIds(formData.get("approverIds")));
  const refs = normalizeRefs(user.id, line, parseIds(formData.get("refIds")));
  const admin = createAdminClient();

  return createApprovalDocument({
    user,
    form: "expense",
    title: parsedTitle.title,
    line,
    refs,
    displayLabel: `${APPROVAL_FORM_LABEL.expense} — ${parsedTitle.title}`,
    insertDetail: async (docId) =>
      admin.from("approval_expense_forms").insert({
        document_id: docId,
        tenant_id: user.tenantId,
        amount,
        spend_date: spendDate,
        category,
        body_html: body.html,
      }),
    auditMetadata: { amount, spendDate, category },
  });
}

/**
 * 수입결의서 기안(상신) — 지출결의서의 거울(금액·수입일·분류 컬럼 + 리치 본문).
 * ⚠️ 수강료는 수납관리 장부 소관이라 여기 안 온다(수강료 외 수입 승인용 — 0216a 주석).
 *    이 금액도 재무 집계에 닿지 않는다.
 */
export async function submitIncomeDraft(
  _prev: ApprovalActionState,
  formData: FormData,
): Promise<ApprovalActionState> {
  const gate = await requireApprovalWriter();
  if ("error" in gate) return { error: gate.error };
  const { user } = gate;

  const parsedTitle = parseTitle(formData.get("title"));
  if ("error" in parsedTitle) return parsedTitle;

  const amountRaw = String(formData.get("amount") ?? "").replace(/[,\s]/g, "");
  if (!amountRaw) return { error: "금액을 입력하세요" };
  if (!/^\d+$/.test(amountRaw)) return { error: "금액은 숫자로 입력하세요" };
  const amount = Number(amountRaw);
  if (amount < 1 || amount > MAX_MONEY_AMOUNT) {
    return { error: "금액은 1원 이상 10억 원 이하로 입력하세요" };
  }

  const incomeDate = String(formData.get("incomeDate") ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(incomeDate)) return { error: "수입일을 선택하세요" };

  // 분류 — 어휘는 파일럿 중 원장 확정 대상(types.ts INCOME_CATEGORIES). 목록 밖 값은 "기타"로 접는다.
  const categoryRaw = String(formData.get("category") ?? "");
  const category = (INCOME_CATEGORIES as readonly string[]).includes(categoryRaw)
    ? categoryRaw
    : "기타";

  const body = parseRichBody(formData.get("body"));
  if ("error" in body) return body;

  const line = normalizeLine(user.id, parseIds(formData.get("approverIds")));
  const refs = normalizeRefs(user.id, line, parseIds(formData.get("refIds")));
  const admin = createAdminClient();

  return createApprovalDocument({
    user,
    form: "income",
    title: parsedTitle.title,
    line,
    refs,
    displayLabel: `${APPROVAL_FORM_LABEL.income} — ${parsedTitle.title}`,
    insertDetail: async (docId) =>
      admin.from("approval_income_forms").insert({
        document_id: docId,
        tenant_id: user.tenantId,
        amount,
        income_date: incomeDate,
        category,
        body_html: body.html,
      }),
    auditMetadata: { amount, incomeDate, category },
  });
}

/**
 * 결재 처리(승인·반려·**전결**) + **후결 넘김** + **대결** (0216a).
 *
 * 자격의 근거는 명단이 아니라 **동결된 결재선 + current_step**이다. 세 경로:
 *   ① 내 차례(현재 칸 주인) — 승인/반려/전결.
 *   ② 후결 넘김(fd `deferPrevious`="1") — 앞 칸 결재자가 부재중일 때 뒤 차례인 내가 앞의 pending
 *      칸들을 전부 'deferred'(후결 대기)로 표시하고 먼저 결재한다. 부재자들은 알림을 받고 나중에
 *      confirmDeferredStep으로 사후 확인한다(하이웍스 후열 '확인').
 *   ③ 대결 — 현재 칸 주인이 아닌 **원장(master)**이 부재자 대신 현재 칸을 처리(acted_by 기록).
 *      v1 대결 권한 = 원장(0216a 주석 — 부재 설정·대결자 사전 지정은 필요해지면 확장).
 *
 * 진행 규칙: 승인 → 다음 **pending** 칸으로(deferred·skipped는 건너뜀), 없으면 승인 종결.
 * **전결** → 남은 pending 칸을 'skipped'로 바꾸고 그 칸에서 즉시 승인 종결. 반려 → 즉시 반려 종결
 * (후결 대기 칸은 문서가 종결돼도 남는다 — 부재자의 사후 확인 대상).
 */
export async function decideDocument(
  _prev: ApprovalActionState,
  formData: FormData,
): Promise<ApprovalActionState> {
  // 메뉴 게이트가 아니라 결재선이 자격이다(requireSignedIn 주석) — 아래 경로 판정이 실 판정.
  const gate = await requireSignedIn();
  if ("error" in gate) return { error: gate.error };
  const { user } = gate;

  const docId = String(formData.get("documentId") ?? "").trim();
  const decision = String(formData.get("decision") ?? "");
  const deferPrevious = String(formData.get("deferPrevious") ?? "") === "1";
  const comment = String(formData.get("comment") ?? "").trim().slice(0, MAX_TEXT) || null;
  if (!docId) return { error: "결재할 문서를 찾을 수 없습니다" };
  if (decision !== "approved" && decision !== "rejected" && decision !== "final") {
    return { error: "승인·반려·전결 중에서 선택하세요" };
  }

  const admin = createAdminClient();
  const { data: doc } = await admin
    .from("approval_documents")
    .select("id, title, drafter_id, status, current_step")
    .eq("id", docId)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  if (!doc) return { error: "문서를 찾을 수 없습니다" };
  if (doc.status !== "pending") return { error: "이미 처리된 문서입니다" };
  if (doc.drafter_id === user.id) return { error: "본인이 올린 문서는 결재할 수 없습니다" };

  const { data: steps } = await admin
    .from("approval_steps")
    .select("id, step_no, approver_id, decision")
    .eq("document_id", docId)
    .order("step_no", { ascending: true });
  const line = steps ?? [];
  const currentCell = line.find((s) => s.step_no === doc.current_step);
  const myCell = line.find((s) => s.approver_id === user.id);

  // ── 경로 판정: 내 차례 / 후결 넘김 / 대결 ─────────────────────────────────
  let target: (typeof line)[number];
  let proxy = false;
  let deferredCells: typeof line = [];

  if (currentCell && currentCell.approver_id === user.id) {
    if (currentCell.decision !== "pending") return { error: "이미 결재한 문서입니다" };
    target = currentCell;
  } else if (deferPrevious) {
    if (!myCell) return { error: "이 문서의 결재선에 포함되지 않았습니다" };
    if (myCell.step_no <= doc.current_step) return { error: "후결로 넘길 앞 단계가 없습니다" };
    if (myCell.decision !== "pending") return { error: "이미 결재한 문서입니다" };
    deferredCells = line.filter(
      (s) => s.step_no >= doc.current_step && s.step_no < myCell.step_no,
    );
    if (deferredCells.some((s) => s.decision !== "pending")) {
      return { error: "앞 단계가 이미 처리되고 있어 후결로 넘길 수 없습니다" };
    }
    target = myCell;
  } else if (user.systemRole === "master" && currentCell && currentCell.decision === "pending") {
    // 대결 — 원장이 부재자의 현재 칸을 대신 처리한다(도장은 부재자 칸에, acted_by에 실제 처리자).
    proxy = true;
    target = currentCell;
  } else {
    return { error: "지금은 내 결재 차례가 아닙니다" };
  }

  const now = new Date().toISOString();

  // ── 후결 넘김: 앞 칸들을 deferred로(부재 표시). 내 결재 확정보다 먼저 — 실패하면 여기서 멈춘다. ──
  if (deferredCells.length > 0) {
    const ids = deferredCells.map((s) => s.id);
    const { data: marked, error: deferErr } = await admin
      .from("approval_steps")
      .update({ decision: "deferred" })
      .in("id", ids)
      .eq("decision", "pending") // 동시 결재 방어
      .select("id");
    if (deferErr) return { error: `후결 처리 실패 — ${deferErr.message}` };
    if ((marked ?? []).length !== ids.length) {
      // 일부가 그 사이 처리됐다 — 방금 표시한 것만 되돌리고 사용자에게 다시 보게 한다.
      await admin
        .from("approval_steps")
        .update({ decision: "pending" })
        .in("id", ids)
        .eq("decision", "deferred");
      return { error: "앞 단계 상태가 방금 바뀌었습니다 — 새로고침 후 다시 확인해 주세요" };
    }
  }

  // ── 내(또는 대결) 칸 확정 ──────────────────────────────────────────────────
  const { data: written, error: stepErr } = await admin
    .from("approval_steps")
    .update({ decision, decided_at: now, comment, ...(proxy ? { acted_by: user.id } : {}) })
    .eq("id", target.id)
    .eq("decision", "pending") // 동시 클릭 방어 — 이미 처리된 칸은 안 덮는다
    .select("id");
  if (stepErr) return { error: `결재 저장 실패 — ${stepErr.message}` };
  if ((written ?? []).length === 0) {
    return { error: "이미 결재된 칸입니다 — 새로고침 후 확인해 주세요" };
  }

  // ── 전결: 남은 pending 칸 생략 처리(deferred 칸은 사후 확인 대상으로 남긴다) ──
  const isFinal = decision === "final";
  let skippedIds: string[] = [];
  if (isFinal) {
    const { data: skipped, error: skipErr } = await admin
      .from("approval_steps")
      .update({ decision: "skipped" })
      .eq("document_id", docId)
      .gt("step_no", target.step_no)
      .eq("decision", "pending")
      .select("id");
    if (skipErr) return { error: `전결 처리 실패 — ${skipErr.message}` };
    skippedIds = (skipped ?? []).map((r) => r.id as string);
  }

  // ── 문서 진행/종결 ─────────────────────────────────────────────────────────
  const deferredIds = new Set(deferredCells.map((s) => s.id));
  const nextPending = isFinal
    ? undefined
    : line.find(
        (s) => s.step_no > target.step_no && s.decision === "pending" && !deferredIds.has(s.id),
      );
  const approvedLike = decision === "approved" || isFinal;
  const closes = !approvedLike || isFinal || !nextPending;
  const who = `${user.displayName}${proxy ? " (대결)" : ""}`;

  const patch = !approvedLike
    ? {
        status: "rejected",
        completed_at: now,
        outcome_note: `반려 — ${who}${comment ? ` (${comment})` : ""}`,
      }
    : isFinal
      ? { status: "approved", completed_at: now, outcome_note: `전결 승인 — ${who}` }
      : nextPending
        ? { current_step: nextPending.step_no }
        : { status: "approved", completed_at: now, outcome_note: `최종 승인 — ${who}` };

  // 🔴 `status = 'pending'` 조건(2026-09-23 전수 점검 S8) — 결재자가 문서를 읽은 뒤 쓰기 전에 기안자가
  //    회수하면, 조건 없는 update가 canceled를 approved로 덮었다(휴가면 연차가 사용으로 잡힌다).
  //    0행이면 이 결재가 늦은 것 — 방금 쓴 결재란을 되돌리고 알린다.
  const { data: docWritten, error: docErr } = await admin
    .from("approval_documents")
    .update(patch)
    .eq("id", docId)
    .eq("tenant_id", user.tenantId)
    .eq("status", "pending")
    .select("id");
  if (docErr || (docWritten ?? []).length === 0) {
    await admin
      .from("approval_steps")
      .update({ decision: "pending", decided_at: null, comment: null, acted_by: null })
      .eq("id", target.id)
      .eq("decision", decision);
    // 전결로 생략한 칸·후결로 넘긴 칸도 원래(pending)로 — 각자 방금 바꾼 값일 때만.
    const reverts: Array<[string[], "skipped" | "deferred"]> = [
      [skippedIds, "skipped"],
      [deferredCells.map((c) => c.id as string), "deferred"],
    ];
    for (const [ids, from] of reverts) {
      if (ids.length === 0) continue;
      await admin.from("approval_steps").update({ decision: "pending" }).in("id", ids).eq("decision", from);
    }
    if (docErr) return { error: `문서 상태 갱신 실패 — ${humanizeDbError(docErr.message)}` };
    return { error: "그 사이 문서가 회수되었거나 이미 처리되었습니다 — 새로고침 후 확인해 주세요" };
  }

  // ── 알림 ───────────────────────────────────────────────────────────────────
  // 대결 — 원래 결재자(부재자)에게 원장이 대신 처리했다고 알린다(N13: 전엔 본인 칸이 처리된 걸 몰랐다).
  if (proxy && target.approver_id && target.approver_id !== user.id) {
    await notifyUsers([
      {
        tenantId: user.tenantId,
        recipientId: target.approver_id as string,
        type: "approval_decided",
        title: "대결 처리 안내",
        body: `${doc.title} — ${user.displayName}님이 내 결재 칸을 대신 ${!approvedLike ? "반려" : isFinal ? "전결" : "승인"}했습니다.`,
        link: `/approvals/${docId}`,
        actorId: user.id,
      },
    ]);
  }
  // 후결로 건너뛰어진 부재자들 — 나중에 '후결 확인'이 필요함을 알린다.
  if (deferredCells.length > 0) {
    await notifyUsers(
      deferredCells.map((s) => ({
        tenantId: user.tenantId,
        recipientId: s.approver_id as string,
        type: "approval_requested" as const,
        title: "후결 처리 안내",
        body: `${doc.title} — 부재로 후결 처리됐습니다. 나중에 후결 확인이 필요합니다.`,
        link: `/approvals/${docId}`,
        actorId: user.id,
      })),
    );
  }
  if (!closes && nextPending) {
    // 다음 차례 결재자에게만 알린다(순차).
    await notifyUsers([
      {
        tenantId: user.tenantId,
        recipientId: nextPending.approver_id as string,
        type: "approval_requested",
        title: "결재 요청",
        body: `${doc.title}`,
        link: `/approvals/${docId}`,
        actorId: user.id,
      },
    ]);
  } else if (closes) {
    // 문서가 끝났다 — 기안자 + **참조자**에게 알린다(참조는 하이웍스처럼 결말을 받아본다).
    const { data: refRows } = await admin
      .from("approval_refs")
      .select("user_id")
      .eq("document_id", docId)
      .eq("tenant_id", user.tenantId);
    const outcome = !approvedLike ? "반려" : isFinal ? "전결 승인" : "승인";
    await notifyUsers([
      {
        tenantId: user.tenantId,
        recipientId: doc.drafter_id as string,
        type: "approval_decided",
        title: `결재 ${outcome}`,
        body: `${doc.title} — ${outcome}되었습니다${proxy ? ` (대결 — ${user.displayName})` : ""}`,
        link: `/approvals/${docId}`,
        actorId: user.id,
      },
      ...((refRows ?? []).map((r) => ({
        tenantId: user.tenantId,
        recipientId: r.user_id as string,
        type: "approval_decided" as const,
        title: `참조 문서 ${outcome}`,
        body: `${doc.title} — ${outcome}으로 종결되었습니다 (참조)`,
        link: `/approvals/${docId}`,
        actorId: user.id,
      }))),
    ]);
  }

  await logAction({
    action: "approval_decide",
    targetType: "approval_document",
    targetLabel: `${doc.title} · ${!approvedLike ? "반려" : isFinal ? "전결" : "승인"}${proxy ? " (대결)" : ""}`,
    metadata: {
      docId,
      decision,
      step: target.step_no,
      proxy,
      deferred: deferredCells.length,
    },
  });
  revalidatePath("/approvals");
  revalidatePath(`/approvals/${docId}`);
  const deferNote = deferredCells.length > 0 ? "앞 단계를 후결로 넘기고 " : "";
  return {
    ok: true,
    notice: !approvedLike
      ? `${deferNote}반려했습니다${proxy ? " (대결)" : ""}`
      : isFinal
        ? `${deferNote}전결로 승인 종결했습니다${proxy ? " (대결)" : ""}`
        : nextPending
          ? `${deferNote}승인했습니다 — 다음 결재자에게 넘어갔습니다${proxy ? " (대결)" : ""}`
          : `${deferNote}최종 승인했습니다${proxy ? " (대결)" : ""}`,
  };
}

/**
 * 후결 확인 — 부재로 건너뛰어진(deferred) 내 칸을 사후 승인(post_approved)으로 바꾼다.
 * 문서 상태·current_step은 **불변**(문서는 이미 진행·종결됐다 — 하이웍스 후열 '확인'과 같은 사후 기록).
 */
export async function confirmDeferredStep(
  _prev: ApprovalActionState,
  formData: FormData,
): Promise<ApprovalActionState> {
  const gate = await requireSignedIn();
  if ("error" in gate) return { error: gate.error };
  const { user } = gate;

  const docId = String(formData.get("documentId") ?? "").trim();
  if (!docId) return { error: "확인할 문서를 찾을 수 없습니다" };

  const admin = createAdminClient();
  const { data: doc } = await admin
    .from("approval_documents")
    .select("id, title")
    .eq("id", docId)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  if (!doc) return { error: "문서를 찾을 수 없습니다" };

  const { data: updated, error } = await admin
    .from("approval_steps")
    .update({ decision: "post_approved", decided_at: new Date().toISOString() })
    .eq("document_id", docId)
    .eq("approver_id", user.id) // 내 칸만
    .eq("decision", "deferred")
    .select("id")
    .maybeSingle();
  if (error) return { error: `후결 확인 실패 — ${error.message}` };
  if (!updated) return { error: "후결 확인할 칸이 없습니다" };

  await logAction({
    action: "approval_decide",
    targetType: "approval_document",
    targetLabel: `${doc.title} · 후결 확인`,
    metadata: { docId, postApproval: true },
  });
  revalidatePath("/approvals");
  revalidatePath(`/approvals/${docId}`);
  return { ok: true, notice: "후결 확인했습니다" };
}

/** 기안 회수 — 진행중이고 **아직 아무도 승인하지 않았을 때만**(한 번 결재된 문서는 기록으로 남긴다). */
export async function withdrawDocument(
  _prev: ApprovalActionState,
  formData: FormData,
): Promise<ApprovalActionState> {
  // 자격 = 아래 drafter_id 필터(본인 기안만) — 메뉴 게이트가 아니다(requireSignedIn 주석).
  const gate = await requireSignedIn();
  if ("error" in gate) return { error: gate.error };
  const { user } = gate;

  const docId = String(formData.get("documentId") ?? "").trim();
  if (!docId) return { error: "회수할 문서를 찾을 수 없습니다" };

  const admin = createAdminClient();
  const { data: steps } = await admin
    .from("approval_steps")
    .select("decision, step_no, approver_id")
    .eq("document_id", docId);
  if ((steps ?? []).some((s) => s.decision !== "pending")) {
    return { error: "이미 결재가 시작돼 회수할 수 없습니다" };
  }

  const { data: updated, error } = await admin
    .from("approval_documents")
    .update({
      status: "canceled",
      completed_at: new Date().toISOString(),
      outcome_note: "기안자 회수",
    })
    .eq("id", docId)
    .eq("tenant_id", user.tenantId)
    .eq("drafter_id", user.id) // 남의 문서는 못 건드린다
    .eq("status", "pending")
    .select("id, title, current_step")
    .maybeSingle();
  if (error) return { error: `회수 실패 — ${error.message}` };
  if (!updated) return { error: "진행중인 본인 기안만 회수할 수 있습니다" };

  // 결재 요청을 받은 사람(현재 차례)에게 회수 사실을 알린다(N13) — 알림을 누르면 '회수됨'이 보인다.
  const currentApprover = (steps ?? []).find((s) => s.step_no === updated.current_step)?.approver_id;
  if (currentApprover && currentApprover !== user.id) {
    await notifyUsers([
      {
        tenantId: user.tenantId,
        recipientId: currentApprover as string,
        type: "approval_decided",
        title: "결재 문서 회수",
        body: `${String(updated.title)} — 기안자가 문서를 회수했습니다. 결재할 필요가 없습니다.`,
        link: `/approvals/${docId}`,
        actorId: user.id,
      },
    ]);
  }

  await logAction({
    action: "approval_withdraw",
    targetType: "approval_document",
    targetLabel: docId,
  });
  revalidatePath("/approvals");
  revalidatePath(`/approvals/${docId}`);
  return { ok: true, notice: "기안을 회수했습니다" };
}

// ── 문서 댓글(하이웍스 개편 전자결재 '댓글', 0227a) ──────────────────────────

/**
 * 댓글 등록 — 참여자(기안자·결재선·참조·원장·super_admin)가 전결 사유 등 보충 내용을 공유한다
 * (원장 2026-08-19: "결재 밑에 댓글처럼 있어서 전결 이유나 여러가지 공유하는거같음").
 * 결재 판단(decideDocument의 comment — 도장에 붙는 처리 의견 1개)과 별개로 몇 번이든 단다.
 * 쓰기는 admin이라 참여자 판정을 서버가 직접 한다([[#77]] — RLS 읽기 자격과 같은 범위).
 */
export async function addApprovalComment(
  _prev: ApprovalActionState,
  formData: FormData,
): Promise<ApprovalActionState> {
  const gate = await requireSignedIn();
  if ("error" in gate) return { error: gate.error };
  const { user } = gate;

  const docId = String(formData.get("documentId") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim().slice(0, MAX_TEXT);
  if (!docId) return { error: "댓글을 남길 문서를 찾을 수 없습니다" };
  if (!body) return { error: "댓글 내용을 입력하세요" };

  // 세 조회는 서로 독립(전부 docId 필터) — 병렬(B4). doc이 없으면 steps/refs는 그냥 버려진다.
  const admin = createAdminClient();
  const [{ data: doc }, { data: steps }, { data: refs }] = await Promise.all([
    admin
      .from("approval_documents")
      .select("id, title, drafter_id")
      .eq("id", docId)
      .eq("tenant_id", user.tenantId) // admin은 RLS 우회 — tenant 명시 필수([[#104]])
      .maybeSingle(),
    admin.from("approval_steps").select("approver_id").eq("document_id", docId),
    admin.from("approval_refs").select("user_id").eq("document_id", docId),
  ]);
  if (!doc) return { error: "문서를 찾을 수 없습니다" };
  const participant =
    doc.drafter_id === user.id ||
    (steps ?? []).some((s) => s.approver_id === user.id) ||
    (refs ?? []).some((r) => r.user_id === user.id) ||
    user.systemRole === "master" ||
    (await isCurrentUserSuperAdmin()); // super_admin은 모든 게이트 자동 통과(결정 로그 2026-08-13)
  if (!participant) return { error: "이 문서의 기안자·결재자·참조자만 댓글을 남길 수 있습니다" };

  const { error } = await admin.from("approval_comments").insert({
    tenant_id: user.tenantId,
    document_id: docId,
    author_id: user.id,
    body,
  });
  if (error) {
    return {
      error: isMissingRelation(error)
        ? "댓글 표가 아직 준비되지 않았습니다(마이그레이션 0227a 적용 필요)"
        : `댓글 저장 실패 — ${error.message}`,
    };
  }

  // 공유 알림 — 기안자 + 결재선(작성자 본인은 notifyUsers가 스킵). 참조는 종결 알림만 받는 결이라 제외.
  const recipients = [
    ...new Set([String(doc.drafter_id), ...(steps ?? []).map((s) => String(s.approver_id))]),
  ];
  // 알림·감사로그는 서로 독립인 best-effort 부수효과 — 병렬(B4).
  await Promise.all([
    notifyUsers(
      recipients.map((recipientId) => ({
        tenantId: user.tenantId,
        recipientId,
        type: "approval_comment" as const,
        title: "결재 문서 댓글",
        body: `${doc.title} — ${user.displayName}: ${body.length > 60 ? `${body.slice(0, 60)}…` : body}`,
        link: `/approvals/${docId}`,
        actorId: user.id,
      })),
    ),
    logAction({
      action: "approval_comment",
      targetType: "approval_document",
      targetLabel: doc.title,
      metadata: { docId },
    }),
  ]);
  revalidatePath(`/approvals/${docId}`);
  return { ok: true, notice: "댓글을 남겼습니다" };
}

/** 댓글 삭제 — 본인 것만(author_id 필터). 남긴 기록이라 수정은 두지 않는다(지우고 다시 단다). */
export async function deleteApprovalComment(
  _prev: ApprovalActionState,
  formData: FormData,
): Promise<ApprovalActionState> {
  const gate = await requireSignedIn();
  if ("error" in gate) return { error: gate.error };
  const { user } = gate;

  const commentId = String(formData.get("commentId") ?? "").trim();
  if (!commentId) return { error: "삭제할 댓글을 찾을 수 없습니다" };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("approval_comments")
    .delete()
    .eq("id", commentId)
    .eq("tenant_id", user.tenantId)
    .eq("author_id", user.id) // 남의 댓글은 못 지운다
    .select("document_id")
    .maybeSingle();
  if (error) return { error: `댓글 삭제 실패 — ${error.message}` };
  if (!data) return { error: "본인이 쓴 댓글만 삭제할 수 있습니다" };

  // 감사로그 대상은 사람이 읽는 라벨(문서 제목) — raw UUID를 화면에 내보내지 않는다(작업 선호).
  const { data: doc } = await admin
    .from("approval_documents")
    .select("title")
    .eq("id", data.document_id)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  await logAction({
    action: "approval_comment_delete",
    targetType: "approval_document",
    targetLabel: doc?.title ?? "결재 문서",
    metadata: { commentId, docId: data.document_id },
  });
  revalidatePath(`/approvals/${data.document_id}`);
  return { ok: true, notice: "댓글을 삭제했습니다" };
}

// ── 자주 쓰는 결재선(개인 템플릿, 하이웍스 대응) ─────────────────────────────

/**
 * 현재 결재선을 이름 붙여 저장(같은 이름은 덮어쓴다 — upsert). 저장 시점에도 검증해서
 * 애초에 못 쓸 결재선(풀 밖·상한 초과)이 템플릿으로 남지 않게 한다.
 */
export async function saveLineTemplate(
  _prev: ApprovalActionState,
  formData: FormData,
): Promise<ApprovalActionState> {
  const gate = await requireApprovalWriter();
  if ("error" in gate) return { error: gate.error };
  const { user } = gate;

  const name = String(formData.get("name") ?? "").trim().slice(0, 40);
  if (!name) return { error: "결재선 이름을 입력하세요" };
  const approvers = normalizeLine(user.id, parseIds(formData.get("approverIds")));
  const refs = normalizeRefs(user.id, approvers, parseIds(formData.get("refIds")));
  let candidateIds: string[];
  try {
    candidateIds = await activeStaffIds(user.tenantId);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "결재자 후보 확인 실패" };
  }
  const invalid = validateApprovalLine({
    drafterId: user.id,
    approverIds: approvers,
    refIds: refs,
    candidateIds,
  });
  if (invalid) return { error: invalid };

  const admin = createAdminClient();
  const { error } = await admin.from("approval_line_templates").upsert(
    {
      tenant_id: user.tenantId,
      owner_id: user.id,
      name,
      approver_ids: approvers,
      ref_ids: refs,
    },
    { onConflict: "tenant_id,owner_id,name" },
  );
  if (error) {
    const missing = /does not exist|Could not find the table|PGRST205/i.test(error.message);
    return {
      error: missing
        ? "전자결재 표가 아직 준비되지 않았습니다(마이그레이션 0213a 적용 필요)"
        : `결재선 저장 실패 — ${error.message}`,
    };
  }
  revalidatePath("/approvals/new");
  return { ok: true, notice: `결재선 '${name}'을(를) 저장했습니다` };
}

/** 내 템플릿 삭제 — 본인 것만(owner_id 필터). */
export async function deleteLineTemplate(
  _prev: ApprovalActionState,
  formData: FormData,
): Promise<ApprovalActionState> {
  const gate = await requireApprovalWriter();
  if ("error" in gate) return { error: gate.error };
  const { user } = gate;

  const id = String(formData.get("templateId") ?? "").trim();
  if (!id) return { error: "삭제할 결재선을 찾을 수 없습니다" };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("approval_line_templates")
    .delete()
    .eq("id", id)
    .eq("tenant_id", user.tenantId)
    .eq("owner_id", user.id) // 남의 템플릿은 못 지운다
    .select("id")
    .maybeSingle();
  if (error) return { error: `삭제 실패 — ${error.message}` };
  if (!data) return { error: "본인이 저장한 결재선만 삭제할 수 있습니다" };
  revalidatePath("/approvals/new");
  return { ok: true, notice: "저장된 결재선을 삭제했습니다" };
}

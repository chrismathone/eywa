import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchInChunks } from "@/lib/supabase/batch";
import { kstToday } from "@/lib/date-kst";
import { resolveLeavePeriod, type LeavePeriod } from "@/features/leave/accrual";
import { applyLeaveGrantOverride } from "@/features/leave/test-grants";
import type { LeaveKind } from "@/features/leave/request-days";
import { getTenantSettings } from "@/features/owner/server/queries";
import { compareByJobRank } from "../job-rank";
import type { ApprovalForm, DocStatus, StepDecision } from "../types";

/**
 * 전자결재 조회. 읽기는 **세션 클라이언트 + RLS**(기안자·결재자·원장)로만 한다 —
 * 쓰기는 서버 액션(service_role)이 담당한다(0213a 주석).
 *
 * ⚠️ 조회 실패를 삼키지 않고 `loadError`로 올린다 — 2026-08-14에 RLS 재귀로 페이지가 통째로 500이
 *    되면서 화면에 단서가 한 글자도 안 남았다([[#109]]). 빈 목록으로 위장하지도 않는다.
 * ⚠️ 임베드는 FK를 **명시**한다([[#94]] — users로 가는 FK가 하나 더 생기면 힌트 없는 임베드는 PGRST201).
 */

const DOC_COLS = `id, doc_no, form_type, title, drafter_id, status, current_step,
  submitted_at, completed_at, outcome_note`;

export type LeaveLoadError = { summary: string; raw: string };

export type ApprovalStepCell = {
  stepNo: number;
  approverId: string;
  approverName: string;
  /** 결재란 칸 위에 찍히는 직급(종이 결재 문법 — 위 직급/가운데 사인/아래 이름). 없으면 roleLabel 폴백. */
  approverJobTitle: string | null;
  roleLabel: string;
  decision: StepDecision;
  decidedAt: string | null;
  comment: string | null;
  /** 대결 실제 처리자 이름(부재자 대신 결재). null = 본인 결재. */
  actedByName: string | null;
};

export type LeaveFormDetail = {
  userId: string;
  kind: LeaveKind;
  startDate: string;
  endDate: string;
  days: number;
  reason: string | null;
  periodStart: string;
  periodEnd: string;
  grantedDays: number;
};

export type BasicFormDetail = { bodyHtml: string };

export type ExpenseFormDetail = {
  amount: number;
  spendDate: string;
  category: string;
  bodyHtml: string;
};

export type IncomeFormDetail = {
  amount: number;
  incomeDate: string;
  category: string;
  bodyHtml: string;
};

export type ApprovalRefCell = { userId: string; name: string };

export type ApprovalDocRow = {
  id: string;
  docNo: string;
  form: ApprovalForm;
  title: string;
  drafterId: string;
  drafterName: string;
  drafterJobTitle: string | null;
  status: DocStatus;
  currentStep: number;
  submittedAt: string;
  completedAt: string | null;
  outcomeNote: string | null;
  steps: ApprovalStepCell[];
  refs: ApprovalRefCell[];
  leave: LeaveFormDetail | null;
  /** 품의서·업무연락 상세(양식 구분은 form). 해당 양식이 아니면 null. */
  basic: BasicFormDetail | null;
  /** 지출결의서 상세. 해당 양식이 아니면 null. */
  expense: ExpenseFormDetail | null;
  /** 수입결의서 상세. 해당 양식이 아니면 null. */
  income: IncomeFormDetail | null;
};

type Raw = Record<string, unknown>;

function isMissingRelationText(msg: string): boolean {
  return /PGRST205|PGRST20[12]|42P01|does not exist|Could not find the table/i.test(msg);
}

/** 실패 사유를 한글 한 줄로. 원문은 툴팁으로만 내보낸다(UI에 영문 원문 노출 금지). */
export function describeLoadError(e: unknown): LeaveLoadError {
  const raw = e instanceof Error ? e.message : String(e);
  if (/42P17|infinite recursion/i.test(raw)) {
    return { summary: "결재 데이터 접근 정책에 문제가 있습니다 — 관리자에게 알려주세요", raw };
  }
  if (isMissingRelationText(raw)) return { summary: "전자결재 표가 아직 준비되지 않았습니다", raw };
  if (/permission denied|42501/i.test(raw)) return { summary: "결재 문서를 볼 권한이 없습니다", raw };
  return { summary: "결재 문서를 불러오지 못했습니다 — 잠시 후 다시 시도해 주세요", raw };
}

export function isMissingRelation(error: { code?: string; message?: string } | null): boolean {
  return !!error && isMissingRelationText(`${error.code ?? ""} ${error.message ?? ""}`);
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** 문서 id 목록 → 문서 + 결재선 + 참조 + 휴가 상세를 붙여 돌려준다(네 조회는 서로 독립 → 병렬, B4). */
async function loadDocs(ids: string[]): Promise<ApprovalDocRow[]> {
  if (ids.length === 0) return [];
  const supabase = await createClient();

  const [docs, steps, refs, leaves, basics, expenses, incomes] = await Promise.all([
    fetchInChunks<Raw>(ids, (chunk) =>
      supabase
        .from("approval_documents")
        .select(
          `${DOC_COLS}, drafter:users!approval_documents_drafter_id_fkey(display_name, job_title)`,
        )
        .in("id", chunk),
    ),
    fetchInChunks<Raw>(ids, (chunk) =>
      supabase
        .from("approval_steps")
        .select(
          "document_id, step_no, approver_id, role_label, decision, decided_at, comment, acted_by, approver:users!approval_steps_approver_id_fkey(display_name, job_title), actor:users!approval_steps_acted_by_fkey(display_name)",
        )
        .in("document_id", chunk)
        .order("step_no", { ascending: true }),
    ),
    fetchInChunks<Raw>(ids, (chunk) =>
      supabase
        .from("approval_refs")
        .select("document_id, user_id, viewer:users!approval_refs_user_id_fkey(display_name)")
        .in("document_id", chunk),
    ),
    fetchInChunks<Raw>(ids, (chunk) =>
      supabase
        .from("leave_forms")
        .select(
          "document_id, user_id, leave_kind, start_date, end_date, days, reason, period_start, period_end, granted_days",
        )
        .in("document_id", chunk),
    ),
    // ⚠️ 0215a 미적용 DB에서도 죽지 않아야 한다([[#95]] expand/contract) — 표 부재는 빈 목록으로 접는다.
    fetchInChunks<Raw>(ids, (chunk) =>
      supabase.from("approval_basic_forms").select("document_id, body_html").in("document_id", chunk),
    ).catch((e) => {
      if (isMissingRelationText(String(e))) return [] as Raw[];
      throw e;
    }),
    fetchInChunks<Raw>(ids, (chunk) =>
      supabase
        .from("approval_expense_forms")
        .select("document_id, amount, spend_date, category, body_html")
        .in("document_id", chunk),
    ).catch((e) => {
      if (isMissingRelationText(String(e))) return [] as Raw[];
      throw e;
    }),
    fetchInChunks<Raw>(ids, (chunk) =>
      supabase
        .from("approval_income_forms")
        .select("document_id, amount, income_date, category, body_html")
        .in("document_id", chunk),
    ).catch((e) => {
      if (isMissingRelationText(String(e))) return [] as Raw[];
      throw e;
    }),
  ]);

  const stepsBy = new Map<string, ApprovalStepCell[]>();
  for (const s of steps) {
    const key = String(s.document_id);
    const approver = s.approver as { display_name?: string; job_title?: string | null } | null;
    const actor = s.actor as { display_name?: string } | null;
    const list = stepsBy.get(key) ?? [];
    list.push({
      stepNo: num(s.step_no),
      approverId: String(s.approver_id),
      approverName: approver?.display_name ?? "(이름 없음)",
      approverJobTitle: approver?.job_title ?? null,
      roleLabel: (s.role_label as string) ?? "승인",
      decision: s.decision as StepDecision,
      decidedAt: (s.decided_at as string | null) ?? null,
      comment: (s.comment as string | null) ?? null,
      actedByName: s.acted_by ? (actor?.display_name ?? "(이름 없음)") : null,
    });
    stepsBy.set(key, list);
  }

  const refsBy = new Map<string, ApprovalRefCell[]>();
  for (const r of refs) {
    const key = String(r.document_id);
    const viewer = r.viewer as { display_name?: string } | null;
    const list = refsBy.get(key) ?? [];
    list.push({ userId: String(r.user_id), name: viewer?.display_name ?? "(이름 없음)" });
    refsBy.set(key, list);
  }

  const leaveBy = new Map<string, LeaveFormDetail>();
  for (const l of leaves) {
    leaveBy.set(String(l.document_id), {
      userId: String(l.user_id),
      kind: (l.leave_kind === "half" ? "half" : "annual") as LeaveKind,
      startDate: String(l.start_date),
      endDate: String(l.end_date),
      days: num(l.days),
      reason: (l.reason as string | null) ?? null,
      periodStart: String(l.period_start),
      periodEnd: String(l.period_end),
      grantedDays: num(l.granted_days),
    });
  }

  const basicBy = new Map<string, BasicFormDetail>();
  for (const b of basics) {
    basicBy.set(String(b.document_id), { bodyHtml: (b.body_html as string) ?? "" });
  }
  const incomeBy = new Map<string, IncomeFormDetail>();
  for (const i of incomes) {
    incomeBy.set(String(i.document_id), {
      amount: num(i.amount),
      incomeDate: String(i.income_date),
      category: (i.category as string) ?? "기타",
      bodyHtml: (i.body_html as string) ?? "",
    });
  }
  const expenseBy = new Map<string, ExpenseFormDetail>();
  for (const e of expenses) {
    expenseBy.set(String(e.document_id), {
      amount: num(e.amount),
      spendDate: String(e.spend_date),
      category: (e.category as string) ?? "기타",
      bodyHtml: (e.body_html as string) ?? "",
    });
  }

  return docs.map((d) => {
    const drafter = d.drafter as { display_name?: string; job_title?: string | null } | null;
    const id = String(d.id);
    return {
      id,
      docNo: String(d.doc_no),
      form: d.form_type as ApprovalForm,
      title: String(d.title),
      drafterId: String(d.drafter_id),
      drafterName: drafter?.display_name ?? "(이름 없음)",
      drafterJobTitle: drafter?.job_title ?? null,
      status: d.status as DocStatus,
      currentStep: num(d.current_step),
      submittedAt: String(d.submitted_at),
      completedAt: (d.completed_at as string | null) ?? null,
      outcomeNote: (d.outcome_note as string | null) ?? null,
      steps: (stepsBy.get(id) ?? []).sort((a, b) => a.stepNo - b.stepNo),
      refs: refsBy.get(id) ?? [],
      leave: leaveBy.get(id) ?? null,
      basic: basicBy.get(id) ?? null,
      expense: expenseBy.get(id) ?? null,
      income: incomeBy.get(id) ?? null,
    };
  });
}

/** 내 차례인가 — 문서가 진행중이고 현재 단계의 결재자가 나. 결재 가능 판정의 단일 소스. */
export function isMyTurn(doc: ApprovalDocRow, userId: string): boolean {
  if (doc.status !== "pending") return false;
  const step = doc.steps.find((s) => s.stepNo === doc.currentStep);
  return !!step && step.approverId === userId && step.decision === "pending";
}

/** 내가 **후결 확인**을 해야 하는 문서인가 — 부재로 건너뛰어진 내 칸(deferred). 문서 종결 후에도 남는다. */
export function needsMyDeferredConfirm(doc: ApprovalDocRow, userId: string): boolean {
  return doc.steps.some((s) => s.approverId === userId && s.decision === "deferred");
}

/**
 * 결재함 — **하이웍스 문서함 구성**을 따른다(원장 지시 2026-08-14 "하이웍스 기준으로"):
 *   결재할 문서(내 차례) / 결재 예정(내 차례가 올 문서) / 진행(내가 관여한 진행중) /
 *   완료 / 반려·회수 / 참조(열람만).
 * ⚠️ 임시저장·합의·수신·회람은 이번 범위 밖(0213a 주석 — 필요해지면 kind로 확장).
 */
export type ApprovalBoxes = {
  ready: boolean;
  loadError: LeaveLoadError | null;
  /** 결재할 문서 — 내 차례(오래된 기안 먼저: 먼저 올라온 것부터 처리). */
  waiting: ApprovalDocRow[];
  /** 결재 예정 — 내가 결재선에 있지만 아직 내 차례가 아닌 진행 문서. */
  upcoming: ApprovalDocRow[];
  /** 진행 문서 — 내가 기안했거나 이미 결재한, 아직 진행중인 문서. */
  inProgress: ApprovalDocRow[];
  /** 완료 문서 — 승인으로 끝난, 내가 관여한 문서. */
  completed: ApprovalDocRow[];
  /** 반려·회수 문서 — 반려 또는 기안자 회수로 끝난, 내가 관여한 문서. */
  rejected: ApprovalDocRow[];
  /** 참조 문서 — 내가 참조로 지정된 문서(결재하지 않고 열람). */
  refDocs: ApprovalDocRow[];
  /** 전체 — 내가 관련된 모든 문서(기안·결재선·참조), 최근 기안 먼저(하이웍스 문서함 '전체'). */
  all: ApprovalDocRow[];
};

const EMPTY_BOXES: ApprovalBoxes = {
  ready: true,
  loadError: null,
  waiting: [],
  upcoming: [],
  inProgress: [],
  completed: [],
  rejected: [],
  refDocs: [],
  all: [],
};

/** 결재함 전부를 한 번에 — 문서 id를 모아 **한 벌만** 적재한다(같은 문서를 함마다 다시 읽지 않게). */
export async function getApprovalBoxes(userId: string): Promise<ApprovalBoxes> {
  const supabase = await createClient();

  const [mine, asApprover, asRef] = await Promise.all([
    supabase
      .from("approval_documents")
      .select("id")
      .eq("drafter_id", userId)
      .order("submitted_at", { ascending: false })
      .limit(200),
    supabase
      .from("approval_steps")
      .select("document_id")
      .eq("approver_id", userId)
      .order("created_at", { ascending: false })
      .limit(300),
    supabase
      .from("approval_refs")
      .select("document_id")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(300),
  ]);

  const err = mine.error ?? asApprover.error ?? asRef.error;
  if (err) {
    if (isMissingRelation(err)) return { ...EMPTY_BOXES, ready: false };
    return { ...EMPTY_BOXES, loadError: describeLoadError(new Error(err.message)) };
  }

  const refIds = new Set((asRef.data ?? []).map((r) => String(r.document_id)));
  const ids = [
    ...new Set([
      ...(mine.data ?? []).map((r) => String(r.id)),
      ...(asApprover.data ?? []).map((r) => String(r.document_id)),
      ...refIds,
    ]),
  ];
  if (ids.length === 0) return EMPTY_BOXES;

  let docs: ApprovalDocRow[];
  try {
    docs = await loadDocs(ids);
  } catch (e) {
    return { ...EMPTY_BOXES, loadError: describeLoadError(e) };
  }

  const byNewest = (a: ApprovalDocRow, b: ApprovalDocRow) =>
    b.submittedAt.localeCompare(a.submittedAt);
  const myStep = (d: ApprovalDocRow) => d.steps.find((s) => s.approverId === userId);
  /** 내가 관여했는가 = 기안자이거나 결재선에 있다(참조는 별도 함). */
  const involved = (d: ApprovalDocRow) => d.drafterId === userId || !!myStep(d);

  return {
    ready: true,
    loadError: null,
    // 후결 확인 대기도 결재 대기함에 함께 담는다 — 부재자가 돌아와 확인할 유일한 자리다.
    waiting: docs
      .filter((d) => isMyTurn(d, userId) || needsMyDeferredConfirm(d, userId))
      .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt)),
    upcoming: docs
      .filter((d) => {
        if (d.status !== "pending") return false;
        const s = myStep(d);
        return !!s && s.stepNo > d.currentStep;
      })
      .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt)),
    inProgress: docs
      .filter((d) => {
        if (d.status !== "pending") return false;
        if (d.drafterId === userId) return true;
        const s = myStep(d);
        return !!s && s.decision !== "pending"; // 내가 이미 결재했고 다음 사람 차례
      })
      .sort(byNewest),
    completed: docs.filter((d) => d.status === "approved" && involved(d)).sort(byNewest),
    rejected: docs
      .filter((d) => (d.status === "rejected" || d.status === "canceled") && involved(d))
      .sort(byNewest),
    refDocs: docs.filter((d) => refIds.has(d.id)).sort(byNewest),
    // ids 자체가 "내가 관련된 문서"의 합집합이라 docs 전부가 곧 전체함이다.
    all: [...docs].sort(byNewest),
  };
}

/** 문서 1건(상세). 볼 수 없는 문서는 RLS가 걸러 null. */
export async function getApprovalDoc(id: string): Promise<ApprovalDocRow | null> {
  const docs = await loadDocs([id]);
  return docs[0] ?? null;
}

export type ApprovalPerson = { id: string; name: string; jobTitle: string | null };

/**
 * 결재자·참조자 **후보 명단** = **활성 직원 전원**(원장 2026-08-14: *"테스트를 둘이 하는 거지,
 * 결재자랑 이런 건 직원들 다 있어야지"*). 하이웍스의 조직도 선택 대응 — 메뉴 노출(파일럿 2명)과
 * 별개로, 결재선에는 누구든 지정할 수 있다.
 *
 * ⚠️ 파일럿 명단 밖 직원이 결재자가 되면 사이드바에 전자결재 메뉴는 없지만, **벨 알림의 문서 링크로**
 *    들어가 결재할 수 있다(문서 열람·결재 자격은 메뉴가 아니라 동결된 결재선이 근거 — 결정 로그).
 * 학생 계정은 제외. **직급 서열순**(원장 2026-08-14 "직급 기준으로 정렬" — 서열 소스는 학원설정
 * `operations.jobTitles` 배열 순서, 매칭 규칙은 job-rank.ts). 직원 수십 명 규모라 상한 500이면
 * 절단 위험 없음(B2 명시 상한).
 */
export async function getApproverCandidates(): Promise<ApprovalPerson[]> {
  const supabase = await createClient();
  const [{ data }, settings] = await Promise.all([
    supabase
      .from("users")
      .select("id, display_name, job_title")
      .neq("status", "inactive")
      .neq("system_role", "student")
      .limit(500),
    getTenantSettings(), // React cache — 레이아웃에서 이미 부른 요청이면 왕복 0
  ]);
  const order = settings.operations.jobTitles;
  return (data ?? [])
    .map((u) => ({
      id: String(u.id),
      name: (u.display_name as string) ?? "(이름 없음)",
      jobTitle: (u.job_title as string | null) ?? null,
    }))
    .sort((a, b) => compareByJobRank(a, b, order));
}

export type ApprovalLineTemplate = {
  id: string;
  name: string;
  approverIds: string[];
  refIds: string[];
};

/** 자주 쓰는 결재선(본인 것, RLS self) — 이름순. 표가 없으면 빈 목록(파일럿 안전망). */
export async function getMyLineTemplates(): Promise<ApprovalLineTemplate[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("approval_line_templates")
    .select("id, name, approver_ids, ref_ids")
    .order("name", { ascending: true })
    .limit(50);
  if (error || !data) return [];
  const toIds = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
  return data.map((t) => ({
    id: String(t.id),
    name: String(t.name),
    approverIds: toIds(t.approver_ids),
    refIds: toIds(t.ref_ids),
  }));
}

export type LeaveBalance = {
  hireDate: string | null;
  period: LeavePeriod | null;
  used: number;
  pending: number;
  remaining: number;
};

/**
 * 내 연차 현황 — 부여는 **입사일에서 계산**하고(accrual.ts), 사용·대기는 결재 문서에서 센다.
 * 잔여 = 부여 − 승인 − 진행중(진행중을 미리 빼야 같은 연차를 두 번 올리지 못한다).
 */
export async function getMyLeaveBalance(userId: string): Promise<LeaveBalance> {
  const supabase = await createClient();
  const today = kstToday();
  const { data: me } = await supabase.from("users").select("hire_date").eq("id", userId).maybeSingle();
  const hireDate = (me?.hire_date as string | null) ?? null;
  // 테스트 계정 부여 오버라이드(파일럿 전용 — test-grants.ts) 적용 후의 부여가 이 화면의 진실이다.
  const period = applyLeaveGrantOverride(userId, resolveLeavePeriod(hireDate, today));
  const zero = { hireDate, period, used: 0, pending: 0, remaining: period?.granted ?? 0 };
  if (!period) return zero;

  // 본인·한 구간이라 행 수가 작다(상한 명시로 절단 위험 차단, B2).
  const { data, error } = await supabase
    .from("leave_forms")
    .select("days, doc:approval_documents!leave_forms_document_id_fkey(status)")
    .eq("user_id", userId)
    .eq("period_start", period.start)
    .limit(500);
  if (error || !data) return zero;

  let used = 0;
  let pending = 0;
  for (const row of data as Raw[]) {
    const doc = row.doc as { status?: string } | null;
    if (doc?.status === "approved") used += num(row.days);
    else if (doc?.status === "pending") pending += num(row.days);
  }
  const r1 = (v: number) => Math.round(v * 10) / 10;
  return {
    hireDate,
    period,
    used: r1(used),
    pending: r1(pending),
    remaining: Math.max(0, r1(period.granted - used - pending)),
  };
}

import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchInChunks } from "@/lib/supabase/batch";
import { kstToday } from "@/lib/date-kst";
import { resolveLeavePeriod, type LeavePeriod } from "@/features/leave/accrual";
import type { LeaveKind } from "@/features/leave/request-days";
import { approvalLineFor } from "../access";
import { stepRoleLabels, type ApprovalForm, type DocStatus, type StepDecision } from "../types";

/**
 * 전자결재 조회. 읽기는 **세션 클라이언트 + RLS**(기안자·결재자·원장)로만 한다 —
 * 쓰기는 서버 액션(service_role)이 담당한다(0212a 주석).
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
  roleLabel: string;
  decision: StepDecision;
  decidedAt: string | null;
  comment: string | null;
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
  leave: LeaveFormDetail | null;
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

/** 문서 id 목록 → 문서 + 결재선 + 휴가 상세를 붙여 돌려준다(세 조회는 서로 독립 → 병렬, B4). */
async function loadDocs(ids: string[]): Promise<ApprovalDocRow[]> {
  if (ids.length === 0) return [];
  const supabase = await createClient();

  const [docs, steps, leaves] = await Promise.all([
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
          "document_id, step_no, approver_id, role_label, decision, decided_at, comment, approver:users!approval_steps_approver_id_fkey(display_name)",
        )
        .in("document_id", chunk)
        .order("step_no", { ascending: true }),
    ),
    fetchInChunks<Raw>(ids, (chunk) =>
      supabase
        .from("leave_forms")
        .select(
          "document_id, user_id, leave_kind, start_date, end_date, days, reason, period_start, period_end, granted_days",
        )
        .in("document_id", chunk),
    ),
  ]);

  const stepsBy = new Map<string, ApprovalStepCell[]>();
  for (const s of steps) {
    const key = String(s.document_id);
    const approver = s.approver as { display_name?: string } | null;
    const list = stepsBy.get(key) ?? [];
    list.push({
      stepNo: num(s.step_no),
      approverId: String(s.approver_id),
      approverName: approver?.display_name ?? "(이름 없음)",
      roleLabel: (s.role_label as string) ?? "승인",
      decision: s.decision as StepDecision,
      decidedAt: (s.decided_at as string | null) ?? null,
      comment: (s.comment as string | null) ?? null,
    });
    stepsBy.set(key, list);
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
      leave: leaveBy.get(id) ?? null,
    };
  });
}

/** 내 차례인가 — 문서가 진행중이고 현재 단계의 결재자가 나. 결재 가능 판정의 단일 소스. */
export function isMyTurn(doc: ApprovalDocRow, userId: string): boolean {
  if (doc.status !== "pending") return false;
  const step = doc.steps.find((s) => s.stepNo === doc.currentStep);
  return !!step && step.approverId === userId && step.decision === "pending";
}

export type ApprovalBoxes = {
  ready: boolean;
  loadError: LeaveLoadError | null;
  /** 결재 대기 — 내 차례인 문서(오래된 기안 먼저). */
  waiting: ApprovalDocRow[];
  /** 상신함 — 내가 올린 문서(최근 기안 먼저). */
  drafted: ApprovalDocRow[];
  /** 완료함 — 내가 결재선에 있었고 이미 끝난 문서. */
  done: ApprovalDocRow[];
};

/** 결재함 3종을 한 번에 — 문서 id를 모아 한 벌만 적재한다(같은 문서를 세 번 읽지 않게). */
export async function getApprovalBoxes(userId: string): Promise<ApprovalBoxes> {
  const empty: ApprovalBoxes = { ready: true, loadError: null, waiting: [], drafted: [], done: [] };
  const supabase = await createClient();

  const [mine, asApprover] = await Promise.all([
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
  ]);

  const err = mine.error ?? asApprover.error;
  if (err) {
    if (isMissingRelation(err)) return { ...empty, ready: false };
    return { ...empty, loadError: describeLoadError(new Error(err.message)) };
  }

  const ids = [
    ...new Set([
      ...(mine.data ?? []).map((r) => String(r.id)),
      ...(asApprover.data ?? []).map((r) => String(r.document_id)),
    ]),
  ];
  if (ids.length === 0) return empty;

  let docs: ApprovalDocRow[];
  try {
    docs = await loadDocs(ids);
  } catch (e) {
    return { ...empty, loadError: describeLoadError(e) };
  }

  const byNewest = (a: ApprovalDocRow, b: ApprovalDocRow) =>
    b.submittedAt.localeCompare(a.submittedAt);
  return {
    ready: true,
    loadError: null,
    // 먼저 올라온 기안을 먼저 처리하는 게 결재 순서의 상식이라 대기함만 오래된 순.
    waiting: docs.filter((d) => isMyTurn(d, userId)).sort((a, b) => a.submittedAt.localeCompare(b.submittedAt)),
    drafted: docs.filter((d) => d.drafterId === userId).sort(byNewest),
    done: docs
      .filter((d) => d.status !== "pending" && d.steps.some((s) => s.approverId === userId))
      .sort(byNewest),
  };
}

/** 문서 1건(상세). 볼 수 없는 문서는 RLS가 걸러 null. */
export async function getApprovalDoc(id: string): Promise<ApprovalDocRow | null> {
  const docs = await loadDocs([id]);
  return docs[0] ?? null;
}

export type ApprovalLineMember = { id: string; name: string; jobTitle: string | null; roleLabel: string };

/**
 * 기안 화면에 보여줄 **결재선 미리보기** — 누가 어떤 순서로 받는지 올리기 전에 보여준다(그룹웨어 관행).
 * 순서는 `approvalLineFor`가 정하고, 여기서는 이름만 붙인다(이름이 없는 id도 자리는 지킨다).
 */
export async function getApprovalLinePreview(drafterId: string): Promise<ApprovalLineMember[]> {
  const ids = approvalLineFor(drafterId);
  if (ids.length === 0) return [];
  const supabase = await createClient();
  const { data } = await supabase.from("users").select("id, display_name, job_title").in("id", ids);
  const byId = new Map((data ?? []).map((u) => [String(u.id), u]));
  const roles = stepRoleLabels(ids.length);
  return ids.map((id, i) => {
    const u = byId.get(id);
    return {
      id,
      name: (u?.display_name as string) ?? "(이름 없음)",
      jobTitle: (u?.job_title as string | null) ?? null,
      roleLabel: roles[i] ?? "승인",
    };
  });
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
  const period = resolveLeavePeriod(hireDate, today);
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

import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchInChunks } from "@/lib/supabase/batch";
import { kstToday } from "@/lib/date-kst";
import { resolveLeavePeriod, type LeavePeriod } from "../accrual";
import type { LeaveKind } from "../request-days";
import type { LeaveDecision, LeaveStatus } from "../types";

/**
 * 휴가 신청 조회. 읽기는 **세션 클라이언트 + RLS**(본인 것 / 내가 결재자인 건 / master)로만 한다 —
 * 쓰기는 서버 액션(service_role)이 담당한다(0210a 주석).
 *
 * ⚠️ [[#95]] 표가 아직 없을 수 있다(SQL은 원장이 손으로 적용). 조회 실패를 삼키지 않고 `ready:false`로
 *    올려 화면이 "준비 중" 안내로 접히게 한다 — 파일럿 화면 하나만 접히고 다른 메뉴는 무영향.
 */

const SELECT_COLS = `id, user_id, leave_kind, start_date, end_date, days, reason, status,
  decided_at, decision_note, period_start, period_end, granted_days, created_at`;

export type LeaveApprovalCell = {
  approverId: string;
  approverName: string;
  decision: LeaveDecision;
  decidedAt: string | null;
  note: string | null;
};

export type LeaveRequestRow = {
  id: string;
  userId: string;
  requesterName: string;
  kind: LeaveKind;
  startDate: string;
  endDate: string;
  days: number;
  reason: string | null;
  status: LeaveStatus;
  decidedAt: string | null;
  decisionNote: string | null;
  periodStart: string;
  periodEnd: string;
  grantedDays: number;
  createdAt: string;
  approvals: LeaveApprovalCell[];
};

export type MyLeaveOverview = {
  /** 표가 준비됐는지(마이그레이션 적용 여부). false면 화면이 안내만 띄운다. */
  ready: boolean;
  hireDate: string | null;
  /** 오늘이 속한 연차 구간. 입사일이 없으면 null. */
  period: LeavePeriod | null;
  /** 이 구간에서 승인된 일수 */
  used: number;
  /** 이 구간에서 결재 대기 중인 일수(잔여에서 미리 뺀다 — 이중 신청 방지) */
  pending: number;
  remaining: number;
  requests: LeaveRequestRow[];
};

type RawRow = Record<string, unknown>;

/** "표가 없다"류 에러인지 — 스키마 미적용과 진짜 장애를 구분한다. */
function isMissingRelation(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const msg = `${error.code ?? ""} ${error.message ?? ""}`;
  return /PGRST205|PGRST20[12]|42P01|does not exist|Could not find the table/i.test(msg);
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function mapRow(r: RawRow, requesterName: string, approvals: LeaveApprovalCell[]): LeaveRequestRow {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    requesterName,
    kind: (r.leave_kind === "half" ? "half" : "annual") as LeaveKind,
    startDate: String(r.start_date),
    endDate: String(r.end_date),
    days: num(r.days),
    reason: (r.reason as string | null) ?? null,
    status: r.status as LeaveStatus,
    decidedAt: (r.decided_at as string | null) ?? null,
    decisionNote: (r.decision_note as string | null) ?? null,
    periodStart: String(r.period_start),
    periodEnd: String(r.period_end),
    grantedDays: num(r.granted_days),
    createdAt: String(r.created_at),
    approvals,
  };
}

/** 신청 id들의 결재선을 한 번에 — 결재자 이름까지(FK 명시: [[#94]]). */
async function loadApprovals(ids: string[]): Promise<Map<string, LeaveApprovalCell[]>> {
  const map = new Map<string, LeaveApprovalCell[]>();
  if (ids.length === 0) return map;
  const supabase = await createClient();
  const rows = await fetchInChunks<RawRow>(ids, (chunk) =>
    supabase
      .from("leave_approvals")
      .select(
        "request_id, approver_id, decision, decided_at, note, approver:users!leave_approvals_approver_id_fkey(display_name)",
      )
      .in("request_id", chunk)
      .order("step", { ascending: true }),
  );
  for (const r of rows) {
    const key = String(r.request_id);
    const approver = r.approver as { display_name?: string } | null;
    const list = map.get(key) ?? [];
    list.push({
      approverId: String(r.approver_id),
      approverName: approver?.display_name ?? "(이름 없음)",
      decision: r.decision as LeaveDecision,
      decidedAt: (r.decided_at as string | null) ?? null,
      note: (r.note as string | null) ?? null,
    });
    map.set(key, list);
  }
  return map;
}

/**
 * 내 연차 현황 + 내 신청 내역. 부여 일수는 표가 아니라 **입사일에서 계산**한다(accrual.ts).
 * 잔여 = 부여 − 승인 − 대기(대기분을 미리 빼야 같은 연차를 두 번 신청하지 못한다).
 */
export async function getMyLeaveOverview(userId: string): Promise<MyLeaveOverview> {
  const supabase = await createClient();
  const today = kstToday();

  const { data: me } = await supabase.from("users").select("hire_date").eq("id", userId).maybeSingle();
  const hireDate = (me?.hire_date as string | null) ?? null;
  const period = resolveLeavePeriod(hireDate, today);

  // 내 신청 전건(본인 것이라 행 수가 작다 — 정렬 + 상한으로 절단 위험 차단, B2).
  const { data, error } = await supabase
    .from("leave_requests")
    .select(SELECT_COLS)
    .eq("user_id", userId)
    .order("start_date", { ascending: false })
    .limit(200);

  if (error) {
    if (isMissingRelation(error)) {
      return { ready: false, hireDate, period, used: 0, pending: 0, remaining: period?.granted ?? 0, requests: [] };
    }
    throw new Error(`휴가 신청 조회 실패 — ${error.message}`);
  }

  const rows = (data ?? []) as RawRow[];
  const approvals = await loadApprovals(rows.map((r) => String(r.id)));
  const requests = rows.map((r) => mapRow(r, "", approvals.get(String(r.id)) ?? []));

  // 잔여 계산은 **지금 구간에 속한 건**만 본다(구간이 넘어가면 다시 부여되므로).
  const inPeriod = period ? requests.filter((r) => r.periodStart === period.start) : [];
  const used = sum(inPeriod.filter((r) => r.status === "approved").map((r) => r.days));
  const pending = sum(inPeriod.filter((r) => r.status === "pending").map((r) => r.days));
  const granted = period?.granted ?? 0;

  return {
    ready: true,
    hireDate,
    period,
    used,
    pending,
    remaining: Math.max(0, round1(granted - used - pending)),
    requests,
  };
}

function sum(values: number[]): number {
  return round1(values.reduce((a, b) => a + b, 0));
}

/** 0.5 단위 합산의 부동소수 잔재 제거(2.9999999 → 3). */
function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/**
 * 전자결재함 — **내가 결재자로 걸린** 신청서(본인이 낸 건은 결재선에 없으니 자연히 빠진다).
 * 결재 대기가 위로 오고, 처리된 건은 최근 순으로 뒤에 붙는다.
 */
export async function getLeaveApprovalInbox(
  approverId: string,
): Promise<{ ready: boolean; rows: LeaveRequestRow[] }> {
  const supabase = await createClient();
  const { data: cells, error: cellErr } = await supabase
    .from("leave_approvals")
    .select("request_id")
    .eq("approver_id", approverId)
    .order("created_at", { ascending: false })
    .limit(300);

  if (cellErr) {
    if (isMissingRelation(cellErr)) return { ready: false, rows: [] };
    throw new Error(`결재함 조회 실패 — ${cellErr.message}`);
  }
  const ids = [...new Set((cells ?? []).map((c) => String(c.request_id)))];
  if (ids.length === 0) return { ready: true, rows: [] };

  // ⚠️ 신청자 이름은 FK를 **명시**해 임베드한다([[#94]] — 나중에 users로 가는 FK가 하나 더 생기면
  //    힌트 없는 임베드는 PGRST201로 화면 전체를 죽인다).
  const rows = await fetchInChunks<RawRow>(ids, (chunk) =>
    supabase
      .from("leave_requests")
      .select(`${SELECT_COLS}, requester:users!leave_requests_user_id_fkey(display_name, job_title)`)
      .in("id", chunk)
      .order("created_at", { ascending: false }),
  );

  const approvals = await loadApprovals(ids);
  const mapped = rows.map((r) => {
    const requester = r.requester as { display_name?: string } | null;
    return mapRow(r, requester?.display_name ?? "(이름 없음)", approvals.get(String(r.id)) ?? []);
  });

  // 결재 대기 먼저(그 안에선 오래된 신청 먼저 = 먼저 낸 사람이 먼저), 처리된 건은 최근 순.
  // ⚠️ 상태 문자열을 직접 비교하면 approved↔rejected 쌍이 0을 돌려줘 날짜 정렬이 통째로 빠진다.
  const pendingFirst = (s: LeaveStatus) => (s === "pending" ? 0 : 1);
  return {
    ready: true,
    rows: mapped.sort((a, b) => {
      const rank = pendingFirst(a.status) - pendingFirst(b.status);
      if (rank !== 0) return rank;
      return a.status === "pending"
        ? a.createdAt.localeCompare(b.createdAt)
        : b.createdAt.localeCompare(a.createdAt);
    }),
  };
}

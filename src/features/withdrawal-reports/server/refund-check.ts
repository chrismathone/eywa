import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchInChunks } from "@/lib/supabase/batch";
import { missingReportSchema, type WithdrawalReport } from "../model";
import { buildRefundCheck, type RefundCheck, type RefundDecision, type RefundHoldState } from "../refund-decision";
import type { RefundOutcome } from "../approval-lines";
import { laterInvoicesFor, loadLaterInvoices, refundScopeOf } from "./refund";
import { orphanSubjects } from "../target-courses";

/**
 * 원장 환불 결정(원장 2026-11-06 · DB s2_0036)의 서버 재료.
 * 🔴 처리할 수 있는 요청(제출·승인 · 처리일 apply · 바로 처리 · release)은 **그 요청 안에서** `loadGroupRefundCheck`를 계산해 DB에 넘긴다.
 *    DB는 확인 값이 없으면 처리하지 않는다 — 한 경로가 계산을 빠뜨려도 처리되지 않는 쪽으로 닫힌다.
 */
type GroupReport = Pick<WithdrawalReport, "id" | "tenant_id" | "student_id" | "effective_date" | "exit_kind" | "subjects" | "snapshot"> & { group_id?: string | null; group_leader?: boolean };
/** 칸·표가 없는 DB(s2_0036 전)인가 — 그때는 결정·표시 없이(종전 화면) 연다(#95). */
const missingDecisionSchema = (error: { code?: string; message?: string } | null) => missingReportSchema(error) || error?.code === "42703";

/**
 * 묶음의 환불 확인 값 — 보고서마다(대표 보고서 먼저) 지금 환불할 수 있는 줄(`loadLaterInvoices` · `lineRefundable` — 화면과 같은 계산).
 * 퇴원 묶음은 보고서마다 같은 줄(과목을 가리지 않는다)이라 대표 보고서 하나로 센다. 못 읽으면 던진다(부르는 쪽은 처리를 맡기지 않는다).
 * 🔴 과목 수강종료는 **묶음의 대상 과목 전체**로 한 번 더 센다(결정 2026-11-06) — 작성 강사 화면 기준이면 작성 강사가 없는 대상 과목 줄이
 *   빠져 결정 없이 처리될 수 있었다. 어느 보고서 화면에도 없는 줄은 대표 보고서 몫(대표 보고서 화면은 `orphanSubjects` 줄까지 보인다).
 *   이 계산은 줄을 더하기만 한다(빼지 않는다) — 화면과 어긋나면 원장이 정할 수 없어 '환불 결정 대기'로 남는다(처리하지 않는 쪽).
 */
export async function loadGroupRefundCheck(tenantId: string, groupId: string): Promise<RefundCheck> {
  const db = createAdminClient();
  const { data, error } = await db.from("withdrawal_reports")
    .select("id,tenant_id,student_id,effective_date,exit_kind,subjects,snapshot,group_leader")
    .eq("tenant_id", tenantId).eq("group_id", groupId).order("group_leader", { ascending: false }).order("id").limit(30);
  if (error) throw new Error(`환불 확인용 보고서 조회 실패: ${error.message}`);
  // 줄을 잡는 요청서는 이 묶음에 이어진 것뿐이다(팀장 결정 2026-11-06) — 묶음 id를 함께 넘긴다.
  const reports = ((data ?? []) as GroupReport[]).map(r => ({ ...r, group_id: groupId }));
  if (!reports.length) throw new Error("환불 확인용 보고서를 찾지 못했습니다.");
  const leader = reports[0]!;
  // asOf = 줄을 계산하기 **전에** DB가 낸 학생의 퇴원월 뒤 청구 **내용 지문**(void 포함 · DB note와 같은 함수 · 리뷰 r2 D-12) — 계산 중·뒤에 청구가 바뀌면
  // 처리 순간 다시 낸 지문과 달라 보류된다. 시각(max(updated_at) = 거래 시작 시각)으로 비교하면 늦게 커밋된 긴 거래의 변경을 놓쳤다.
  const { data: fingerprint, error: fpError } = await db.rpc("withdrawal_refund_later_fingerprint", { p_tenant: tenantId, p_student: leader.student_id, p_month: leader.effective_date.slice(0, 7) });
  if (fpError) throw new Error(`환불 확인용 청구 지문 조회 실패: ${fpError.message}`);
  if (typeof fingerprint !== "string" || !fingerprint) throw new Error("환불 확인용 청구 지문을 읽지 못했습니다.");
  const asOf = fingerprint;
  // 처리 범위 — 처리 함수가 과목 수강종료를 전체 퇴원으로 바꿀 조건이면 전체 범위로 센다(리뷰 #13 · DB note와 같은 판정).
  const scope = await refundScopeOf(leader);
  const meta = { asOf, scope };
  if (scope === "withdrawal") {
    return buildRefundCheck([{ reportId: leader.id, later: await loadLaterInvoices({ ...leader, exit_kind: "withdrawal" }, { orphans: [], scope }) }], meta);
  }
  const { data: group, error: groupError } = await db.from("withdrawal_report_groups").select("subjects").eq("tenant_id", tenantId).eq("id", groupId).maybeSingle();
  if (groupError) throw new Error(`환불 확인용 묶음 조회 실패: ${groupError.message}`);
  if (!group) throw new Error("환불 확인용 묶음을 찾지 못했습니다.");
  const groupSubjects = (group.subjects ?? []) as string[];
  const orphans = leader.group_leader ? orphanSubjects(groupSubjects, reports.map(r => r.subjects)) : [];
  const [own, whole] = await Promise.all([
    Promise.all(reports.map(r => loadLaterInvoices(r, { orphans: r === leader ? orphans : [], scope }))),
    laterInvoicesFor({ ...leader, subjects: [...new Set([...groupSubjects, ...reports.flatMap(r => r.subjects)])] }),
  ]);
  return buildRefundCheck([...reports.map((r, i) => ({ reportId: r.id, later: own[i]! })), { reportId: leader.id, later: whole }], meta);
}

/**
 * 관문 DB 준비(리뷰 #5) — 새 앱 + 옛 DB(s2_0036 전)면 처리 함수가 확인 값을 모른 채 처리한다(열린 쪽). 제출·승인·바로 처리·release·처리일 cron은
 * 이 값이 false면 부르지 않는다(거절 · 'DB 적용 전'). 함수가 없으면 false · 그 밖의 오류는 던진다(부르는 쪽이 처리하지 않는다).
 * 🔑 판정은 s2_0036이 만들고 되돌리기가 **지우는** 표식 함수(`withdrawal_refund_gate_ready`)로 한다(리뷰 r2 D-7) — 칸(refund_hold)은 되돌려도 남아
 *    '새 앱 + 되돌린 DB'에서 참이 되어 확인 값을 옛 처리 함수(확인 값 무시)에 넘겼다.
 */
export async function refundGateReady(): Promise<boolean> {
  const { data, error } = await createAdminClient().rpc("withdrawal_refund_gate_ready");
  if (!error) return data === true;
  // 운영자가 알아볼 수 있게 서버 로그에만 SQL 번호를 남긴다(화면 글 `REFUND_GATE_NOT_READY`엔 없다 — 리뷰 r2 m13).
  if (missingDecisionSchema(error)) { console.error("[withdrawal-refund-gate] s2_0036 적용 전이거나 되돌림(관문 표식 함수 withdrawal_refund_gate_ready 없음) — 관문 경로를 막았습니다."); return false; }
  throw new Error(`퇴원보고서 환불 관문 확인 실패: ${error.message}`);
}
// 리뷰 r2 m13 — 작성 강사도 보는 글이라 SQL 번호·'관리자'(이 앱에선 승인 관리자) 대신 할 일만. 운영자 확인용 번호는 오류 보고(서버 로그)에 남긴다.
export const REFUND_GATE_NOT_READY = "시스템 준비 중이라 제출·승인을 잠시 막았습니다. 원장에게 알려 주세요.";

/** 묶음의 원장 환불 결정 — 줄 키 → 결정('환불'이면 그 요청서가 아직 있나). 표가 없는 DB는 빈 지도. */
export async function loadRefundDecisions(tenantId: string, groupId: string): Promise<Map<string, RefundDecision>> {
  const db = createAdminClient();
  const { data, error } = await db.from("withdrawal_report_refund_decisions").select("line_key,decision,document_id,paid_net,paid_seen").eq("tenant_id", tenantId).eq("group_id", groupId).limit(1000);
  if (missingDecisionSchema(error)) return new Map();
  if (error) throw new Error(`환불 결정 조회 실패: ${error.message}`);
  const rows = (data ?? []) as { line_key: string; decision: "refund" | "none"; document_id: string | null; paid_net?: number | string | null; paid_seen?: number | string | null }[];
  const docIds = [...new Set(rows.flatMap(r => r.document_id ? [r.document_id] : []))];
  const live = new Set(docIds.length ? (await fetchInChunks<{ id: string }>(docIds, async chunk =>
    (await db.from("academy_documents").select("id").eq("tenant_id", tenantId).eq("form_type", "refund_request").in("id", chunk)) as unknown as { data: { id: string }[] | null; error: { message: string } | null }))
    .map(d => String(d.id)) : []);
  return new Map(rows.map(r => [r.line_key, { decision: r.decision, live: r.decision === "refund" && !!r.document_id && live.has(r.document_id),
    paidNet: r.paid_net == null ? null : Number(r.paid_net), paidSeen: r.paid_seen == null ? null : Number(r.paid_seen), documentId: r.document_id }]));
}

/** '환불 결정 대기' 표시가 선 묶음(DB `refund_hold`) → 결정할 줄을 보이는 보고서(원장 할 일이 걸린 보고서 · 없으면 null). 칸이 없는 DB는 빈 지도. */
export async function loadRefundHolds(tenantId: string, groupIds: readonly (string | null | undefined)[]): Promise<Map<string, string | null>> {
  const ids = [...new Set(groupIds.filter((g): g is string => !!g))];
  if (!ids.length) return new Map();
  const db = createAdminClient();
  type Row = { id: string; refund_hold_report: string | null };
  const rows = await fetchInChunks<Row>(ids, async chunk => {
    const res = await db.from("withdrawal_report_groups").select("id,refund_hold_report").eq("tenant_id", tenantId).eq("refund_hold", true).in("id", chunk);
    if (missingDecisionSchema(res.error)) return { data: [], error: null };
    return res as unknown as { data: Row[] | null; error: { message: string } | null };
  });
  return new Map(rows.map(r => [String(r.id), r.refund_hold_report ? String(r.refund_hold_report) : null]));
}

/**
 * 상세용 — 묶음의 DB '환불 결정 대기' 표시 한 벌(대기 · 결정할 줄을 보이는 보고서 · 마지막 판정 시각 · 리뷰 r2 (b)). 목록 칩과 같은 칸이다.
 * 칸이 없는 DB(s2_0036 전) · 묶음 없음은 null(모름 — 상세는 어긋남을 말하지 않는다). 그 밖의 오류는 던진다(부르는 쪽이 모름으로 접는다).
 */
export async function loadRefundHoldState(tenantId: string, groupId: string): Promise<RefundHoldState | null> {
  const { data, error } = await createAdminClient().from("withdrawal_report_groups").select("refund_hold,refund_hold_report,refund_undecided,refund_checked_at")
    .eq("tenant_id", tenantId).eq("id", groupId).maybeSingle();
  if (missingDecisionSchema(error)) return null;
  if (error) throw new Error(`환불 결정 대기 조회 실패: ${error.message}`);
  if (!data) return null;
  const row = data as { refund_hold?: boolean | null; refund_hold_report?: string | null; refund_undecided?: string[] | null; refund_checked_at?: string | null };
  return { hold: row.refund_hold === true, report: row.refund_hold_report ? String(row.refund_hold_report) : null,
    undecided: Array.isArray(row.refund_undecided) ? row.refund_undecided.length : 0, checkedAt: row.refund_checked_at ? String(row.refund_checked_at) : null };
}

/**
 * 묶음마다 원장 결정 요약(승인 진행의 '✓ 결정한 원장' — 원장 2026-11-06) — 환불 승인이 하나라도 있으면 'refund', 아니면 'none' ·
 * 그 결정을 마지막에 한 사람·시각. 결정이 없는 묶음은 빠진다. 표가 없는 DB(s2_0036 전)는 빈 지도.
 */
export async function loadRefundOutcomes(tenantId: string, groupIds: readonly (string | null | undefined)[]): Promise<Map<string, RefundOutcome>> {
  const ids = [...new Set(groupIds.filter((g): g is string => !!g))];
  if (!ids.length) return new Map();
  const db = createAdminClient();
  type Row = { group_id: string; decision: "refund" | "none"; decided_by: string | null; decided_at: string };
  const rows = await fetchInChunks<Row>(ids, async chunk => {
    const res = await db.from("withdrawal_report_refund_decisions").select("group_id,decision,decided_by,decided_at").eq("tenant_id", tenantId).in("group_id", chunk).order("decided_at");
    if (missingDecisionSchema(res.error)) return { data: [], error: null };
    return res as unknown as { data: Row[] | null; error: { message: string } | null };
  });
  const out = new Map<string, RefundOutcome>();
  for (const id of ids) {
    const mine = rows.filter(r => String(r.group_id) === id);
    const pick = mine.some(r => r.decision === "refund") ? mine.filter(r => r.decision === "refund") : mine;
    const last = pick.reduce<Row | undefined>((a, r) => (!a || r.decided_at >= a.decided_at ? r : a), undefined);
    if (last) out.set(id, { outcome: last.decision, by: last.decided_by, at: last.decided_at });
  }
  return out;
}

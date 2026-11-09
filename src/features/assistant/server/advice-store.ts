import "server-only";
/**
 * 비서 의견 저장소 — 제안 → 결과 → 학습 1단계(2026-11-09 · SQL s2_0036). 앱의 관리자 연결(service_role)로만 읽고 쓴다
 * (표는 RLS 켬 · 정책 0 — 원장 관문 `assistantViewer`를 지난 뒤에만 부른다).
 * - 지금은 대화를 연 본인(묻는 사람)만 자기 의견을 본다·처리한다 — 대화가 사람별 비공개라서(지점 전체 '지난 의견 결과'는 다음 단계).
 * - 처리는 낙관적 잠금(`status_at`) — 다른 탭에서 먼저 바꿨으면 거절하고 다시 열게 한다.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchInChunks } from "@/lib/supabase/batch";
import { kstToday } from "@/lib/date-kst";
import { reportError } from "@/lib/observability/report-error";
import { ADVICE_VIEW_COLUMNS, adviceDrafts, adviceViewOf, type AdviceCheckResult, type AdviceRating, type AdviceRow, type AdviceStatus, type AdviceView } from "../advice";
import type { SettledReport } from "../report";
import type { Owner } from "./store";

export const ADVICE = "assistant_advice";
export const ADVICE_EVENTS = "assistant_advice_events";

/** 답을 저장한 뒤 그 답의 비서 의견을 줄마다 남긴다. 의견 블록이 없으면 아무것도 하지 않는다. */
export async function saveAdvice(
  owner: Owner,
  input: { messageId: string; threadId: string; report: SettledReport; checks: readonly AdviceCheckResult[]; askedOn: string },
): Promise<AdviceView[]> {
  const block = input.report.blocks.find((b) => b.type === "advice");
  if (!block || block.type !== "advice" || block.items.length === 0) return [];
  const now = new Date().toISOString();
  const rows = adviceDrafts(block.items, input.checks, input.askedOn).map((d) => ({
    ...d,
    tenant_id: owner.tenantId,
    message_id: input.messageId,
    thread_id: input.threadId,
    asked_by: owner.userId,
    baseline_at: d.baseline_value === null ? null : now,
  }));
  const { data, error } = await createAdminClient().from(ADVICE).insert(rows).select(ADVICE_VIEW_COLUMNS);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as AdviceRow[]).map(adviceViewOf).sort((a, b) => a.itemNo - b.itemNo);
}

/** 대화를 다시 열 때 — 답(message)마다 의견 처리 상태. 본인 의견만. */
export async function adviceForMessages(owner: Owner, messageIds: string[]): Promise<Map<string, AdviceView[]>> {
  const out = new Map<string, AdviceView[]>();
  if (messageIds.length === 0) return out;
  const db = createAdminClient();
  const rows = await fetchInChunks<AdviceRow>(messageIds, (chunk) =>
    db.from(ADVICE).select(ADVICE_VIEW_COLUMNS).in("message_id", chunk).eq("tenant_id", owner.tenantId).eq("asked_by", owner.userId).returns<AdviceRow[]>(),
  );
  for (const r of rows) {
    const list = out.get(r.message_id) ?? [];
    list.push(adviceViewOf(r));
    out.set(r.message_id, list);
  }
  for (const list of out.values()) list.sort((a, b) => a.itemNo - b.itemNo);
  return out;
}

export type AdviceUpdate = {
  status: AdviceStatus;
  /** 화면이 받은 status_at — 그 사이 다른 곳에서 바꿨으면 거절. */
  statusAt: string;
  memo?: string | null;
  doneOn?: string | null;
  selfRating?: AdviceRating | null;
};

/**
 * 원장 처리 — 채택 · 완료(한 날 · 해 본 내용 · 어땠나) · 보류 · 안 함(까닭) · 처리 전으로 되돌리기.
 * 완료가 아니면 한 날·평가는 비운다. 처리 이력은 새 줄로 남긴다(실패해도 처리는 산다 — 오류만 남긴다).
 */
export async function updateAdvice(
  owner: Owner,
  id: string,
  patch: AdviceUpdate,
): Promise<{ ok: true; view: AdviceView; from: AdviceStatus } | { ok: false; reason: "missing" | "stale" }> {
  const db = createAdminClient();
  const { data: current, error: readError } = await db
    .from(ADVICE)
    .select("status, status_at")
    .eq("id", id)
    .eq("tenant_id", owner.tenantId)
    .eq("asked_by", owner.userId)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  if (!current) return { ok: false, reason: "missing" };
  const from = current.status as AdviceStatus;
  const done = patch.status === "done";
  const memo = patch.status === "open" ? null : patch.memo?.trim() || null;
  const { data, error } = await db
    .from(ADVICE)
    .update({
      status: patch.status,
      status_memo: memo,
      status_by: owner.userId,
      // 처리 시각은 DB 시계로(트리거가 now()로 바꾼다 — 서버마다 시계가 달라도 순서가 맞게 · 적대 리뷰 2026-11-09).
      status_at: new Date().toISOString(),
      done_on: done ? patch.doneOn || kstToday() : null,
      self_rating: done ? (patch.selfRating ?? null) : null,
    })
    .eq("id", id)
    .eq("tenant_id", owner.tenantId)
    .eq("asked_by", owner.userId)
    .eq("status_at", patch.statusAt)
    .select(ADVICE_VIEW_COLUMNS)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return { ok: false, reason: "stale" };
  const view = adviceViewOf(data as unknown as AdviceRow);
  const { error: eventError } = await db.from(ADVICE_EVENTS).insert({
    tenant_id: owner.tenantId,
    advice_id: id,
    actor_id: owner.userId,
    from_status: from,
    to_status: patch.status,
    memo,
    done_on: view.doneOn,
    self_rating: view.selfRating,
  });
  if (eventError) reportError(new Error(eventError.message), { scope: "assistant.advice.event", tenantId: owner.tenantId });
  return { ok: true, view, from };
}

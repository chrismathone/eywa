import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { isFeatureOptedInFresh } from "@/lib/license/server";
import { SLACK_AGGREGATE_THRESHOLD, slackErrorKind } from "../format";
import { renderAggregate, renderDigest } from "../render";
import { isQuietAt, nextAwakeAt, type QuietConfig } from "../schedule";
import { slackPostDm, slackPostMessage, type SlackFail } from "./client";

/**
 * 아웃박스 → 슬랙. 보낼 시각이 된 줄을 **대상별로 묶어** 보낸다.
 *  · message: 한 곳에 4건 이상이면 종류별 건수 한 통(일괄 배정·출결 한꺼번에), 아니면 낱개
 *  · digest_item: 한 곳의 몫을 요약 한 통(방해금지 동안 쌓인 것·요약만 규칙)
 * 실패 처리(format.ts `slackErrorKind`): 토큰 문제 = 연결 '끊김' + 중단 / 대상 문제 = 그 건 포기 /
 * 한도 = Retry-After 뒤 / 일시 오류 = 1·5·15·60분 백오프, 5번째 실패나 보낼 시각에서 하루 지난 건은 포기.
 * 예산: 한 번 실행에 최대 40통 **그리고 `deadline`까지**(지점 리스보다 짧게 — 한 실행이 리스를 넘겨 다음 실행과 겹치면
 * 같은 줄을 두 번 보낸다, codex 2차) — 남은 건 다음 분에.
 * 1:1은 보내는 순간 **현재 연결을 다시 확인**한다 — 대기 중에 연결이 풀리면 안 보내고, 바뀌었으면 새 계정으로.
 */
const MAX_POSTS = 40;
const BACKOFF_MIN = [1, 5, 15, 60];
const GIVE_UP_ATTEMPTS = 5;
const GIVE_UP_AGE_MS = 24 * 60 * 60 * 1000;

type Row = { id: string; target: { kind: string; channelId?: string; slackUserId?: string; aywaUserId?: string; ping?: string; quiet?: boolean }; kind: string; body: string; group_label: string; created_at: string; due_at: string; attempt_count: number };
type Ping = "none" | "here" | "channel";

export type DeliverResult = { sent: number; authError: string | null };

export async function deliverDue(tenantId: string, token: string, now: Date, deadline: number, quiet: QuietConfig): Promise<DeliverResult> {
  const admin = createAdminClient();
  const nowIso = now.toISOString();
  const { data, error } = await admin
    .from("slack_outbox")
    .select("id, target, kind, body, group_label, created_at, due_at, attempt_count")
    .eq("tenant_id", tenantId)
    .eq("status", "pending")
    .lte("due_at", nowIso)
    .lte("next_attempt_at", nowIso)
    .order("created_at")
    .limit(400);
  if (error || !data?.length) return { sent: 0, authError: null };

  const groups = new Map<string, Row[]>();
  for (const r of data as Row[]) {
    const k = `${r.kind}|${JSON.stringify(r.target)}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }

  const dmCache = new Map<string, string>();
  let sent = 0;
  for (const rows of groups.values()) {
    if (sent >= MAX_POSTS || Date.now() > deadline) break;
    const target = rows[0].target;
    // 방해금지를 **보내는 순간에도** 본다 — 만들 때는 낮이었어도 재시도·밀림으로 밤에 나가려는 것은 아침 요약으로(grok 2차).
    if (rows[0].kind === "message" && target.quiet && isQuietAt(now, quiet)) {
      await update(tenantId, rows.map((r) => r.id), { kind: "digest_item", due_at: nextAwakeAt(now, quiet).toISOString() });
      continue;
    }
    // 1:1 대상 재확인 — 연결표가 정본이다(대기 줄에 박힌 슬랙 id는 만든 때의 것). **보내기 직전에** 그 사람 한 줄을 읽는다
    // (실행 시작 때 한 번 읽으면 발송 도중 바뀐 연결을 놓친다, codex 3차).
    const dmTo = target.kind === "dm" ? await currentSlackId(tenantId, target) : "";
    const ping = (target.ping as Ping) ?? "none";
    const items = rows.map((r) => ({ body: r.body, groupLabel: r.group_label, createdAt: new Date(r.created_at) }));
    const posts: { ids: string[]; text: string }[] =
      rows[0].kind === "digest_item"
        ? [{ ids: rows.map((r) => r.id), text: rows.length === 1 ? rows[0].body : renderDigest(items, ping) }]
        : rows.length > SLACK_AGGREGATE_THRESHOLD
          ? [{ ids: rows.map((r) => r.id), text: renderAggregate(items, ping) }]
          : rows.map((r) => ({ ids: [r.id], text: r.body }));

    for (const p of posts) {
      if (sent >= MAX_POSTS || Date.now() > deadline) break;
      // drain 시작 때의 요청 캐시를 믿지 않는다. 끄기·만료가 발송 도중 생겼으면 HTTP 요청 직전에 멈춘다.
      if (!(await isFeatureOptedInFresh(tenantId, "slack"))) return { sent, authError: null };
      const res =
        target.kind === "channel" && target.channelId
          ? await slackPostMessage(token, target.channelId, p.text)
          : target.kind === "dm" && dmTo
            ? await slackPostDm(token, dmTo, p.text, dmCache)
            : ({ ok: false, error: "not_linked" } as SlackFail);
      if (res.ok) {
        sent++;
        await update(tenantId, p.ids, { status: "sent", sent_at: nowIso, slack_channel_id: res.channel, slack_ts: res.ts });
        continue;
      }
      const kind = slackErrorKind(res.error);
      if (kind === "auth") return { sent, authError: res.error ?? "invalid_auth" }; // 대기 줄은 그대로 — 토큰을 고치면 이어서 나간다
      if (kind === "target" || res.error === "not_linked") {
        await update(tenantId, p.ids, { status: "dead", last_error_code: res.error });
      } else if (kind === "rate") {
        const wait = new Date(now.getTime() + ((res as SlackFail).retryAfter ?? 30) * 1000).toISOString();
        await update(tenantId, p.ids, { next_attempt_at: wait, last_error_code: "ratelimited" });
        break; // 이 대상은 이번 실행에서 그만
      } else {
        await retryOrGiveUp(tenantId, rows.filter((r) => p.ids.includes(r.id)), now, res.error);
      }
    }
  }
  return { sent, authError: null };
}

async function currentSlackId(tenantId: string, target: Row["target"]): Promise<string> {
  if (!target.aywaUserId) return target.slackUserId ?? "";
  const { data } = await createAdminClient()
    .from("slack_user_links")
    .select("slack_user_id")
    .eq("tenant_id", tenantId)
    .eq("aywa_user_id", target.aywaUserId)
    .maybeSingle();
  return (data?.slack_user_id as string | undefined) ?? "";
}

async function retryOrGiveUp(tenantId: string, rows: Row[], now: Date, code: string | null) {
  for (const r of rows) {
    const attempts = r.attempt_count + 1;
    // 포기 기준은 '보낼 시각'부터 — 금요일 밤에 생겨 월요일 아침에 보낼 요약이 첫 실패에 바로 포기되지 않게.
    const old = now.getTime() - new Date(r.due_at).getTime() > GIVE_UP_AGE_MS;
    if (attempts >= GIVE_UP_ATTEMPTS || old) {
      await update(tenantId, [r.id], { status: "dead", attempt_count: attempts, last_error_code: code ?? "gave_up" });
    } else {
      const wait = BACKOFF_MIN[Math.min(attempts - 1, BACKOFF_MIN.length - 1)] * 60_000;
      await update(tenantId, [r.id], {
        attempt_count: attempts,
        next_attempt_at: new Date(now.getTime() + wait).toISOString(),
        last_error_code: code ?? "network",
      });
    }
  }
}

async function update(tenantId: string, ids: string[], patch: Record<string, unknown>) {
  const admin = createAdminClient();
  for (let i = 0; i < ids.length; i += 100) {
    // 끄기·규칙 삭제가 먼저 취소한 줄을 늦은 HTTP 결과가 sent/dead로 되살리지 않는다.
    await admin
      .from("slack_outbox")
      .update(patch)
      .eq("tenant_id", tenantId)
      .eq("status", "pending")
      .in("id", ids.slice(i, i + 100));
  }
}

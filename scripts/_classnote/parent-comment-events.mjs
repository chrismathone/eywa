/**
 * scripts/_classnote/parent-comment-events.mjs — **오래된 글에 달린 학부모 댓글**을 잡는 신호(2026-10-02).
 *
 * 왜 필요한가(실사고 2026-10-02 김근호): 아버지가 15일 전(9/17) 글에 "두통있어서 오늘학원쉽니다"를 달았는데 아무도 몰랐다.
 * 댓글 폴러는 `num_comments` 스냅샷 대조라 **감시 창(10일) 안의 글**만 본다 — 그 밖의 글은 댓글 수가 변해도 보이지 않는다.
 * 창을 30일로 늘리면 10분마다 60페이지(하루 8,640회)를 읽어야 해서, 대신 **ClassNote 알림 목록**을 신호로 쓴다.
 *
 * 알림 목록 `GET /api/v1/me/notifications/`(읽기 전용, 실측 2026-10-02):
 *  - 학원 계정에는 **전 보드**의 댓글 알림(`code:"report_comment"`)이 온다. `object_id` = 글 번호 · `created` = 마지막 댓글 시각.
 *  - **글 하나에 한 줄**이고 새 댓글이 달리면 그 줄이 **새 번호로 맨 위에** 다시 선다(댓글 알림 58건 중 시각 역전 0건).
 *    → "지난번에 본 번호보다 큰 줄"만 보면 그 사이 댓글이 달린 글을 **글 나이와 무관하게** 전부 안다. 폴마다 보통 1페이지.
 *  - 줄에는 **마지막 댓글만** 실린다(여러 개가 한 줄로 접힌다) → 내용은 여기서 읽지 않고 그 글의 댓글 목록을 다시 연다.
 *  - 알림 시각은 댓글 시각보다 십여 초 늦을 수 있다(실측 11~12초) → 댓글을 고를 때 여유(`EVENT_SLACK_MS`)를 둔다.
 *
 * 여기는 **창 밖 글 전용 보조 경로**다 — 창 안 글은 종전 스냅샷 대조가 그대로 맡는다(두 경로가 같은 글을 같이 잡지 않게 창 안 글은 거른다).
 * 여유 구간 때문에 같은 댓글이 다시 후보가 될 수 있어, 벨은 호출부가 **링크(댓글 번호)로 이미 보낸 것**을 걸러낸다.
 */

/** 상태 행(`classnote_feed_state.scope`) — 마지막으로 본 알림 번호(`last_seen_post_id`)와 그 시각(`counts.lastCreated`). */
export const EVENT_SCOPE = "parent_comment_events";
/** 이 날수보다 오래된 글의 댓글은 알리지 않는다(원장 2026-10-02 *"30일내로는 잡도록 하자"*). */
export const EVENT_POST_MAX_AGE_DAYS = 30;
/** 알림 목록 백스톱 — 평소 1페이지. 연동 PC가 며칠 꺼졌다 켜졌을 때만 깊이 판다(전 종류 합쳐 하루 ~300줄 × 3일 = 9페이지). */
export const EVENT_MAX_PAGES = 15;
/** 알림이 댓글보다 늦게 서는 만큼의 여유 — 넉넉히 잡고 중복은 링크로 거른다. */
export const EVENT_SLACK_MS = 15 * 60_000;
/** 한 폴에서 여는 스냅샷 밖 글 수 상한(평소 0~2건) — 넘치면 오래된 것부터 처리하고 나머지는 다음 폴이 이어받는다. */
export const EVENT_REPORT_CAP = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** 이 페이지에서 멈춰도 되나 — 이미 본 번호에 닿았거나, 줄이 댓글 유효기간(maxAgeDays)보다 오래됐다. */
export function eventsPageDone(list, { lastId, nowMs = Date.now(), maxAgeDays = 3 } = {}) {
  const rows = list ?? [];
  if (!rows.length) return true;
  const tail = rows[rows.length - 1];
  if (lastId != null && Number(tail?.id) <= Number(lastId)) return true;
  const t = Date.parse(tail?.created ?? "");
  return Number.isFinite(t) && nowMs - t > maxAgeDays * DAY_MS;
}

/**
 * 알림 줄(최신순) → **창 밖 글 중 새 댓글이 달린 글 번호**와 다음 워터마크.
 *
 * @param {Array<{id:number, created:string, code:string, object_id:number}>} events
 * @param {{ lastId:number|null, lastCreated?:string|null, windowIds:Set<number>, nowMs?:number, maxAgeDays?:number, cap?:number }} opts
 *   windowIds = 스냅샷 대조가 맡는 글 번호(창 안에 있고 지난 스냅샷에도 있던 글). lastCreated = 지난 워터마크의 시각.
 * @returns {{ reportIds:number[], top:{id:number, created:string}|null, head:{id:number, created:string}|null, overflow:number, pending:number[] }}
 *   head = 이번에 본 **실제** 가장 큰 번호의 줄(상한과 무관 — 첫 실행의 기준선은 이것으로 잡는다).
 *   top = 다음 워터마크. 평소엔 이번에 본 가장 큰 번호의 줄. 줄이 하나도 없으면 null(워터마크 그대로).
 *   🔴 상한에 걸리면 **오래된 것부터** 처리하고 워터마크는 **처리한 줄까지만** 옮긴다(시각은 그대로 둔다) — 남은 글(pending)은
 *      다음 폴이 이어받는다. 최신부터 처리하고 맨 위로 전진하면 밀린 글이 영영 버려진다(연동 PC가 며칠 꺼졌다 켜진 경우).
 */
export function selectCommentEvents(events, { lastId, lastCreated = null, windowIds, nowMs = Date.now(), maxAgeDays = 3, cap = EVENT_REPORT_CAP } = {}) {
  let top = null;
  const newest = new Map(); // 글 번호 → 그 글의 가장 큰 알림 번호
  const createdOf = new Map(); // 알림 번호 → 그 줄의 시각
  for (const e of events ?? []) {
    const id = Number(e?.id);
    if (!Number.isFinite(id)) continue;
    if (!top || id > top.id) top = { id, created: String(e?.created ?? "") };
    if (lastId != null && id <= Number(lastId)) continue;
    if (e?.code !== "report_comment") continue;
    const t = Date.parse(e?.created ?? "");
    if (!Number.isFinite(t) || nowMs - t > maxAgeDays * DAY_MS) continue; // 밀린 알림 폭주 방지(댓글 age 가드와 같은 날수)
    const reportId = Number(e?.object_id);
    if (!Number.isFinite(reportId) || windowIds?.has(reportId)) continue;
    if (!newest.has(reportId) || id > newest.get(reportId)) newest.set(reportId, id);
    createdOf.set(id, String(e?.created ?? ""));
  }
  const picked = [...newest].map(([reportId, id]) => ({ reportId, id })).sort((a, b) => a.id - b.id); // 오래된 것부터
  const take = picked.slice(0, cap);
  const rest = picked.slice(cap);
  // 지난 시각을 모르면(있을 수 없지만) 처리한 마지막 줄의 시각이라도 적는다 — 빈 값으로 두면 다음 폴의 기준 시각이 사라진다.
  const mark = rest.length ? { id: rest[0].id - 1, created: String(lastCreated || take[take.length - 1]?.created || "") } : top;
  return {
    reportIds: take.map((p) => p.reportId),
    picked: take.map((p) => ({ ...p, created: createdOf.get(p.id) ?? "" })), // 글 번호 + 그 줄의 번호·시각(실패했을 때 워터마크를 세울 자리)
    top: mark,
    head: top,
    overflow: rest.length,
    pending: rest.map((p) => p.reportId),
  };
}

/** 실패한 글을 다시 보려고 워터마크를 세워 두는 한도 — 그 줄이 이보다 오래됐으면 포기하고 지나간다(한 글이 경로 전체를 오래 막지 않게). */
export const EVENT_RETRY_MS = 60 * 60_000;
/** 알림 목록 조회가 통째로 실패한 폴에서 기준선을 미루는 한도 — 댓글 유효기간(3일)과 같다(그보다 오래된 댓글은 어차피 알리지 않는다). */
export const FAILED_HOLD_MS = 3 * 24 * 60 * 60_000;
/** 처음 본 글(댓글이 이미 달린)의 기준선을 미루는 한도 — 글이 올라온 지 이 시간 안이면 알림 목록 경로가 읽을 때까지 기다린다. */
export const FIRST_SEEN_HOLD_MS = 60 * 60_000;

/**
 * 실패한 글이 있을 때의 워터마크 — 실패한 줄 중 **한 시간 안에 선 가장 오래된 줄 바로 앞**까지만 옮긴다(시각은 지난 값 그대로).
 * 다음 폴이 그 줄부터 다시 본다(이미 보낸 벨은 링크 가드가 거른다). 한 시간이 지난 줄은 세우지 않는다.
 * @param {{id:number, created:string}|null} top 실패가 없을 때의 워터마크
 * @param {Array<{id:number, created:string}>} failed 읽지 못한 글의 알림 줄
 */
export function markAfterFailures(top, failed, { lastCreated = null, nowMs = Date.now(), retryMs = EVENT_RETRY_MS } = {}) {
  if (!top) return top;
  let holdAt = null;
  for (const f of failed ?? []) {
    const t = Date.parse(f?.created ?? "");
    if (!Number.isFinite(t) || nowMs - t > retryMs) continue;
    if (holdAt === null || f.id - 1 < holdAt) holdAt = f.id - 1;
  }
  return holdAt !== null && holdAt < top.id ? { id: holdAt, created: String(lastCreated || top.created || "") } : top;
}

/**
 * 스냅샷이 **처음 보는 글**(창 안인데 지난 스냅샷에 없던 글) 중 댓글이 이미 달린 글의 기준선을 고친다(`nextCounts`를 제자리에서).
 * 그 댓글은 스냅샷 경로가 못 본다(기준선으로만 잡힌다) — 알림 목록 경로가 맡는다:
 *  · 그 경로가 댓글을 읽은 글 → **읽은 댓글 수**로 기준선(다음 폴부터 스냅샷 경로가 이어받는다. 피드 값은 몇 초 전 것이라 그대로 쓰면
 *    그 사이 달린 댓글을 두 경로가 한 번씩 집는다).
 *  · 아직 못 읽은 글 → 기준선을 잡지 않는다(다음 폴에도 '처음 보는 글'로 남아 알림 목록 경로가 다시 받는다). 대상 = 밀려 있는 글
 *    (`pending`), 그리고 올라온 지 한 시간 안 된 글(알림 줄이 아직 안 섰거나 알림 목록 조회가 실패한 폴).
 *  · 한 시간이 넘은 글은 종전처럼 기준선을 잡는다 — 알림 목록이 오래 막혀도 그 뒤 댓글은 스냅샷 경로가 잡게.
 *    (알림 목록 조회가 **실패한 폴**은 그 한도가 3일이다 — `failed`.)
 */
export function settleFirstSeen(rows, counts, nextCounts, { read, pending, failed = false, nowMs = Date.now(), holdMs = FIRST_SEEN_HOLD_MS } = {}) {
  for (const r of rows ?? []) {
    const id = Number(r?.id);
    if (!Number.isFinite(id) || counts?.[String(id)] !== undefined) continue;
    // 읽은 글은 피드 값과 무관하게 읽은 댓글 수로(피드가 0이라고 했어도 그 사이 달린 댓글을 이미 처리했다).
    if (read?.has(id)) {
      nextCounts[String(id)] = read.get(id);
      continue;
    }
    if (!(Number(r?.num_comments ?? 0) > 0)) continue;
    const t = Date.parse(r?.created ?? "");
    // 알림 목록 조회가 통째로 실패한 폴(failed)은 한도를 댓글 유효기간(3일)까지 늘린다 — 연동 PC가 오래 꺼졌다 켜진 첫 폴에서
    // 그사이 올라온 글의 댓글을 기준선에 묻지 않게.
    const limit = failed ? FAILED_HOLD_MS : holdMs;
    const young = Number.isFinite(t) && nowMs - t < limit;
    if (pending?.has(id) || young) delete nextCounts[String(id)];
  }
}

/** 글이 감시 대상 나이를 넘었나(작성 시각 기준). 시각을 못 읽으면 넘은 것으로 본다(모르면 안 알린다). */
export function postTooOld(report, { nowMs = Date.now(), maxDays = EVENT_POST_MAX_AGE_DAYS } = {}) {
  const t = Date.parse(report?.created ?? "");
  if (!Number.isFinite(t)) return true;
  return nowMs - t > maxDays * DAY_MS;
}

/**
 * 창 밖 글의 댓글 목록 → **이번에 새로 달린 학부모 댓글**.
 * 기준 = 지난 워터마크 시각에서 여유를 뺀 뒤(`sinceMs`)에 달린 것 · 학부모가 쓴 것 · 댓글 유효기간(maxAgeDays) 안.
 * 🔴 스냅샷 경로의 "앞의 N개 건너뛰기"를 쓰지 않는다 — 창 밖 글은 기준 댓글 수를 모른다.
 */
export function pickEventComments(list, { sinceMs, nowMs = Date.now(), maxAgeDays = 3 } = {}) {
  const out = [];
  for (const k of list ?? []) {
    if (!Number.isFinite(Number(k?.id))) continue;
    if (k?.author?.type !== "parent") continue;
    const t = Date.parse(k?.created ?? "");
    if (!Number.isFinite(t)) continue;
    if (nowMs - t > maxAgeDays * DAY_MS) continue;
    if (Number.isFinite(sinceMs) && t <= sinceMs) continue;
    out.push(k);
  }
  return out.sort((a, b) => Number(a.id) - Number(b.id));
}

/** 알림 목록 1페이지 — cursor는 DRF next 토큰(쿼리 이름은 `page`, 피드와 같다). */
export async function fetchEventPage(page, cursor) {
  return page.evaluate(async (cur) => {
    const qs = new URLSearchParams({ page_size: "100" });
    if (cur) qs.set("page", cur);
    const r = await fetch(`/api/v1/me/notifications/?${qs}`, { headers: { accept: "application/json" } });
    if (!r.ok) throw new Error(`알림 목록 조회 실패 HTTP ${r.status}`);
    const j = await r.json();
    return { list: j?.results ?? [], next: j?.next ?? null };
  }, cursor);
}

/** 워터마크 위쪽 알림 줄 전부(상한·나이 컷오프까지). */
export async function collectEvents(page, { lastId, nowMs = Date.now(), maxAgeDays = 3, maxPages = EVENT_MAX_PAGES, log = () => {} } = {}) {
  const all = [];
  let cursor = null;
  for (let i = 0; i < maxPages; i++) {
    const { list, next } = await fetchEventPage(page, cursor);
    all.push(...list);
    if (lastId == null) return all; // 첫 실행 — 맨 위 한 페이지로 기준선만 잡는다
    if (!next || eventsPageDone(list, { lastId, nowMs, maxAgeDays })) return all;
    cursor = next;
  }
  log(`[comment] ⚠️ 알림 목록 ${maxPages}페이지(${all.length}줄)를 봤는데도 지난번 위치에 못 닿음 — 더 과거는 건너뜁니다`);
  return all;
}

/** 글 하나(피드 행과 같은 모양: id · created · class_name · cls · child · num_comments). 없는 글이면 null. */
export async function fetchReport(page, reportId) {
  return page.evaluate(async (id) => {
    const r = await fetch(`/api/v1/reports/${id}/`, { headers: { accept: "application/json" } });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`글 조회 실패 HTTP ${r.status}`);
    return r.json();
  }, reportId);
}

/**
 * 이미 보낸 댓글 벨을 계획에서 뺀다 — 링크에 댓글 번호가 실려 있어(`?comment=`) 같은 댓글·같은 사람을 정확히 짚는다.
 * **두 경로의 줄을 다 본다**: 알림 목록 경로는 여유 구간 때문에, 스냅샷 경로는 방금 올라온 글을 알림 목록 경로가 먼저 알린 뒤
 * 댓글 수 기준선이 어긋났을 때 같은 댓글이 다시 후보가 될 수 있다. 벨이 있을 때만 한 번 조회한다.
 * @returns {Promise<{rows:Array, dropped:number}>}
 */
export async function dropAlreadyBelled(sql, tenant, rows) {
  const links = [...new Set((rows ?? []).map((r) => r.link).filter(Boolean))];
  if (!links.length) return { rows: rows ?? [], dropped: 0 };
  const sent = await sql`
    select link, recipient_id from notifications
    where tenant_id = ${tenant} and type = 'classnote_parent_comment' and link = any(${links})`;
  const done = new Set(sent.map((r) => `${r.link}|${r.recipient_id}`));
  const kept = rows.filter((r) => !done.has(`${r.link}|${r.recipient_id}`));
  return { rows: kept, dropped: rows.length - kept.length };
}

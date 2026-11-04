/**
 * ClassNote **지금 반 보드 동기화** — 요청(0313a) 상태 판정·범위 합치기·쿨다운·멈춤 판정(순수, 서버·클라 공용).
 *
 * 원장 2026-09-30 *"지금 반 보드 동기화 버튼을 만들자 … 한번 누르면 다른곳에서 누르지 못하도록 중복 발동 방지"* ·
 * *"너무 과부하 일어나지 않게 필요한것만 동기화하게"*.
 * - 중복 발동 방지의 진짜 자물쇠는 DB(지점당 살아 있는 요청 하나 — 부분 유니크)다. 여기 판정은 **화면 표시**와
 *   서버 액션의 사전 판정(멈춘 요청 정리·쿨다운)을 한 벌로 맞추는 용도다.
 * - 워커는 같은 숫자를 `scripts/_classnote/classnote-sync-request.mjs`에 따로 적는다(앱·워커가 다른 런타임) —
 *   🔴 한쪽을 바꾸면 다른 쪽도 바꿀 것(가드: classnote-sync.test.ts가 두 파일의 숫자를 대조한다).
 * ⚠️ 순수 모듈 — `server-only` 금지(#61). 버튼(클라)이 import한다.
 */

/** 대기(pending)가 이만큼 지나도 안 집히면 연동 PC가 꺼진 것으로 본다(분). */
export const SYNC_PENDING_STALE_MIN = 30;
/** 실행 중(running)이 이만큼 지나면 멈춘 것으로 본다(분) — 수동 실행은 상한(반 15개)이 있어 몇 분이면 끝난다. */
export const SYNC_RUNNING_STALE_MIN = 20;
/** 끝난 뒤 다시 누를 수 있기까지(분) — ClassNote 로그인·조회 폭주 방지. 시간 초과로 끝난 요청엔 걸지 않는다. */
export const SYNC_COOLDOWN_MIN = 5;
/** 한 요청이 들고 갈 수 있는 반·학생 id 상한(합칠 때 포함) — 워커가 실제로 도는 반 수 상한은 워커 쪽(15). */
export const SYNC_SCOPE_MAX_IDS = 50;

export type SyncScope = { full: boolean; classIds: string[]; studentIds: string[] };

export type SyncRequestRow = {
  id: string;
  status: "pending" | "running" | "done" | "failed";
  requestedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  result: Record<string, unknown> | null;
  error: string | null;
  scope: SyncScope;
  mergeCount: number;
  /** 실행 중에 합류한 범위(0313a next_scope) — 워커가 끝나면 이 범위로 새 요청을 만든다. */
  nextScope: SyncScope | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ids = (v: unknown): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && UUID.test(x)))].slice(0, SYNC_SCOPE_MAX_IDS) : [];

/** 입력·DB 값 → 범위. 반·학생이 하나도 없으면 전체(차이 계산). 모르는 모양은 전체로(안전 — 워커가 차이만 본다). */
export function normalizeScope(raw: unknown): SyncScope {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const classIds = ids(o.classIds);
  const studentIds = ids(o.studentIds);
  const full = o.full === true || (!classIds.length && !studentIds.length);
  return { full, classIds, studentIds };
}

/** 대기 중 요청에 새 요청을 합친다 — 전체는 전체로 남고, 반·학생은 합집합(상한). */
export function mergeScope(a: SyncScope, b: SyncScope): SyncScope {
  return normalizeScope({
    full: a.full || b.full,
    classIds: [...a.classIds, ...b.classIds],
    studentIds: [...a.studentIds, ...b.studentIds],
  });
}

/** 같은 범위인가(합쳐도 바뀌는 게 없으면 쓰지 않는다). */
export function sameScope(a: SyncScope, b: SyncScope): boolean {
  const eq = (x: string[], y: string[]) => x.length === y.length && x.every((v) => y.includes(v));
  return a.full === b.full && eq(a.classIds, b.classIds) && eq(a.studentIds, b.studentIds);
}

/** 살아 있는 요청이 멈췄는가 — 멈췄으면 한글 사유(화면·error 칸), 아니면 null. */
export function staleReason(row: Pick<SyncRequestRow, "status" | "requestedAt" | "startedAt">, nowMs: number): string | null {
  if (row.status === "pending") {
    const age = nowMs - Date.parse(row.requestedAt);
    if (age > SYNC_PENDING_STALE_MIN * 60_000)
      return `연동 PC가 ${SYNC_PENDING_STALE_MIN}분 동안 요청을 받지 않아 취소했습니다 — 연동 PC가 켜져 있는지 확인하세요`;
  }
  if (row.status === "running") {
    const age = nowMs - Date.parse(row.startedAt ?? row.requestedAt);
    if (age > SYNC_RUNNING_STALE_MIN * 60_000)
      return `${SYNC_RUNNING_STALE_MIN}분이 지나도 끝나지 않아 시간 초과로 처리했습니다 — 다시 요청할 수 있습니다`;
  }
  return null;
}

/**
 * 쿨다운 남은 시간(ms). 시간 초과(`result.timedOut`)로 끝난 요청엔 걸지 않는다 — 이미 오래 기다렸다.
 * 자동 동기화(연동 PC가 스스로 낸 요청, `result.auto`)가 끝난 것에도 걸지 않는다(2026-10-03) — 자동은 달라진 반만 돈다.
 * 자동이 돌 때마다 버튼이 5분씩 잠기면 사람이 필요한 동기화(지목한 반·학생)를 요청할 틈이 없다.
 * (신입 1인 보드 준비는 2026-11-04부터 어디서도 하지 않는다 — 원장 "앞으로 1인보드에 배정 시키지마 절대".)
 * (지점당 살아 있는 요청 하나 · 자동 쪽 간격은 워커가 따로 지킨다.)
 */
export function cooldownLeftMs(latest: Pick<SyncRequestRow, "status" | "finishedAt" | "result"> | null, nowMs: number): number {
  if (!latest || (latest.status !== "done" && latest.status !== "failed") || !latest.finishedAt) return 0;
  if (latest.result && (latest.result.timedOut === true || latest.result.auto === true)) return 0;
  const left = Date.parse(latest.finishedAt) + SYNC_COOLDOWN_MIN * 60_000 - nowMs;
  return left > 0 ? left : 0;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null);

/** 결과 요약 — "반 3 · 배정 2 · 보류 1". 숫자만(워커가 적은 한글 문장은 `result.summary` — 툴팁용). */
export function syncResultBrief(result: Record<string, unknown> | null): string {
  if (!result) return "";
  if (result.noChange === true) return "변경 없음";
  const bits: string[] = [];
  const add = (label: string, v: unknown, always = false) => {
    const n = num(v);
    if (n !== null && (n > 0 || always)) bits.push(`${label} ${n}`);
  };
  add("반", result.classes, true);
  add("새 반", result.created);
  add("이름 변경", result.renamed);
  add("배정", result.enrolled, true);
  add("담임", result.teachers);
  add("1인 보드", result.boardsCreated);
  add("보류", result.held);
  add("남은 반", result.remaining);
  return bits.join(" · ");
}

/** KST HH:MM. */
export function kstHhmm(iso: string | null): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(t));
}

/** 버튼이 그릴 상태 — 서버 조회 결과 하나로 모든 화면이 같은 모양을 그린다. */
export type SyncButtonView =
  | { kind: "hidden" }
  | { kind: "idle"; last: string | null; lastTitle: string | null }
  | { kind: "pending"; since: string }
  | { kind: "running"; since: string }
  | { kind: "cooldown"; leftMin: number; last: string; lastTitle: string | null }
  /** 실패·멈춤 — leftMin=0이면 다시 누를 수 있다(멈춘 요청은 누르는 순간 서버가 정리하고 새로 요청한다). */
  | { kind: "failed"; reason: string; raw: string | null; leftMin: number }
  | { kind: "offline"; reason: string };

/**
 * 조회 결과 → 버튼 상태.
 * @param active  살아 있는 요청(대기·실행 중) — 멈췄으면 서버가 이미 null로 넘기지 않는다(표시만 '멈춤')
 * @param latest  마지막으로 끝난 요청
 */
export function deriveSyncView(a: {
  available: boolean;
  workerReady: boolean;
  active: SyncRequestRow | null;
  latest: SyncRequestRow | null;
  nowMs: number;
}): SyncButtonView {
  if (!a.available) return { kind: "hidden" };
  if (a.active && !staleReason(a.active, a.nowMs)) {
    return a.active.status === "running"
      ? { kind: "running", since: kstHhmm(a.active.startedAt ?? a.active.requestedAt) }
      : { kind: "pending", since: kstHhmm(a.active.requestedAt) };
  }
  if (a.active) return { kind: "failed", reason: staleReason(a.active, a.nowMs)!, raw: null, leftMin: 0 };
  const latest = a.latest;
  const summary = latest?.result && typeof latest.result.summary === "string" ? latest.result.summary : null;
  const left = cooldownLeftMs(latest, a.nowMs);
  if (latest?.status === "failed" && left > 0)
    return {
      kind: "failed",
      reason: latest.error || "동기화에 실패했습니다",
      raw: typeof latest.result?.raw === "string" ? latest.result.raw : null,
      leftMin: Math.ceil(left / 60_000),
    };
  if (!a.workerReady) return { kind: "offline", reason: "연동 PC가 꺼져 있거나 옛 버전이라 지금 동기화를 받을 수 없습니다 — 새벽 5시 정기 동기화는 그대로 돕니다" };
  const last = latest?.status === "done" ? `마지막 동기화 ${kstHhmm(latest.finishedAt)} · ${syncResultBrief(latest.result)}` : null;
  if (left > 0 && last) return { kind: "cooldown", leftMin: Math.ceil(left / 60_000), last, lastTitle: summary };
  return { kind: "idle", last, lastTitle: summary };
}

/** 이 시간 안에 심장박동이 있어야 연동 PC가 켜져 있다고 본다(분) — 워커는 폴과 따로 30초마다 갱신한다(POST 모드). */
export const SYNC_WORKER_ALIVE_MIN = 5;

/**
 * 연동 PC가 **지금 동기화 요청을 받을 수 있는가** — 살아 있고(최근 심장박동) · 실게시 PC이고(`postMode`, dry-run PC는 안 집는다) ·
 * 이 기능을 아는 버전(`caps.syncRequests`)인 PC가 하나라도 있으면 true. 옛 워커는 키가 없어 false(아무도 안 집는 '대기 중' 방지).
 */
export function workerReadyFromHeartbeats(rows: { last_seen: string | null; last_results: unknown }[], nowMs: number): boolean {
  return liveRequestWorkerCaps(rows, nowMs).length > 0;
}

/**
 * 연동 PC가 **낮 동안 달라진 반을 스스로 맞추는가**(자동 동기화, 2026-10-03) — 요청을 받을 수 있는 PC가 있고, 그 PC가 **전부**
 * `caps.autoBoardSync`를 내걸 때만 true(어느 PC가 발송 임대를 쥘지 모른다 — 하나라도 옛 버전·꺼 둔 PC면 약속하지 않는다).
 * 버튼 설명 문구만 가른다(동작 게이트가 아니다) — 연동 PC를 바꾸기 전·자동 동기화를 꺼 둔 지점에 없는 기능을 말하지 않게.
 */
export function workerAutoSyncFromHeartbeats(rows: { last_seen: string | null; last_results: unknown }[], nowMs: number): boolean {
  const caps = liveRequestWorkerCaps(rows, nowMs);
  return caps.length > 0 && caps.every((c) => c.autoBoardSync === true);
}

/** 살아 있고 · 실게시이고 · 동기화 요청을 아는 연동 PC들의 지원 표식. */
function liveRequestWorkerCaps(rows: { last_seen: string | null; last_results: unknown }[], nowMs: number): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const r of rows) {
    const seen = r.last_seen ? Date.parse(r.last_seen) : NaN;
    if (!Number.isFinite(seen) || nowMs - seen > SYNC_WORKER_ALIVE_MIN * 60_000) continue;
    const lr = r.last_results;
    if (!lr || typeof lr !== "object" || Array.isArray(lr)) continue;
    const o = lr as Record<string, unknown>;
    const caps = o.caps && typeof o.caps === "object" && !Array.isArray(o.caps) ? (o.caps as Record<string, unknown>) : {};
    if (o.postMode === true && caps.syncRequests === true) out.push(caps);
  }
  return out;
}

/** DB 행 → 화면 행(모르는 상태는 버린다). */
export function toSyncRow(r: Record<string, unknown>): SyncRequestRow | null {
  const status = r.status;
  if (status !== "pending" && status !== "running" && status !== "done" && status !== "failed") return null;
  const result = r.result && typeof r.result === "object" && !Array.isArray(r.result) ? (r.result as Record<string, unknown>) : null;
  return {
    id: String(r.id),
    status,
    requestedAt: String(r.requested_at),
    startedAt: (r.started_at as string | null) ?? null,
    finishedAt: (r.finished_at as string | null) ?? null,
    result,
    error: typeof r.error === "string" ? r.error : null,
    scope: normalizeScope(r.scope),
    mergeCount: typeof r.merge_count === "number" ? r.merge_count : 0,
    nextScope: r.next_scope && typeof r.next_scope === "object" ? normalizeScope(r.next_scope) : null,
  };
}

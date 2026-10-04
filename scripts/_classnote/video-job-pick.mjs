// 한 계정의 용량 부족·재연결이 다른 계정의 대기 작업을 끝까지 막지 않게, 앞쪽 일부만 보고 고른다.
const PROBE = 8;
const COOL_MS = 5 * 60_000;
const quotaCooled = new Map();
const authCooled = new Map();
const until = (map, key) => map.get(key) ?? 0;
const mark = (map, key, now, ms) => map.set(key, now + ms);

export function resetVideoJobPick() { quotaCooled.clear(); authCooled.clear(); }
export const videoAccountCooling = (key, now = Date.now()) => until(quotaCooled, key) > now || until(authCooled, key) > now;
/** 용량 때문에 식힌다. 인증 실패와 구분한다. 찍힌 작업은 이 식힘으로 미루지 않는다. */
export function coolVideoAccount(key, now = Date.now(), ms = COOL_MS) { mark(quotaCooled, key, now, ms); }

async function consider(job, hooks, now) {
  const decision = hooks.resolve(job);
  if (decision.kind === "skip") return { action: "skip" };
  if (decision.invalid) return { action: "mismatch", job };
  const key = decision.connectionId ?? "legacy";
  if (until(authCooled, key) > now) return { action: "defer", job };
  if (until(quotaCooled, key) > now && decision.kind !== "pinned") return { action: "defer", job };
  if (decision.kind === "pinned") {
    try {
      if (!(await hooks.owned(decision))) return { action: "mismatch", job };
    } catch { return { action: "requeue", job }; }
  }
  let auth;
  try { auth = await hooks.auth(decision); }
  catch (error) {
    mark(authCooled, key, now, COOL_MS);
    if (error?.code === "mismatch") return { action: "mismatch", job };
    if (error?.code === "reauth" || error?.code === "unauthorized") return { action: "defer", job };
    return { action: "requeue", job };
  }
  let paused = false;
  try { paused = await hooks.paused(auth, decision); }
  catch { return { action: "requeue", job }; }
  if (paused && decision.kind !== "pinned") {
    coolVideoAccount(key, now);
    return { action: "defer", job };
  }
  return { action: "ready", job, decision, auth, paused };
}

/** 준비된 작업을 먼저 집는다. 멈춘 계정의 새 작업은 실패로 두지 않고 뒤로 밀고, 이미 찍힌 작업은 다른 일이 없을 때만 끝낸다. */
export async function pickVideoJob(candidates, hooks) {
  const now = hooks.now?.() ?? Date.now();
  const list = candidates.slice(0, PROBE);
  let mismatched = false;
  let pausedPinned = null;
  for (const job of list) {
    const found = await consider(job, hooks, now);
    if (found.action === "mismatch") { mismatched = true; await hooks.fail(job); continue; }
    if (found.action === "requeue") { await hooks.requeue(job); continue; }
    if (found.action === "defer") { await hooks.defer(job); continue; }
    if (found.action !== "ready") continue;
    if (found.paused) { pausedPinned ??= found; continue; }
    const claimed = await hooks.claim(found.job);
    if (claimed) return { job: claimed, decision: found.decision, auth: found.auth, mismatched };
  }
  if (pausedPinned) {
    const claimed = await hooks.claim(pausedPinned.job);
    if (claimed) return { job: claimed, decision: pausedPinned.decision, auth: pausedPinned.auth, mismatched };
  }
  return { job: null, decision: null, auth: null, mismatched };
}

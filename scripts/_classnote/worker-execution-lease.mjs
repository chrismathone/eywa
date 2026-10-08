import { LEASE_SECONDS, LEASE_REFRESH_MS } from "./worker-lease.mjs";

export function workerLeaseApi(sql, tenant, instanceId) {
  if (process.env.SYNC_AGENT_MODE === "1") {
    const check = async () => {
      const { brokerCall } = await import("../_sync-agent/remote-db.cjs");
      const row = await brokerCall("lease-check", {});
      return [{ generation: row.generation, remaining_ms: row.remainingMs }];
    };
    return { claim: check, renew: check, release: async () => [] };
  }
  return {
    claim: () => sql`select * from public.claim_worker_execution_lease(${tenant}::uuid, 'classnote', ${instanceId}::uuid)`,
    renew: (generation) => sql`select * from public.renew_worker_execution_lease(${tenant}::uuid, 'classnote', ${instanceId}::uuid, ${generation}::bigint)`,
    release: (generation) => sql`select public.release_worker_execution_lease(${tenant}::uuid, 'classnote', ${instanceId}::uuid, ${generation}::bigint)`,
  };
}

// The local monotonic deadline starts BEFORE the request. Late replies cannot revive it.
export function createExecutionLease(api, {
  now = () => performance.now(), onLost = () => {}, localHeld = () => true,
  requestTimeoutMs = 10_000, refreshMs = LEASE_REFRESH_MS, watchdogMs = 1000,
} = {}) {
  let generation = null;
  let validUntil = 0;
  let lost = false;
  let acquiring = null;
  let renewing = false;
  let timer = null;
  let watchdog = null;
  const clearTimers = () => { clearInterval(timer); clearInterval(watchdog); timer = watchdog = null; };
  const lose = () => {
    if (lost) return;
    lost = true;
    validUntil = 0;
    clearTimers();
    onLost();
  };
  const valid = () => !lost && generation !== null && localHeld() && now() < validUntil;
  const request = async (call) => {
    let timeout;
    try {
      return await Promise.race([
        Promise.resolve().then(call),
        new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("워커 실행 잠금 응답이 지연되었습니다.")), requestTimeoutMs); }),
      ]);
    } finally { clearTimeout(timeout); }
  };
  const accept = (rows, started, previous) => {
    const row = rows?.[0];
    const remaining = Number(row?.remaining_ms);
    const next = String(row?.generation ?? "");
    if (!/^\d+$/.test(next) || BigInt(next) <= 0n || !Number.isFinite(remaining) || remaining <= 0 ||
        remaining > LEASE_SECONDS * 1000 || (previous !== null && next !== previous)) return false;
    const deadline = started + remaining - 10_000;
    if (lost || !localHeld() || now() >= deadline) return false;
    generation = next;
    validUntil = deadline;
    return true;
  };
  const renew = async () => {
    if (renewing || lost) return;
    if (!valid()) { lose(); return; }
    renewing = true;
    const started = now();
    try {
      const rows = await request(() => api.renew(generation));
      // A resumed event loop may deliver the response before the watchdog runs.
      // Once the previous local deadline has passed, this process must retire.
      if (!valid() || !accept(rows, started, generation)) lose();
    } catch { lose(); }
    finally { renewing = false; }
  };
  return {
    get generation() { return generation; },
    get held() { return valid(); },
    acquire() {
      if (lost) return Promise.resolve(false);
      if (generation !== null) { if (!valid()) lose(); return Promise.resolve(valid()); }
      if (!localHeld()) return Promise.resolve(false);
      if (acquiring) return acquiring;
      acquiring = (async () => {
        const started = now();
        const rows = await request(api.claim);
        if (!accept(rows, started, null)) return false;
        timer = setInterval(renew, refreshMs);
        watchdog = setInterval(() => { if (!valid()) lose(); }, watchdogMs);
        timer.unref?.(); watchdog.unref?.();
        return true;
      })().finally(() => { acquiring = null; });
      return acquiring;
    },
    assertHeld() {
      if (!valid()) { lose(); throw new Error("워커 실행 잠금을 확인하지 못해 작업을 중단했습니다."); }
    },
    renew,
    async release() {
      clearTimers();
      const owned = generation;
      generation = null;
      validUntil = 0;
      lost = true;
      if (owned !== null) await request(() => api.release(owned));
    },
  };
}

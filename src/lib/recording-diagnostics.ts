/**
 * 녹음 중단 진단 — 브라우저 쪽(보내기 · 다음 접속 때 남은 녹음 찾기). 판정은 `recording-diagnostics-core.ts`.
 * 모든 일은 best-effort다 — 실패해도 녹음·백업·화면에는 아무 영향이 없다.
 */
import { targetLockName } from "./browser-recording-channel";
import { classifyLeftover, browserFamily, INTERRUPT_REASONS, type InterruptReason } from "./recording-diagnostics-core";
import { getRecordingOwner } from "./browser-recording";
import { dropClearedMeta, listOwnerDiagnostics, patchRecoveryMeta, readRecoveryMeta, type RecordingMeta, type RecordingOwner, type RecoveryKind } from "./recording-recovery";

const PAGE_CLOSED = "eywa-rec-page-closed:";
const INTERRUPT = "eywa-rec-interrupt:";
/** 정상 종료 직후(잠금은 풀렸고 끝 기록은 아직 쓰는 중)를 강제 종료로 보지 않게 — 끝 기록 없는 것은 이만큼 뒤에 다시 본다(Codex 4차). */
const RECHECK_MS = 3000;

const STOP_REQUESTED = "eywa-rec-stop-requested:";
/** 녹음 끝내기를 눌렀다 — 끝 기록(비동기)이 쓰이기 전에 탭이 닫혀도 정상 종료로 보게 동기로 남긴다. */
export function markStopRequested(metaId: string): void {
  try { localStorage.setItem(STOP_REQUESTED + metaId, String(Date.now())); } catch { /* 저장소 막힘 */ }
}
function stopRequested(id: string): boolean {
  try { return localStorage.getItem(STOP_REQUESTED + id) !== null; } catch { return false; }
}

/** 처음 본 중단 사유를 동기 저장소에도 — 탭이 바로 닫혀 백업(비동기) 쓰기가 끝나지 못해도 남게. */
export function markInterrupt(metaId: string, reason: InterruptReason): void {
  try { localStorage.setItem(INTERRUPT + metaId, reason); } catch { /* 저장소 막힘 */ }
}
function localInterrupt(id: string): InterruptReason | null {
  try {
    const value = localStorage.getItem(INTERRUPT + id);
    return value && (INTERRUPT_REASONS as readonly string[]).includes(value) ? (value as InterruptReason) : null;
  } catch {
    return null;
  }
}

/** 녹음 중 문서가 내려간다 — 끝 처리(비동기)가 못 돌아도 남도록 동기 저장소에 표시한다. */
export function markPageClosed(metaIds: readonly string[]): void {
  try { for (const id of metaIds) localStorage.setItem(PAGE_CLOSED + id, String(Date.now())); } catch { /* 저장소 막힘 */ }
}
function pageClosed(id: string): boolean {
  try { return localStorage.getItem(PAGE_CLOSED + id) !== null; } catch { return false; }
}
function clearPageClosed(id: string): void {
  try { localStorage.removeItem(PAGE_CLOSED + id); localStorage.removeItem(INTERRUPT + id); localStorage.removeItem(STOP_REQUESTED + id); } catch { /* 저장소 막힘 */ }
}

function ownerOfMeta(meta: RecordingMeta): { tenantId: string; userId: string } | null {
  try {
    const [tenantId, userId] = JSON.parse(meta.scopeKey ?? "") as [string, string];
    return typeof tenantId === "string" && typeof userId === "string" && tenantId && userId ? { tenantId, userId } : null;
  } catch {
    return null;
  }
}

async function postInterruption(report: Record<string, unknown>): Promise<boolean> {
  const res = await fetch("/api/recordings/interruption", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(report),
    credentials: "same-origin",
    keepalive: true,
  });
  if (!res.ok) return false;
  const data = (await res.json().catch(() => null)) as { ok?: unknown } | null;
  return data?.ok === true;
}

async function send(meta: RecordingMeta, reason: InterruptReason, late: boolean, extra: { errorCode?: string | null; seconds?: number | null; endedAt?: number | null } = {}): Promise<void> {
  const owner = ownerOfMeta(meta);
  if (!owner) return;
  // 이 문서가 지금 그 계정일 때만 — 다른 계정으로 바뀐 뒤 보내면 서버가 지금 사람으로 적는다(서버도 대조한다).
  const current = getRecordingOwner();
  if (current && (current.tenantId !== owner.tenantId || current.userId !== owner.userId)) return;
  try {
    const live = !late && typeof document !== "undefined";
    // 🔴 서버 액션이 아니라 fetch — 셸이 마운트하자마자 부르는 자리다(gotchas #137). keepalive = 페이지를 닫는 중에도 보낸다.
    const ok = await postInterruption({
      sessionId: meta.id, ownerTenantId: owner.tenantId, ownerUserId: owner.userId, kind: meta.kind, reason,
      errorCode: extra.errorCode ?? meta.errorCode ?? null,
      seconds: extra.seconds ?? meta.seconds ?? null,
      startedAt: meta.startedAt, endedAt: extra.endedAt ?? meta.endedAt ?? null,
      visibility: live ? document.visibilityState : null,
      online: live ? navigator.onLine : null,
      browser: browserFamily(typeof navigator === "undefined" ? "" : navigator.userAgent),
      late,
    });
    if (!ok) return; // 다음 접속 때 다시 보낸다(끝 기록은 백업에 남아 있다)
    await patchRecoveryMeta(meta.id, { reportedAt: Date.now() });
    await dropClearedMeta(meta.id);
    clearPageClosed(meta.id);
  } catch {
    // 오프라인 · 서버 오류 — 다음 접속 때 다시 보낸다.
  }
}

/** 그 문서가 살아 있을 때 본 중단 — 끝 기록을 먼저 백업에 남기고 보낸다(보내기가 실패해도 다음 접속이 다시 보낸다). */
export async function reportLiveInterruption(meta: RecordingMeta, reason: InterruptReason, values: { errorCode?: string; seconds: number; endedAt: number }): Promise<void> {
  await patchRecoveryMeta(meta.id, { endReason: reason, errorCode: values.errorCode, seconds: values.seconds, endedAt: values.endedAt });
  await send(meta, reason, false, values);
}

function lockNameOf(meta: RecordingMeta): string | null {
  try {
    const [tenantId, userId, recordKey] = JSON.parse(meta.scopeKey ?? "") as [string, string, string];
    if (!meta.kind || typeof recordKey !== "string") return null;
    return targetLockName(meta.kind as RecoveryKind, { tenantId, userId, recordKey, label: "" });
  } catch {
    return null;
  }
}

let scanning: string | null = null;
/**
 * 이 계정의 남은 녹음 백업을 훑어 끝나지 않은 것·못 보낸 것을 보낸다 — 계정이 붙을 때마다(로그인·계정 전환).
 * 살아 있는 녹음(어느 탭이든 대상 잠금을 쥔 것)은 건너뛴다. Web Locks가 없으면 살아 있는지 모르니 끝 기록 없는 것은 보내지 않는다.
 */
export async function scanLeftoverRecordings(owner: RecordingOwner): Promise<void> {
  if (!owner.tenantId || !owner.userId || typeof window === "undefined") return;
  const key = `${owner.tenantId}:${owner.userId}`;
  if (scanning === key) return;
  scanning = key;
  try {
    const metas = await listOwnerDiagnostics(owner);
    if (!metas.length) return;
    const heldLocks = async (): Promise<Set<string> | null> => {
      try { return navigator.locks ? new Set(((await navigator.locks.query()).held ?? []).map((lock) => lock.name ?? "")) : null; } catch { return null; }
    };
    const judge = (meta: RecordingMeta, held: Set<string> | null) => {
      const name = lockNameOf(meta);
      return classifyLeftover(meta, held === null || name === null ? true : held.has(name), pageClosed(meta.id), localInterrupt(meta.id), stopRequested(meta.id));
    };
    const held = await heldLocks();
    for (const meta of metas) {
      let reason = judge(meta, held);
      if (!reason) continue;
      // 끝 기록이 없는 것은 잠깐 뒤 새로 읽고 다시 판정 — 막 직접 끝낸 녹음은 잠금을 푼 뒤 끝 기록을 쓴다.
      if (!meta.endedAt) {
        await new Promise((resolve) => setTimeout(resolve, RECHECK_MS));
        const fresh = await readRecoveryMeta(meta.id);
        reason = fresh ? judge(fresh, await heldLocks()) : null;
        if (!reason || !fresh) continue;
        await send(fresh, reason, true);
        continue;
      }
      await send(meta, reason, true);
    }
  } finally {
    if (scanning === key) scanning = null;
  }
}

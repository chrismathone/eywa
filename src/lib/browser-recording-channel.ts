/**
 * 녹음 세션의 문서 사이 신호 — 같은 브라우저의 다른 창(iframe)·탭에 있는 녹음과 맞춘다.
 *
 * - **누른 녹음만 녹음**(원장 2026-10-16): 녹음을 시작하거나 '이어서 녹음'을 누른 문서가 `activate`를 알리면 다른 문서는
 *   제 녹음을 일시정지한다. 동시에 눌렸으면 나중 시각이 이긴다(같은 시각이면 요청 id가 큰 쪽) — 양쪽이 서로의 알림을
 *   받아 같은 결론을 낸다. 누른 녹음이 시작하지 못하면(마이크 거부·준비 중 취소) `release`로 그 때문에 멈춘 녹음을 되돌린다.
 * - **같은 대상은 하나**: 대상(계정·지점·종류·상담/회의 키)마다 Web Lock 하나를 녹음이 끝날 때까지 쥔다.
 * - 다른 문서의 같은 대상 녹음은 `state` 알림으로 기억해 작성 화면이 미리 막는다(잠금이 실제로 막는 것과 별개 — 안내용).
 * - 배포가 섞인 사이의 옛 탭(`type` 없는 알림 · 계정 하나에 잠금 하나)은 `activate`를 모른다 — 그 탭이 녹음을 시작하면
 *   이쪽이 일시정지하고, 그 탭이 녹음 중인 동안에는 이쪽이 소리를 담지 않는다(`legacyRecording`).
 */
import { recordingScopeKey, type RecordingOwner, type RecordingScope, type RecoveryKind } from "./recording-recovery";

export type RecordingStatus = "starting" | "recording" | "paused" | "stopping" | "ready" | "failed";
export type ForeignRecording = { requestId: string; kind: RecoveryKind; scope: RecordingScope; status: RecordingStatus; href?: string };
export type RecordingActivation = { requestId: string; owner: RecordingOwner; at: number };
export type RecordingRelease = { requestId: string; owner: RecordingOwner };

const LIVE: readonly RecordingStatus[] = ["starting", "recording", "paused", "stopping"];
/** 옛 탭이 알리던 살아 있는 상태(그때는 일시정지가 없었다). */
const LEGACY_LIVE: readonly string[] = ["starting", "recording", "stopping"];
let channel: BroadcastChannel | undefined;
const foreign = new Map<string, ForeignRecording>();
const legacy = new Map<string, RecordingOwner>();
let sweep: ReturnType<typeof setTimeout> | undefined;
type Handlers = {
  activation: (value: RecordingActivation) => void;
  release: (value: RecordingRelease) => void;
  /** 옛 탭이 녹음을 시작했다 — 이쪽은 소리를 담지 않는다. */
  legacy: (value: RecordingRelease) => void;
  change: () => void;
};
let handlers: Handlers | null = null;

export function targetLockName(kind: RecoveryKind, scope: RecordingScope): string {
  return `eywa-audio:${JSON.stringify([scope.tenantId, scope.userId, kind, scope.recordKey])}`;
}
/** 옛 배포본이 계정마다 쥐던 잠금 — 지금 판은 이 이름을 쓰지 않으니, 쥔 쪽이 있으면 옛 탭이다. */
export function legacyLockName(owner: RecordingOwner): string {
  return `eywa-audio:${JSON.stringify([owner.tenantId, owner.userId])}`;
}
const validOwner = (value: Partial<RecordingOwner> | undefined): value is RecordingOwner =>
  typeof value?.tenantId === "string" && typeof value?.userId === "string";

export function connectRecordingChannel(next: Handlers): void {
  handlers = next;
  if (channel || typeof window === "undefined" || typeof BroadcastChannel === "undefined") return;
  channel = new BroadcastChannel("eywa-audio-recording");
  channel.onmessage = (event: MessageEvent) => {
    const data = event.data as Partial<ForeignRecording & RecordingActivation & { type: string }> | null;
    if (!data || typeof data.requestId !== "string") return;
    if (data.type === "activate") {
      if (typeof data.at === "number" && validOwner(data.owner)) handlers?.activation({ requestId: data.requestId, owner: data.owner, at: data.at });
      return;
    }
    if (data.type === "release") {
      if (validOwner(data.owner)) handlers?.release({ requestId: data.requestId, owner: data.owner });
      return;
    }
    const scope = data.scope;
    if (!scope || typeof scope.tenantId !== "string" || typeof scope.userId !== "string" || typeof scope.recordKey !== "string") return;
    if (data.type === undefined) {
      const owner = { tenantId: scope.tenantId, userId: scope.userId };
      if (typeof data.status === "string" && LEGACY_LIVE.includes(data.status)) {
        legacy.set(data.requestId, owner);
        handlers?.legacy({ requestId: data.requestId, owner });
      } else legacy.delete(data.requestId);
    } else if (data.status && LIVE.includes(data.status) && data.kind) {
      foreign.set(data.requestId, { requestId: data.requestId, kind: data.kind, scope, status: data.status, href: typeof data.href === "string" ? data.href : undefined });
    } else foreign.delete(data.requestId);
    handlers?.change();
    scheduleSweep();
  };
}

/** 알리지 못하고 사라진 문서(강제 종료 등)의 녹음은 대상 잠금이 풀린 것으로 걷어 낸다. */
function scheduleSweep() {
  if (sweep !== undefined || (!foreign.size && !legacy.size) || typeof navigator === "undefined" || !navigator.locks) return;
  sweep = setTimeout(async () => {
    sweep = undefined;
    try {
      const held = new Set((await navigator.locks.query()).held?.map((lock) => lock.name));
      let changed = false;
      for (const [id, value] of foreign) {
        if (!held.has(targetLockName(value.kind, value.scope))) { foreign.delete(id); changed = true; }
      }
      for (const [id, owner] of legacy) {
        if (!held.has(legacyLockName(owner))) { legacy.delete(id); changed = true; }
      }
      if (changed) handlers?.change();
    } catch { /* 잠금이 실제 중복을 막는다 — 안내만 늦을 뿐 */ }
    scheduleSweep();
  }, 3000);
}

export function announceState(value: ForeignRecording): void {
  channel?.postMessage({ type: "state", requestId: value.requestId, kind: value.kind, scope: value.scope, status: value.status, href: value.href });
}

export function announceActivation(value: RecordingActivation): void {
  channel?.postMessage({ type: "activate", ...value });
}

/** 누른 녹음이 시작하지 못했다 — 그 때문에 일시정지된 다른 문서의 녹음을 되돌린다. */
export function announceRelease(value: RecordingRelease): void {
  channel?.postMessage({ type: "release", ...value });
}

/** 다른 창·탭에서 같은 대상을 녹음 중이면 그 녹음(작성 화면이 시작 버튼을 막는 데 쓴다). */
export function getForeignRecording(kind: RecoveryKind, scope: RecordingScope | null): ForeignRecording | null {
  if (!scope) return null;
  const key = recordingScopeKey(scope);
  for (const value of foreign.values()) if (value.kind === kind && recordingScopeKey(value.scope) === key) return value;
  return null;
}

/** 다른 창·탭의 살아 있는 녹음 전부 — 단일 화면의 '새 X'가 녹음이 걸린 작성 화면을 피하는 데 쓴다. */
export function getForeignRecordings(): ForeignRecording[] {
  return [...foreign.values()];
}

/** 다른 창·탭에서 지금 소리를 담고 있는 녹음이 있나(같은 계정) — '시작하면 일시정지됩니다' 안내용. */
export function foreignCapturing(owner: RecordingOwner | null): boolean {
  if (!owner) return false;
  for (const value of foreign.values()) {
    if (value.status === "recording" && value.scope.tenantId === owner.tenantId && value.scope.userId === owner.userId) return true;
  }
  return legacyRecording(owner);
}

/** 옛 판 탭이 이 계정으로 녹음 중인가(알림으로 안 것). */
export function legacyRecording(owner: RecordingOwner): boolean {
  for (const value of legacy.values()) if (value.tenantId === owner.tenantId && value.userId === owner.userId) return true;
  return false;
}

/** 옛 판 탭이 이 계정의 녹음 잠금을 쥐고 있나 — 이 탭이 열리기 전에 시작한 녹음까지 본다. */
export async function legacyLockHeld(owner: RecordingOwner): Promise<boolean> {
  try {
    const held = (await navigator.locks.query()).held ?? [];
    return held.some((lock) => lock.name === legacyLockName(owner));
  } catch {
    return false;
  }
}

/**
 * 대상 잠금 — 잡으면 풀기 함수, 이미 다른 화면이 쥐고 있으면 null. 녹음이 끝날 때 푼다.
 * Web Locks가 없는 브라우저에서는 시작하지 않는다(문서 사이 일시정지도 같은 세대의 기능이라 함께 없다).
 */
export function reserveTarget(kind: RecoveryKind, scope: RecordingScope, stillWanted: () => boolean): Promise<(() => void) | null> {
  if (!navigator.locks) throw new DOMException("Web Locks unavailable", "NotSupportedError");
  return new Promise((resolve, reject) => {
    void navigator.locks.request(targetLockName(kind, scope), { ifAvailable: true }, async (lock) => {
      if (!lock || !stillWanted()) { resolve(null); return; }
      await new Promise<void>((release) => resolve(release));
    }).catch(reject);
  });
}

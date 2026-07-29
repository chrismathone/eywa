// ECS 미저장 patch 저널 — 서버 저장 실패/크래시 안전망(계획 v2.2 §F).
//
// 기존 useStateDraft를 쓰지 않는 이유(검수 지적): ① 700ms 디바운스 스냅샷이라 언마운트 직전 입력이
// 유실될 수 있고 ② 같은 (반,주)를 연 두 표면(플로팅 iframe 복제·복제 탭)이 같은 키를 덮어쓴다.
// 계약:
//  · 키 = `${tenantId}:${userId}:${classId}:${week}:${documentInstanceId}` — instanceId는 **마운트마다**
//    crypto.randomUUID(sessionStorage 금지 — same-origin iframe·복제 탭이 공유/복사).
//  · **단일 writer chain** — 저널 쓰기·ack 삭제를 Promise 체인으로 직렬화(순서 역전 금지).
//  · ack 삭제는 **(mutationId, clientRev) 일치 시에만** — 그 사이 새 입력(rev 증가)이 있으면 보존.
//  · flushPersist()는 체인이 IDB에 실제 커밋될 때까지 대기.
//  · 죽은 인스턴스 회수: heartbeat 단독 판정 금지 — **Web Locks 보유 확인**(폴백: 호출부 BroadcastChannel
//    ping) 후 무응답일 때만 claim. 산 인스턴스는 자기 키의 Web Lock을 계속 보유한다.
//
// 저장소는 어댑터 주입(JournalStorage) — 실전은 IndexedDB, 테스트는 in-memory fake(순서 역전 재현).
import type { PlanFieldPatch } from "./save-keys";

export type JournalMutation = {
  mutationId: string;
  clientRev: number;
  patch: PlanFieldPatch;
};

export type JournalRecord = {
  key: string;
  tenantId: string;
  userId: string;
  classId: string;
  week: string;
  instanceId: string;
  heartbeatAt: number;
  mutations: JournalMutation[];
};

export type JournalStorage = {
  get(key: string): Promise<JournalRecord | null>;
  put(record: JournalRecord): Promise<void>;
  delete(key: string): Promise<void>;
  /** prefix(`${tenantId}:${userId}:${classId}:${week}:`)로 시작하는 모든 레코드. */
  listByPrefix(prefix: string): Promise<JournalRecord[]>;
};

export type JournalIdentity = {
  tenantId: string;
  userId: string;
  classId: string;
  week: string;
  instanceId: string;
};

export function journalKeyOf(id: JournalIdentity): string {
  return `${id.tenantId}:${id.userId}:${id.classId}:${id.week}:${id.instanceId}`;
}

export function journalPrefixOf(id: Omit<JournalIdentity, "instanceId">): string {
  return `${id.tenantId}:${id.userId}:${id.classId}:${id.week}:`;
}

export const ECS_JOURNAL_LOCK_PREFIX = "ecs-journal:";

/**
 * 저널 1개(현 문서 인스턴스) — 모든 변경이 단일 체인을 통과한다.
 * enqueue/ack가 반환하는 Promise는 "IDB 커밋 완료"를 뜻한다(write-through, 디바운스 없음).
 */
export class EcsPatchJournal {
  private readonly key: string;
  private mutations: JournalMutation[] = [];
  private chain: Promise<void> = Promise.resolve();
  private lastError: unknown = null;

  constructor(
    private readonly storage: JournalStorage,
    private readonly identity: JournalIdentity,
  ) {
    this.key = journalKeyOf(identity);
  }

  get pendingCount(): number {
    return this.mutations.length;
  }

  pendingMutations(): JournalMutation[] {
    return [...this.mutations];
  }

  private enqueueOp(op: () => Promise<void>): Promise<void> {
    // 실패해도 체인이 끊기지 않게(다음 op는 계속) — 마지막 에러만 보관해 flush가 보고.
    this.chain = this.chain.then(op).catch((e) => {
      this.lastError = e;
    });
    return this.chain;
  }

  private persist(): Promise<void> {
    const snapshot: JournalRecord = {
      key: this.key,
      ...this.identity,
      heartbeatAt: Date.now(),
      mutations: [...this.mutations],
    };
    return this.enqueueOp(() =>
      snapshot.mutations.length === 0 ? this.storage.delete(this.key) : this.storage.put(snapshot),
    );
  }

  /** patch 추가/갱신(같은 saveKey는 최신으로 교체 — pending은 saveKey당 1건). */
  enqueue(mutation: JournalMutation): Promise<void> {
    const idx = this.mutations.findIndex((m) => m.patch.saveKey === mutation.patch.saveKey);
    if (idx >= 0) this.mutations[idx] = mutation;
    else this.mutations.push(mutation);
    return this.persist();
  }

  /** 서버 확정(applied/already_applied) — (mutationId, clientRev)가 **둘 다** 일치할 때만 삭제. */
  ack(mutationId: string, clientRev: number): Promise<void> {
    const idx = this.mutations.findIndex((m) => m.mutationId === mutationId);
    if (idx >= 0 && this.mutations[idx].clientRev === clientRev) {
      this.mutations.splice(idx, 1);
    }
    return this.persist();
  }

  /** 체인 drain — 지금까지의 모든 쓰기가 IDB에 커밋될 때까지 대기. 실패 시 ok:false(저널 보존). */
  async flushPersist(): Promise<{ ok: boolean }> {
    await this.chain;
    if (this.lastError) {
      this.lastError = null;
      return { ok: false };
    }
    return { ok: true };
  }

  /** 주기 heartbeat(레코드 타임스탬프 갱신) — pending 있을 때만 의미. */
  heartbeat(): Promise<void> {
    if (this.mutations.length === 0) return this.chain;
    return this.persist();
  }

  /** 전부 확정 후 정리(언마운트 등). */
  clear(): Promise<void> {
    this.mutations = [];
    return this.persist();
  }
}

/**
 * 같은 (tenant,user,class,week)의 **다른 인스턴스** 저널 중 죽은 것만 회수 대상으로 나열.
 * isAlive는 호출부가 판정(Web Locks 보유 확인 → 폴백 BroadcastChannel ping) — heartbeat 단독 판정 금지.
 */
export async function listRecoverableJournals(
  storage: JournalStorage,
  id: JournalIdentity,
  isAlive: (instanceId: string) => Promise<boolean>,
): Promise<JournalRecord[]> {
  const records = await storage.listByPrefix(journalPrefixOf(id));
  const out: JournalRecord[] = [];
  for (const r of records) {
    if (r.instanceId === id.instanceId) continue;
    if (r.mutations.length === 0) continue;
    if (await isAlive(r.instanceId)) continue;
    out.push(r);
  }
  return out;
}

/** 회수(claim) — 레코드를 삭제하고 mutation 목록을 반환(재적용은 호출부의 flush 경로). */
export async function claimJournal(
  storage: JournalStorage,
  record: JournalRecord,
): Promise<JournalMutation[]> {
  await storage.delete(record.key);
  return record.mutations;
}

// ── IndexedDB 어댑터(실전) ────────────────────────────────────────────────────

const DB_NAME = "ecs-journal";
const DB_VERSION = 1;
const STORE = "journals";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function createIdbJournalStorage(): JournalStorage {
  return {
    async get(key) {
      const db = await openDB();
      try {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).get(key);
        await txDone(tx);
        return (req.result as JournalRecord | undefined) ?? null;
      } finally {
        db.close();
      }
    },
    async put(record) {
      const db = await openDB();
      try {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(record);
        await txDone(tx); // 커밋까지 대기(write-through 계약)
      } finally {
        db.close();
      }
    },
    async delete(key) {
      const db = await openDB();
      try {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete(key);
        await txDone(tx);
      } finally {
        db.close();
      }
    },
    async listByPrefix(prefix) {
      const db = await openDB();
      try {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).getAll();
        await txDone(tx);
        const all = (req.result as JournalRecord[] | undefined) ?? [];
        return all.filter((r) => typeof r.key === "string" && r.key.startsWith(prefix));
      } finally {
        db.close();
      }
    },
  };
}

/** 산 인스턴스 판정 — Web Locks 보유 확인(지원 브라우저), 미지원이면 null(호출부 폴백 판단). */
export async function isInstanceAliveViaWebLocks(instanceId: string): Promise<boolean | null> {
  try {
    if (typeof navigator === "undefined" || !navigator.locks?.query) return null;
    const state = await navigator.locks.query();
    return (state.held ?? []).some((l) => l.name === `${ECS_JOURNAL_LOCK_PREFIX}${instanceId}`);
  } catch {
    return null;
  }
}

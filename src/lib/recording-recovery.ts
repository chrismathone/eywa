/** Browser recording backups, isolated by account, form record, and recording session.
 * Legacy kind-only backups are preserved, but never assigned to a student by guessing.
 */
import { recordingFileName } from "./audio-upload";

const DB_NAME = "recording-recovery";
const CHUNKS_STORE = "chunks";
const META_STORE = "meta";

export type RecoveryKind = "meeting" | "consultation" | "student-consultation";
export type RecordingOwner = { tenantId: string; userId: string };
export type RecordingScope = RecordingOwner & { recordKey: string; label: string };
export type RecordingMeta = {
  id: string;
  kind?: RecoveryKind;
  scopeKey?: string;
  startedAt: number;
  mimeType: string;
  chunkCount: number;
  title?: string;
  fileName?: string;
  /**
   * 녹음 중단 진단(원장 2026-10-29 *"회의록이 강제로 종료된건 이유 체크… 분석가능하게 로그"*) — `recording-diagnostics.ts`.
   * `diag`가 없는 옛 백업은 진단 대상이 아니다(끝 기록이 없어 모두 '정리되지 않은 종료'로 오보된다).
   */
  diag?: 1;
  /** 실제로 소리를 담은 초(일시정지 제외) — 30초마다·끝날 때 갱신. 조각 수는 녹음 초가 아니다. */
  seconds?: number;
  endedAt?: number;
  /** 이 문서가 본 끝 — `stopped`(직접 끝냄) · 중단 사유(즉시 보고 대상) · `signed_out`(계정을 벗어나 버림). */
  endReason?: string;
  errorCode?: string;
  /** 서버가 받았다고 답한 시각 — 없으면 다음 접속 때 다시 보낸다. */
  reportedAt?: number;
  /** 소리는 올리거나 지워서 비웠고, 못 보낸 진단 때문에 표만 남았다 — 복구 목록에 보이지 않고, 보낸 뒤 지운다. */
  cleared?: true;
};

export function recordingScopeKey(scope: RecordingScope): string {
  return JSON.stringify([scope.tenantId, scope.userId, scope.recordKey]);
}

/** Unsaved prospects use name + contact; saved consultations always use their record id.
 * No name means no automatic recovery suggestion. Phone formatting is immaterial.
 */
export function consultationRecordingKey(id: string | undefined, name: string, phone: string, draftId?: string): string | null {
  if (id) return `enrollment:${id}`;
  const normalizedName = name.trim().normalize("NFC");
  if (!normalizedName) return null;
  const digits = phone.replace(/\D/g, "");
  // A name alone cannot distinguish two people. An unsaved form's persisted draft id can.
  if (!digits) return draftId ? `prospect-draft:${draftId}` : null;
  return `prospect:${JSON.stringify([normalizedName, digits])}`;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(CHUNKS_STORE)) db.createObjectStore(CHUNKS_STORE);
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function completed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error("Recording backup failed"));
  });
}

/** A new session never deletes an earlier recording, even in the same form or another tab. */
export async function startRecoverySession(kind: RecoveryKind, mimeType: string, scope: RecordingScope): Promise<RecordingMeta> {
  const id = crypto.randomUUID();
  const startedAt = Date.now();
  const meta: RecordingMeta = {
    id, kind, scopeKey: recordingScopeKey(scope), startedAt, mimeType, chunkCount: 0, diag: 1,
    title: scope.label,
    fileName: recordingFileName(kind, scope.label, new Date(startedAt), id, mimeType),
  };
  let db: IDBDatabase | undefined;
  try {
    db = await openDB();
    const tx = db.transaction(META_STORE, "readwrite");
    tx.objectStore(META_STORE).put(meta, id);
    await completed(tx);
  } catch {
    // A failed browser backup must not prevent recording or the separate file download.
  } finally {
    db?.close();
  }
  return meta;
}

// Serialize writes per recording. Cleanup waits for outstanding chunks; late chunks cannot
// resurrect a successfully submitted backup because saveChunk checks the metadata first.
const pendingWrites = new Map<string, Promise<void>>();
export function saveChunk(id: string, index: number, chunk: Blob): Promise<void> {
  const previous = pendingWrites.get(id) ?? Promise.resolve();
  const pending = previous.then(async () => {
    let db: IDBDatabase | undefined;
    try {
      db = await openDB();
      const tx = db.transaction([CHUNKS_STORE, META_STORE], "readwrite");
      const metaStore = tx.objectStore(META_STORE);
      const req = metaStore.get(id);
      req.onsuccess = () => {
        const meta = req.result as RecordingMeta | undefined;
        // 비운 표(cleared)는 진단만 남은 것 — 늦은 조각이 지운 백업을 되살리지 않는다.
        if (!meta || meta.cleared) return;
        tx.objectStore(CHUNKS_STORE).put(chunk, `${id}_${index}`);
        meta.chunkCount = Math.max(meta.chunkCount, index + 1);
        metaStore.put(meta, id);
      };
      await completed(tx);
    } catch {
      // Recording continues if IndexedDB is unavailable or full.
    } finally {
      db?.close();
    }
  });
  pendingWrites.set(id, pending);
  void pending.then(() => { if (pendingWrites.get(id) === pending) pendingWrites.delete(id); });
  return pending;
}

/**
 * 녹음 백업의 진단 칸만 고친다(조각·이름은 그대로). 없으면(올려서 지운 백업) 아무것도 하지 않는다 — 지운 백업을 되살리지 않는다.
 * 조각 저장과 같은 줄에 세워 순서를 지킨다(끝 기록이 마지막 조각보다 먼저 쓰여 덮이지 않게).
 */
export function patchRecoveryMeta(id: string, values: Pick<RecordingMeta, "seconds" | "endedAt" | "endReason" | "errorCode" | "reportedAt">): Promise<void> {
  const previous = pendingWrites.get(id) ?? Promise.resolve();
  const pending = previous.then(async () => {
    let db: IDBDatabase | undefined;
    try {
      db = await openDB();
      const tx = db.transaction(META_STORE, "readwrite");
      const store = tx.objectStore(META_STORE);
      const req = store.get(id);
      req.onsuccess = () => {
        const meta = req.result as RecordingMeta | undefined;
        if (meta) store.put({ ...meta, ...values }, id);
      };
      await completed(tx);
    } catch {
      // 진단 기록 실패는 녹음·백업을 막지 않는다.
    } finally {
      db?.close();
    }
  });
  pendingWrites.set(id, pending);
  void pending.then(() => { if (pendingWrites.get(id) === pending) pendingWrites.delete(id); });
  return pending;
}

/** 백업 표 하나를 새로 읽는다(다음 접속 판정의 재확인). */
export async function readRecoveryMeta(id: string): Promise<RecordingMeta | null> {
  await pendingWrites.get(id);
  let db: IDBDatabase | undefined;
  try {
    db = await openDB();
    const tx = db.transaction(META_STORE, "readonly");
    const req = tx.objectStore(META_STORE).get(id);
    let meta: RecordingMeta | null = null;
    req.onsuccess = () => { meta = (req.result as RecordingMeta | undefined) ?? null; };
    await completed(tx);
    return meta;
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

/** 진단을 보낸 뒤 — 소리를 비운 표(cleared)는 지운다. 소리가 남은 백업은 그대로(복구 목록은 손대지 않는다). */
export async function dropClearedMeta(id: string): Promise<void> {
  await pendingWrites.get(id);
  let db: IDBDatabase | undefined;
  try {
    db = await openDB();
    const tx = db.transaction(META_STORE, "readwrite");
    const store = tx.objectStore(META_STORE);
    const req = store.get(id);
    req.onsuccess = () => { if ((req.result as RecordingMeta | undefined)?.cleared) store.delete(id); };
    await completed(tx);
  } catch {
    // 남아도 다음 접속 때 reportedAt을 보고 건너뛴다.
  } finally {
    db?.close();
  }
}

/** 이 계정의 진단 대상 백업 전부(폼·대상과 무관) — 다음 접속 때 끝나지 않은 녹음을 찾는다. */
export async function listOwnerDiagnostics(owner: RecordingOwner): Promise<RecordingMeta[]> {
  await Promise.all([...pendingWrites.values()]);
  const prefix = JSON.stringify([owner.tenantId, owner.userId]).slice(0, -1) + ",";
  let db: IDBDatabase | undefined;
  try {
    db = await openDB();
    const tx = db.transaction(META_STORE, "readonly");
    const req = tx.objectStore(META_STORE).getAll();
    const records: RecordingMeta[] = [];
    req.onsuccess = () => {
      for (const meta of req.result as RecordingMeta[]) if (meta.diag === 1 && meta.scopeKey?.startsWith(prefix)) records.push(meta);
    };
    await completed(tx);
    return records;
  } catch {
    return [];
  } finally {
    db?.close();
  }
}

export async function listRecovery(kind: RecoveryKind, scope: RecordingScope): Promise<RecordingMeta[]> {
  await Promise.all([...pendingWrites.values()]);
  let db: IDBDatabase | undefined;
  try {
    db = await openDB();
    const tx = db.transaction(META_STORE, "readonly");
    const req = tx.objectStore(META_STORE).getAll();
    const key = recordingScopeKey(scope);
    const records: RecordingMeta[] = [];
    req.onsuccess = () => {
      for (const meta of req.result as RecordingMeta[]) {
        if (meta.kind === kind && meta.scopeKey === key && meta.chunkCount > 0 && !meta.cleared) records.push(meta);
      }
    };
    await completed(tx);
    return records.sort((a, b) => b.startedAt - a.startedAt);
  } catch {
    return [];
  } finally {
    db?.close();
  }
}

export async function recoverRecording(id: string): Promise<File | null> {
  await pendingWrites.get(id);
  let db: IDBDatabase | undefined;
  try {
    db = await openDB();
    const tx = db.transaction([META_STORE, CHUNKS_STORE], "readonly");
    const req = tx.objectStore(META_STORE).get(id);
    let meta: RecordingMeta | undefined;
    const chunks: Blob[] = [];
    req.onsuccess = () => {
      meta = req.result as RecordingMeta | undefined;
      if (!meta || meta.chunkCount < 1 || meta.cleared) return;
      for (let i = 0; i < meta.chunkCount; i++) {
        const chunkReq = tx.objectStore(CHUNKS_STORE).get(`${id}_${i}`);
        chunkReq.onsuccess = () => { chunks[i] = chunkReq.result as Blob; };
      }
    };
    await completed(tx);
    if (!meta || meta.chunkCount < 1 || chunks.filter(Boolean).length !== meta.chunkCount) return null;
    return new File(chunks, meta.fileName ?? `복구_${id}.webm`, { type: meta.mimeType });
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

/** Clear only the recording actually submitted or explicitly discarded. Restoring is a read. */
export async function clearRecovery(id: string): Promise<void> {
  await pendingWrites.get(id);
  let db: IDBDatabase | undefined;
  try {
    db = await openDB();
    const tx = db.transaction([META_STORE, CHUNKS_STORE], "readwrite");
    const metaStore = tx.objectStore(META_STORE);
    // 녹음 중단 진단을 아직 못 보냈으면 소리만 지우고 표는 남긴다(다음 접속 때 보낸 뒤 지운다 · Codex 2차).
    const metaReq = metaStore.get(id);
    metaReq.onsuccess = () => {
      const meta = metaReq.result as RecordingMeta | undefined;
      if (meta?.diag === 1 && !meta.reportedAt && meta.endReason !== "stopped" && meta.chunkCount > 0) metaStore.put({ ...meta, cleared: true }, id);
      else metaStore.delete(id);
    };
    const req = tx.objectStore(CHUNKS_STORE).openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return;
      if (String(cursor.key).startsWith(`${id}_`)) cursor.delete();
      cursor.continue();
    };
    await completed(tx);
  } catch {
    // Best effort: the disk backup remains available independently.
  } finally {
    db?.close();
  }
}

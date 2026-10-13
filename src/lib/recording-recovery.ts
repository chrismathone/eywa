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
    id, kind, scopeKey: recordingScopeKey(scope), startedAt, mimeType, chunkCount: 0,
    title: scope.label,
    fileName: recordingFileName(kind, scope.label, new Date(startedAt), id),
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
        if (!meta) return;
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
        if (meta.kind === kind && meta.scopeKey === key && meta.chunkCount > 0) records.push(meta);
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
      if (!meta || meta.chunkCount < 1) return;
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
    tx.objectStore(META_STORE).delete(id);
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

/**
 * Crash-safe recording recovery via IndexedDB.
 *
 * Each MediaRecorder `ondataavailable` chunk is persisted to IDB. If the tab
 * crashes mid-recording, the next visit to the upload form can re-assemble the
 * chunks into a downloadable File. Ported from ijw-calander/utils/recordingRecovery.ts.
 */

const DB_NAME = "recording-recovery";
const DB_VERSION = 1;
const CHUNKS_STORE = "chunks";
const META_STORE = "meta";

const KIND = "meeting" as const;
type Kind = typeof KIND;

export type RecordingMeta = {
  id: Kind;
  startedAt: number;
  mimeType: string;
  chunkCount: number;
  title?: string;
};

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(CHUNKS_STORE)) db.createObjectStore(CHUNKS_STORE);
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function startRecoverySession(mimeType: string, title?: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction([META_STORE, CHUNKS_STORE], "readwrite");

  // wipe stale chunks for this kind
  const chunks = tx.objectStore(CHUNKS_STORE);
  const cursorReq = chunks.openCursor();
  cursorReq.onsuccess = () => {
    const cursor = cursorReq.result;
    if (cursor) {
      if ((cursor.key as string).startsWith(KIND + "_")) cursor.delete();
      cursor.continue();
    }
  };

  const meta: RecordingMeta = {
    id: KIND,
    startedAt: Date.now(),
    mimeType,
    chunkCount: 0,
    title,
  };
  tx.objectStore(META_STORE).put(meta, KIND);

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

export async function saveChunk(index: number, chunk: Blob): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction([CHUNKS_STORE, META_STORE], "readwrite");
    tx.objectStore(CHUNKS_STORE).put(chunk, `${KIND}_${index}`);

    const metaStore = tx.objectStore(META_STORE);
    const getReq = metaStore.get(KIND);
    getReq.onsuccess = () => {
      const meta = getReq.result as RecordingMeta | undefined;
      if (meta) {
        meta.chunkCount = index + 1;
        metaStore.put(meta, KIND);
      }
    };

    return new Promise((resolve) => {
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      // Swallow errors — recording must continue even if IDB persistence fails.
      tx.onerror = () => {
        db.close();
        resolve();
      };
    });
  } catch {
    // ignore
  }
}

export async function checkRecovery(): Promise<RecordingMeta | null> {
  try {
    const db = await openDB();
    const tx = db.transaction(META_STORE, "readonly");
    const req = tx.objectStore(META_STORE).get(KIND);
    return new Promise((resolve) => {
      req.onsuccess = () => {
        db.close();
        const meta = req.result as RecordingMeta | undefined;
        resolve(meta && meta.chunkCount > 0 ? meta : null);
      };
      req.onerror = () => {
        db.close();
        resolve(null);
      };
    });
  } catch {
    return null;
  }
}

export async function recoverRecording(): Promise<File | null> {
  try {
    const db = await openDB();
    const tx = db.transaction([META_STORE, CHUNKS_STORE], "readonly");
    const metaReq = tx.objectStore(META_STORE).get(KIND);

    return new Promise((resolve) => {
      metaReq.onsuccess = () => {
        const meta = metaReq.result as RecordingMeta | undefined;
        if (!meta || meta.chunkCount === 0) {
          db.close();
          resolve(null);
          return;
        }

        const chunks: Blob[] = [];
        let loaded = 0;

        for (let i = 0; i < meta.chunkCount; i++) {
          const chunkReq = tx.objectStore(CHUNKS_STORE).get(`${KIND}_${i}`);
          chunkReq.onsuccess = () => {
            if (chunkReq.result) chunks[i] = chunkReq.result as Blob;
            loaded++;
            if (loaded === meta.chunkCount) {
              db.close();
              const valid = chunks.filter(Boolean);
              if (valid.length === 0) {
                resolve(null);
                return;
              }
              const blob = new Blob(valid, { type: meta.mimeType });
              const d = new Date(meta.startedAt);
              const pad = (n: number) => String(n).padStart(2, "0");
              const name = `복구_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}.webm`;
              resolve(new File([blob], name, { type: meta.mimeType }));
            }
          };
        }
      };
      metaReq.onerror = () => {
        db.close();
        resolve(null);
      };
    });
  } catch {
    return null;
  }
}

export async function clearRecovery(): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction([META_STORE, CHUNKS_STORE], "readwrite");
    tx.objectStore(META_STORE).delete(KIND);

    const chunks = tx.objectStore(CHUNKS_STORE);
    const cursorReq = chunks.openCursor();
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (cursor) {
        if ((cursor.key as string).startsWith(KIND + "_")) cursor.delete();
        cursor.continue();
      }
    };

    return new Promise((resolve) => {
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    });
  } catch {
    // ignore
  }
}

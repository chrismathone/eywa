/** One recorder per document, independent of the page/form that started it.
 * AppProviders keeps the controls and unload guard mounted across client navigation.
 * Audio stays local until the originating form explicitly uploads it.
 */
import { downloadFile } from "./audio-upload";
import { microphoneErrorMessage, microphoneMessage, refreshMicrophone } from "./microphone";
import { startRecoverySession, saveChunk, recordingScopeKey, type RecordingMeta, type RecordingOwner, type RecordingScope, type RecoveryKind } from "./recording-recovery";

export type BrowserRecording = {
  requestId: string;
  kind: RecoveryKind;
  scope: RecordingScope;
  href: string;
  status: "starting" | "recording" | "stopping" | "ready" | "failed";
  seconds: number;
  meta?: RecordingMeta;
  file?: File;
  error?: string;
  errorCode?: string;
};
type Attempt = {
  request: BrowserRecording;
  stream?: MediaStream;
  recorder?: MediaRecorder;
  timer?: ReturnType<typeof setInterval>;
  chunks: Blob[];
  requestedStop: boolean;
  retired: boolean;
  removeTrackListeners?: () => void;
  releaseLock?: () => void;
};
let snapshot: BrowserRecording | null = null;
let attempt: Attempt | null = null;
const listeners = new Set<() => void>();
type ForeignRecording = Pick<BrowserRecording, "requestId" | "scope" | "kind" | "status">;
const foreign = new Map<string, ForeignRecording>();
let channel: BroadcastChannel | undefined;
let owner: RecordingOwner | null = null;
let foreignCheck: ReturnType<typeof setTimeout> | undefined;
export const getRecordingOwner = () => owner;
export function getForeignRecording(scope: RecordingOwner | null): ForeignRecording | null {
  if (!scope) return null;
  return [...foreign.values()].find((value) => value.scope.tenantId === scope.tenantId && value.scope.userId === scope.userId) ?? null;
}
function notify() { for (const listener of listeners) listener(); }
function connect() {
  if (typeof window === "undefined" || channel || typeof BroadcastChannel === "undefined") return;
  channel = new BroadcastChannel("eywa-audio-recording");
  channel.onmessage = (event: MessageEvent<ForeignRecording>) => {
    const value = event.data;
    if (!value || typeof value.requestId !== "string" || !value.scope || typeof value.scope.userId !== "string" || typeof value.scope.tenantId !== "string") return;
    if (recordingIsActive(value as BrowserRecording)) foreign.set(value.requestId, value);
    else foreign.delete(value.requestId);
    notify();
    checkForeignLocks();
  };
  window.addEventListener("pagehide", () => {
    stopBrowserRecording();
    if (snapshot) channel?.postMessage({ requestId: snapshot.requestId, kind: snapshot.kind, scope: snapshot.scope, status: "ready" });
  });
}
function checkForeignLocks() {
  if (foreignCheck !== undefined || !foreign.size || !navigator.locks) return;
  foreignCheck = setTimeout(async () => {
    foreignCheck = undefined;
    try {
      const locks = await navigator.locks.query();
      const names = new Set(locks.held?.map((lock) => lock.name));
      for (const [id, value] of foreign) {
        if (!names.has(`eywa-audio:${JSON.stringify([value.scope.tenantId, value.scope.userId])}`)) foreign.delete(id);
      }
      notify();
    } catch { /* Lock acquisition still enforces exclusivity. */ }
    checkForeignLocks();
  }, 3000);
}
export const getBrowserRecording = () => snapshot;
export const getServerRecording = () => null;
export function subscribeBrowserRecording(listener: () => void): () => void {
  connect();
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function publish(value: BrowserRecording | null) {
  const previous = snapshot;
  snapshot = value;
  if (value) channel?.postMessage({ requestId: value.requestId, kind: value.kind, scope: value.scope, status: value.status });
  else if (previous) channel?.postMessage({ requestId: previous.requestId, kind: previous.kind, scope: previous.scope, status: "ready" });
  notify();
}
export function recordingIsActive(value: BrowserRecording | null): boolean {
  return !!value && ["starting", "recording", "stopping"].includes(value.status);
}
export function recordingMatches(value: BrowserRecording | null, kind: RecoveryKind, scope: RecordingScope | null): boolean {
  return !!value && !!scope && value.kind === kind && recordingScopeKey(value.scope) === recordingScopeKey(scope);
}
function patch(current: Attempt, values: Partial<BrowserRecording>) {
  if (attempt !== current || current.retired || snapshot?.requestId !== current.request.requestId) return;
  publish({ ...snapshot, ...values });
}
function clean(current: Attempt) {
  if (current.timer !== undefined) clearInterval(current.timer);
  current.timer = undefined;
  current.removeTrackListeners?.();
  current.removeTrackListeners = undefined;
  current.stream?.getTracks().forEach((track) => track.stop());
  current.releaseLock?.();
  current.releaseLock = undefined;
}

/** Web Locks gives all same-origin tabs and frames one atomic microphone reservation.
 * Never silently fall back to an unprotected concurrent recorder.
 */
async function reserveMicrophone(current: Attempt): Promise<boolean> {
  if (!navigator.locks) throw new DOMException("Web Locks unavailable", "NotSupportedError");
  return new Promise<boolean>((resolve, reject) => {
    void navigator.locks.request(`eywa-audio:${JSON.stringify([current.request.scope.tenantId, current.request.scope.userId])}`, { ifAvailable: true }, async (lock) => {
      if (!lock) { resolve(false); return; }
      if (current.retired || attempt !== current) { resolve(false); return; }
      await new Promise<void>((release) => { current.releaseLock = release; resolve(true); });
    }).catch(reject);
  });
}
function finish(current: Attempt) {
  clean(current);
  const value = snapshot;
  const meta = current.request.meta;
  const mime = meta?.mimeType ?? "audio/webm";
  const blob = new Blob(current.chunks, { type: mime });
  current.chunks = [];
  if (attempt !== current || current.retired) return;
  attempt = null;
  if (!meta || blob.size === 0) {
    publish({ ...current.request, seconds: value?.seconds ?? 0, status: "failed", errorCode: value?.errorCode, error: value?.error ?? "녹음된 소리가 없습니다. 마이크를 확인한 뒤 다시 녹음해 주세요." });
    return;
  }
  const file = new File([blob], meta.fileName!, { type: mime });
  downloadFile(file);
  publish({ ...current.request, seconds: value?.seconds ?? 0, status: "ready", file, errorCode: value?.errorCode,
    error: value?.error ?? (!current.requestedStop ? "녹음이 예기치 않게 중단되었습니다. 중단 전 녹음은 보관했습니다." : undefined) });
}

/** Starting another student's form must never replace an in-progress recording. */
export async function startBrowserRecording(kind: RecoveryKind, scope: RecordingScope): Promise<string | null> {
  connect();
  if (attempt || recordingIsActive(snapshot)) return "이미 녹음 중입니다. 녹음 아이콘에서 진행 중인 녹음을 확인해 주세요.";
  const request: BrowserRecording = {
    requestId: crypto.randomUUID(), kind, scope: { ...scope },
    href: window.location.pathname + window.location.search,
    status: "starting", seconds: 0,
  };
  const microphone = await refreshMicrophone();
  if (owner && (owner.tenantId !== request.scope.tenantId || owner.userId !== request.scope.userId)) return "작성 화면을 다시 열어 주세요.";
  if (attempt || recordingIsActive(snapshot)) return "이미 녹음 중입니다. 녹음 아이콘에서 진행 중인 녹음을 확인해 주세요.";
  if (microphone !== "available") return microphoneMessage(microphone);
  const current: Attempt = { request, chunks: [], requestedStop: false, retired: false };
  attempt = current;
  publish(request);
  try {
    if (!await reserveMicrophone(current)) {
      if (attempt === current && !current.retired) {
        attempt = null;
        publish({ ...request, status: "failed", error: "다른 화면에서 녹음 중입니다. 진행 중인 녹음을 먼저 중지해 주세요." });
      }
      return null;
    }
    if (attempt !== current || current.retired) { clean(current); return null; }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    current.stream = stream;
    if (attempt !== current || current.retired) { clean(current); return null; }
    const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((type) => MediaRecorder.isTypeSupported(type));
    if (!mime) throw new DOMException("No recording format", "NotSupportedError");
    const recorder = new MediaRecorder(stream, { mimeType: mime });
    current.recorder = recorder;
    const meta = await startRecoverySession(kind, mime, request.scope);
    current.request = { ...request, meta };
    if (attempt !== current || current.retired) { clean(current); return null; }
    recorder.ondataavailable = (event) => {
      if (!event.data?.size) return;
      const index = current.chunks.length;
      current.chunks.push(event.data);
      void saveChunk(meta.id, index, event.data);
    };
    recorder.onstop = () => finish(current);
    recorder.onerror = (event) => {
      const code = (event as Event & { error?: DOMException }).error?.name ?? "UnknownError";
      patch(current, { errorCode: code, error: "녹음 오류가 발생했습니다. 중단 전 녹음은 보관합니다. 마이크 연결 상태를 확인해 주세요." });
      // MediaRecorder emits its final dataavailable and stop after the error.
      console.error("[browser-recording]", code);
    };
    const tracks = stream.getTracks();
    const ended = () => {
      if (attempt !== current || current.retired || current.requestedStop) return;
      patch(current, { error: "마이크 연결이 끊겨 녹음이 중단되었습니다. 중단 전 녹음은 보관합니다." });
      if (recorder.state !== "inactive") recorder.stop();
    };
    tracks.forEach((track) => track.addEventListener?.("ended", ended));
    current.removeTrackListeners = () => tracks.forEach((track) => track.removeEventListener?.("ended", ended));
    recorder.start(1000);
    if (attempt !== current || current.retired) { clean(current); return null; }
    const startedAt = Date.now();
    patch(current, { ...current.request, status: "recording" });
    current.timer = setInterval(() => patch(current, { seconds: Math.floor((Date.now() - startedAt) / 1000) }), 1000);
    return null;
  } catch (error) {
    clean(current);
    if (attempt !== current || current.retired) return null;
    attempt = null;
    const code = error instanceof Error ? error.name : "UnknownError";
    console.error("[browser-recording] start", code);
    publish({ ...current.request, status: "failed", errorCode: code, error: microphoneErrorMessage(error) });
    void refreshMicrophone();
    return null;
  }
}

export function stopBrowserRecording(requestId?: string): void {
  const current = attempt;
  if (!current || (requestId && requestId !== current.request.requestId)) return;
  current.requestedStop = true;
  if (!current.recorder || !current.request.meta) {
    // Cancel a pending microphone permission / backup initialization. A late stream is closed.
    current.retired = true;
    clean(current);
    attempt = null;
    publish(null);
    return;
  }
  patch(current, { status: "stopping" });
  if (current.recorder.state !== "inactive") current.recorder.stop();
}

/** Dismiss controls only; local backups are removed solely after save or explicit deletion. */
export function dismissBrowserRecording(recoveryId?: string): void {
  if (recordingIsActive(snapshot) || (recoveryId && snapshot?.meta?.id !== recoveryId)) return;
  publish(null);
}

/** A client navigation must not carry a different account's live microphone or file. */
export function adoptRecordingOwner(owner: RecordingOwner): void {
  // Owner is also used to filter foreign-tab lock notices.
  setOwner(owner);
  if (!snapshot || (snapshot.scope.userId === owner.userId && snapshot.scope.tenantId === owner.tenantId)) return;
  const current = attempt;
  if (current) {
    current.retired = true;
    if (current.recorder && current.recorder.state !== "inactive") current.recorder.stop();
    clean(current);
    attempt = null;
  }
  publish(null);
}

/** Leaving the authenticated shell (including a soft logout redirect) retires its microphone. */
export function releaseRecordingOwner(value: RecordingOwner): void {
  if (owner?.tenantId !== value.tenantId || owner?.userId !== value.userId) return;
  adoptRecordingOwner({ tenantId: "", userId: "" });
}

function setOwner(value: RecordingOwner) {
  if (owner?.tenantId === value.tenantId && owner?.userId === value.userId) return;
  owner = { ...value };
  notify();
}

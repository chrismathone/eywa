/**
 * 녹음 세션 — 문서(창·탭)마다 여러 개, 시작한 화면과 따로 산다(루트의 `RecordingRuntime`이 아이콘을 띄운다).
 *
 * 🔴 **여러 개를 켜 두되 소리를 담는 것은 하나**(원장 2026-10-16): 녹음을 시작하거나 '이어서 녹음'을 누르면 나머지(다른
 *    창·탭 포함)는 자동으로 일시정지된다. 한 마이크로 두 녹음이 동시에 돌면 같은 소리가 양쪽에 들어가 전사·분석을 가를 수
 *    없다. 같은 대상(같은 상담·같은 회의)은 녹음 하나만 둔다(`browser-recording-channel`의 대상 잠금).
 * 소리는 시작한 폼이 올리기 전까지 이 브라우저 밖으로 나가지 않는다(1초 조각은 IndexedDB, 끝내면 PC에 파일 백업).
 */
import { downloadFile } from "./audio-upload";
import { microphoneErrorMessage, microphoneMessage, refreshMicrophone } from "./microphone";
import { startRecoverySession, saveChunk, recordingScopeKey, type RecordingMeta, type RecordingOwner, type RecordingScope, type RecoveryKind } from "./recording-recovery";
import {
  announceActivation, announceRelease, announceState, connectRecordingChannel, legacyLockHeld, legacyRecording, reserveTarget,
  type RecordingActivation, type RecordingRelease, type RecordingStatus,
} from "./browser-recording-channel";

export type { RecordingStatus } from "./browser-recording-channel";
export type BrowserRecording = {
  requestId: string;
  kind: RecoveryKind;
  scope: RecordingScope;
  /** '작성 화면 열기'로 돌아갈 곳. */
  href: string;
  /** 녹음을 누른 시각 — 돌아온 작성 화면은 이보다 뒤의 임시 저장만 안내 없이 되살린다(recording-resume.ts). */
  startedAt: number;
  status: RecordingStatus;
  /** 실제로 소리를 담은 시간(일시정지한 동안은 세지 않는다). */
  seconds: number;
  meta?: RecordingMeta;
  file?: File;
  error?: string;
  errorCode?: string;
};
type Session = {
  request: BrowserRecording;
  stream?: MediaStream;
  recorder?: MediaRecorder;
  timer?: ReturnType<typeof setInterval>;
  chunks: Blob[];
  requestedStop: boolean;
  retired: boolean;
  removeTrackListeners?: () => void;
  releaseLock?: () => void;
  /** 마지막으로 시작·이어서 녹음을 누른 시각 — 문서 사이에서 '나중에 누른 것'이 이긴다. */
  activatedAt: number;
  elapsedMs: number;
  segmentStart: number | null;
  /** 준비(마이크 권한) 중에 다른 녹음이 눌렸다 — 준비가 끝나면 바로 일시정지로 둔다. */
  pauseWhenReady: boolean;
  /** 어느 녹음을 누른 탓에 멈췄나 — 그 녹음이 시작하지 못하면 이 녹음을 되돌린다. 직접 멈췄거나 다시 켰으면 비운다. */
  pausedBy?: string;
};

const EMPTY: readonly BrowserRecording[] = [];
let entries: readonly BrowserRecording[] = EMPTY;
const sessions = new Map<string, Session>();
const listeners = new Set<() => void>();
/** 지금 화면에 붙어 있는 작성 폼(요청 id → 개수) — 붙어 있으면 '작성 화면 열기'가 주소를 옮기지 않는다. */
const views = new Map<string, number>();
let owner: RecordingOwner | null = null;
let connected = false;

export const getRecordingOwner = () => owner;
export const getBrowserRecordings = () => entries;
export const getServerRecordings = () => EMPTY;
export function recordingIsActive(value: BrowserRecording | null | undefined): boolean {
  return !!value && (value.status === "starting" || value.status === "recording" || value.status === "paused" || value.status === "stopping");
}
export function recordingMatches(value: BrowserRecording | null | undefined, kind: RecoveryKind, scope: RecordingScope | null): boolean {
  return !!value && !!scope && value.kind === kind && recordingScopeKey(value.scope) === recordingScopeKey(scope);
}
/** 이 대상의 녹음 — 진행 중인 것이 먼저, 없으면 가장 최근에 끝난 것. */
export function findRecording(list: readonly BrowserRecording[], kind: RecoveryKind, scope: RecordingScope | null): BrowserRecording | null {
  const same = list.filter((value) => recordingMatches(value, kind, scope));
  return same.find(recordingIsActive) ?? same[same.length - 1] ?? null;
}

function notify() { for (const listener of listeners) listener(); }
export function subscribeBrowserRecording(listener: () => void): () => void {
  connect();
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function connect() {
  if (connected || typeof window === "undefined") return;
  connected = true;
  connectRecordingChannel({ activation: onForeignActivation, release: onForeignRelease, legacy: onLegacyRecording, change: notify });
  window.addEventListener("pagehide", () => {
    const live = entries.filter(recordingIsActive);
    stopBrowserRecording();
    for (const value of live) announceState({ ...value, status: "ready" });
  });
}

const entryOf = (id: string) => entries.find((value) => value.requestId === id);
function put(value: BrowserRecording) {
  const previous = entryOf(value.requestId);
  entries = previous ? entries.map((item) => item.requestId === value.requestId ? value : item) : [...entries, value];
  if (previous?.status !== value.status) announceState(value);
  notify();
}
function remove(drop: (value: BrowserRecording) => boolean) {
  const gone = entries.filter(drop);
  if (!gone.length) return;
  entries = entries.filter((value) => !drop(value));
  for (const value of gone) if (recordingIsActive(value)) announceState({ ...value, status: "ready" });
  notify();
}
const alive = (session: Session) => !session.retired && sessions.get(session.request.requestId) === session;
function patch(session: Session, values: Partial<BrowserRecording>) {
  const current = entryOf(session.request.requestId);
  if (alive(session) && current) put({ ...current, ...values });
}
function secondsOf(session: Session): number {
  return Math.floor((session.elapsedMs + (session.segmentStart === null ? 0 : Date.now() - session.segmentStart)) / 1000);
}
function settle(session: Session) {
  if (session.segmentStart === null) return;
  session.elapsedMs += Date.now() - session.segmentStart;
  session.segmentStart = null;
}
function clean(session: Session) {
  if (session.timer !== undefined) clearInterval(session.timer);
  session.timer = undefined;
  session.removeTrackListeners?.();
  session.removeTrackListeners = undefined;
  session.stream?.getTracks().forEach((track) => track.stop());
  session.releaseLock?.();
  session.releaseLock = undefined;
}

/** `by` = 이 녹음을 멈추게 한 녹음(다른 녹음을 누른 탓) — 직접 멈추면 비운다. */
function pauseSession(session: Session, by?: string) {
  if (!alive(session)) return;
  const status = entryOf(session.request.requestId)?.status;
  // 이미 멈춰 있다 — 직접 멈춘 것(pausedBy 없음)은 그대로, 다른 녹음 탓에 멈춘 것은 지금 누른 녹음을 따라간다. 안 그러면
  // A 녹음 중 B(준비 중) → C를 누른 뒤 B가 실패하면 A가 되살아나 마지막에 누른 C가 멈췄다(재리뷰 2026-10-16).
  const held = status === "starting" ? session.pauseWhenReady : status !== "recording";
  if (held) { if (!by || session.pausedBy) session.pausedBy = by; return; }
  if (status === "starting") { session.pauseWhenReady = true; session.pausedBy = by; return; }
  if (session.recorder?.state === "recording") session.recorder.pause();
  settle(session);
  session.pausedBy = by;
  patch(session, { status: "paused", seconds: secondsOf(session) });
}
const ownerOf = (session: Session) => ({ tenantId: session.request.scope.tenantId, userId: session.request.scope.userId });
const sameOwner = (session: Session, value: { tenantId: string; userId: string }) =>
  session.request.scope.tenantId === value.tenantId && session.request.scope.userId === value.userId;
/** 이 녹음만 소리를 담는다 — 이 문서의 나머지는 지금, 다른 창·탭은 알림을 받아 일시정지한다. */
function takeMicrophone(session: Session) {
  session.activatedAt = Date.now();
  session.pauseWhenReady = false;
  session.pausedBy = undefined;
  for (const other of sessions.values()) if (other !== session) pauseSession(other, session.request.requestId);
  announceActivation({ requestId: session.request.requestId, owner: ownerOf(session), at: session.activatedAt });
}
function onForeignActivation(message: RecordingActivation) {
  for (const session of sessions.values()) {
    if (!sameOwner(session, message.owner)) continue;
    const { requestId } = session.request;
    const newer = session.activatedAt > message.at || (session.activatedAt === message.at && requestId > message.requestId);
    if (!newer) pauseSession(session, message.requestId);
  }
}
/**
 * 누른 녹음이 시작하지 못했다(마이크 거부·백업 준비 실패·준비 중 취소) — 그 때문에 멈춘 녹음을 되돌린다. 안 그러면 녹음하던
 * 상담이 아무도 모르게 일시정지로 남는다. 소리를 담던 녹음은 하나였으니 되돌릴 것도 하나(가장 나중에 누른 것). 이 문서에
 * 없으면 다른 창·탭에 알린다.
 */
function restoreDisplaced(by: string, owner: { tenantId: string; userId: string }, tellOthers: boolean) {
  const displaced = [...sessions.values()].filter((session) => alive(session) && session.pausedBy === by && sameOwner(session, owner));
  const last = displaced.sort((a, b) => b.activatedAt - a.activatedAt)[0];
  if (last) resumeBrowserRecording(last.request.requestId);
  else if (tellOthers) announceRelease({ requestId: by, owner });
}
function onForeignRelease(message: RecordingRelease) {
  restoreDisplaced(message.requestId, message.owner, false);
}
/** 옛 판 탭이 녹음을 시작했다 — 그 탭은 일시정지 알림을 모르니 이쪽이 멈춘다(소리는 하나). */
function onLegacyRecording(message: RecordingRelease) {
  for (const session of sessions.values()) if (sameOwner(session, message.owner)) pauseSession(session, message.requestId);
}
const LEGACY_TAB = "새로고침하지 않은 다른 탭에서 녹음하고 있습니다. 그 녹음을 끝내거나 그 탭을 새로고침한 뒤 다시 눌러 주세요.";

function finish(session: Session) {
  clean(session);
  settle(session);
  const meta = session.request.meta;
  const mime = meta?.mimeType ?? "audio/webm";
  const blob = new Blob(session.chunks, { type: mime });
  session.chunks = [];
  if (!alive(session)) return;
  sessions.delete(session.request.requestId);
  const current = entryOf(session.request.requestId) ?? session.request;
  const base = { ...current, seconds: secondsOf(session), errorCode: current.errorCode };
  if (!meta || blob.size === 0) {
    put({ ...base, status: "failed", error: current.error ?? "녹음된 소리가 없습니다. 마이크를 확인한 뒤 다시 녹음해 주세요." });
    return;
  }
  const file = new File([blob], meta.fileName!, { type: mime });
  downloadFile(file);
  put({ ...base, status: "ready", file,
    error: current.error ?? (!session.requestedStop ? "녹음이 예기치 않게 중단되었습니다. 중단 전 녹음은 보관했습니다." : undefined) });
}

const SAME_TARGET = "이미 녹음하고 있습니다. 녹음 아이콘에서 진행 중인 녹음을 확인해 주세요.";
const OTHER_TAB = "다른 창이나 탭에서 같은 녹음이 진행 중입니다.";
/** 같은 대상이 이 문서에서 녹음 중이면 시작하지 않는다. 다른 대상은 함께 켜 두고, 지금 누른 것만 소리를 담는다. */
export async function startBrowserRecording(kind: RecoveryKind, scope: RecordingScope, options: { href?: string } = {}): Promise<string | null> {
  connect();
  const key = recordingScopeKey(scope);
  const busy = () => [...sessions.values()].some((s) => s.request.kind === kind && recordingScopeKey(s.request.scope) === key);
  if (busy()) return SAME_TARGET;
  const request: BrowserRecording = {
    requestId: crypto.randomUUID(), kind, scope: { ...scope },
    href: options.href ?? window.location.pathname + window.location.search,
    startedAt: Date.now(), status: "starting", seconds: 0,
  };
  const who = { tenantId: request.scope.tenantId, userId: request.scope.userId };
  const [microphone, legacyTab] = await Promise.all([refreshMicrophone(), legacyRecording(who) || legacyLockHeld(who)]);
  if (owner && (owner.tenantId !== request.scope.tenantId || owner.userId !== request.scope.userId)) return "작성 화면을 다시 열어 주세요.";
  if (busy()) return SAME_TARGET;
  if (legacyTab) return LEGACY_TAB;
  if (microphone !== "available") return microphoneMessage(microphone);
  const session: Session = { request, chunks: [], requestedStop: false, retired: false, activatedAt: request.startedAt, elapsedMs: 0, segmentStart: null, pauseWhenReady: false };
  sessions.set(request.requestId, session);
  // 같은 대상의 지난 결과(완료·확인 필요 안내)는 새 녹음이 대신한다 — 파일은 이미 폼과 PC 백업에 있다.
  entries = entries.filter((value) => recordingIsActive(value) || !recordingMatches(value, kind, scope));
  put(request);
  try {
    const release = await reserveTarget(kind, request.scope, () => alive(session));
    if (!alive(session)) { release?.(); return null; }
    if (!release) {
      sessions.delete(request.requestId);
      put({ ...request, status: "failed", error: OTHER_TAB });
      return null;
    }
    session.releaseLock = release;
    // 누른 녹음만 — 마이크를 열기 전에 나머지를 멈춘다(권한 창이 떠 있는 동안 다른 녹음에 소리가 새지 않게).
    takeMicrophone(session);
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    session.stream = stream;
    if (!alive(session)) { clean(session); return null; }
    const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((type) => MediaRecorder.isTypeSupported(type));
    if (!mime) throw new DOMException("No recording format", "NotSupportedError");
    const recorder = new MediaRecorder(stream, { mimeType: mime });
    session.recorder = recorder;
    const meta = await startRecoverySession(kind, mime, request.scope);
    session.request = { ...request, meta };
    if (!alive(session)) { clean(session); return null; }
    recorder.ondataavailable = (event) => {
      if (!event.data?.size) return;
      const index = session.chunks.length;
      session.chunks.push(event.data);
      void saveChunk(meta.id, index, event.data);
    };
    recorder.onstop = () => finish(session);
    recorder.onerror = (event) => {
      const code = (event as Event & { error?: DOMException }).error?.name ?? "UnknownError";
      patch(session, { errorCode: code, error: "녹음 오류가 발생했습니다. 중단 전 녹음은 보관합니다. 마이크 연결 상태를 확인해 주세요." });
      // MediaRecorder emits its final dataavailable and stop after the error.
      console.error("[browser-recording]", code);
    };
    const tracks = stream.getTracks();
    const ended = () => {
      if (!alive(session) || session.requestedStop) return;
      patch(session, { error: "마이크 연결이 끊겨 녹음이 중단되었습니다. 중단 전 녹음은 보관합니다." });
      if (recorder.state !== "inactive") recorder.stop();
    };
    tracks.forEach((track) => track.addEventListener?.("ended", ended));
    session.removeTrackListeners = () => tracks.forEach((track) => track.removeEventListener?.("ended", ended));
    recorder.start(1000);
    if (!alive(session)) { clean(session); return null; }
    if (session.pauseWhenReady) {
      recorder.pause();
      patch(session, { ...session.request, status: "paused" });
    } else {
      session.segmentStart = Date.now();
      patch(session, { ...session.request, status: "recording" });
    }
    session.timer = setInterval(() => {
      const seconds = secondsOf(session);
      if (entryOf(request.requestId)?.seconds !== seconds) patch(session, { seconds });
    }, 1000);
    return null;
  } catch (error) {
    clean(session);
    if (!alive(session)) return null;
    sessions.delete(request.requestId);
    const code = error instanceof Error ? error.name : "UnknownError";
    console.error("[browser-recording] start", code);
    put({ ...session.request, status: "failed", errorCode: code, error: microphoneErrorMessage(error) });
    restoreDisplaced(request.requestId, who, true);
    void refreshMicrophone();
    return null;
  }
}

export function pauseBrowserRecording(requestId: string): void {
  const session = sessions.get(requestId);
  if (session) pauseSession(session);
}

/** 이어서 녹음 — 이 녹음이 소리를 담고 나머지는 자동으로 일시정지된다. */
export function resumeBrowserRecording(requestId: string): void {
  const session = sessions.get(requestId);
  if (!session || !alive(session)) return;
  const status = entryOf(requestId)?.status;
  // 옛 판 탭은 일시정지 알림을 모른다 — 그 탭이 녹음 중이면 둘이 같은 소리를 담게 되니 켜지 않고 알린다.
  if (legacyRecording(ownerOf(session))) { patch(session, { error: LEGACY_TAB }); return; }
  if (entryOf(requestId)?.error === LEGACY_TAB) patch(session, { error: undefined });
  if (status === "starting") { takeMicrophone(session); return; }
  if (status !== "paused" || !session.recorder) return;
  takeMicrophone(session);
  if (session.recorder.state === "paused") session.recorder.resume();
  session.segmentStart = Date.now();
  patch(session, { status: "recording" });
}

/** 녹음 끝내기 — 요청 id가 없으면 이 문서의 녹음 전부(문서가 내려갈 때). */
export function stopBrowserRecording(requestId?: string): void {
  for (const session of [...sessions.values()]) {
    if (requestId && session.request.requestId !== requestId) continue;
    session.requestedStop = true;
    if (!session.recorder || !session.request.meta) {
      // 마이크 권한·백업 준비 중에 취소 — 늦게 열린 마이크는 닫는다. 이 녹음 탓에 멈춘 녹음은 되돌린다. 문서가 내려갈 때는
      // 이 문서의 녹음도 함께 끝나니 다른 창·탭에만 알린다(창이 닫히거나 새로고침돼도 거기 녹음이 멈춘 채 남지 않게).
      session.retired = true;
      clean(session);
      sessions.delete(session.request.requestId);
      remove((value) => value.requestId === session.request.requestId);
      if (requestId) restoreDisplaced(requestId, ownerOf(session), true);
      else announceRelease({ requestId: session.request.requestId, owner: ownerOf(session) });
      continue;
    }
    settle(session);
    patch(session, { status: "stopping", seconds: secondsOf(session) });
    if (session.recorder.state !== "inactive") session.recorder.stop();
  }
}

/** 끝난 녹음의 안내만 닫는다 — 로컬 백업은 저장하거나 직접 지울 때만 지운다. 대상을 안 주면 끝난 것 전부. */
export function dismissBrowserRecording(target: { requestId?: string; recoveryId?: string } = {}): void {
  remove((value) => !recordingIsActive(value)
    && (!target.requestId || value.requestId === target.requestId)
    && (!target.recoveryId || value.meta?.id === target.recoveryId));
}

/** 작성 폼이 이 녹음을 화면에 보이는 동안 — 돌려주는 함수로 뗀다. */
export function attachRecordingView(requestId: string): () => void {
  views.set(requestId, (views.get(requestId) ?? 0) + 1);
  return () => {
    const left = (views.get(requestId) ?? 1) - 1;
    if (left > 0) views.set(requestId, left);
    else views.delete(requestId);
  };
}
export const recordingViewAttached = (requestId: string) => views.has(requestId);

/** A client navigation must not carry a different account's live microphone or file. */
export function adoptRecordingOwner(next: RecordingOwner): void {
  setOwner(next);
  const same = (scope: RecordingScope) => scope.userId === next.userId && scope.tenantId === next.tenantId;
  for (const session of [...sessions.values()]) {
    if (same(session.request.scope)) continue;
    session.retired = true;
    if (session.recorder && session.recorder.state !== "inactive") session.recorder.stop();
    clean(session);
    sessions.delete(session.request.requestId);
  }
  remove((value) => !same(value.scope));
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

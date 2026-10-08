import { parseUploadEvent, type UploadEvent } from "./upload-diagnostics";

const ENDPOINT = "/api/video-submit/event";
const keyOf = (token: string) => `aywa.videoSubmit.diagnostics.${token.slice(0, 12)}`;
type Pending = { uploadId: string; event: UploadEvent; savedAt: number };
const memory = new Map<string, Pending[]>();
const storageBlocked = new Set<string>();
function read(token: string): Pending[] {
  const cached = memory.get(keyOf(token));
  if (storageBlocked.has(keyOf(token)) && cached) return cached.filter(p => p.savedAt > Date.now() - 86_400_000);
  try {
    const saved = JSON.parse(localStorage.getItem(keyOf(token)) ?? "[]");
    if (Array.isArray(saved)) return saved.filter(p => typeof p.uploadId === "string" && parseUploadEvent(p.event) && typeof p.savedAt === "number" && p.savedAt > Date.now() - 86_400_000).slice(-24);
  } catch { /* Private browsing/storage quota: memory still works. */ }
  return memory.get(keyOf(token)) ?? [];
}
function write(token: string, rows: Pending[]) {
  memory.set(keyOf(token), rows);
  try {
    if (rows.length) localStorage.setItem(keyOf(token), JSON.stringify(rows)); else localStorage.removeItem(keyOf(token));
    storageBlocked.delete(keyOf(token));
  } catch { storageBlocked.add(keyOf(token)); /* Upload is independent. */ }
}
const flushing = new Map<string, Promise<void>>();
/** Replay only this link's bounded local queue. No tokens or Drive session URLs are stored. */
export function flushUploadEvents(token: string): Promise<void> {
  const key = keyOf(token); const existing = flushing.get(key); if (existing) return existing;
  const pending = (async () => {
    for (let i = 0; i < 24; i++) {
      const item = read(token)[0]; if (!item) break;
      try {
        const response = await fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, keepalive: true,
          body: JSON.stringify({ token, uploadId: item.uploadId, event: item.event }), signal: AbortSignal.timeout(10_000) });
        if (!response.ok && ![400, 403, 404, 413].includes(response.status)) break;
        write(token, read(token).filter(p => p.uploadId !== item.uploadId || p.event.sequence !== item.event.sequence));
      } catch { break; }
    }
  })().finally(() => { flushing.delete(key); });
  flushing.set(key, pending); return pending;
}
function browserKind(): UploadEvent["browser"] {
  const ua = navigator.userAgent;
  return /KAKAOTALK/i.test(ua) ? "kakaotalk" : /SamsungBrowser/i.test(ua) ? "samsung" : /Edg/i.test(ua) ? "edge" : /Chrome|CriOS/i.test(ua) ? "chrome" : /Safari/i.test(ua) ? "safari" : "other";
}
export function createUploadReporter(token: string, uploadId: string, total: number, onEvent: (event: UploadEvent) => void) {
  const started = Date.now(); let sequence = 0; let sentBytes = 0; let phase: UploadEvent["phase"] = "transfer";
  let lastMotion = started; let stalled = false; let disposed = false;
  function event(kind: UploadEvent["kind"], detail: Partial<Pick<UploadEvent, "reason" | "attempt" | "httpStatus">> = {}, beacon = false) {
    if (disposed) return;
    const snapshot: UploadEvent = { kind, sequence: ++sequence, elapsedMs: Math.min(172_800_000, Math.max(0, Date.now() - started)), sentBytes,
      phase, reason: null, attempt: 0, httpStatus: null, online: navigator.onLine, visibility: document.visibilityState === "hidden" ? "hidden" : "visible", browser: browserKind(), ...detail };
    // Failure of diagnostics (including caller rendering/storage) must never become an upload failure.
    try { onEvent(snapshot); } catch { /* best effort */ }
    const queue = read(token).filter(p => kind !== "progress" || p.uploadId !== uploadId || p.event.kind !== "progress");
    write(token, [...queue, { uploadId, event: snapshot, savedAt: Date.now() }].slice(-24));
    if (beacon) {
      try { navigator.sendBeacon?.(ENDPOINT, new Blob([JSON.stringify({ token, uploadId, event: snapshot })], { type: "application/json" })); } catch { /* Queue remains for replay. */ }
    }
    void flushUploadEvents(token);
  }
  const visibility = () => event(document.visibilityState === "hidden" ? "hidden" : "visible", {}, document.visibilityState === "hidden");
  const leave = () => event("page_left", {}, true);
  const offline = () => event("offline");
  const online = () => { event("online"); void flushUploadEvents(token); };
  document.addEventListener("visibilitychange", visibility); window.addEventListener("pagehide", leave);
  window.addEventListener("offline", offline); window.addEventListener("online", online);
  const timer = window.setInterval(() => {
    if (!stalled && Date.now() - lastMotion >= 60_000) { stalled = true; event("stalled", { reason: phase === "confirm" ? "confirm_pending" : "no_progress" }); }
    else event("progress");
  }, 20_000);
  event("started");
  return {
    event,
    progress(bytes: number) { const next = Math.min(total, Math.max(0, Math.floor(bytes))); if (next !== sentBytes) { lastMotion = Date.now(); stalled = false; } sentBytes = next; },
    confirming() { phase = "confirm"; lastMotion = Date.now(); stalled = false; event("confirming"); },
    dispose() { disposed = true; clearInterval(timer); document.removeEventListener("visibilitychange", visibility); window.removeEventListener("pagehide", leave); window.removeEventListener("offline", offline); window.removeEventListener("online", online); },
  };
}

/**
 * 브라우저 → Google Drive **재개 가능 업로드**(조각 PUT · 끊기면 이어 올리기). 공개 제출 화면이 쓴다.
 * 서버는 세션 주소만 주고 영상 바이트는 받지 않는다(Vercel 본문 한도). 끝났는지는 서버가 Drive를 다시 읽어 확인한다.
 * 운반(`PutFn`)을 주입받아 Vitest가 끊김·이어 올리기 순서를 잠근다(실제 운반 = 아래 `xhrPut`, 진행률 때문에 XHR).
 */

/** 조각 크기 — Drive 규칙상 256KiB의 배수. 폰 회선에서 끊겨도 잃는 양이 작게 16MiB. */
import { uploadFailureText, type UploadEvent, type UploadFailureReason } from "./upload-diagnostics";

export const CHUNK_BYTES = 16 * 1024 * 1024;
const MAX_FAILURES = 5;
/**
 * **응답이 아예 없는** 실패(연결 실패·끊김)는 이만큼 이어서 다시 시도한다 — 서버 오류(5xx·429)는 종전대로 5번.
 * 2026-10-13 실측: 카카오톡 앱 안 브라우저에서 모든 요청(파일 없는 '어디까지 받았나'까지)이 1~2분 동안 바로 실패하다 풀렸다 —
 * 약 50초 만에 포기하던 업로드는 실패로 끝났고, 같은 학생이 1분 뒤 다시 올리자 같은 파일이 끝까지 올라갔다(3건 중 2건).
 * 다시 시도 사이에는 인터넷이 다시 잡히거나 화면으로 돌아오면 바로 깬다(`wakeableSleep`).
 */
export const NETWORK_RETRY_MS = 3 * 60_000;
/**
 * 시계가 안 가는 환경(멈춘 탭)에서도 끝나게 — 연결 실패가 이어지는 한 번의 끊김에서 다시 시도할 최대 횟수.
 * 연결이 붙었다 끊겼다 하면 기다림이 자주 일찍 깨서(`wakeableSleep`) 3분보다 횟수가 먼저 찰 수 있다 — 넉넉히 60.
 */
const MAX_NETWORK_RETRIES = 60;
/** 실패와 실패 사이 틈은 이만큼까지만 끊긴 시간으로 센다 — 앱이 뒤로 가 타이머가 멈춰 있던 10분이 3분을 다 써 버리지 않게. */
const OFFLINE_GAP_CAP_MS = 30_000;

export type PutResult = { status: number; range: string | null };
/** 한 번의 PUT. body=null이면 "어디까지 받았나"만 묻는다(Content-Range = bytes 별표/총크기). 네트워크 오류는 throw. */
export type PutFn = (body: Blob | null, contentRange: string, onChunkProgress?: (loaded: number) => void) => Promise<PutResult>;

/** `Range: bytes=0-12345` → 다음에 보낼 위치(12346). 없거나 이상하면 null. */
export function nextOffsetFromRange(range: string | null): number | null {
  const match = /^bytes=0-(\d+)$/.exec(String(range ?? "").trim());
  if (!match) return null;
  const end = Number(match[1]);
  return Number.isSafeInteger(end) ? end + 1 : null;
}

export class UploadError extends Error {
  constructor(public readonly code: "session_gone" | "failed", public readonly reason: UploadFailureReason = code === "session_gone" ? "session_gone" : "unknown") {
    const text = uploadFailureText(reason);
    super(`${text.label}. ${text.help}`);
  }
}

export async function runResumableUpload(input: {
  size: number; slice: (start: number, end: number) => Blob; put: PutFn;
  onProgress?: (sent: number, total: number) => void; sleep?: (ms: number) => Promise<void>; now?: () => number;
  onEvent?: (kind: "retry" | "failed" | "transferred", detail: Pick<UploadEvent, "reason" | "attempt" | "httpStatus">) => void;
}): Promise<void> {
  const { size, slice, put, onProgress } = input;
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = input.now ?? Date.now;
  let offset = 0;
  /** 서버 오류·시간 초과·진전 없음 — 종전 규칙(5번 넘으면 멈춘다). 연결 실패는 따로 센다(아래) — 끊김이 지나간 뒤 서버 오류 한 번에 끝나지 않게. */
  let failures = 0;
  let probe = false;
  /**
   * 지금 이어지는 끊김 — 시작한 자리(`from`)보다 **실제로 더 받았을 때**(또는 끝났을 때)만 지운다. '어디까지 받았나' 응답만 오고
   * 조각은 계속 못 보내는 경우(폰에서 파일을 다시 못 읽는 등)도 같은 끊김으로 이어서 세야 3분에 끝난다(적대적 리뷰 2026-10-13).
   * `elapsed` = 다시 시도하던 시간 — 실패 사이 틈은 최대 `OFFLINE_GAP_CAP_MS`까지만 센다(앱이 뒤로 가 멈춰 있던 시간은 빼고).
   */
  let offline: { from: number; elapsed: number; lastAt: number; retries: number } | null = null;
  // 진단 기록은 시도 횟수 100까지만 받는다(그 넘는 값은 서버가 거절해 마지막 실패·선생님 알림이 사라진다).
  const report = (kind: "retry" | "failed" | "transferred", reason: UploadFailureReason | null, httpStatus: number | null = null, attempt = failures) => {
    try { input.onEvent?.(kind, { reason, attempt: Math.min(attempt, 100), httpStatus }); } catch { /* Diagnostics cannot break transfer. */ }
  };
  const fail = (reason: UploadFailureReason, status: number | null = null, attempt = failures): never => {
    report("failed", reason, status, attempt); throw new UploadError(reason === "session_gone" ? "session_gone" : "failed", reason);
  };
  // 조각 수의 몇 배를 넘기면 멈춘다 — 서버가 계속 같은 자리를 돌려주는 고리를 끊는다.
  let budget = Math.ceil(size / CHUNK_BYTES) * 3 + 10;
  while (budget-- > 0) {
    let result: PutResult;
    const end = Math.min(offset + CHUNK_BYTES, size);
    try {
      result = probe
        ? await put(null, `bytes */${size}`)
        : await put(slice(offset, end), `bytes ${offset}-${end - 1}/${size}`, (loaded) => onProgress?.(offset + loaded, size));
    } catch (error) {
      const reason: UploadFailureReason = error instanceof Error && error.message === "timeout" ? "timeout" : error instanceof Error && error.message === "aborted" ? "aborted" : "network";
      if (reason === "timeout") {
        if (++failures > MAX_FAILURES) fail(reason);
        report("retry", reason);
        probe = true;
        await sleep(1000 * 2 ** Math.min(failures, 4));
        continue;
      }
      // 응답이 없는 실패는 횟수가 아니라 이어진 시간으로 끊는다(위 NETWORK_RETRY_MS). 이 시도는 '같은 자리 고리' 예산에서 빼 준다.
      const at = now();
      offline ??= { from: offset, elapsed: 0, lastAt: at, retries: 0 };
      offline.elapsed += Math.min(Math.max(at - offline.lastAt, 0), OFFLINE_GAP_CAP_MS);
      offline.lastAt = at;
      offline.retries++;
      budget++;
      if ((offline.retries > MAX_FAILURES && offline.elapsed >= NETWORK_RETRY_MS) || offline.retries > MAX_NETWORK_RETRIES) fail(reason, null, offline.retries);
      report("retry", reason, null, offline.retries);
      probe = true;
      await sleep(1000 * 2 ** Math.min(offline.retries, 4));
      continue;
    }
    if (result.status === 200 || result.status === 201) {
      onProgress?.(size, size);
      report("transferred", null, result.status);
      return;
    }
    if (result.status === 308) {
      // 받은 자리까지 — Range가 안 보이면(드물게) 방금 보낸 조각까지 받은 것으로 본다. 틀리면 다음 PUT이 다시 바로잡힌다.
      const next = nextOffsetFromRange(result.range) ?? (probe ? 0 : end);
      if (offline && next > offline.from) offline = null; // 끊긴 자리보다 더 받았다 = 끊김이 지나갔다
      if (!probe && next <= offset && ++failures > MAX_FAILURES) fail("no_progress", result.status);
      offset = Math.min(Math.max(next, 0), size - 1);
      probe = false;
      onProgress?.(offset, size);
      continue;
    }
    if (result.status === 404 || result.status === 410) fail("session_gone", result.status);
    if ((result.status === 429 || result.status >= 500) && ++failures <= MAX_FAILURES) {
      report("retry", result.status === 429 ? "server_busy" : "server_error", result.status);
      probe = true;
      await sleep(1000 * 2 ** Math.min(failures, 4));
      continue;
    }
    fail(result.status === 429 ? "server_busy" : result.status >= 500 ? "server_error" : result.status === 0 ? "network" : "server_rejected", result.status);
  }
  fail("retry_limit");
}

/**
 * 다시 시도 사이의 기다림(브라우저) — 정해진 시간이 지나거나, 인터넷이 다시 잡히거나(`online`), 화면으로 돌아오면(보이게 됨) 바로 깬다.
 * 학생이 다른 앱에 갔다 돌아오는 순간 16초를 더 기다리지 않고 이어 올린다.
 */
export function wakeableSleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    if (typeof window === "undefined") { setTimeout(resolve, ms); return; }
    const done = () => {
      clearTimeout(timer);
      window.removeEventListener("online", done);
      document.removeEventListener("visibilitychange", onVisible);
      resolve();
    };
    const onVisible = () => { if (document.visibilityState === "visible") done(); };
    const timer = setTimeout(done, ms);
    window.addEventListener("online", done);
    document.addEventListener("visibilitychange", onVisible);
  });
}

/** 실제 운반 — XHR(업로드 진행률 이벤트가 있다). 응답 본문(파일 정보)은 쓰지 않는다(서버가 Drive에서 다시 읽는다). */
export function xhrPut(sessionUrl: string): PutFn {
  return (body, contentRange, onChunkProgress) => new Promise<PutResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", sessionUrl);
    xhr.setRequestHeader("Content-Range", contentRange);
    if (body && onChunkProgress) xhr.upload.onprogress = (event) => onChunkProgress(event.loaded);
    xhr.onload = () => resolve({ status: xhr.status, range: xhr.getResponseHeader("Range") });
    xhr.onerror = () => reject(new Error("network"));
    xhr.ontimeout = () => reject(new Error("timeout"));
    xhr.onabort = () => reject(new Error("aborted"));
    xhr.timeout = 10 * 60_000;
    xhr.send(body);
  });
}

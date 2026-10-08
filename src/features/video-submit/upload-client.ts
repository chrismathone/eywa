/**
 * 브라우저 → Google Drive **재개 가능 업로드**(조각 PUT · 끊기면 이어 올리기). 공개 제출 화면이 쓴다.
 * 서버는 세션 주소만 주고 영상 바이트는 받지 않는다(Vercel 본문 한도). 끝났는지는 서버가 Drive를 다시 읽어 확인한다.
 * 운반(`PutFn`)을 주입받아 Vitest가 끊김·이어 올리기 순서를 잠근다(실제 운반 = 아래 `xhrPut`, 진행률 때문에 XHR).
 */

/** 조각 크기 — Drive 규칙상 256KiB의 배수. 폰 회선에서 끊겨도 잃는 양이 작게 16MiB. */
import { uploadFailureText, type UploadEvent, type UploadFailureReason } from "./upload-diagnostics";

export const CHUNK_BYTES = 16 * 1024 * 1024;
const MAX_FAILURES = 5;

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
  onProgress?: (sent: number, total: number) => void; sleep?: (ms: number) => Promise<void>;
  onEvent?: (kind: "retry" | "failed" | "transferred", detail: Pick<UploadEvent, "reason" | "attempt" | "httpStatus">) => void;
}): Promise<void> {
  const { size, slice, put, onProgress } = input;
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let offset = 0;
  let failures = 0;
  let probe = false;
  const report = (kind: "retry" | "failed" | "transferred", reason: UploadFailureReason | null, httpStatus: number | null = null) => {
    try { input.onEvent?.(kind, { reason, attempt: failures, httpStatus }); } catch { /* Diagnostics cannot break transfer. */ }
  };
  const fail = (reason: UploadFailureReason, status: number | null = null): never => {
    report("failed", reason, status); throw new UploadError(reason === "session_gone" ? "session_gone" : "failed", reason);
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
      if (++failures > MAX_FAILURES) fail(reason);
      report("retry", reason);
      probe = true;
      await sleep(1000 * 2 ** Math.min(failures, 4));
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

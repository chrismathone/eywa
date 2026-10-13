// 오디오 업로드 공용 — 등록상담(recording-form)·회의(new-meeting-form) 녹음 폼이 공유.
// 두 폼에 중복돼 있던 형식/크기 검증·포맷 헬퍼를 한 곳으로(#Q4 부분 — 순수 로직만, MediaRecorder 결합은 폼에 유지).

export const ACCEPTED_AUDIO_TYPES = [
  "audio/mpeg",
  "audio/mp4",
  "audio/x-m4a",
  "audio/wav",
  "audio/x-wav",
  "audio/webm",
  "audio/ogg",
];
// Windows can identify .webm as video/webm. Include extensions so downloaded audio backups
// remain selectable even when the OS assigns a different MIME type.
export const AUDIO_FILE_ACCEPT = [...ACCEPTED_AUDIO_TYPES, ".mp3", ".m4a", ".wav", ".webm", ".ogg"].join(",");
/**
 * 업로드 오디오 상한 — **100MB**(원장 2026-09-10 *"100MB까지 허용해줘"*, 종전 50MB).
 *
 * 🔴 이 값은 **서버 [`AUDIO_MAX`](./storage/media-storage.ts)와 짝**이다 — 한쪽만 올리면 클라가
 *    통과시킨 파일을 서버가 티켓 발급에서 거절해서, 사용자는 "형식도 크기도 맞는데 업로드 준비 실패"라는
 *    설명 없는 오류만 본다. 바꿀 땐 반드시 둘 다.
 * ⚠️ 옛 주석의 "Supabase free-tier cap"은 낡았다 — 유료 전환(2026-07-29) 후 버킷 상한은
 *    `meeting-recordings`·`consultation-recordings` 모두 **200MB**로 이미 열려 있다(실측 2026-09-10).
 *    즉 지금 병목은 스토리지가 아니라 이 상수였다.
 */
export const MAX_AUDIO_SIZE = 100 * 1024 * 1024;

/**
 * 화면에 적는 상한 표기 — `"100MB"`.
 * 🔴 **화면 파일에 숫자를 손으로 적지 말 것.** 2026-09-10에 상한을 50→100MB로 올렸을 때 회의록 폼과
 *    등록상담 녹음 칸이 `MP3/M4A/WAV · 50MB`를 글자로 들고 있어 **화면만 옛 숫자**로 남아 있었다
 *    (올릴 수 있는데 못 올린다고 적혀 있으면 아무도 시도하지 않는다).
 */
export const MAX_AUDIO_SIZE_LABEL = `${MAX_AUDIO_SIZE / 1024 / 1024}MB`;
const EXT_RE = /\.(mp3|m4a|wav|webm|ogg)$/i;

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function formatSeconds(s: number): string {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

/**
 * 녹음 파일명용 KST(Asia/Seoul) 타임스탬프 — `2026-06-26_20-34-41_KST`.
 * 사용자 OS 시간대와 무관하게 한국시간으로 일관(옛 팝업 동작과 동일). `toISOString()`은 UTC라 금지.
 */
export function kstTimestamp(d: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    hourCycle: "h23",
  }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${g("year")}-${g("month")}-${g("day")}_${g("hour")}-${g("minute")}-${g("second")}_KST`;
}

/** Human-readable disk backup name; identifiers distinguish recordings made in the same second. */
export function recordingFileName(
  kind: "meeting" | "consultation" | "student-consultation",
  label: string,
  startedAt: Date,
  id: string,
  mimeType = "audio/webm",
): string {
  const prefix = { meeting: "회의녹음", consultation: "콜앤상담녹음", "student-consultation": "상담녹음" }[kind];
  const safeLabel = label.normalize("NFC").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim().replace(/[. ]+$/, "").slice(0, 70);
  const extension = mimeType.startsWith("audio/mp4") ? "m4a" : mimeType.startsWith("audio/ogg") ? "ogg" : "webm";
  return `${prefix}_${safeLabel || "이름없음"}_${kstTimestamp(startedAt)}_${id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8)}.${extension}`;
}

/**
 * 녹음 파일을 사용자의 다운로드 폴더로 저장(불상사=파일증발 대비 디스크 백스톱).
 * 녹음 정지 직후 호출 — IndexedDB 복구(브라우저 내부)와 별개로 OS 파일을 남긴다(옛 팝업 동작 복원).
 * best-effort: 차단/실패해도 throw하지 않음(업로드 흐름을 막지 않게).
 */
export function downloadFile(file: File): void {
  try {
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 1000);
  } catch {
    /* 다운로드 실패해도 무시 — 파일은 폼 state + IDB에 보존 */
  }
}

/** 업로드 오디오 검증 — 통과하면 null, 아니면 폼이 그대로 표시할 에러 메시지. */
export function validateAudioFile(f: { type: string; name: string; size: number }): string | null {
  if (!ACCEPTED_AUDIO_TYPES.includes(f.type) && !EXT_RE.test(f.name)) {
    return `지원하지 않는 형식입니다: ${f.type || f.name}`;
  }
  if (f.size > MAX_AUDIO_SIZE) {
    return `파일이 너무 큽니다 (${formatBytes(f.size)} > ${formatBytes(MAX_AUDIO_SIZE)})`;
  }
  return null;
}

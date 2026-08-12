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
export const MAX_AUDIO_SIZE = 50 * 1024 * 1024; // 50 MB — Supabase free-tier cap
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

// 🔴 `downloadFile`(녹음 정지 시 다운로드 폴더 자동 저장)은 2026-08-12 개인정보 검토로 **제거**했다.
// 유실 대비 디스크 백스톱이 의도였으나, 결과적으로 상담·회의 녹음 원본이 매 건마다 직원 개인 PC에
// 남아 학원이 통제·파기할 수 없는 사본이 쌓였다(개인정보보호법 제29조 안전성 확보조치 위반 소지 —
// 서버 원본은 90일 자동 파기되는데 PC 사본은 영원히 남는다). 유실 방어는 IndexedDB 청크 복구
// (`recording-recovery.ts`)가 그대로 담당한다. ⚠️ 편의를 이유로 되살리지 말 것.

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

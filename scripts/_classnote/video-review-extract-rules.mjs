// scripts/_classnote/video-review-extract-rules.mjs — 영상 설명 AI 참고 메모(0390a)의 추출 규칙(순수 함수). 배경은 video-review-extract.mjs.
//
// 화면 이름은 서버 `src/features/video-review/storage-paths.ts`의 규칙과 같아야 한다 — 이름(확장자 뺀 것)이 판정의 근거 위치로 쓰인다.
//   `f01_00m05s.jpg`(그 시각의 화면, 긴 변 1280) · `last_02m05s_hi.jpg`(마지막 장면, 긴 변 1920) · `audio.mp3`(모노 16kHz 48k)

/** 화면 수 상한 — 하네스 6차(2026-10-20)와 같은 값. */
export const REVIEW_FRAME_MAX = 12;
/** 이만큼 세면 그만둔다(실패로 남긴다). */
export const REVIEW_EXTRACT_MAX_ATTEMPTS = 5;
const RETRY_MINUTES = [5, 15, 60];

/** 초 → `00m05s`. 음수·NaN은 0. */
export function mmssTag(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}m${String(s % 60).padStart(2, "0")}s`;
}

/** 고르게 나눈 화면 시각 — 12장(짧은 영상은 초 수만큼, 최소 5장). 각 칸의 가운데 시각. */
export function frameTimes(durationSec) {
  const d = Number(durationSec);
  if (!(d > 0)) return [];
  const k = Math.min(REVIEW_FRAME_MAX, Math.max(5, Math.ceil(d)));
  return Array.from({ length: k }, (_, i) => Number(((d * (i + 0.5)) / k).toFixed(2)));
}

export function frameName(index, seconds) {
  return `f${String(index + 1).padStart(2, "0")}_${mmssTag(seconds)}.jpg`;
}

/** 마지막 장면 — 끝 0.7초 전(마지막 프레임은 검게 끝나는 영상이 있다). */
export function lastFrameTime(durationSec) {
  return Math.max(0, (Number(durationSec) || 0) - 0.7);
}
export function lastFrameName(seconds) {
  return `last_${mmssTag(seconds)}_hi.jpg`;
}

/** 긴 변을 `size`로 맞추는 scale 필터(세로 영상은 세로가 긴 변 — ffmpeg가 회전을 먼저 반영한다). */
export function scaleFilter(size) {
  return `scale='if(gt(iw,ih),${size},-2)':'if(gt(iw,ih),-2,${size})'`;
}

/** 올릴 파일 목록(이름 · 형식) — 순서 = 소리, 화면, 마지막 장면. */
export function plannedFiles(durationSec) {
  const times = frameTimes(durationSec);
  const last = lastFrameTime(durationSec);
  return [
    { name: "audio.mp3", contentType: "audio/mpeg", kind: "audio" },
    ...times.map((t, i) => ({ name: frameName(i, t), contentType: "image/jpeg", kind: "frame", at: t, size: 1280 })),
    { name: lastFrameName(last), contentType: "image/jpeg", kind: "frame", at: last, size: 1920 },
  ];
}

/** 실패 판정 — permanent(다시 해도 안 된다)면 바로 그만두고, 아니면 횟수에 따라 5·15·60분 뒤에. */
export function failureOutcome(attempts, error, now = new Date()) {
  const permanent = error?.permanent === true;
  const reason = String(error?.reviewReason ?? error?.message ?? "추출하지 못했습니다.").slice(0, 300);
  if (permanent || attempts >= REVIEW_EXTRACT_MAX_ATTEMPTS)
    return { stage: error?.skip ? "skipped" : "failed", reason, availableAt: null };
  const minutes = RETRY_MINUTES[Math.min(RETRY_MINUTES.length - 1, Math.max(0, attempts - 1))];
  return { stage: "extract", reason, availableAt: new Date(now.getTime() + minutes * 60_000) };
}

/** 사람이 읽을 사유를 단 오류. permanent = 다시 해도 안 되는 것(원본 없음·깨짐), skip = 판정할 수 없는 영상(소리 없음). */
export function reviewError(reason, { permanent = false, skip = false } = {}) {
  return Object.assign(new Error(reason), { reviewReason: reason, permanent, skip });
}

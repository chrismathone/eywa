/**
 * 수업보고서 **영상 첨부**(원장 2026-11-06) — 발송 PC 쪽 순수 규약. 앱 쪽 같은 값 = src/features/onescreen/report-video.ts.
 *
 * ClassNote 알림장 글은 영상을 **한 개**(`attached_video`) 받는다. 작성 화면의 같은 사진·영상 입력(`media-attachment-add-input`)에
 * 영상 파일을 넣으면 kage에 `file_type=video`로 올라가고(ClassNote 화면 코드 실측 2026-11-06: 이미지=img · 영상=video · 그 밖=etc),
 * 글에는 `{ access_key, original_file_name, file_size }`(+ 길이를 알면 `duration`)로 싣는다.
 *
 * 🔴 Playwright는 **버퍼로 넘기는 파일이 50MB를 넘으면** 거절한다("Cannot set buffer larger than 50Mb") — 영상은 임시 파일로 내려받아
 *    **경로로** 넘긴다(같은 PC의 브라우저라 경로는 크기 제한이 없다).
 * 🔴 업로드 응답 대기 = 크기에 비례(사진 12초 상한으로는 50MB가 중간에 '응답 없음'이 된다 — 학원 업로드 40Mbps 아래면 12초 안에 못 끝난다).
 */

/** 영상 확장자 — 앱 `REPORT_VIDEO_EXTS`와 같은 집합. */
export const VIDEO_NAME_RE = /\.(mp4|mov|m4v)(\?|$)/i;

export const isVideoName = (name) => VIDEO_NAME_RE.test(String(name ?? ""));

const MB = 1024 * 1024;
/** 바닥 30초 + 1MB당 2초(≈ 4Mbps 바닥 속도) · 상한 6분 — 게시 1건 상한(POST_TIMEOUT_MS 10분) 안에 들어가게. */
export function videoUploadWaitMs(bytes) {
  const n = Number(bytes) || 0;
  return Math.min(6 * 60_000, 30_000 + Math.ceil(n / MB) * 2_000);
}

/** kage 응답 → 글의 영상 칸. access_key가 없으면 null. */
export function attachedVideoOf(kage, { name, size, duration = null }) {
  if (!kage?.access_key) return null;
  return {
    access_key: kage.access_key,
    original_file_name: name,
    file_size: Number(kage.info?.size ?? size) || size,
    ...(typeof duration === "number" && Number.isFinite(duration) ? { duration } : {}),
  };
}

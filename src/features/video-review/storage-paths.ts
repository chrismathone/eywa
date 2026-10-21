/**
 * 소리·화면 보관 경로(버킷 homework-video-review, 0390a) — 워커(scripts/_classnote/video-review-extract.mjs)와 서버가 같은 규칙을 쓴다.
 * `{tenantId}/{videoId}/audio.mp3` · `{tenantId}/{videoId}/f01_00m05s.jpg` · `{tenantId}/{videoId}/last_02m05s_hi.jpg`
 * 화면 이름(확장자 뺀 것)이 판정의 근거 위치로 쓰인다 — 바꾸면 하네스 지침(`f번호_분m초s`·`last_…_hi`)도 함께.
 */
export const REVIEW_BUCKET = "homework-video-review";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const NAME = "(audio\\.mp3|f\\d{2}_\\d{2}m\\d{2}s\\.jpg|last_\\d{2}m\\d{2}s_hi\\.jpg)";
const PATH_RE = new RegExp(`^(${UUID})/(${UUID})/${NAME}$`, "i");

export function reviewAssetPath(tenantId: string, videoId: string, name: string): string {
  return `${tenantId}/${videoId}/${name}`;
}

/** 이 지점·이 영상의 경로이고 이름 규칙에 맞는가(업로드 티켓·읽기 전에 확인). */
export function isReviewAssetPath(path: string, tenantId: string, videoId: string): boolean {
  const m = PATH_RE.exec(path);
  return !!m && m[1].toLowerCase() === tenantId.toLowerCase() && m[2].toLowerCase() === videoId.toLowerCase();
}

/** 화면 경로 → 판정에 쓰는 이름(확장자 뺀 것). */
export function frameLabel(path: string): string {
  return (path.split("/").pop() ?? path).replace(/\.jpg$/i, "");
}

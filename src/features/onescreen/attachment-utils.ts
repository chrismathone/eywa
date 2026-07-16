// 보고서 첨부 렌더 판별 — 이미지는 인라인 <img>, 그 외(pdf·hwp·office·오디오)는 다운로드 링크.
// 순수(서버 컴포넌트·클라 컴포넌트 공용, server-only/use client 금지). 확장자 기반.
const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "webp", "gif"]);

/** 파일명(또는 path)이 이미지 확장자인가. 확장자 없으면 false(=파일 취급). */
export function isImageAttachment(nameOrPath: string): boolean {
  const ext = (nameOrPath.split("?")[0].split(".").pop() ?? "").toLowerCase();
  return IMAGE_EXTS.has(ext);
}

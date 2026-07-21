// 보고서 첨부 렌더 판별 — 이미지는 인라인 <img>, 그 외(pdf·hwp·office·오디오)는 다운로드 링크.
// 순수(서버 컴포넌트·클라 컴포넌트 공용, server-only/use client 금지). 확장자 기반.
const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "webp", "gif"]);

/** 파일명(또는 path)이 이미지 확장자인가. 확장자 없으면 false(=파일 취급). */
export function isImageAttachment(nameOrPath: string): boolean {
  const ext = (nameOrPath.split("?")[0].split(".").pop() ?? "").toLowerCase();
  return IMAGE_EXTS.has(ext);
}

/**
 * 화면에 실을 첨부 목록.
 *
 * ⚠️ `forScreenshot`(ClassNote 발송 워커가 /r을 캡처하는 요청)이면 **파일(비이미지) 첨부를 뺀다**
 * — 스샷은 그림이라 '받기'가 눌리지 않는데, 게시글 이미지 안에 다운로드 버튼처럼 찍혀 학부모가
 * 눌러보고 오해한다(2026-07-21 원장 제보). 실제 파일은 같은 게시글에 **네이티브 첨부**로 따로 붙으므로
 * 정보 손실이 없고 중복도 사라진다. 사진은 스샷에 실리는 게 목적이라 그대로 둔다.
 */
export function visibleAttachments<T extends { name: string; path: string }>(
  list: T[],
  opts: { forScreenshot: boolean },
): T[] {
  if (!opts.forScreenshot) return list;
  return list.filter((a) => isImageAttachment(a.name || a.path));
}

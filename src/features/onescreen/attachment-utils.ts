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
 * ⚠️ `forScreenshot`(ClassNote 발송 워커가 /r을 캡처하는 요청)이면 **첨부를 전부 뺀다**(빈 배열).
 * 워커가 첨부를 ClassNote 게시글에 **네이티브 첨부**로 따로 붙이기 때문에 스샷에 또 실으면 중복이다:
 *  · 파일(비이미지) = `attached_files` (스샷은 그림이라 '받기'가 안 눌려 다운로드 버튼처럼 오해 — 2026-07-21 원장 제보)
 *  · 이미지(교재 등) = `attached_images`에 개별 부착 (2026-07-22 원장 요청 — "보고서 하단엔 첨부이미지 없어야")
 * 둘 다 게시글에 네이티브로 붙으므로 정보 손실 없이 스샷 중복만 사라진다.
 * forScreenshot=false(학부모가 여는 실제 /r 페이지)는 종전대로 전부 렌더(이미지 인라인 + 파일 링크).
 */
export function visibleAttachments<T extends { name: string; path: string }>(
  list: T[],
  opts: { forScreenshot: boolean },
): T[] {
  if (!opts.forScreenshot) return list;
  return []; // 워커 스샷: 첨부는 전부 네이티브 부착으로 이관 → 스샷엔 안 실음
}

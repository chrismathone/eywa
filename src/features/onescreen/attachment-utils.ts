// 보고서 첨부 렌더 판별 — 이미지는 인라인 <img>, 그 외(pdf·hwp·office·오디오)는 다운로드 링크.
// 순수(서버 컴포넌트·클라 컴포넌트 공용, server-only/use client 금지). 확장자 기반.
import { usedAttachmentNames } from "@/features/report-templates/image-slots";

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
 * 정보 손실이 없고 중복도 사라진다.
 *
 * **사진(이미지)은 스샷에 남긴다** — /r 하단에 크게 실려 스샷 1장으로 세로 완결(ParentReportCard).
 * ⚠️ 이미지 개별 부착(attached_images)은 2026-07-22 시도했다가 철회: ClassNote가 가로로 나열해 세로가 안 됐다.
 */
export function visibleAttachments<T extends { name: string; path: string }>(
  list: T[],
  opts: { forScreenshot: boolean },
): T[] {
  if (!opts.forScreenshot) return list;
  return list.filter((a) => isImageAttachment(a.name || a.path));
}

/**
 * 영어 템플릿 글 속 첨부 자리(`[첨부: 이름]`, image-slots.ts)가 가리키는 첨부 — 이름이 **글자까지 같은** 첫 첨부.
 * 카드가 그 자리에 그리고 아래 '첨부' 칸에선 뺀다(같은 사진이 두 번 나가지 않게). 못 찾은 줄은 아무것도 안 그린다
 * (대괄호 글자를 학부모에게 내보내지 않는다 — 워커 캡처에선 PDF가 목록에 없어 여기서 저절로 빠진다).
 */
export function pickInlineAttachments<T extends { name: string; path: string }>(
  text: string | null | undefined,
  list: readonly T[],
): Map<string, T> {
  const out = new Map<string, T>();
  for (const name of usedAttachmentNames(text)) {
    const hit = list.find((a) => a.name === name);
    if (hit) out.set(name, hit);
  }
  return out;
}

/** 보고서 한 장의 첨부 상한 — 서버(attachment-actions.ts `MAX_ATTACHMENTS`)가 같은 수로 거절한다. 화면은 미리 잠그는 데만 쓴다. */
export const REPORT_ATTACHMENT_MAX = 6;

/** 원스크린 카드의 영어 글 칸 id — '사진·PDF 넣기'가 커서 자리를 읽는다(카드는 한 번에 한 학생만 그린다). */
export const ENGLISH_DRAFT_TEXTAREA_ID = "onescreen-english-draft";

/** 글 속에 넣는 파일 — 사진(넣기 전에 자를 수 있다)과 PDF. 서버 검사(allowCT)가 최종. */
export const INLINE_MEDIA_ACCEPT = "image/jpeg,image/png,image/webp,application/pdf";

/**
 * 글 속 자리 줄이 가리킬 **겹치지 않는 이름** — 폰 사진은 대개 `image.jpg`라 이름이 같으면 자리가 엉뚱한 사진을 가리킨다.
 * 대괄호는 소괄호로(자리 줄 모양을 깨지 않게), 줄바꿈·연속 공백은 한 칸으로, 겹치면 확장자 앞에 ` (2)`.
 */
export function uniqueAttachmentName(raw: string, existing: readonly string[], fallback = "첨부"): string {
  const cleaned = (raw ?? "").replace(/\[/g, "(").replace(/\]/g, ")").replace(/\s+/g, " ").trim();
  const dot = cleaned.lastIndexOf(".");
  const hasExt = dot > 0 && dot < cleaned.length - 1 && cleaned.length - dot <= 6;
  const ext = hasExt ? cleaned.slice(dot) : "";
  const base = (hasExt ? cleaned.slice(0, dot) : cleaned).slice(0, 60).trim() || fallback;
  const taken = new Set(existing);
  let name = `${base}${ext}`;
  for (let n = 2; taken.has(name); n++) name = `${base} (${n})${ext}`;
  return name;
}

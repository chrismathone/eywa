/**
 * 학부모 공지(classnote_notices) 첨부 — 순수 규칙(서버 액션·내부 라우트 공용, server-only/use client 금지).
 *
 * 첨부는 **두 군데**에 나뉘어 저장된다(0130a):
 *  · 전원 공통(교재 표지 등) = `classnote_notices.attachments`
 *  · 학생별(교재요청서 PNG)  = `targets[].attachments`
 * 워커는 타깃마다 "공통 + 그 타깃 것"을 합쳐 올리므로, **합치기·상한·이미지/파일 분리 규칙을 한 곳**에 둔다.
 */

import { isImageAttachment } from "./attachment-utils";

export type NoticeAttachment = { path: string; name: string; size: number };

/** 한 글(=한 타깃)에 실을 수 있는 첨부 상한 — 공통+개별 합계. ClassNote 게시글이 감당하는 현실적 한계. */
export const NOTICE_ATTACHMENT_MAX = 10;

/**
 * 저장 전 정규화가 받아두는 최대치(입력 방어). 상한 판정은 `noticeAttachmentOverflow`가 하고 **초과하면 발송을
 * 막는다** — 정규화가 먼저 10장에서 잘라버리면 "넘쳤다"는 사실 자체가 사라져 조용한 누락이 된다.
 */
export const NOTICE_ATTACHMENT_INPUT_MAX = NOTICE_ATTACHMENT_MAX * 5;

/**
 * 저장 전 정규화 — 경로가 유효한 것만, 중복 path 제거, 상한까지 자른다.
 * `isValidPath`는 테넌트 경로 검증(서버가 주입) — 클라가 남의 경로를 큐 행에 실어 보내는 걸 차단한다.
 */
export function sanitizeNoticeAttachments(
  list: readonly NoticeAttachment[] | null | undefined,
  isValidPath: (path: string) => boolean,
  max: number = NOTICE_ATTACHMENT_MAX,
): NoticeAttachment[] {
  const out: NoticeAttachment[] = [];
  const seen = new Set<string>();
  for (const a of list ?? []) {
    const path = (a?.path ?? "").trim();
    if (!path || seen.has(path) || !isValidPath(path)) continue;
    seen.add(path);
    const size = Number(a?.size);
    out.push({
      path,
      name: (a?.name ?? "").trim() || "첨부",
      size: Number.isFinite(size) && size > 0 ? Math.floor(size) : 0,
    });
    if (out.length >= max) break;
  }
  return out;
}

/**
 * 공통 + 학생별 합치기 — 중복 path 제거 + 상한. 워커가 한 글에 올릴 최종 목록.
 *
 * ⚠️ **학생별(요청서)이 앞, 공통(표지)이 뒤**다. 상한에서 잘린다면 잘리는 쪽은 반드시 공통이어야 한다 —
 * 표지는 없어도 글이 성립하지만 **그 학생 본인 요청서가 빠지면 이 글의 의미(금액 근거)가 사라진다**.
 * (적대검증 2026-07-21: 공통을 앞에 두어 표지 4장 + 요청 7건이면 마지막 요청서가 조용히 잘렸다.)
 */
export function mergeNoticeAttachments(
  common: readonly NoticeAttachment[] | null | undefined,
  individual: readonly NoticeAttachment[] | null | undefined,
  max: number = NOTICE_ATTACHMENT_MAX,
): NoticeAttachment[] {
  return sanitizeNoticeAttachments([...(individual ?? []), ...(common ?? [])], () => true, max);
}

/**
 * 상한 때문에 **잘려나갈** 장수(0이면 안전). 0이 아니면 발송을 막고 "표지를 줄이라"고 알린다 —
 * 자르고 보내면 워커가 받는 목록엔 잘린 뒤 개수만 있어 **아무도 누락을 알아채지 못한다**(조용한 손실).
 */
export function noticeAttachmentOverflow(
  common: readonly NoticeAttachment[] | null | undefined,
  individual: readonly NoticeAttachment[] | null | undefined,
  max: number = NOTICE_ATTACHMENT_MAX,
): number {
  return Math.max(0, mergeNoticeAttachments(common, individual, Number.MAX_SAFE_INTEGER).length - max);
}

/**
 * 타깃 배열에 **학생별 첨부**가 하나라도 있나 — 공통 본문 일괄 수정(개별 본문 스트립)을 막는 판정.
 * 개별 본문(교재명·금액·계좌)만 지우고 이미지를 남기면 "그림만 있고 설명이 사라진 글"이 된다.
 */
export function hasNoticeTargetAttachments(targets: unknown): boolean {
  return (
    Array.isArray(targets) &&
    targets.some((t) => Array.isArray((t as { attachments?: unknown } | null)?.attachments) &&
      ((t as { attachments: unknown[] }).attachments.length > 0))
  );
}

/**
 * 이미지/파일 분류 — 이름과 **경로 둘 다** 본다. `name`은 사용자가 올린 원본 파일명이라 확장자가 없을 수 있고
 * (`KakaoTalk_20260721`), `path`는 서버가 CT 검증 후 붙인 확장자라 항상 정확하다. 이름만 보면 사진이
 * '첨부파일'로 올라가 원장이 손으로 올리던 형태(인라인 사진)와 달라진다.
 */
export function isNoticeImageAttachment(att: { name?: string | null; path?: string | null }): boolean {
  return isImageAttachment(att?.name ?? "") || isImageAttachment(att?.path ?? "");
}

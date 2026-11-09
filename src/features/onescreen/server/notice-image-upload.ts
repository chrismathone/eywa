import "server-only";

/**
 * 학부모 공지(classnote_notices) **이미지 첨부 업로드의 공통 코어** — 2단계(티켓 발급 → 클라 PUT → 서버 재검증).
 *
 * 공지 첨부 표면이 둘이라(교재요청 발송 다이얼로그 · 원스크린 공지 컴포저) 허용 형식·경로 규칙·재검증이
 * 갈라지면 한쪽만 버킷 mime과 어긋나 조용히 실패한다 → **여기 한 곳**에 둔다. 표면별로 다른 건 **게이트(권한)뿐**이고,
 * 게이트는 각 액션 파일이 책임진다(#77: 같은 레코드의 여러 표면은 같은 게이트를 통과해야 한다).
 *
 * ⚠️ DB 행에 append하지 않는다 — 공지는 발송 버튼을 누르기 전엔 큐 행이 없다. 검증된 `{path,name,size}`만
 *    돌려주고 적재는 발송 액션이 한다.
 * ⚠️ 삭제 경로는 의도적으로 없다(같은 버킷에 수업보고서 첨부가 함께 산다 — path만으로 임의 객체를 지우는
 *    표면을 열지 않는다). 화면에서 '삭제'하면 발송 목록에서만 빠진다.
 */

import { randomUUID } from "node:crypto";
import { createUploadTicket, verifyUploadedObject } from "@/lib/storage/media-storage";
import { isTenantReportAttachmentPath } from "@/lib/storage/legacy-audio-path";
import type { UploadTicket } from "@/lib/storage/types";
import type { NoticeAttachment } from "../notice-attachments";
// 버킷 바깥 상한은 영상 때문에 100MB(2026-11-06) — 공지 이미지는 종전 20MB 그대로.
import { REPORT_FILE_MAX_BYTES } from "../report-video";

const KIND = "report_attachment" as const;

// ClassNote 알림장 글의 attached_images로 올라가므로 **이미지만**.
// ⚠️ 버킷 allowed_mime_types(scripts/setup-storage.ts REPORT_ATTACHMENT_MIME_TYPES)의 부분집합이어야 한다.
const IMAGE_CT = new Set(["image/jpeg", "image/png", "image/webp"]);
const EXT_BY_CT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export const NOTICE_IMAGE_ACCEPT = "image/jpeg,image/png,image/webp";
const CT_ERROR = "이미지(JPG·PNG·WebP)만 첨부할 수 있습니다";

/** 결정적 파일명(덮어쓰기용)을 조립할 때 필요한 확장자. 허용 CT가 아니면 null(발급이 어차피 거부한다). */
export function noticeImageExt(contentType: string): string | null {
  return EXT_BY_CT[(contentType ?? "").toLowerCase()] ?? null;
}

/**
 * ① 업로드 티켓 발급 — 이미지 CT·크기 검증 후 **서버가** tenant 경로를 만든다(클라 경로 주장 금지).
 * `fileName`을 주면 그 이름으로 덮어쓴다(같은 원본 재업로드 시 객체 누적 방지) — 없으면 매번 새 경로.
 */
export async function issueNoticeImageTicket(
  tenantId: string,
  input: { contentType: string; size: number; fileName?: string },
): Promise<{ ticket?: UploadTicket; error?: string }> {
  const ct = (input.contentType ?? "").toLowerCase();
  if (!IMAGE_CT.has(ct)) return { error: CT_ERROR };
  if (!Number.isFinite(input.size) || input.size <= 0 || input.size > REPORT_FILE_MAX_BYTES)
    return { error: "이미지가 너무 큽니다 (최대 20MB)" };

  const file = input.fileName?.trim() || `${randomUUID()}.${EXT_BY_CT[ct]}`;
  const path = `${tenantId}/report-attachments/${file}`;
  if (!isTenantReportAttachmentPath(path, tenantId)) return { error: "경로 생성 실패" };
  try {
    return {
      ticket: await createUploadTicket({ kind: KIND, path, contentType: ct, upsert: Boolean(input.fileName) }),
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "업로드 준비에 실패했습니다" };
  }
}

/**
 * ② 업로드 완료 재검증 — 실제 객체의 크기·형식을 서버가 다시 확인하고 첨부 항목을 돌려준다.
 * (GCS signed PUT은 서명 시점 이후를 강제하지 않아 클라 주장만으론 신뢰 불가.)
 */
export async function verifyNoticeImage(
  tenantId: string,
  input: { path: string; name: string; size: number },
): Promise<{ attachment?: NoticeAttachment; error?: string }> {
  if (!isTenantReportAttachmentPath(input.path, tenantId)) return { error: "잘못된 파일 경로입니다" };
  try {
    const verified = await verifyUploadedObject(KIND, input.path);
    // 실제 올라온 객체가 이미지인지 재확인(kind 공용 allowCT는 문서·오디오까지 통과시킨다).
    // ⚠️ Supabase 백엔드는 verify가 best-effort(빈 값)라 값이 있을 때만 검사.
    if (verified.contentType && !IMAGE_CT.has(verified.contentType.toLowerCase())) return { error: CT_ERROR };
    if (verified.size > REPORT_FILE_MAX_BYTES) return { error: "이미지가 너무 큽니다 (최대 20MB)" };
    // Supabase 백엔드는 size도 0으로 오므로 클라가 보낸 크기로 폴백(표시용 값일 뿐).
    const size = verified.size || Math.max(0, Math.floor(Number(input.size) || 0));
    return { attachment: { path: input.path, name: (input.name || "첨부").slice(0, 120), size } };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "업로드 검증에 실패했습니다" };
  }
}

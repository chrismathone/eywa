"use server";

/**
 * 원스크린 학부모 공지 **이미지 첨부** — 2단계 티켓 업로드(발급 → 클라 PUT → 서버 재검증).
 *
 * 공지도 수업보고서와 같은 레일(워커가 `POST /api/v1_2/reports/`에 이미지를 함께 올림)이라 보고서처럼
 * 사진을 붙일 수 있어야 한다(원장 요청 2026-07-23). 업로드 코어는 교재요청 첨부와 공유
 * ([`notice-image-upload.ts`](./notice-image-upload.ts)) — 여기서 정하는 건 **게이트뿐**이다.
 *
 * 게이트 = 공지를 실제로 보낼 수 있는 사람과 **같은 조건**(#77) — 담당 반이 있는 강사(겸직 강사뷰 포함)
 * 또는 보고서 관리 권한. sendOnescreenNotice의 인가 분기와 같은 모양이라 "올릴 순 있는데 못 보내는" 갭이 없다.
 */

import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { effectiveTeacherId } from "@/lib/auth/view-mode";
import type { UploadTicket } from "@/lib/storage/types";
import type { NoticeAttachment } from "../notice-attachments";
import { issueNoticeImageTicket, verifyNoticeImage } from "./notice-image-upload";

async function gate(): Promise<{ tenantId: string } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  const teacherId = await effectiveTeacherId();
  if (!teacherId && !(await canWriteTenant(user.systemRole, "lesson_reports")))
    return { error: "공지 발송 권한이 없습니다" };
  return { tenantId: user.tenantId };
}

/** ① 업로드 티켓 발급. */
export async function issueNoticeAttachmentTicket(input: {
  contentType: string;
  size: number;
}): Promise<{ ticket?: UploadTicket; error?: string }> {
  const g = await gate();
  if ("error" in g) return { error: g.error };
  return issueNoticeImageTicket(g.tenantId, input);
}

/** ② 업로드 완료 재검증 — 발송 액션에 실을 `{path,name,size}`를 돌려준다(DB 적재는 발송 시). */
export async function registerNoticeAttachment(input: {
  path: string;
  name: string;
  size: number;
}): Promise<{ attachment?: NoticeAttachment; error?: string }> {
  const g = await gate();
  if ("error" in g) return { error: g.error };
  return verifyNoticeImage(g.tenantId, input);
}

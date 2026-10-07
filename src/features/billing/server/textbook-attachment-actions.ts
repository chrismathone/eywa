"use server";

/**
 * 교재요청 학부모 발송 첨부 업로드(2단계) — 요청서 양식 PNG(학생별) + 교재 표지(선택, 공통).
 *
 * 업로드 코어(허용 형식·경로·재검증)는 공지 첨부와 공유한다
 * ([`notice-image-upload.ts`](../../onescreen/server/notice-image-upload.ts)) — 여기서 정하는 건 **게이트**와
 * **결정적 파일명**뿐이다. (원형은 수업보고서 첨부의 2단계 티켓 업로드: issue → 클라 PUT → 서버 재검증.)
 *
 * ⚠️ 보고서 첨부와 결정적으로 다른 점: 여기서는 **DB 행에 append하지 않는다.** 교재 공지는 아직 큐 행이
 * 없는 상태(발송 버튼을 누르기 전)에서 이미지를 먼저 올리므로, 이 액션은 검증된 `{path,name,size}`만 돌려주고
 * 실제 적재는 발송 액션(sendTextbookNotice)이 큐 행(classnote_notices)에 싣는다.
 *
 * ⚠️ 삭제 액션은 **의도적으로 없다** — path만으로 임의 객체를 지우는 표면을 열지 않기 위해서(같은 버킷에
 * 수업보고서 첨부가 함께 산다). 화면에서 '삭제'하면 발송 목록에서만 빠지고 업로드된 객체는 참조되지 않은 채 남는다
 * (표지 이미지 수 KB 수준, 학부모에게 가지 않음).
 * ⚠️ 그래서 **자동 생성물(요청서 PNG)은 결정적 경로**로 올린다(`key` 인자 → stableName) — 다이얼로그를 열
 *    때마다 새 객체가 쌓이면 삭제 경로가 없는 만큼 그대로 영구 누적된다(무료 스토리지 한도 직결).
 */

import { createHash } from "node:crypto";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import type { UploadTicket } from "@/lib/storage/types";
import type { NoticeAttachment } from "@/features/onescreen/notice-attachments";
import {
  issueNoticeImageTicket,
  noticeImageExt,
  verifyNoticeImage,
} from "@/features/onescreen/server/notice-image-upload";

async function gate() {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" as const };
  if (!(await canWriteTenant(user.systemRole, "textbook_requests")))
    return { error: "교재 요청 권한이 없습니다" as const };
  return { user };
}

/**
 * 같은 원본(교재요청 1건)을 다시 캡처할 때 **같은 객체를 덮어쓰기 위한** 결정적 파일명.
 *
 * 🔴 왜: 요청서 PNG는 발송 다이얼로그를 **열기만 해도** 학생 수만큼 생성된다. 매번 새 UUID면 보내지 않고
 * 닫거나 과목을 바꾸려 다시 열 때마다 수백 KB 객체가 영구 누적된다(30명 × 10회 = 300개). 삭제 액션은
 * 의도적으로 없으므로(위 주석) **덮어쓰기**가 유일한 방어다.
 * 🔒 사용자 id를 섞어 해시한다 — 클라가 보낸 key만으로 경로를 만들면 **남의 캐시 객체를 덮어쓸 수 있다**.
 *    같은 강사가 같은 요청을 다시 캡처할 때만 같은 경로가 나온다.
 */
function stableName(userId: string, key: string, ext: string): string {
  const slug = createHash("sha256").update(`${userId}:${key}`).digest("hex").slice(0, 32);
  return `tb-${slug}.${ext}`;
}

/** ① 업로드 티켓 발급 — 이미지 CT·크기 검증 후 tenant 경로 발급(경로는 서버가 만든다). */
export async function issueTextbookAttachmentTicket(input: {
  contentType: string;
  size: number;
  /** 같은 원본을 다시 올릴 때 **같은 경로**를 받기 위한 키(교재요청 id). 없으면 매번 새 경로(수동 첨부). */
  key?: string;
}): Promise<{ ticket?: UploadTicket; error?: string }> {
  const g = await gate();
  if ("error" in g) return { error: g.error };
  const key = (input.key ?? "").trim();
  const ext = noticeImageExt(input.contentType);
  return issueNoticeImageTicket(g.user.tenantId, {
    contentType: input.contentType,
    size: input.size,
    // ext가 null이면 허용 형식이 아니라 코어가 어차피 거부한다 — 덮어쓰기 이름만 생략.
    ...(key && ext ? { fileName: stableName(g.user.id, key, ext) } : {}),
  });
}

/**
 * ② 업로드 완료 재검증 — 실제 객체의 크기·형식을 서버가 다시 확인하고 첨부 항목을 돌려준다.
 * (GCS signed PUT은 서명 시점 이후를 강제하지 않아 클라 주장만으론 신뢰 불가 — 보고서 첨부와 동일 이유.)
 */
export async function registerTextbookAttachment(input: {
  path: string;
  name: string;
  size: number;
}): Promise<{ attachment?: NoticeAttachment; error?: string }> {
  const g = await gate();
  if ("error" in g) return { error: g.error };
  return verifyNoticeImage(g.user.tenantId, input);
}

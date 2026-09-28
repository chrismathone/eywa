import "server-only";
import { notifyUsers } from "@/features/notifications/server/notify";
import { reportError } from "@/lib/observability/report-error";

/**
 * 개선요청 처리 소식 → 요청자 벨. best-effort(알림 실패가 답변 저장을 막지 않는다).
 * 보낸 이는 비운다 — 슈퍼관리자는 지점 `users`에 없는 계정일 수 있다(FK·이름 해석이 깨진다).
 */
export async function notifySupportAnswer(args: {
  tenantId: string;
  requestId: string;
  authorId: string;
  title: string;
  statusLabel: string;
}): Promise<void> {
  try {
    await notifyUsers([
      {
        tenantId: args.tenantId,
        recipientId: args.authorId,
        type: "support_answer",
        title: `개선요청 ${args.statusLabel}`,
        body: args.title,
        link: `/support/requests/${args.requestId}`,
      },
    ]);
  } catch (e) {
    reportError(e, { scope: "support.notify.answer" });
  }
}

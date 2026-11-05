import "server-only";
import { cache } from "react";
import { getCurrentUser } from "@/lib/auth/current-user";
import { viewAsTeacher } from "@/lib/auth/view-as";
import { isTenantViewWriteBlocked } from "@/lib/auth/tenant-view";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type NotificationDb = Awaited<ReturnType<typeof createClient>> | ReturnType<typeof createAdminClient>;

/** 지금 화면의 받은함 — 누구의 알림을, 어떤 연결로 읽고, 바꿀 수 있는가. */
export type NotificationInbox = {
  tenantId: string;
  recipientId: string;
  db: NotificationDb;
  /** 읽음 · 보관 · 삭제를 해도 되는가('읽기' 강사뷰는 보기만). */
  writable: boolean;
};

/**
 * 받은함 단일 소스 — 벨 목록 · 읽음 · 보관 · 삭제 · 할 일 칩이 전부 이걸 지난다.
 *
 * - 평소: 로그인한 본인 받은함. 세션 연결이라 RLS(`recipient_id = auth.uid()`)가 한 번 더 막는다.
 * - '다른 강사 뷰'(검증된 대상): **그 강사의** 받은함(원장 2026-11-05 *"강사뷰 전환시에 실제 그 사람으로 완벽하게 전환"*).
 *   DB는 강사뷰를 모르고 `auth.uid()`가 보는 사람이라, 세션 연결로는 대상 알림이 0행이다 → 관리 연결 + **지점 · 받는 사람을
 *   명시**해 그 사람 것만 읽는다(대상은 viewAsTeacher가 매 요청 자격 · 같은 지점 · 활성으로 재검증한 사람뿐). 계기: 김태건 선생님
 *   앞 '퇴원보고서 작성 요청'이 강사뷰 벨에 안 뜨고 보는 관리자 본인 알림이 떴다(점검 2026-11-05).
 *   '읽기' 강사뷰는 보기만 — 읽음 · 보관 · 삭제로 그 강사의 받은함을 바꾸지 않는다.
 * - 운영 콘솔의 '지점 보기' 중이면 null(벨을 비운다 — 알림은 지점이 아니라 받는 사람으로 걸러지는 표다).
 */
export const notificationInbox = cache(async (): Promise<NotificationInbox | null> => {
  const user = await getCurrentUser();
  if (!user) return null;
  if (user.tenantView || (await isTenantViewWriteBlocked())) return null;
  const target = await viewAsTeacher();
  if (target) return { tenantId: target.tenantId, recipientId: target.id, db: createAdminClient(), writable: target.access === "full" };
  return { tenantId: user.tenantId, recipientId: user.id, db: await createClient(), writable: true };
});

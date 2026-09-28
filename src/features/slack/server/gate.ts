import "server-only";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isCurrentUserSuperAdmin } from "@/lib/auth/super-admin";
import { isFeatureOptedIn } from "@/lib/license/server";

/**
 * 슬랙 설정 게이트 단일 소스 — 액션·카드 조회가 함께 쓴다([[#77]] 화면만 잠그지 않게).
 * 원장(master) 또는 총괄(super_admin) ∧ 슈퍼관리자가 이 지점의 '슬랙 알림 연결'을 켰을 때만.
 */
export type SlackGateOk = { tenantId: string; userId: string; email: string };

export async function slackGate(): Promise<SlackGateOk | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await isFeatureOptedIn(user.tenantId, "slack"))) {
    return { error: "이 지점은 슬랙 알림 연결이 꺼져 있습니다 — 사용하려면 운영사에 문의하세요" };
  }
  if (user.systemRole !== "master" && !(await isCurrentUserSuperAdmin())) {
    return { error: "슬랙 연결은 원장만 설정할 수 있습니다" };
  }
  return { tenantId: user.tenantId, userId: user.id, email: user.email ?? "" };
}

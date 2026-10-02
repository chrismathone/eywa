import "server-only";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canAccessTenant, canWriteTenant } from "@/lib/auth/perm-matrix";
import { isFeatureOptedIn } from "@/lib/license/server";
import { loadConnection } from "./store";

/**
 * 슬랙 설정 게이트 단일 소스 — 액션·카드 조회가 함께 쓴다([[#77]] 화면만 잠그지 않게).
 * 연동 설정 권한 ∧ 슈퍼관리자가 이 지점의 '슬랙 알림 연결'을 켰을 때만.
 */
export type SlackGateOk = { tenantId: string; userId: string; email: string };

export async function slackGate(write = true): Promise<SlackGateOk | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await isFeatureOptedIn(user.tenantId, "slack"))) {
    return { error: "이 지점은 슬랙 알림 연결이 꺼져 있습니다 — 사용하려면 운영사에 문의하세요" };
  }
  if (!(await (write ? canWriteTenant : canAccessTenant)(user.systemRole, "integration_settings"))) {
    return { error: "연동 설정을 변경할 권한이 없습니다" };
  }
  return { tenantId: user.tenantId, userId: user.id, email: user.email ?? "" };
}

/**
 * 본인 슬랙 연결(내 정보) 게이트 — 원장이 아니어도 된다(자기 계정만 연결). 지점 스위치 ∧ 연결된 봇 토큰이 있어야 한다.
 */
export type SlackSelfGateOk = { tenantId: string; userId: string; email: string; token: string };

export async function slackSelfGate(): Promise<SlackSelfGateOk | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await isFeatureOptedIn(user.tenantId, "slack"))) return { error: "이 지점은 슬랙 연결을 쓰지 않습니다" };
  const conn = await loadConnection(user.tenantId);
  if (conn.status !== "ok" || !conn.value?.botToken || conn.value.status !== "active") {
    return { error: "학원 슬랙이 아직 연결되지 않았습니다 — 원장에게 문의해 주세요" };
  }
  return { tenantId: user.tenantId, userId: user.id, email: user.email ?? "", token: conn.value.botToken };
}

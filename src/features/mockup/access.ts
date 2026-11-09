import "server-only";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { requireAccess } from "@/lib/auth/require-access";
import { isCurrentUserSuperAdmin } from "@/lib/auth/super-admin";

/**
 * 경영 분석 · 스키마·지식그래프 시안의 문 — 학원 설정 → 역할·권한의 **'경영 분석·지식그래프' 권한**(`management` · 2026-11-09 권한 줄 정비).
 * 전엔 대시보드 권한 + 코드의 원장·관리자 판정이었다 — 기본값이 그 두 역할이라(permissions.ts · 원장 결정 전 임시안) 지금 쓰는 사람은 그대로 연다.
 * 운영 계정은 늘 통과(결정 로그 2026-08-13). 메뉴 판의 '스키마·지식그래프' · 운영실 '경영 분석' 칸도 같은 권한을 본다(#77). 새 표를 읽지 않는다.
 */
export async function requireManagementSample() {
  if (await isCurrentUserSuperAdmin()) {
    const user = await getCurrentUser();
    if (!user) redirect("/login");
    return user;
  }
  return requireAccess("management");
}

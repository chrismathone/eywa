import "server-only";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { requireAccess } from "@/lib/auth/require-access";
import { isCurrentUserSuperAdmin } from "@/lib/auth/super-admin";

/**
 * 조직·OKR 시안의 문 — 학원 설정 → 역할·권한의 **'조직·OKR' 권한**(`okr` · 2026-11-09 권한 줄 정비).
 * 전엔 코드의 원장·관리자·매니저 판정이었다 — 기본값이 그 세 역할이라(permissions.ts · 원장 결정 전 임시안) 지금 쓰는 사람은 그대로 연다.
 * 운영 계정은 늘 통과(결정 로그 2026-08-13). 메뉴 판의 '조직·OKR'도 같은 권한을 본다(#77). 새 표를 읽지 않는다.
 */
export async function requireSampleViewer() {
  if (await isCurrentUserSuperAdmin()) {
    const user = await getCurrentUser();
    if (!user) redirect("/login");
    return user;
  }
  return requireAccess("okr");
}

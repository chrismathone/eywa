import "server-only";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { requireAccess } from "@/lib/auth/require-access";
import { isCurrentUserSuperAdmin } from "@/lib/auth/super-admin";

/**
 * 조직·OKR 페이지의 문 — 학원 설정 → 역할·권한의 **'조직·OKR' 권한**(`okr` · 2026-11-09 권한 줄 정비).
 * 전엔 코드의 원장·관리자·매니저 판정이었다. 기본값 = **원장만**(원장 2026-11-10 결정 — 다른 역할은 원장이 역할·권한 면에서 연다).
 * 운영 계정은 늘 통과(결정 로그 2026-08-13). 메뉴 판의 '조직·OKR'도 같은 권한을 본다(#77). 서버 라우트는 같은 판정을 menuGate('okr')로(organization-okr/server.ts).
 */
export async function requireOkrViewer() {
  if (await isCurrentUserSuperAdmin()) {
    const user = await getCurrentUser();
    if (!user) redirect("/login");
    return user;
  }
  return requireAccess("okr");
}

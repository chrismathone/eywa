import "server-only";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { requireAccess } from "@/lib/auth/require-access";
import { isCurrentUserSuperAdmin } from "@/lib/auth/super-admin";

/**
 * 연간 운영계획 · 홍보·마케팅 시안의 문 — 학원 설정 → 역할·권한의 **'홍보·마케팅' 권한**(`marketing` · 2026-11-09 권한 줄 정비).
 * 전엔 코드의 원장·관리자·매니저 판정이었다. 기본값 = **원장만**(원장 2026-11-10 결정 — 다른 역할은 원장이 역할·권한 면에서 연다).
 * 운영 계정은 늘 통과(결정 로그 2026-08-13). 메뉴 판의 두 버튼도 같은 권한을 본다(#77). 새 표를 읽지 않는다.
 */
export async function requireSampleViewer() {
  if (await isCurrentUserSuperAdmin()) {
    const user = await getCurrentUser();
    if (!user) redirect("/login");
    return user;
  }
  return requireAccess("marketing");
}

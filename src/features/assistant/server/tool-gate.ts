import "server-only";
/**
 * 비서 툴 **메뉴 권한 게이트** — 툴 하나가 곧 한 화면의 데이터라, 그 화면을 못 여는 사람은
 * 비서로도 못 봐야 한다(#77 "한 레코드의 모든 표면이 공용 게이트를 통과해야").
 *
 * 왜 RLS만으로 부족한가: RLS는 대부분 **테넌트** 격리라 역할을 안 본다. 실제로 직원관리(/staff)는
 * 원장 + 개인 예외 체제(2026-08-01)인데 그 게이트는 **메뉴 권한**이지 RLS가 아니다 → 비서 게이트만
 * 통과한 admin·manager가 "직원 목록 알려줘"로 우회 조회할 수 있었다(이탈 위험 명단이 같은 이유로
 * 2026-07-30 적대 리뷰에서 막혔던 것과 같은 구멍).
 *
 * ⚠️ 폴백은 fail-open 고정([[#60]]) — canAccessTenant 안에서 매트릭스 조회가 실패하면 테넌트 기본
 *    매트릭스로 떨어진다. 여기서 fail-closed로 바꾸지 말 것(복구불능 락아웃).
 * ⚠️ 거절은 **한글 한 줄**로 돌려준다 — 모델이 그대로 옮겨도 raw 영문 키가 노출되지 않게.
 */
import { getCurrentUser } from "@/lib/auth/current-user";
import { canAccessTenant } from "@/lib/auth/perm-matrix";
import type { MenuKey } from "@/lib/permissions";

/**
 * 메뉴 접근 권한 확인 — 통과면 null, 아니면 툴이 **그대로 반환할** 오류 JSON 문자열.
 * 사용법: `const denied = await requireMenu("staff", "직원 정보"); if (denied) return denied;`
 */
export async function requireMenu(menu: MenuKey, what: string): Promise<string | null> {
  const user = await getCurrentUser();
  if (!user) return JSON.stringify({ error: "로그인이 필요합니다." });
  // getUserPermMatrix는 요청 캐시 — 툴이 여러 번 불려도 매트릭스 조회는 요청당 1회(B4 라운드트립 0).
  if (await canAccessTenant(user.systemRole, menu)) return null;
  // 조사(을/를) 문제를 피하려 "…조회 권한" 형태로 고정 — what은 명사구만 넘긴다.
  return JSON.stringify({ error: `${what} 조회 권한이 없습니다. 사용자에게 그대로 안내하십시오.` });
}

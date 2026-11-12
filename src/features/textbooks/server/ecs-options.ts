import "server-only";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getTextbookOptions } from "./queries";
import type { TextbookOptionItem } from "../textbook-options-context";
import { isModuleOnForTenant } from "@/features/owner/server/modules";

/**
 * ECS 화면이 쓰는 **교재 제안 목록** 한 줄 진입점 — 주간 시트·월간·오늘 면이 같은 값을 본다.
 *
 * 🔴 **fail-soft**([[#95]]) — 이 화면은 영어 강사 전원이 매일 연다. 0266a 적용 전이든 조회가 실패하든
 *    빈 목록으로 떨어져 시트는 그대로 뜬다(제안만 사라지고 칸은 지금까지처럼 자유 입력이다).
 * 🔴 **여기엔 권한 판정이 없다** — 호출부(ECS 페이지)가 이미 `requireAccess("ecs")`와
 *    `requireEcsClassAccess`를 지났다. 제안 목록은 반이 아니라 **테넌트 단위** 값이라 반 게이트를
 *    한 번 더 부를 이유가 없다(그것 때문에 페이지마다 게이트가 2회 돌던 것을 여기서 없앴다).
 * ⚠️ `subject`는 그 시트의 과목이다. ECS는 지금 영어뿐이라 기본값이 `english`지만, 호출부가 값을
 *    알고 있으면 넘길 것 — 과목을 여기 박아 두면 수학 시트가 붙을 때 조용히 영어 교재를 제안한다.
 */
export async function loadEcsTextbookOptions(subject: string = "english"): Promise<TextbookOptionItem[]> {
  try {
    const user = await getCurrentUser();
    if (!user) return [];
    if (!(await isModuleOnForTenant(user.tenantId, "textbooks"))) return [];
    return await getTextbookOptions(user.tenantId, subject);
  } catch {
    return [];
  }
}

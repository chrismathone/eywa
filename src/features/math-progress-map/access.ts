/**
 * 진도맵 **공개 범위** — 원장 2026-09-16 *"진도맵 시안을 모든 관리자이상에게 공개"*.
 *
 * 종전(2026-09-14)엔 user id 명단(박소선) 한 줄이었다. 원장이 축을 바꿔서, 이제 판정은 **역할 위계**다 —
 * 관리자(`admin`) **이상**, 즉 원장·관리자. 매니저 이하는 아직 아니다.
 *
 * 🔑 **명단을 다시 만들지 말 것** — 사람이 바뀔 때마다 uuid를 줍는 자리가 되면 "지금 누가 보는가"를 아무도
 *    모르게 된다. 더 열 땐 이 상수 한 줄(`PROGRESS_MAP_MIN_ROLE`)을 내리고, 시안이 끝나 전 직원에게 열 땐
 *    이 게이트가 아니라 **메뉴키(`mcs`) 권한 그대로**로 넘긴다(2026-09-14 결정 그대로).
 * ⚠️ **아직 숨은 기능이다** — 사이드바·메뉴키·검색 팰릿에 올리지 않는다(가드 `access.test.ts`). 진입로는
 *    MCS 랜딩 머리의 '진도맵(시안)' 링크 하나 + 직접 주소이고, 범위 밖 계정엔 링크도 없고 페이지는 404다.
 * ⚠️ super_admin은 이 판정 밖에서도 통과한다(원장 2026-08-13 상시 규약) — `server/access.ts`가 얹는다.
 * ⚠️ 페이지는 이 게이트 **앞에** `requireAccess("mcs")`도 지난다 — `mcs` 기본값이 master·admin 모두 full이라
 *    두 축이 어긋나지 않는다. 그 기본값을 낮추는 날엔 여기도 함께 볼 것(화면은 조용히 닫힌다).
 */
import { ROLE_HIERARCHY } from "@/lib/auth/role-hierarchy";
import type { SystemRole } from "@/lib/permissions";

/** 여기까지 열려 있다 — 관리자(`admin`) 이상 = 원장·관리자. */
export const PROGRESS_MAP_MIN_ROLE: SystemRole = "admin";

/** 역할이 공개 범위 안인가 — 순수 판정(super_admin 통과는 서버 게이트가 얹는다). */
export function canSeeProgressMapPreview(role: SystemRole): boolean {
  return ROLE_HIERARCHY[role] <= ROLE_HIERARCHY[PROGRESS_MAP_MIN_ROLE];
}

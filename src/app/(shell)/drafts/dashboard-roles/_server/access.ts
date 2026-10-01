import "server-only";
import { cache } from "react";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isCurrentUserSuperAdmin } from "@/lib/auth/super-admin";

/**
 * 역할별 운영실 시안(`/drafts/dashboard-roles`) — **원장(master) + 슈퍼관리자만**. 범위 밖이면 false.
 *
 * 이 화면은 **실제 업무 데이터**(운영실 스냅샷 전체 — 금액·직원·퇴원 명단까지)를 읽는다. 그래서 이 게이트가 핵심이다:
 * 레이아웃(loading 앞, 문서 요청에 404)·페이지(데이터를 읽기 전)가 **둘 다** 이 함수를 지난다([[#77]] — UI 조건은 게이트가 아니다).
 * 판정은 급여명세서(`canManageSalary`)와 같은 두 줄이다. 슈퍼관리자는 역할이 관리자(admin)일 수도 있어 역할만 보면
 * 잠긴다(`owner/page.tsx` 주석) — 그래서 표를 따로 묻는다. 범위 밖이면 없는 주소와 똑같이 `notFound()`.
 * 메뉴·사이드바엔 올리지 않는다.
 */
export const canOpenDraft = cache(async (): Promise<boolean> => {
  const user = await getCurrentUser();
  if (!user) return false;
  if (user.systemRole === "master") return true;
  return isCurrentUserSuperAdmin();
});

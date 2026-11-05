import "server-only";
import { cache } from "react";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isCurrentUserSuperAdmin } from "@/lib/auth/super-admin";
import { canSeeProgressMapPreview } from "../access";

/**
 * 진도맵(시안)을 볼 수 있는가 — **관리자 이상 또는 super_admin**(원장 2026-09-16, 그전엔 user id 명단).
 * 페이지 게이트와 MCS 랜딩의 링크 노출이 이 함수 하나를 지난다(#77 — 화면에서만 감추면 주소를 치면 열린다).
 * 요청당 1회 cache. 비로그인은 false(페이지는 그 앞의 `requireAccess("mcs")`가 /login으로 보낸다).
 * 🔑 역할은 '다른 강사 뷰'면 **대상 직원 X의 역할**이다(원장 2026-11-05 강사뷰 전수 — 원장 A가 강사 X 화면을 볼 때 X에게 없는
 *    시안 링크가 서면 'X가 보는 화면'이 아니다). 총괄 우회도 강사뷰 중에는 열리지 않는다(super-admin.ts).
 */
export const canPreviewProgressMap = cache(async (): Promise<boolean> => {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return false;
  if (canSeeProgressMapPreview(user.systemRole)) return true;
  // MCS 랜딩은 수학 강사 전원의 매일 첫 화면 — 강사·학생 역할엔 super_admin 조회(왕복 1)를 안 붙인다(숨은 기능을 위해
  // 핫패스에 쿼리를 더하지 않는다, 적대 리뷰 2026-09-14). 이 테넌트의 super_admin은 master·admin 행이라 위에서 이미 통과한다.
  if (user.systemRole === "teacher" || user.systemRole === "student") return false;
  return isCurrentUserSuperAdmin();
});

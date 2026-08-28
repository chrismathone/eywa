import "server-only";
import { getCurrentUser, type CurrentUser } from "@/lib/auth/current-user";
import { accessLevelTenant, canWriteTenant } from "@/lib/auth/perm-matrix";

/**
 * 시간표(개발중) 월별 계획의 **유일한 권한 게이트**.
 *
 * `timetable_plan_slots`(0231a)는 RLS를 켜고 **정책 0개 + service_role 전용**이라, 세션 클라이언트로는
 * 에러 없이 0행이 오고([[#104]]) 실제 접근은 전부 admin 클라이언트로 이뤄진다 = **DB가 아무도 안 막는다.**
 * 그래서 조회·모든 서버 액션이 예외 없이 이 함수를 통과해야 한다(#77 "한 레코드의 모든 표면이 공용 게이트를").
 * 화면에서만 버튼을 숨기는 것은 게이트가 아니다.
 *
 * 판정은 **시간표 메뉴 권한**(`"timetable"`)을 그대로 쓴다 — 계획은 시간표의 미래판이지 새 메뉴가 아니다.
 * ⚠️ bare `canAccess`/`accessLevel`(권한 매트릭스 원본)을 직접 부르지 않는다([[#58]]) — 테넌트 override와
 *    개인 예외가 얹힌 tenant-aware 헬퍼만 쓴다. super_admin 우회·'다른 강사 뷰' 열람 캡도 그 안에 있다.
 *
 * 🔴 **쓰기는 `full`만** — `canWriteTenant`는 `scoped`(강사)도 통과하지만, 월 계획은 **학원 전체의 격자**라
 *    "내 담당 것만 쓴다"가 성립하지 않는다(한 칸을 옮기면 남의 반·남의 강의실이 함께 움직인다).
 *    본 시간표의 편집 버튼도 같은 이유로 `canManageTenant`(=full)로 잠겨 있다
 *    (`(shell)/timetable/page.tsx` 158~160줄 · perm-matrix `canManageTenant` 주석 — 2026-08-06 원장 제보로
 *    강사에게 시간표 '편집'이 열려 있던 것을 좁힌 결정). 계획도 같은 선을 지킨다.
 *    `canWriteTenant`를 함께 거는 이유는 '다른 강사 뷰'(열람 전용) 중앙 캡을 한 번 더 태우기 위함이다.
 */
export type TimetablePlanAccess = {
  user: CurrentUser;
  tenantId: string;
  /** 계획을 만들거나 고칠 수 있는가(= 시간표 메뉴 full). 화면의 편집 UI 노출도 이 값을 쓸 것. */
  canWrite: boolean;
};

export type TimetablePlanAccessResult =
  | { ok: true; access: TimetablePlanAccess }
  | { ok: false; error: string };

export async function requireTimetablePlanAccess(
  opts: { write?: boolean } = {},
): Promise<TimetablePlanAccessResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };

  const level = await accessLevelTenant(user.systemRole, "timetable");
  if (level === "none") return { ok: false, error: "시간표 접근 권한이 없습니다" };

  // full + 쓰기 가능(열람 전용 뷰 캡 통과) 둘 다여야 쓰기. 위 주석의 두 갈래를 그대로 옮긴 것.
  const canWrite = level === "full" && (await canWriteTenant(user.systemRole, "timetable"));
  if (opts.write && !canWrite) {
    return { ok: false, error: "시간표 계획을 편집할 권한이 없습니다" };
  }

  return { ok: true, access: { user, tenantId: user.tenantId, canWrite } };
}

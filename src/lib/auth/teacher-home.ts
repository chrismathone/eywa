import "server-only";
import { cache } from "react";
import { canAccess, roleHome, type AccessMatrix, type SystemRole } from "@/lib/permissions";
import { ecsAssistantClassIds } from "@/features/class-sheets/server/access";
import { effectiveTeacherId } from "./view-mode";
import { getUserPermMatrix } from "./perm-matrix";
import { getTeacherScope } from "./teacher-scope";
import {
  DEFAULT_TEACHER_HOME,
  ENGLISH_TEACHER_HOME,
  teacherHomeFromAssistantClasses,
  teacherHomeFromClassSubjects,
} from "./teacher-home-rule";
import { getCurrentUser } from "./current-user";
import { landingPathFromDuties } from "@/features/attendance/seat/duty";
import { getSeatDuties } from "@/features/attendance/seat/server/duty";

/**
 * 🔴 무한 리다이렉트 가드 — ECS 홈은 **접근이 열려 있을 때만** 준다.
 *
 * `/ecs`는 `teacher_onescreen`과 달리 **ROLE_LOCKED가 아니다**(학원설정 '강사 내 메뉴 표시'에서 끌 수 있는
 * `TEACHER_MENU_KEYS` 중 하나). 접근이 꺼진 학원에서 홈을 ECS로 주면 `requireAccess("ecs")` 거부 → 홈(=/ecs)
 * 폴백 → 다시 거부가 **무한히** 돈다. 원스크린은 ROLE_LOCKED라 폴백 종점으로 항상 안전하다.
 *
 * 판정 축은 **teacher 행**이다 — (shell) 레이아웃의 뷰-경로 가드가 강사뷰에서 그 행으로 통과를 정하므로,
 * 다른 축을 쓰면 "홈은 ECS인데 레이아웃이 도로 튕기는" 어긋남이 난다(겸직 관리자 포함).
 */
async function ecsHomeIfAllowed(home: string): Promise<string> {
  if (home !== ENGLISH_TEACHER_HOME) return home;
  return canAccess("teacher", "ecs", await getUserPermMatrix())
    ? ENGLISH_TEACHER_HOME
    : DEFAULT_TEACHER_HOME;
}

/**
 * 강사뷰 홈 — **영어 전담이면 ECS, 그 외 원스크린**. 판정 규칙은 [teacher-home-rule.ts](./teacher-home-rule.ts).
 *
 * ⚠️ 이건 **뷰 기준**이지 role 기준이 아니다 — 겸직(관리자 계열 + 강사뷰 쿠키)도 강사 미니셸에 있으면
 * 그 사람의 작업면은 강사 홈이다. 그래서 `roleHome(실 role)`이 아니라 `effectiveTeacherId()`를 본다.
 *
 * 비용: 담당 반 과목으로 끝나면 추가 쿼리 0(`getTeacherScope`는 요청당 React cache — 스코프 소비처가
 * 이미 부른다). 담당 반이 0개일 때만 부담임 슬롯 1쿼리(`ecsAssistantClassIds`도 cache라 ECS 화면과 공유).
 * 권한 매트릭스(`getUserPermMatrix`)도 cache라 레이아웃·requireAccess와 같은 것을 재사용한다.
 */
export const teacherViewHome = cache(async (): Promise<string> => {
  const teacherId = await effectiveTeacherId();
  if (!teacherId) return DEFAULT_TEACHER_HOME;
  const { subjects } = await getTeacherScope(teacherId);
  return ecsHomeIfAllowed(
    teacherHomeFromClassSubjects(subjects) ??
      teacherHomeFromAssistantClasses((await ecsAssistantClassIds()).length),
  );
});

/**
 * 담당 반 과목을 **이미 손에 들고 있을 때**의 강사 홈 — 관리자→강사뷰 전환 액션 전용.
 *
 * ⚠️ 그 액션에서 `teacherViewHome()`을 쓸 수 없는 이유: 강사뷰 쿠키를 **방금 이 응답에서** 세팅했는데
 * `effectiveTeacherId()`는 요청 쿠키를 읽어 아직 안 보인다(→ 항상 원스크린으로 착지해 버린다).
 * 규칙 자체는 teacher-home-rule 한 곳뿐이라 두 경로가 갈라지지 않는다.
 */
export async function teacherHomeForSubjects(subjects: string[]): Promise<string> {
  return ecsHomeIfAllowed(teacherHomeFromClassSubjects(subjects) ?? DEFAULT_TEACHER_HOME);
}

/**
 * 착지 경로 **단일 소스** — 권한 거부 폴백·로그인 착지·랜딩 리다이렉트·'내 정보' 되돌아가기가 전부 이걸 쓴다.
 *
 * 강사뷰(실 강사 + 겸직 강사뷰)면 위 강사 홈, 그 외는 기존 `roleHome`(학생=/my-learning, 관리자=/dashboard).
 * ⚠️ 겸직이 강사뷰 중에 권한 없는 페이지를 열면 예전엔 `roleHome(admin)`=`/dashboard`로 갔다가 (shell)
 * 레이아웃의 뷰-경로 가드가 다시 강사 홈으로 튕겼다(리다이렉트 2회). 여기서 바로 강사 홈을 주므로 착지는
 * 같고 왕복만 하나 준다.
 */
export async function landingPath(role: SystemRole, matrix?: AccessMatrix): Promise<string> {
  // 자리 출석부 담당 토글 — 강사 홈보다 앞선다(원장: 로그인하면 그 출석부로).
  const user = await getCurrentUser();
  if (user) {
    const seatHome = landingPathFromDuties(await getSeatDuties(user.id));
    if (seatHome) return seatHome;
  }
  if (await effectiveTeacherId()) return teacherViewHome();
  return roleHome(role, matrix);
}

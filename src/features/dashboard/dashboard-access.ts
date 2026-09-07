import { canManageStaff } from "@/lib/auth/role-hierarchy";
import {
  canAccess,
  canWrite,
  type AccessMatrix,
  type MenuKey,
  type SystemRole,
} from "@/lib/permissions";
import type { TodayActionAccess } from "./today-actions";

/**
 * `오늘` 화면이 다루는 도메인별 유효 권한.
 *
 * 페이지·브리핑·하단 카드가 서로 다른 기준으로 판단하면 홈에서 민감 정보가 새거나,
 * 눌러도 열리지 않는 링크가 생긴다. 한 번 계산한 작은 boolean 집합을 서버 컴포넌트
 * 안에서만 공유해 같은 기준으로 조회와 렌더를 건넌다.
 *
 * ⚠️ **소비처 없는 갈래는 두지 않는다** — 이 집합의 유일한 소비처는 운영실 페이지 하나라,
 * 화면에서 블록이 빠지면 그 블록만 보던 갈래도 함께 뺀다(2026-09-03: `read.classes`·
 * `read.timetable`은 '실시간 운영', `write.classes`는 '빠른 작업'과 함께 제거).
 */
export type DashboardAccess = {
  read: {
    attendance: boolean;
    billing: boolean;
    consultations: boolean;
    enrollment: boolean;
    lessonReports: boolean;
    meetings: boolean;
    owner: boolean;
    staff: boolean;
    students: boolean;
  };
  write: {
    billing: boolean;
    consultations: boolean;
    enrollment: boolean;
    meetings: boolean;
    students: boolean;
  };
  /** 휴가 승인은 역할 계층과 테넌트 staff 쓰기 권한을 모두 충족해야 한다. */
  manageStaff: boolean;
};

export function resolveDashboardAccess(role: SystemRole, matrix: AccessMatrix): DashboardAccess {
  return {
    read: {
      attendance: canAccess(role, "attendance", matrix),
      billing: canAccess(role, "billing", matrix),
      consultations: canAccess(role, "consultations", matrix),
      enrollment: canAccess(role, "enrollment", matrix),
      lessonReports: canAccess(role, "lesson_reports", matrix),
      meetings: canAccess(role, "meetings", matrix),
      owner: canAccess(role, "owner", matrix),
      staff: canAccess(role, "staff", matrix),
      students: canAccess(role, "students", matrix),
    },
    write: {
      billing: canWrite(role, "billing", matrix),
      consultations: canWrite(role, "consultations", matrix),
      enrollment: canWrite(role, "enrollment", matrix),
      meetings: canWrite(role, "meetings", matrix),
      students: canWrite(role, "students", matrix),
    },
    manageStaff: canManageStaff(role) && canWrite(role, "staff", matrix),
  };
}

/**
 * "이 조치 화면을 지금 이 사람이 열 수 있는가" 술어.
 *
 * 오늘 조치 카드(todayActions 필터)와 일일 브리핑 바로 가기 칩이 **같은 판정**을 써야 한다 —
 * 갈리면 한쪽에만 눌러도 튕기는 죽은 링크가 생긴다([[#77]]). 브리핑 payload는 master 관점
 * 전신호(0114a)라 admin·manager에게 그대로 링크를 깔면 실제로 그런 링크가 나온다.
 */
export function todayActionGate(
  role: SystemRole,
  matrix: AccessMatrix,
  access: Pick<DashboardAccess, "manageStaff">,
): (menuKey: MenuKey, requiredAccess: TodayActionAccess) => boolean {
  return (menuKey, requiredAccess) => {
    if (!canAccess(role, menuKey, matrix)) return false;
    if (requiredAccess === "write") return canWrite(role, menuKey, matrix);
    if (requiredAccess === "manage-staff") return access.manageStaff;
    return requiredAccess === "read";
  };
}

import type { SystemRole } from "@/lib/permissions";

export const ENROLLMENT_DATE_DENIED = "수강 날짜를 수정할 권한이 없습니다";

export type EnrollmentDateAccess = { allowed: boolean; classIds: string[] | null };

export function canEditEnrollmentDateClass(access: EnrollmentDateAccess, classId: string | null | undefined): boolean {
  return access.allowed && !!classId && (access.classIds === null || access.classIds.includes(classId));
}

/** 메뉴 권한과 분리된 기능 지정. 원장과 운영 계정은 기존 자격을 유지한다. */
export function canEditEnrollmentDates(
  user: { id: string; systemRole: SystemRole },
  isSuperAdmin: boolean,
  editorIds: unknown,
): boolean {
  if (user.systemRole === "student") return false;
  return isSuperAdmin || user.systemRole === "master" ||
    (Array.isArray(editorIds) && editorIds.includes(user.id));
}

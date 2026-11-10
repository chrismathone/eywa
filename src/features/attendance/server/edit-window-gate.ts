import { accessLevelTenant } from "@/lib/auth/perm-matrix";

/**
 * 강사 7일 수정 창(`isWithinAttendanceEditWindow`)을 거는가 — **역할 이름이 아니라 출석 권한 단계**로(수정 계획 P1-A 4-5).
 * 출석부 액션(`attendance/server/actions.ts`)은 처음부터 `accessLevelTenant(…, "attendance") === "scoped"`로 걸었는데
 * ECS·원스크린 보강 액션은 `systemRole === "teacher"`만 봐서, 출석 권한이 '담당만'인 다른 역할은 그 화면에서만 기간 제한 없이
 * 지난 출결을 고칠 수 있었다. 권한표가 그 역할을 '전체'로 두면 종전처럼 제한 없음.
 * ⚠️ `"use server"` 파일에서 export하지 말 것(#119) — 이 일반 모듈에서 가져다 쓴다.
 */
export async function attendanceWindowApplies(systemRole: Parameters<typeof accessLevelTenant>[0]): Promise<boolean> {
  return (await accessLevelTenant(systemRole, "attendance")) === "scoped";
}

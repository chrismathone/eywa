import "server-only";
import { accessLevelTenant } from "@/lib/auth/perm-matrix";
import type { SystemRole } from "@/lib/permissions";

export const TIMETABLE_IMPORT_DENIED_MSG = "시간표 일괄 가져오기 권한이 없습니다";

/**
 * 시간표 **파일(xlsx) 일괄 가져오기**(미리보기·적용) 공통 게이트 = classes 접근 "full"만.
 * 시트 경로의 `canManageSheetSync`(sheet_sync=full)와 **같은 이유로 대칭**인 게이트 — 표면만 다르고
 * 다루는 데이터·권한 폭은 동일하다.
 *
 * ⚠️ canWriteTenant를 쓰지 말 것 — scoped(강사)도 통과시킨다. 업로드하는 '수강편집' 시트는 **테넌트 전체**
 * (전 강사·전 학생) 수강 목록이고, diff도 전 테넌트 컨텍스트(loadContext)로 계산되며, applyDiff는 담당 반과
 * 무관하게 아무 enrollment나 이동·종료·생성한다. 즉 "담당(scoped)" 개념이 성립하지 않는 작업이라
 * 전체/없음만 의미가 있다. (2026-07-17 적대 감사: 시트 경로만 full-only였고 파일 경로가 비대칭으로
 * 강사에게 열려 있어, 강사가 편집한 xlsx 재업로드로 학원 전체 수강을 바꿀 수 있었다.)
 *
 * 사무실(master/admin/manager)은 classes=full이라 기존 운영 흐름은 그대로 통과한다.
 * UI(가져오기 버튼) 노출도 같은 함수를 거쳐야 한다 — 화면에서만 숨기는 건 게이트가 아니다(#77).
 */
export async function canManageTimetableImport(role: SystemRole): Promise<boolean> {
  return (await accessLevelTenant(role, "classes")) === "full";
}

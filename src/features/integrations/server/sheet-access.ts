import "server-only";
import { accessLevelTenant } from "@/lib/auth/perm-matrix";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isFeatureLicensed } from "@/lib/license/server";
import type { SystemRole } from "@/lib/permissions";

export const SHEET_ACCESS_DENIED_MSG = "구글 시트 연동 권한이 없습니다";

/**
 * 시트 반영(push)·시트 가져오기(pull) 공통 게이트 = sheet_sync 액션 키 "full"(기본 master·admin·실장).
 * 코드 하드코딩이 아니라 owner 역할·권한 매트릭스를 읽으므로, 원장이 화면에서 역할별로 조정한다.
 *
 * ⚠️ canWriteTenant를 쓰지 말 것 — scoped도 통과시킨다. 이 경로는 **테넌트 전체 시간표**(전 강사·전 학생
 * 명단)를 외부 공유 시트와 주고받아 담당(scoped) 개념이 성립하지 않는다. 원장이 실수로 강사를 '담당'으로
 * 돌려도 전 학생 명단이 나가지 않도록 "full"만 통과(전체/없음만 의미 있음, MENU_ACCESS 주석과 동일 규약).
 *
 * 반/수강을 실제로 바꾸는 apply 경로는 이 게이트에 더해 canWriteTenant(role, "classes")를 별도로
 * 통과해야 한다(2단: 시트 경로 자격 + 시간표 변경 자격).
 */
export async function canManageSheetSync(role: SystemRole): Promise<boolean> {
  // 모듈(sheet_sync)이 꺼지면 권한 매트릭스 캡으로 none — 여기에 **지점 라이선스(google_sheets)**까지 건다
  // (원장 2026-09-30 "꺼지면 있었는지조차 모르게" — 라이선스를 끈 지점에 '시트로 보내기' 버튼이 서 있었다).
  if ((await accessLevelTenant(role, "sheet_sync")) !== "full") return false;
  const user = await getCurrentUser();
  return user ? isFeatureLicensed(user.tenantId, "google_sheets") : false;
}

/**
 * **연차 조정 자격** — 남의 연차 부여 일수를 바꿀 수 있는 사람. **원장 역할** + 학원 설정 '역할·권한'의 개인별 기능 권한에서 지정한 사람
 * (`permissions.specialAccess.leaveAdjusterIds` — 원장 2026-10-06 *"개인 역할은 전부다 편집기"*).
 * 🔴 원장 역할은 지정 없이 조정한다(원장 2026-10-06: *"원일은 원장인데 침산 전지점 권한이 있어야지"*) — 전의 코드 명단 밖에 있던 원장 역할(원일 · 설현)도 이제 조정한다.
 * 전에는 이 파일이 계정 명단 셋을 들고 있었다(2026-09-08). 🔴 여기에 계정 명단을 다시 만들지 말 것(가드: adjust-wiring.test.ts).
 *
 * 🔑 화면 자리는 **직원관리**다(원장 2026-09-09: *"직원관리에 버튼 연동해주지 전자결재에 있는게 연차를
 *    관리하는게 이상하자나"*). 휴가 **신청·결재**는 전자결재(`/approvals`), 연차 **부여 일수**는 직원
 *    정보라 직원관리(`/staff/annual-leave`) — 두 자리는 다른 일을 한다.
 *    ⚠️ 이 지정은 직원관리 메뉴 권한과 **별개의 좁은 문**이다. 직원관리를 볼 수 있는 사람이 곧 연차를 고칠 수 있는
 *    사람은 아니다.
 * 🔴 **반대 방향은 전제다**: 화면이 `/staff` 안에 있어 `requireAccess("staff")`를 먼저 지난다 — 즉 **지정된 사람은
 *    직원관리 메뉴가 열려 있어야 한다**(역할 칸 또는 개인별 메뉴 권한). 메뉴가 닫혀 있으면 `canAdjustLeave`는 true인데
 *    페이지가 튕겨 **버튼도 안 뜨고 에러도 없이 기능만 죽는다** — 설정 화면이 이 조건을 적어 둔다.
 * ⚠️ 화면·서버 액션이 같은 함수를 통과한다([[#77]]).
 */
import type { SystemRole } from "@/lib/permissions";

/** 연차 조정 게이트 — 화면·서버 액션이 **같은 함수**를 통과한다([[#77]]). */
export function canAdjustLeave(
  user: { id: string; systemRole: SystemRole },
  isSuperAdmin: boolean,
  policy: { adjusterIds: readonly string[] },
): boolean {
  // 운영 계정은 새로 만드는 어떤 제한도 자동 통과(원장 2026-08-13 — 자기 시스템에 잠기지 않게). 원장 역할도 지정 없이 통과.
  if (isSuperAdmin || user.systemRole === "master") return true;
  // 저장값은 스키마를 거치지 않고 읽힌다 — 목록이 아니면(손으로 넣은 값) 지정된 사람이 없는 것으로 본다.
  return Array.isArray(policy.adjusterIds) && policy.adjusterIds.includes(user.id);
}

export const LEAVE_ADJUST_DENIED_MSG = "연차를 조정할 권한이 없습니다";

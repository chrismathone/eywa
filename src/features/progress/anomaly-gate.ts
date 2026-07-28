import type { Access } from "@/lib/permissions";

/**
 * "이상 없음 확인"을 누를 수 있는가 — **순수 판정**(Vitest). 서버 액션과 화면 버튼 노출이 **같은 이 함수**를
 * 쓴다(#77: 표면마다 조건을 다시 쓰면 한쪽만 조여져 우회 구멍이 난다. UI 조건문은 게이트가 아니다).
 *
 * - `full`(원장·사무실·상담) = 전 학생 확인 가능.
 * - `scoped`(강사) = **본인 담당 학생만**. 강사도 알림 수신자이고 정상/비정상을 아는 당사자라 확인 권한을
 *   준다. 다만 scoped는 canWrite를 통과하므로 소유 확인을 **반드시 AND**로 붙여야 한다 — 안 붙이면
 *   강사가 남의 반 학생 신호까지 끌 수 있다.
 * - `readonly`/`none` = 불가(회계·뷰어).
 */
export function canResolveProgressAnomaly(level: Access, ownsStudent: boolean): boolean {
  if (level === "full") return true;
  if (level === "scoped") return ownsStudent;
  return false;
}

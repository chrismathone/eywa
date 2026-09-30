/**
 * 반 이름 공백 정리 **단일소스** (순수 · Vitest).
 *
 * 원장 2026-09-29: 반 이름은 ClassNote 반 보드 이름과 **글자까지 같아야** 동기화된다. 그런데 aywa에
 * `중등M 개별  BS3R`(공백 두 칸)이 저장돼 있었다 — 웹 화면은 연속 공백을 한 칸으로 그려서 **아무도 못 봤다**.
 * 그대로 ClassNote에 복사되면 겉보기엔 같고 글자는 다른 이름이 생긴다.
 *
 * 규칙: 앞뒤 공백 제거 + 연속 공백(탭·줄바꿈·NBSP 포함)을 한 칸으로.
 * 저장하는 모든 경로가 이 함수를 지나고, DB 트리거(0301a)가 같은 규칙으로 한 번 더 막는다
 * (시트 가져오기·cron·스크립트처럼 이 함수를 안 부르는 경로까지).
 * ⚠️ 규칙을 바꾸면 0301a 트리거의 정규식도 함께 바꿀 것 — 둘이 다르면 저장값과 화면 비교가 어긋난다.
 */
export function normalizeClassName(name: string | null | undefined): string {
  return (name ?? "").replace(/\s+/g, " ").trim();
}

/**
 * 반 이름으로 **쓸 수 없는 모양**(2026-09-30 ClassNote 개명 감사 G2) — `(수학)홍길동` 같은 괄호 접두는 ClassNote 1인 보드
 * 이름이고 `[ALL]…`은 전체방이다. 반 이름이 이 모양이면 매일 동기화가 그 보드를 반 보드로 착각할 수 있다(워커
 * class-board-plan.mjs `reservedBoardName`도 같은 모양을 반 보드로 쓰지 않는다 — 둘을 같이 고칠 것).
 * `[특강] …`처럼 대괄호로 시작하는 보통 이름은 괜찮다.
 * @returns 거절 이유(한글) — 괜찮으면 null
 */
export function reservedClassNameReason(name: string | null | undefined): string | null {
  const n = normalizeClassName(name).replace(/\s/g, "");
  if (/^\([^)]*\)/.test(n)) return "괄호로 시작하는 이름(예: (수학)홍길동)은 클래스노트 개인 보드 이름과 겹쳐 반 이름으로 쓸 수 없습니다";
  if (/^\[ALL\]/i.test(n)) return "[ALL]로 시작하는 이름은 클래스노트 전체방 이름과 겹쳐 반 이름으로 쓸 수 없습니다";
  return null;
}

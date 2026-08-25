/**
 * ECS 동시편집 presence의 **scope 단일 소스** — 축은 (반, 주차)다.
 *
 * 🔴 이 문자열을 화면마다 따로 적지 말 것. scope가 갈리면 두 화면이 서로를 못 봐서, 강사가 영어 시트에서
 *    열어 둔 반을 다른 화면(자리 출석부 JJ 진도·원스크린 계획 편집기)에서 **모르고** 고친다. 실제 덮어쓰기는
 *    CAS가 막지만, "지금 누가 보고 있다"는 신호는 그대로 사라진다.
 * ⚠️ 접두사 `ecs:`는 presence allowlist([presence-state](@/features/presence/presence-state))에 등록된 값이다 —
 *    바꾸려면 그 목록도 함께.
 *
 * 쓰는 곳: 주간/오늘 시트(툴바 배지 포함) · 원스크린 오늘 보드의 계획 편집기 · 자리 출석부 JJ 진도 블록.
 */
export function ecsPresenceScope(classId: string, weekMonday: string): string {
  return `ecs:${classId}:${weekMonday}`;
}

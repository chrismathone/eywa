import type { SlackRule } from "./rules";

/**
 * 규칙의 사람 필터 — '빼기'(exclude_actor_ids)와 '누가'(0311a actor_ids)를 한 곳에서 판정한다(expand.ts 알림·활동 두 경로 공용).
 * - 빼기에 든 사람이 한 일은 보내지 않는다.
 * - '누가'가 비면 누구든 · 채우면 그 사람이 한 일만 — 발동자가 없는 것(시스템 자동 알림·PIN 화면 기록)은 맞지 않는다.
 */
export function passesActorFilter(rule: Pick<SlackRule, "actorIds" | "excludeActorIds">, actorId: string | null): boolean {
  if (actorId && rule.excludeActorIds.includes(actorId)) return false;
  if (rule.actorIds.length && !(actorId && rule.actorIds.includes(actorId))) return false;
  return true;
}

/** A saved report remains saved; this notice concerns its makeup follow-up only. */
export function makeupEffectNotice(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const effect = value as Record<string, unknown>;
  if (effect.state !== "pending" && effect.state !== "unknown") return null;
  return effect.queued === true
    ? "기록은 저장했습니다. 보강 연결 확인이 대기 중입니다. 보강관리의 대사·복구에서 확인해 주세요."
    : "기록은 저장했습니다. 보강 연결 확인을 완료하지 못했습니다. 보강관리에서 연결 상태를 확인해 주세요.";
}

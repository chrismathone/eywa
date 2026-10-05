/** 반영 실패 기록의 성공 본문. 빈 응답·거절은 대기열에 넣은 것이 아니다. */
export function acceptedEffectGap(
  data: unknown,
  expected: { effectKey: string; kind: string },
): boolean {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const row = data as Record<string, unknown>;
  return row.queued === true
    && typeof row.id === "string"
    && row.id.length > 0
    && row.effect_key === expected.effectKey
    && row.kind === expected.kind;
}

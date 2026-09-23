/**
 * 회의록 "AI로 정리"(텍스트 재분석)가 화자 라벨을 합치는 규칙 — 순수 함수(Vitest).
 *
 * 🔴 사람이 고친 화자 이름(화자 편집 `updateMeetingSpeakers`)을 AI 추정값으로 덮지 않는다(F5, 2026-09-23 감사).
 *    덮으면 화자 A를 '원장'으로 고쳐 둔 것이 재분석 한 번에 AI 값으로 돌아가고, 함께 저장된
 *    직원 연결(`speaker_staff`)과 표시 라벨이 어긋난다. 이미 있는 라벨은 그대로 두고 **빈 화자만** AI 값으로 채운다.
 */
export function mergeSpeakerRoles(
  existing: unknown,
  inferred: Record<string, string> | null | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [speaker, label] of Object.entries(inferred ?? {})) {
    if (typeof label === "string" && label.trim()) out[speaker] = label.trim();
  }
  if (existing && typeof existing === "object" && !Array.isArray(existing)) {
    for (const [speaker, label] of Object.entries(existing as Record<string, unknown>)) {
      if (typeof label === "string" && label.trim()) out[speaker] = label;
    }
  }
  return out;
}

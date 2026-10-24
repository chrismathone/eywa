/** 신규 집계에 쓰는 실제 등록 전환. 자료 정리·보정·복구 로그의 실행일은 등록일이 아니다. */
export type EnrollmentOutcomeLog = {
  metadata: { consultationId?: unknown; from?: unknown; to?: unknown; via?: unknown } | null;
  created_at: string;
};

/** 감사로그는 시간순으로 들어온다. 상담별 마지막 실제 전환만 남긴다(자료 정리는 날짜도 덮지 않는다). */
export function enrollmentEventTimes(logs: readonly EnrollmentOutcomeLog[]): Map<string, string> {
  const movedAt = new Map<string, string>();
  for (const { metadata, created_at } of logs) {
    if (!metadata || typeof metadata.consultationId !== "string" || metadata.to !== "enrolled" || metadata.from === "enrolled") continue;
    // 화면 상태 변경(via 없음) · 수업 배정(convert) · 데모 시나리오만 등록 사건이다.
    // 스크립트·revert 등 다른 출처는 감사 기록으로 보존하되 신규로 세지 않는다. 상담의 legacy 여부와는 무관하다.
    if (metadata.via != null && metadata.via !== "convert" && metadata.via !== "demo") continue;
    movedAt.set(metadata.consultationId, created_at);
  }
  return movedAt;
}

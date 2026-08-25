/**
 * 회의 AI 보고서 8섹션 중 **인라인 수정 가능한 7섹션**의 키 → 한글 라벨(단일 소스).
 * 소비처: 화면 아코디언([ai-report.tsx](<src/app/(shell)/meetings/[id]/ai-report.tsx>))·서버 액션의
 * 편집 허용 키(updateMeetingReportSection)·감사로그 상세(audit/describe.ts).
 * 🔴 여기가 단일 소스라 감사로그에 영문 키(`summary`)가 그대로 뜨지 않는다.
 *
 * 순수 모듈(서버/클라 공용) — server-only·클라 전용 의존 금지([[#61]]·[[#81]]).
 * (meetingType은 분류 필드라 편집 대상이 아니다 — 여기 넣지 말 것.)
 */
export const MEETING_REPORT_SECTION_LABEL = {
  summary: "요약",
  agendaDiscussion: "안건별 논의",
  decisions: "결정 사항",
  actionItems: "액션 아이템",
  speakerSummary: "참석자별 발언",
  concerns: "우려 / 위험 요소",
  nextSteps: "다음 단계",
} as const;

export type MeetingReportSectionKey = keyof typeof MEETING_REPORT_SECTION_LABEL;

/** 편집 허용 섹션 키 집합 — 라벨 맵과 갈리지 않게 여기서 파생한다. */
export const EDITABLE_REPORT_KEYS: ReadonlySet<string> = new Set(
  Object.keys(MEETING_REPORT_SECTION_LABEL),
);

/** 섹션 키 → 한글 라벨(미등록 키는 null — 원문 영문을 화면에 흘리지 않는다). */
export function meetingReportSectionLabel(key: string | null | undefined): string | null {
  if (!key) return null;
  return (MEETING_REPORT_SECTION_LABEL as Record<string, string>)[key] ?? null;
}

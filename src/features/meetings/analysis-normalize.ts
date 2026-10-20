// 회의록 8섹션 분석 **저장 전** 후처리 — 모델이 바뀌어도 저장·화면 모양을 기존(v4-pro 저장본)과 같게(원장 2026-10-19).
// 순수 함수(⚠️ server-only 금지 [[#61]] — Vitest 대상). 규칙 원문 = server/ai.ts 프롬프트의 '출력 형식 규칙'
// (나열 섹션 = 줄바꿈 + '- ' · 핵심어 **굵게** 허용). 화자 표기는 기존 저장본 꼴('노원장(A)')로 맞춘다.
import { cleanRoleMap, normalizeSection, sectionSource, type SectionRules } from "@/lib/ai/section-normalize";
import type { MeetingReport } from "./server/ai";

const PROSE_KEYS = ["meetingType", "summary"] as const;
const LIST_KEYS = ["agendaDiscussion", "decisions", "actionItems", "speakerSummary", "concerns", "nextSteps"] as const;
/** 응답에 회의록 섹션 칸이 하나도 없을 때(모양 실패) — 빈 회의록을 '완료'로 저장하지 않는다. 칸이 비어 있는 것은 정상. */
export const EMPTY_MEETING_ERROR = "AI 응답에 회의록 내용이 없습니다";

/**
 * AI 응답(JSON 파싱 직후) → 기존과 같은 모양의 회의록 + 화자 역할.
 * 모양만 고친다(내용 불변) · 모르는 키는 버린다 · 한 겹 싸서 보낸 응답·키 대소문자 차이는 푼다 · 8섹션 칸이 하나도 없으면 던진다.
 */
export function normalizeMeetingAnalysis(raw: unknown): { report: MeetingReport; speakerRoles: Record<string, string> } {
  const { source: r, hasSections } = sectionSource(raw, [...PROSE_KEYS, ...LIST_KEYS], ["speakerRoles"]);
  if (!hasSections) throw new Error(EMPTY_MEETING_ERROR);
  const rules: SectionRules = { bold: "balance", speakers: "compact" };
  const out = {} as Record<string, string>;
  for (const k of PROSE_KEYS) out[k] = normalizeSection(r[k], "prose", rules);
  for (const k of LIST_KEYS) out[k] = normalizeSection(r[k], "list", rules);
  return { report: out as MeetingReport, speakerRoles: cleanRoleMap(r.speakerRoles) };
}

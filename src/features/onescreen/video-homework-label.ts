import { homeworkDueText } from "@/features/video-homework/due";
import { isVideoHomeworkDate } from "@/features/video-homework/types";

/**
 * 보고서 카드의 '영상 숙제' 칸 — 언제까지 내나(실제 제출 창과 같은 마감, video-homework/due.ts). 발송일·오늘 날짜로 연장하지 않는다.
 * "10/9 (금)까지"(기본 수업일 + 7일) · "다음 수업 10/15 (목)까지"(선생님이 고른 마감). 올리기 사이트·멘트와 같은 문구다(원장 2026-10-15).
 * `due` = 저장된 마감 · `next` = '다음 수업'을 골랐다(저장 전 미리보기는 날짜를 몰라 "다음 수업 전까지").
 */
export function videoHomeworkDueLabel(reportDate: string | null, assigned?: boolean | null, due?: string | null, next?: boolean): string | null {
  if (assigned !== true || !reportDate || !isVideoHomeworkDate(reportDate)) return null;
  return next === undefined ? homeworkDueText(reportDate, due) : homeworkDueText(reportDate, due, next);
}

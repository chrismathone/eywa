/**
 * 영상 숙제의 **제출 마감** — 순수(클라·서버 공용, `server-only` 금지 [[#61]]).
 * 원장 2026-10-15 *"선생님이 영상 숙제 체크할때 마감 날짜를 정하는게 좋을듯. 다음수업 또는 7일 둘중에 하나 토글하게"* · *"기본값은 7일"*
 * (계기: 하은결 10/14 — 학생이 '10/12 수업 숙제'를 10/15에 낼 숙제로 알고 '숙제 없이 올리기'를 골랐다).
 *  · 7일(기본) = 숙제일 + 7일(`SITE_HOMEWORK_DAYS`) — 저장값이 없다(`lesson_reports.video_homework_due` null).
 *  · 다음 수업 = 보고서를 저장할 때 서버가 시간표로 찾은 그 학생의 다음 수업일을 **날짜로 고정**해 둔다(issue-window.ts `nextLessonDate`).
 *    학부모에게 나간 마감이 뒤에 시간표를 고쳐도 바뀌지 않게 날짜로 남긴다.
 *  · 마감은 숙제일 뒤 `VIDEO_HOMEWORK_MAX_DUE_DAYS`(14일) 안 — 장부가 영상을 그 숙제로 세는 창(rounds.ts `VIDEO_MATCH_WINDOW_DAYS`)을 넘지 않게.
 * 🔴 올리기 사이트가 받는 기간 · 미수행 판정(DB 함수 `reconcile_video_homework_outcomes` 포함) · 반려 뒤 다시 올리기 · 보고서 카드 · 멘트가
 *    **모두 같은 값**을 본다 — 숙제일에 7을 더하는 계산을 새로 쓰지 말고 `homeworkDue`로만 읽는다.
 * 따로 낸 숙제(영상 제출 현황의 '숙제 출제')는 7일 그대로다(원장 2026-10-13 *"기한은 7일"*) — 마감 저장값이 없다.
 */
import { addDays, formatShortKoreanDate } from "@/lib/date-kst";
import { SITE_HOMEWORK_DAYS } from "@/features/video-submit/site";
import { isVideoHomeworkDate } from "./types";

/** 마감의 최대 거리(숙제일 + 이 날수) — rounds.ts `VIDEO_MATCH_WINDOW_DAYS`와 같은 값(due.test.ts가 잠근다). */
export const VIDEO_HOMEWORK_MAX_DUE_DAYS = 14;

/** 원스크린 토글 값 — 7일(기본) 또는 다음 수업. */
export type VideoHomeworkDueMode = "week" | "next";
/**
 * 보고서 저장이 적은(또는 둔) 마감 — `date` = '다음 수업' 날짜(7일이면 null). 고른 것과 다르게 됐으면 까닭을 싣는다(due-write.ts):
 * `fellBack` = 7일로 됐다(none = 14일 안에 다음 수업 없음 · past = 다음 수업(`missed`)이 이미 지남 · error = 시간표를 못 읽음) ·
 * `kept` = 다른 선생님이 처음 쓴 줄이라 그 선생님의 마감을 그대로 뒀다.
 */
export type SavedVideoHomeworkDue = {
  mode: VideoHomeworkDueMode; date: string | null;
  fellBack?: "none" | "past" | "error"; missed?: string; kept?: true;
};

/** 저장된 마감이 쓸 수 있는 값인가 — 숙제일 다음 날부터 `VIDEO_HOMEWORK_MAX_DUE_DAYS` 안. 그 밖(옛 값·지어낸 값)은 7일로 읽는다. */
export function isCustomDue(homeworkDate: string, due: unknown): due is string {
  return typeof due === "string" && isVideoHomeworkDate(due) && due > homeworkDate && due <= addDays(homeworkDate, VIDEO_HOMEWORK_MAX_DUE_DAYS);
}

/** 그 숙제의 마지막 제출일(KST, 그날 포함) — 저장된 마감이 있으면 그 날, 없으면 숙제일 + 7일. */
export function homeworkDue(homeworkDate: string, due?: string | null): string {
  return isCustomDue(homeworkDate, due) ? due : addDays(homeworkDate, SITE_HOMEWORK_DAYS);
}

/** 아직 낼 수 있나 — 오늘이 마감일 이하. */
export const homeworkOpen = (homeworkDate: string, today: string, due?: string | null): boolean => today <= homeworkDue(homeworkDate, due);

/**
 * 사람이 읽는 마감 — "10/22 (목)까지"(7일) · "다음 수업 10/15 (목)까지". 다음 수업인데 아직 날짜를 모르면(저장 전) "다음 수업 전까지".
 * `next`를 안 주면 저장된 마감이 있는지로 가른다 · false면 저장된 마감을 보지 않고 7일이다(토글을 7일로 돌린 미리보기).
 * 학생·학부모 화면과 멘트가 같은 말을 하게 여기 한 곳에서 만든다.
 */
export function homeworkDueText(homeworkDate: string, due: string | null | undefined, next = isCustomDue(homeworkDate, due)): string {
  if (!next) return `${formatShortKoreanDate(addDays(homeworkDate, SITE_HOMEWORK_DAYS))}까지`;
  return isCustomDue(homeworkDate, due) ? `다음 수업 ${formatShortKoreanDate(due)}까지` : "다음 수업 전까지";
}

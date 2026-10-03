/**
 * 수업보고서에 **영상 제출 링크를 넣을지** — 화면(원스크린 토글·일괄 입력)과 서버(발송 직전 판정)가 같이 쓰는 순수 규칙.
 * 클라가 import하므로 `server-only` 금지([[#61]]).
 *
 * 원장 2026-10-02 *"체크하면 '영상 첨부 링크 넣기' 토글이 하나 더 생기는걸로"* — '영상 과제 있음'만으로 자동으로 붙던 것을
 * 강사가 행마다 고르게 바꿨다(0328a `lesson_reports.video_submit_link`). 고르지 않은 보고서엔 붙지 않는다.
 */
import { isVideoHomeworkEnabled, type VideoHomeworkPolicy } from "@/features/video-homework/policy";

/**
 * 보고서 글에 줄을 붙이는 단계 — Vercel env `VIDEO_SUBMIT_REPORT_LINE`.
 *  · `on`   = 조건을 통과한 모든 보고서.
 *  · `test` = 테스트 학생 '학원이'의 보고서만(실 학부모 글은 그대로 — 학원이 보드에서 끝-끝 확인용).
 *  · 그 밖(없음) = 붙이지 않는다. 🔴 학부모에게 나가는 글이 바뀌는 일이라 기본은 꺼짐이다.
 */
export type SubmitLinkMode = "off" | "test" | "on";

/**
 * 🔴 원장 2026-10-03 *"기존 클래스노트에 영상숙제 링크 올라가는건 이제 필요없을듯. 그냥 영상 숙제 유무만 이전처럼"* —
 *    보고서 글에 영상 제출 링크를 **더는 붙이지 않는다**. 학생은 올리기 사이트(`/v`)에서 선생님이 낸 숙제를 골라 올린다.
 *    env가 무엇이든 꺼짐이다: 이 값 하나로 원스크린의 '영상 첨부 링크 넣기' 토글·일괄 입력 칸·발송 직전 링크 만들기가 함께 사라진다
 *    (`submitLinkChoosable`). '영상 과제 있음/없음'은 그대로다. 다시 켜려면 원장 결정.
 *    → 같은 날 원장 *"영상숙제 체크하더라도 /v 링크를 안내"*: 영상 과제 있음인 보고서 글에는 학생마다의 링크 대신 **올리기 사이트 주소 한 줄**이
 *      붙는다(`reportSiteLine` — 토글 없이, 이 단계 값과 무관하다).
 */
export const REPORT_VIDEO_LINK_RETIRED = true;

export function reportLineMode(env: Record<string, string | undefined> = process.env): SubmitLinkMode {
  if (REPORT_VIDEO_LINK_RETIRED) return "off";
  const raw = env.VIDEO_SUBMIT_REPORT_LINE?.trim().toLowerCase();
  return raw === "on" || raw === "test" ? raw : "off";
}

export const TEST_STUDENT_NAME = "학원이";

/** 그 단계에서 이 학생의 보고서에 줄이 붙을 수 있나 — `test`는 학원이만. */
export const submitLinkModeAllows = (mode: SubmitLinkMode, studentName: string | null | undefined): boolean =>
  mode === "on" || (mode === "test" && String(studentName ?? "").trim() === TEST_STUDENT_NAME);

/**
 * 이 행에서 '영상 첨부 링크 넣기'를 고를 수 있나 — **토글을 그리는 조건 = 일괄 입력이 값을 넣는 조건 = 저장에 싣는 조건**.
 * 서버 `reportGetsVideoLink`가 붙이지 않을 행(영어·반 없음·정책이 끈 반·줄이 꺼진 단계)엔 토글도 없다(눌러도 안 붙는 거짓 약속 금지).
 */
export function submitLinkChoosable(
  mode: SubmitLinkMode,
  policy: VideoHomeworkPolicy | null | undefined,
  row: { classId: string | null | undefined; subjectKey: string | null | undefined; grade: string | null | undefined; studentName: string | null | undefined },
): boolean {
  if (!policy || !row.classId || !submitLinkModeAllows(mode, row.studentName)) return false;
  const subjectKey = row.subjectKey ?? "math";
  if (subjectKey === "english") return false;
  return isVideoHomeworkEnabled(policy, { classId: row.classId, subjectKey, grade: row.grade ?? null });
}

/** 학생 × 날짜 × 반 → 저장된 고르기(true/false). 키는 영상 과제 값(`assignmentKey`)과 같은 모양. */
export type SubmitLinkChoices = Readonly<Record<string, boolean>>;

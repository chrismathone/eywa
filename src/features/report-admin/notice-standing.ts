/**
 * 원생 개별 공지·교재요청서의 **수업 시작 전·휴원 제외** — 순수 판정(서버·테스트 공용, `server-only`/`use client` 금지).
 *
 * 원장 2026-11-05 *"수업 시작전이거나 휴원 중인 학생은 클래스노트 배정을 하지말것. 수업배정이 되는 순간 동기화 작동하게"*:
 * 그 과목에 **오늘 다니는 반이 없고**, 끝나지 않은 수강이 아직 시작 전이거나 휴원(그 수강 휴원·대기 또는 학생 휴원)이면 그 과목 알림장으로
 * 보내지 않는다 — 반 보드·반 방으로도, 1인 보드로도(전에는 영어가 1인 보드로 갔다). 수업 시작일이 되거나 휴원이 풀리면 다시 보낼 수 있다
 * (수학 반 보드는 그때 자동 동기화가 배정한다 · 영어 반 방 배정은 ClassNote에서 선생님이 한다).
 * 그 과목 수강이 아예 없는 학생은 여기서 판정하지 않는다(종전대로 — 수학 '반 보드 없음' · 영어 1인 보드).
 * 워커도 게시 직전에 같은 뜻으로 다시 막는다(scripts/_classnote/notice-class-route.mjs `attendanceNote`).
 */
import { isEnrollmentEndedOn } from "@/features/enrollments/eligibility";
import { SEND_CLASS_SUBJECTS } from "@/features/onescreen/send-class";

/** 제외 사유 — 화면 문구는 NOTICE_SKIP_LABEL(notice-targets.ts)·원스크린 사전. */
export type NoticeStanding = "not_started" | "on_hold";

export type StandingEnrollment = {
  class_id: string;
  start_date: string | null;
  end_date: string | null;
  is_transferred: boolean | null;
  on_hold: boolean | null;
};
export type StandingClass = { subject: string | null; is_active: boolean | null; closed_at: string | null };

/** 알림장 과목 → 같은 알림장으로 보는 반 과목(수학 = 수학·수학(심화) — 반 보드 경로와 같은 묶음). */
export function standingSubjectsOf(subject: string): ReadonlySet<string> {
  return SEND_CLASS_SUBJECTS.has(subject) ? SEND_CLASS_SUBJECTS : new Set([subject]);
}

/**
 * 한 학생 · 한 알림장 과목의 판정. 제외면 사유, 아니면 null.
 * @param rows 이 학생의 수강 전부 · @param classOf 반 id → 반(과목·활성·종강일) · @param studentOnHold 학생 상태가 휴원인가
 */
export function noticeStandingOf(args: {
  subject: string;
  rows: readonly StandingEnrollment[];
  classOf: (classId: string) => StandingClass | undefined;
  studentOnHold: boolean;
  date: string;
}): NoticeStanding | null {
  const group = standingSubjectsOf(args.subject);
  // 그 과목의 살아 있는 반(활성 · 종강 전)에 걸린, 아직 끝나지 않은 수강(종료 규약 단일 소스 — 반이동 당일 옛 반은 끝났다).
  const open = args.rows.filter((e) => {
    const c = args.classOf(e.class_id);
    if (!c?.subject || !group.has(c.subject) || c.is_active === false) return false;
    if (c.closed_at && c.closed_at.slice(0, 10) < args.date) return false;
    return !isEnrollmentEndedOn(e.end_date, args.date, !!e.is_transferred);
  });
  if (!open.length) return null;
  if (args.studentOnHold) return "on_hold";
  const attending = open.some((e) => !e.on_hold && (!e.start_date || e.start_date <= args.date));
  if (attending) return null;
  return open.some((e) => e.on_hold) ? "on_hold" : "not_started";
}

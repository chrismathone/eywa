import { axisSlotFromRow, resolveTaughtBy, type AxisSlotRow, type TeacherAxisSource } from "@/features/attendance/teacher-axis";
import { enrollmentAttendsOnDay, isEnrollmentActiveOn } from "@/features/enrollments/eligibility";
import { dowOf, type ClassPostDay } from "@/features/report-admin/english-writing";
import { isTestClass, reportWorkObligations, type WorkAttendance, type WorkEnrollment, type WorkSchedule } from "@/features/dashboard/overview/work-targets";
import type { WorkClass, WorkReport } from "@/features/dashboard/overview/teacher-work";
import type { DutyKind, DutyPeriod, DutyStatus } from "../kinds";

/**
 * 일간 의무 생성기(순수) — 하루(`date`)의 출결 입력 · 수업보고서 작성 · 보고서 발송 의무를 **학생 × 반** 단위로 만든다.
 *
 * 분모·완료 판정은 운영실·포트폴리오가 이미 쓰는 함수 그대로다:
 *   · 보고서 작성 = `reportWorkObligations`(결석 전원 제외 · 미발송 반 · 작성 면제 · `covers_date` · 영어 반 알림장은 반 단위 `class:<id>`).
 *     그날 수업이 아직 시작 안 했어도 의무로 센다(`nowMinutes` 하루 끝) — 아침에 하루치가 다 보여야 한다.
 *   · 출결 입력 = `judgeClassAttendanceDay`와 같은 명단 규칙(시작일 있는 유효 수강 · 등원 요일)을 **학생 단위로 펼친 것**.
 * 열쇠(subjectKey) — 출결 = `<학생>|<반>`(같은 날 두 반을 듣는 학생은 반마다 한 건) · 보고서 작성·발송 = `<학생>|<담당>:<과목>`(`reportWorkObligations`의 묶음과 같다 —
 * 같은 담당·과목의 두 반 중 어느 반으로 보고서를 썼든 열쇠가 안 흔들리고 실제 반은 classId로만 바뀐다 · 재리뷰 2026-11-09) · 반 알림장 = `class:<반>`.
 * 한 열쇠가 둘이면 DB upsert가 21000으로 깨진다 — 끝에서 한 번 더 거른다.
 * 담당(owner) = 그 교시를 실제로 가르친 사람(`resolveTaughtBy`, 원장 2026-11-09 '일간 = 실제 수업자'). 교시 담당이 갈리거나 자리(JJ·LAB)면 반 담임으로.
 * 퇴사한 담당(담임·교시 담당 모두)은 비운다 — 원장 폴백은 늦음 사다리가 한다.
 * `doneAt` = 원 표의 사실 시각(출결 recorded_at · 보고서 created_at · 발송 classnote_sent_at) — 기한 안 완료(on_time)를 맞춤 시각이 아니라 사실 시각으로 센다.
 */
export type DutySchedule = WorkSchedule & Pick<AxisSlotRow, "teacher_id" | "slot_teacher_label">;
export type DutyClass = WorkClass & { closedAt?: string | null };
export type DutyReport = WorkReport & { recalled?: boolean; createdAt?: string | null; sentAt?: string | null };
export type DutyAttendance = WorkAttendance & { recorded_at?: string | null };

export type DutyDraft = {
  kind: DutyKind; period: DutyPeriod; cycle: string; subjectKey: string;
  studentId: string | null; classId: string | null; subject: string | null;
  ownerId: string | null; ownerSource: TeacherAxisSource | "retired" | null;
  dueAt: string; status: DutyStatus; source: string | null; doneAt: string | null;
};

export type DailyInput = {
  date: string; holidays: ReadonlySet<string>;
  classes: readonly DutyClass[]; schedules: readonly DutySchedule[]; enrollments: readonly WorkEnrollment[];
  attendance: readonly DutyAttendance[]; reports: readonly DutyReport[]; posts: readonly ClassPostDay[];
  /** ClassNote 발송이 켜진 지점만 '보고서 발송' 의무를 만든다(꺼진 지점엔 흔적 없이). */
  classnoteOn: boolean;
  /** 재직이 아닌 사람(퇴사) — 담당에서 비운다. 담임·교시 담당 모두 포함해 넘길 것. */
  inactiveTeacherIds?: ReadonlySet<string>;
};

/** 기한 — KST 날짜 + n일 뒤 hh시(원장 2026-11-09 제안: 출결·보고서 당일 자정 · 발송 다음 날 정오). */
export function kstDueAt(date: string, plusDays: number, hour: number): string {
  const base = Date.parse(`${date}T00:00:00+09:00`);
  return new Date(base + plusDays * 86_400_000 + hour * 3_600_000).toISOString();
}
export const DAILY_DUE: Record<DutyKind, (date: string) => string> = {
  attendance: (d) => kstDueAt(d, 1, 0),
  report_write: (d) => kstDueAt(d, 1, 0),
  report_send: (d) => kstDueAt(d, 1, 12),
};

export const dutySubjectKey = (studentId: string | null, classId: string): string => (studentId ? `${studentId}|${classId}` : `class:${classId}`);
/** 보고서 의무 열쇠 — 운영실 분모(`reportWorkObligations`)가 묶는 단위(담당 × 과목)와 같다. */
export const reportSubjectKey = (studentId: string, cls: Pick<WorkClass, "teacherId" | "subject">): string => `${studentId}|${cls.teacherId ?? "unassigned"}:${cls.subject}`;

export function buildDailyDuties(input: DailyInput): DutyDraft[] {
  const { date } = input;
  if (input.holidays.has(date)) return [];
  const dow = dowOf(date);
  const classes = input.classes.filter((c) => !isTestClass(c.name ?? "") && (!c.closedAt || c.closedAt >= date));
  const byId = new Map(classes.map((c) => [c.id, c]));
  const slotsOf = new Map<string, DutySchedule[]>();
  for (const s of input.schedules) slotsOf.set(s.class_id, [...(slotsOf.get(s.class_id) ?? []), s]);
  const ownerOf = (classId: string): Pick<DutyDraft, "ownerId" | "ownerSource"> => {
    const cls = byId.get(classId);
    if (!cls) return { ownerId: null, ownerSource: null };
    const axis = resolveTaughtBy({ homeroomTeacherId: cls.teacherId, date, dayOfWeek: dow,
      slots: (slotsOf.get(classId) ?? []).map((s) => axisSlotFromRow({ day_of_week: s.day_of_week, start_time: s.start_time, teacher_id: s.teacher_id,
        slot_teacher_label: s.slot_teacher_label, valid_from: s.valid_from ?? "0000-01-01", valid_to: s.valid_to })) });
    const ownerId = axis.teacherId ?? cls.teacherId;
    if (ownerId && input.inactiveTeacherIds?.has(ownerId)) return { ownerId: null, ownerSource: "retired" };
    return { ownerId, ownerSource: axis.teacherId ? axis.source : cls.teacherId ? "homeroom" : "none" };
  };
  const out: DutyDraft[] = [];

  // ── 출결 입력(학생 × 반 × 날) — 그날 시간표가 유효한 반(시작일 있는 배치만 · 운영실 신호와 같게)의 그날 명단.
  const recordedAt = new Map<string, string | null>();
  for (const a of input.attendance) if (a.session_date === date) {
    const key = `${a.class_id}|${a.student_id}`;
    const prev = recordedAt.get(key);
    const at = a.recorded_at ?? null;
    if (!recordedAt.has(key) || (at && (!prev || at < prev))) recordedAt.set(key, at);
  }
  for (const cls of classes) {
    const meets = (slotsOf.get(cls.id) ?? []).some((s) => s.day_of_week === dow && !!s.valid_from && s.valid_from <= date && (!s.valid_to || s.valid_to >= date));
    if (!meets) continue;
    const owner = ownerOf(cls.id);
    for (const e of input.enrollments) {
      if (e.class_id !== cls.id || !e.start_date) continue;
      if (!isEnrollmentActiveOn({ startDate: e.start_date, endDate: e.end_date, onHold: e.on_hold === true, isTransferred: e.is_transferred === true }, date)) continue;
      if (!enrollmentAttendsOnDay(e.attendance_days, dow)) continue;
      const key = `${cls.id}|${e.student_id}`;
      const done = recordedAt.has(key);
      out.push({ kind: "attendance", period: "daily", cycle: date, subjectKey: dutySubjectKey(e.student_id, cls.id), studentId: e.student_id, classId: cls.id, subject: cls.subject,
        ...owner, dueAt: DAILY_DUE.attendance(date), status: done ? "done" : "open", source: done ? "attendance_record" : null, doneAt: done ? recordedAt.get(key) ?? null : null });
    }
  }

  // ── 수업보고서 작성 · 발송 — 운영실 '강사별 업무 현황'과 같은 분모(`reportWorkObligations`).
  const obligations = reportWorkObligations({ classes, schedules: input.schedules, enrollments: input.enrollments, attendance: input.attendance,
    reports: input.reports, posts: input.posts, from: date, to: date, nowMinutes: 24 * 60, holidays: [...input.holidays] });
  const reportOf = new Map(input.reports.map((r) => [`${r.classId}|${r.studentId}|${r.date}`, r]));
  for (const ob of obligations) {
    const cls = byId.get(ob.classId);
    const classPost = ob.studentId === "class-post";
    const owner = ownerOf(ob.classId);
    const report = classPost ? undefined : reportOf.get(`${ob.classId}|${ob.studentId}|${date}`);
    const key = classPost || !cls ? dutySubjectKey(null, ob.classId) : reportSubjectKey(ob.studentId, cls);
    out.push({ kind: "report_write", period: "daily", cycle: date, subjectKey: key,
      studentId: classPost ? null : ob.studentId, classId: ob.classId, subject: cls?.subject ?? null, ...owner,
      dueAt: DAILY_DUE.report_write(date), status: ob.written ? "done" : "open", source: ob.written ? (classPost ? "class_post" : "lesson_report") : null,
      doneAt: ob.written ? report?.createdAt ?? null : null });
    if (classPost || !ob.written || !input.classnoteOn || cls?.reportSource !== "lesson") continue;
    const recalled = report?.recalled === true;
    const status: DutyStatus = recalled || ob.status === "too_old" ? "void" : ob.status === "success" ? "done" : "open";
    out.push({ kind: "report_send", period: "daily", cycle: date, subjectKey: key, studentId: ob.studentId, classId: ob.classId, subject: cls?.subject ?? null,
      ...owner, dueAt: DAILY_DUE.report_send(date), status, source: status === "void" ? (recalled ? "recalled" : "too_old") : status === "done" ? "classnote_success" : null,
      doneAt: status === "done" ? report?.sentAt ?? null : null });
  }
  // 같은 열쇠가 둘이면 DB upsert가 깨진다(21000) — 먼저 온 것(명단 순)만 남긴다. 정상 입력에선 생기지 않는다.
  const seen = new Set<string>();
  return out.filter((d) => { const k = `${d.kind}|${d.subjectKey}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

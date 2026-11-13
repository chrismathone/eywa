import { isTestClass, type WorkObligation } from "./work-targets";

export type WorkClass = { id: string; name?: string; teacherId: string | null; teacherName: string; subject: string; reportSource?: "lesson" | "classnote" | "none" };
export type WorkReport = { id: string; classId: string; studentId: string; date: string; coversDate?: string | null; status: string | null; videoHomework: boolean };
export type WorkOutcome = { classId: string; studentId: string; date: string; status: string; observedAt: string };
export type TeacherWorkRow = {
  teacherId: string | null; teacherName: string; subject: string; classIds: string[];
  reports: number; reportTarget: number; sent: number; pending: number; failed: number; videoMissing: number;
  videoAssigned: number; videoSubmitted: number; reportSource: "lesson" | "classnote" | "none";
  /** 영상 숙제 출제율(원장 2026-10-19) — '보고서 작성' 줄이 센 쓴 보고서(분자 = `reports`와 같은 수) 중 영상 과제가 나간 것. */
  reportsWritten: number; videoIssuedReports: number;
  /** 오늘 작성할 보고서 중 아직 안 쓴 것(보고서 작성 행의 보조 표기 — 오늘 미작성 판정 `judgeTodayLessonReports`와 같은 의무 목록). */
  todayUnwritten: number;
  /** 보냈다가 회수한 보고서 — '안 나간 것'이 아니라 일부러 거둔 것이라 발송 확인에서 뺀다. */
  recalled: number;
  /** 학부모 미확인 — 판정 가능한 발송(성공 · 매칭 가능 · 유예 지남) 중 읽음 기록 없음(`judgeUnreadReport`). */
  unreadJudged: number; unread: number;
  /** 출결 미입력 — 수업한 반×날 중 출결을 다 못 찍은 날(`judgeClassAttendanceDay`). */
  attendanceDays: number; attendanceUnrecorded: number;
  /** 원생상담 — 그 달(이번 달 · 1일엔 지난달, `counselMonth`) 담임 반 학생 중 상담한 비율(%) · 직원 포트폴리오 저장값. 없으면 null. */
  counselRate: number | null;
};
export type TeacherWork = { reportFrom: string; videoFrom: string; to: string; videoCheckedAt: string | null; rows: TeacherWorkRow[];
  /** 출결 미입력 창(어제까지) · 학부모 미확인 창 시작 · 원생상담 집계 기준일과 그 달(YYYY-MM — 1일엔 지난달, `pickCounselMonth`) — 카드 아래 안내가 적는다. */
  attendanceFrom?: string; attendanceTo?: string; unreadFrom?: string; counselAsOf?: string | null; counselMonth?: string | null;
  /** 줄 표시 여부 — 기능이 꺼진 지점엔 그 줄이 흔적 없이 빠진다(ClassNote 실제 발송 꺼짐 = 발송 확인·학부모 미확인 · 직원 평가 꺼짐·실험실 밖 = 원생상담). */
  deliveryShown?: boolean; counselShown?: boolean;
  /** 열린 할 일(0377a 업무 처리 확인) — 업무 처리 현황 권한이 있는 사람에게만 실린다(없으면 줄째 없음). 사람별 · 전체(함께 맡은 일은 한 번). */
  tasks?: { byUser: Record<string, { open: number; late: number }>; open: number; late: number } };

/** 현재 담당 반 기준. 동명이인은 ID로, 복수 과목 강사는 과목별로 분리한다. */
/**
 * `extraVideoAssignments` = 보고서 없이 따로 낸 영상 숙제(video-homework `extra-issues.ts`) — 영상 제출 현황과 같은 숙제 축이라 낸 숙제 수에 더한다
 * (같은 날 보고서에도 켜져 있으면 한 번만 · 보고서 수·발송 집계에는 들어가지 않는다).
 */
export function teacherWork(classes: readonly WorkClass[], reports: readonly WorkReport[], outcomes: readonly WorkOutcome[], range: Pick<TeacherWork, "reportFrom" | "videoFrom" | "to">, obligations?: readonly WorkObligation[],
  extraVideoAssignments: readonly Pick<WorkReport, "classId" | "studentId" | "date">[] = []): TeacherWork {
  const rows = new Map<string, TeacherWorkRow>();
  const byClass = new Map<string, TeacherWorkRow>();
  for (const cls of classes) {
    if (isTestClass(cls.name ?? "")) continue;
    const key = `${cls.teacherId ?? "unassigned"}:${cls.subject}`;
    let row = rows.get(key);
    if (!row) {
      row = { teacherId: cls.teacherId, teacherName: cls.teacherName, subject: cls.subject, classIds: [], reports: 0, reportTarget: 0, sent: 0, pending: 0, failed: 0,
        videoMissing: 0, videoAssigned: 0, videoSubmitted: 0, reportSource: cls.reportSource ?? "lesson", reportsWritten: 0, videoIssuedReports: 0,
        todayUnwritten: 0, recalled: 0, unreadJudged: 0, unread: 0, attendanceDays: 0, attendanceUnrecorded: 0, counselRate: null };
      rows.set(key, row);
    }
    if (!row.classIds.includes(cls.id)) row.classIds.push(cls.id);
    byClass.set(cls.id, row);
  }
  const assignments = new Set<string>();
  const seen = new Set<string>();
  const keyOf = (r: { classId: string; studentId: string; date: string }) => `${r.classId}:${r.studentId}:${r.date}`;
  for (const rep of reports) {
    const row = byClass.get(rep.classId);
    if (!row || rep.date > range.to) continue;
    const key = keyOf(rep);
    if (seen.has(key)) continue;
    seen.add(key);
    if (rep.videoHomework && rep.date >= range.videoFrom) { assignments.add(key); row.videoAssigned++; }
    if (obligations) continue;
    if (rep.date < range.reportFrom) continue;
    row.reports++;
    row.reportsWritten++;
    if (rep.videoHomework) row.videoIssuedReports++;
    row.reportTarget++;
    if (rep.status === "success") row.sent++;
    else if (["failed", "too_old", "name_conflict", "blocked_shared", "recall_failed"].includes(rep.status ?? "")) row.failed++;
    else if (rep.status === "recalled") row.recalled++;
    else row.pending++;
  }
  for (const extra of extraVideoAssignments) {
    const row = byClass.get(extra.classId);
    const key = keyOf(extra);
    if (!row || extra.date > range.to || extra.date < range.videoFrom || assignments.has(key)) continue;
    assignments.add(key);
    row.videoAssigned++;
  }
  for (const obligation of obligations ?? []) {
    const row = byClass.get(obligation.classId);
    if (!row || obligation.date < range.reportFrom || obligation.date > range.to) continue;
    row.reportTarget++;
    // 출제율의 분모 = '보고서 작성' 줄의 분자(쓴 보고서)와 같은 목록 — 두 줄 숫자가 서로 맞는다.
    if (obligation.written) { row.reports++; row.reportsWritten++; if (obligation.videoHomework) row.videoIssuedReports++; }
    else if (obligation.date === range.to) row.todayUnwritten++;
    if (obligation.status === "success") row.sent++;
    else if (["failed", "too_old", "name_conflict", "blocked_shared", "recall_failed"].includes(obligation.status ?? "")) row.failed++;
    else if (obligation.status === "recalled") row.recalled++;
    else row.pending++;
  }
  const counted = new Set<string>();
  let videoCheckedAt: string | null = null;
  for (const outcome of outcomes) {
    const row = byClass.get(outcome.classId);
    const key = keyOf(outcome);
    if (!row || !assignments.has(key) || counted.has(key)) continue;
    counted.add(key);
    if (!videoCheckedAt || outcome.observedAt < videoCheckedAt) videoCheckedAt = outcome.observedAt;
    if (outcome.status === "missing") row.videoMissing++;
    if (outcome.status === "submitted") row.videoSubmitted++;
  }
  return { ...range, videoCheckedAt, rows: [...rows.values()].sort((a, b) => a.teacherName.localeCompare(b.teacherName, "ko") || a.subject.localeCompare(b.subject) || (a.teacherId ?? "").localeCompare(b.teacherId ?? "")) };
}

/** 강사별 업무 현황의 덧붙임 행 재료(서버가 이미 받은 데이터에서 판정 — 새 조회 없음 · 원생상담만 저장값 한 번). */
export type TeacherWorkExtras = {
  unread: readonly { classId: string; judgeable: boolean; unread: boolean }[];
  /** 반의 담임·과목도 싣는다 — 보고서 미발송 반(이 표의 열에 없는 반)은 같은 담임·과목 열에 붙인다(운영실 신호와 같은 반 범위). */
  attendance: readonly { classId: string; teacherId: string | null; subject: string; unrecorded: boolean }[];
  /** 강사 id → 그 달(`counselMonth`) 원생상담 비율(%). 과목이 둘인 강사는 두 열에 같은 값(담임 반 전체 기준이라 과목으로 못 가른다). */
  counsel: ReadonlyMap<string, number | null>;
  attendanceFrom: string; attendanceTo: string; unreadFrom: string; counselAsOf: string | null; counselMonth: string | null;
  deliveryShown: boolean; counselShown: boolean;
};

/** 반 → 열(강사 × 과목)로 덧붙임 값을 더한다. 순수 — 같은 입력이면 같은 결과. */
export function withTeacherWorkExtras(work: TeacherWork, extras: TeacherWorkExtras): TeacherWork {
  const rows = work.rows.map((r) => ({ ...r }));
  const byClass = new Map<string, TeacherWorkRow>();
  for (const row of rows) for (const id of row.classIds) byClass.set(id, row);
  const byColumn = new Map(rows.map((r) => [`${r.teacherId ?? "unassigned"}:${r.subject}`, r] as const));
  for (const u of extras.unread) {
    const row = byClass.get(u.classId);
    if (!row || !u.judgeable) continue;
    row.unreadJudged++;
    if (u.unread) row.unread++;
  }
  for (const a of extras.attendance) {
    const row = byClass.get(a.classId) ?? byColumn.get(`${a.teacherId ?? "unassigned"}:${a.subject}`);
    if (!row) continue;
    row.attendanceDays++;
    if (a.unrecorded) row.attendanceUnrecorded++;
  }
  for (const row of rows) row.counselRate = extras.counselShown && row.teacherId ? extras.counsel.get(row.teacherId) ?? null : null;
  return { ...work, rows, attendanceFrom: extras.attendanceFrom, attendanceTo: extras.attendanceTo, unreadFrom: extras.unreadFrom,
    counselAsOf: extras.counselShown ? extras.counselAsOf : null, counselMonth: extras.counselShown ? extras.counselMonth : null,
    deliveryShown: extras.deliveryShown, counselShown: extras.counselShown };
}

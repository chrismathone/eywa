import { pinnedTimeKey, planAttendanceMigration } from '@/features/timetable/import/master/attendance-migration';
import type { AttendanceLink, AttendanceMove, MasterAttendance } from '@/features/timetable/import/master/attendance-types';
import { axisDowOf } from '@/features/attendance/teacher-axis';
import { specialSlotLabel } from '@/features/timetable/lib/teacher-label';
import { timeLabel } from './editor/model';
import { scheduleTeacher, type ApplyPlan } from './apply-plan';
import type { ApplyContext } from './server/apply-context';

export type LabAttendance = { moves: AttendanceMove[]; errors: string[] };
const seatOf = (label: string | null | undefined) => specialSlotLabel(label ?? '');

/** 시각·요일·반·자리 구분이 바뀐 수업만 고른다. 출결은 반·날짜·시작 시각에 묶여 강사·강의실만 바뀐 수업과는 상관없다. */
export function movedSchedules(plan: ApplyPlan) {
  return plan.schedules.flatMap(row => row.before && (row.item.classId !== row.before.classId || row.day !== row.before.day || timeLabel(row.item.start) !== row.before.start || seatOf(row.teacherLabel ?? row.item.teacher) !== seatOf(row.before.teacherLabel)) ? [{ ...row, before: row.before }] : []);
}

/** 교시가 달라지는 반 — 교시를 들고 있는 보강·자리 기록은 이 반에서만 어긋난다. */
export function slotChangedClasses(plan: ApplyPlan) {
  return new Set([...movedSchedules(plan).flatMap(row => [row.item.classId, row.before.classId]), ...plan.removedSchedules.map(row => row.classId), ...plan.closedClasses.map(row => row.id)]);
}

/** 적용 계획을 시트 반영의 출결 이관 규칙에 넘긴다 — 상태·시수·메모·입력자·기록 ID를 그대로 두고 반·교시만 옮긴다. */
export function planLabAttendance(plan: ApplyPlan, context: ApplyContext, date: string, attendance: MasterAttendance[], links: AttendanceLink[]): LabAttendance {
  const moved = movedSchedules(plan);
  const removed = [...plan.removedSchedules, ...moved.map(row => row.before)].map(row => ({ action: 'delete', scheduleId: row.id, classId: row.classId, day: row.day, startTime: row.start, endTime: row.end, teacherNames: [] }));
  const added = [...moved, ...plan.schedules.filter(row => !row.before)].map(row => ({ action: 'create', scheduleId: null, classId: row.item.classId, day: row.day, startTime: timeLabel(row.item.start), endTime: timeLabel(row.item.end), teacherId: row.teacherId, teacherNames: [row.teacherLabel ?? row.item.teacher] }));
  const active = context.schedules.filter(row => row.validFrom <= date && (!row.validTo || row.validTo >= date));
  // 연습본은 어느 수업이 어디로 갔는지 안다 — 한 칸에 수업이 하나일 때만 추정 대신 그 교시로 옮긴다.
  const pinnedTimes = new Map(moved.flatMap(({ before, item, day }) => {
    const sameCell = active.filter(other => other.classId === before.classId && other.day === before.day && other.start === before.start);
    return item.classId === before.classId && day === before.day && sameCell.length === 1 ? [[pinnedTimeKey(before.classId, before.day, before.start), timeLabel(item.start)] as const] : [];
  }));
  const rosterMoves = plan.enrollments.flatMap(row => row.before && row.remove ? plan.enrollments.filter(other => other.studentId === row.studentId && !other.before && !other.remove).map(other => ({ enrollmentId: row.before!.id, toClassId: other.classId })) : []);
  const rosterPairs = new Set(plan.enrollments.filter(row => row.before).map(row => `${row.classId}:${row.studentId}`));
  // 수업보고서에는 교시가 없다 — 같은 반 안에서 시각만 옮기면 그대로 맞고, 학생이 반을 떠날 때만 어긋난다.
  const anchored = links.filter(link => link.kind !== 'report' || rosterPairs.has(`${link.classId}:${link.studentId}`));
  const classes = [...context.classes, ...plan.classes.filter(row => !row.before)];
  const className = (id: string) => classes.find(row => row.id === id)?.name ?? '반';
  const studentName = (id: string) => context.students.find(row => row.id === id)?.name ?? '학생';
  const result = planAttendanceMigration(
    { effectiveDate: date, mappings: [], report: { planItems: [...removed, ...added] }, roster: { moves: rosterMoves }, pinnedTimes } as never,
    {
      attendance, attendanceLinks: anchored,
      classes: classes.map(row => ({ id: row.id, className: row.name })),
      enrollments: context.enrollments,
      students: context.students.map(row => ({ studentId: row.id, name: row.name })),
      schedules: active.map(row => ({ ...row, startTime: row.start, endTime: row.end, slotTeacherLabel: row.teacherLabel, teacherId: scheduleTeacher(row, context).id })),
    } as never,
  );
  const errors = result.issues.filter(issue => issue.severity === 'error').map(issue => `${issue.target}: ${issue.reason}`);
  const leaving = new Set(rosterMoves.map(row => row.enrollmentId)), closed = new Set(plan.closedClasses.map(row => row.id));
  // 옮길 반이 없는 출결은 지우지 않는다. 적용일은 옛 수강의 마지막 날이라 그대로 맞고, 그 뒤 날짜만 막는다.
  for (const row of plan.enrollments) {
    if (!row.before || leaving.has(row.before.id)) continue;
    for (const item of attendance) {
      if (item.classId !== row.classId || item.studentId !== row.studentId || item.date <= date) continue;
      if (row.remove || (row.days.length && !row.days.includes(axisDowOf(item.date) ?? ''))) errors.push(`${studentName(item.studentId)} · ${item.date} ${className(item.classId)}: 수강이 끝나는 날짜에 출결이 있습니다.`);
    }
  }
  const movingOut = (studentId: string, classId: string) => rosterMoves.some(move => context.enrollments.some(row => row.id === move.enrollmentId && row.studentId === studentId && row.classId === classId));
  for (const item of attendance) if (closed.has(item.classId) && !movingOut(item.studentId, item.classId)) errors.push(`${studentName(item.studentId)} · ${item.date} ${className(item.classId)}: 종료할 반에 출결이 있습니다.`);
  return { moves: result.moves, errors: [...new Set(errors)] };
}

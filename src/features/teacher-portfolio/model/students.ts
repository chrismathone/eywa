/**
 * 학생 배정·유지 — 매월 기본 10점에서 새로 시작한다(누적·이월 없음).
 *
 * 기준은 그날 **마감 후** 명단이다: 수강 종료일에 종료로 반영하고 다음 달에 다시 세지 않는다.
 * 담임은 당시 인수인계 이력, 부담임은 유효한 시간표 담당(`class_schedules.teacher_id`)으로 판정한다.
 * 같은 강사가 계속 맡는 반이동·역할 변경은 가감하지 않고, 추가 수강·재등록·담당 변경은
 * 신규·반이동으로 짐작하지 않고 따로 표시만 한다(점수 0).
 */
import { axisSlotFromRow, isSeatSlot } from "@/features/attendance/teacher-axis";
import { enrollmentAttendsOnDay } from "@/features/enrollments/eligibility";
import { addDays } from "./dates";
import type {
  PeriodWindow, SnapshotClass, SnapshotEnrollment, SnapshotSchedule, StudentEvent, StudentEventType, StudentTracking,
} from "./types";

export const STUDENT_BASE_POINTS = 10;
const clampScore = (n: number) => Math.min(20, Math.max(0, n));
type Role = "담임" | "부담임";
/** `homeClasses` = 그중 담임인 반(원생상담이 담임 반 학생·반 이름만 본다). */
type Relation = { classes: Set<string>; homeClasses: Set<string>; roles: Set<Role> };
type TrackedEvent = StudentEvent & { teacherId: string; month: string };
/** 학생이 수강을 끝낸 날 — 그날 끝난 수강 줄 전부(끝 = 종료일과 반이 닫힌 날 중 이른 날 · 보강 반·하루도 안 다닌 줄 제외). */
export type StudentExit = { day: string; ended: readonly SnapshotEnrollment[] };
/**
 * 퇴원율이 쓰는 재료 — 그날 강사별 명단(학생 추적과 같은 명단 한 벌)과 학생별 수강 끝.
 * 🔴 끝은 강사 명단의 차이가 아니라 학생 수강에서 읽는다 — 다른 선생님 반으로 옮긴 뒤 그만둔 학생은 옛 선생님 명단에서
 *    '반이동 유출'로만 빠져 어느 선생님에게도 퇴원으로 안 잡혔다(main 퇴원율과 합칠 때 적대적 리뷰 2026-10-14).
 */
export type ChurnSource = {
  rosterOf: (day: string, teacherId: string) => ReadonlyMap<string, {
    classes: ReadonlySet<string>; homeClasses: ReadonlySet<string>; roles: ReadonlySet<"담임" | "부담임">;
  }>;
  exitsOf: (studentId: string, start: string, end: string) => readonly StudentExit[];
  teachersOn: (day: string) => Iterable<string>;
  enrollmentsOf: (studentId: string) => readonly SnapshotEnrollment[];
};

export function buildStudentTracking(input: {
  from: string; end: string;
  classes: readonly SnapshotClass[];
  schedules: readonly SnapshotSchedule[];
  enrollments: readonly SnapshotEnrollment[];
  owner: (c: SnapshotClass, day: string) => string | null;
}) {
  const { owner } = input;
  const baseline = addDays(input.from, -1);
  const classes = new Map(input.classes.map((c) => [c.id, c]));
  const schedules = new Map(input.classes.map((c) => [
    c.id, input.schedules.filter((s) => s.class_id === c.id && !isSeatSlot(axisSlotFromRow(s))),
  ]));
  const enrollmentByStudent = new Map<string, SnapshotEnrollment[]>();
  for (const e of input.enrollments) {
    const rows = enrollmentByStudent.get(e.student_id);
    if (rows) rows.push(e);
    else enrollmentByStudent.set(e.student_id, [e]);
  }
  const validAtClose = (e: SnapshotEnrollment, day: string) => !e.on_hold && e.start_date <= day && (!e.end_date || e.end_date > day);
  const openClass = (c: SnapshotClass | undefined, day: string) => Boolean(c) && !c!.is_makeup_pool && (!c!.closed_at || c!.closed_at > day);

  function teachersFor(e: SnapshotEnrollment, day: string): Map<string, Role> {
    const c = classes.get(e.class_id);
    const roles = new Map<string, Role>();
    if (!c || c.is_makeup_pool) return roles;
    const home = owner(c, day);
    if (home) roles.set(home, "담임");
    for (const s of schedules.get(c.id) ?? []) {
      if (!s.teacher_id || s.valid_from > day || (s.valid_to && s.valid_to < day)
        || !enrollmentAttendsOnDay(e.attendance_days, s.day_of_week)) continue;
      if (!roles.has(s.teacher_id)) roles.set(s.teacher_id, "부담임");
    }
    return roles;
  }

  const rosterCache = new Map<string, Map<string, Map<string, Relation>>>();
  function roster(day: string): Map<string, Map<string, Relation>> {
    const cached = rosterCache.get(day);
    if (cached) return cached;
    const map = new Map<string, Map<string, Relation>>();
    for (const e of input.enrollments) {
      const c = classes.get(e.class_id);
      if (!c || !openClass(c, day) || !validAtClose(e, day)) continue;
      for (const [teacherId, role] of teachersFor(e, day)) {
        const students = map.get(teacherId) ?? map.set(teacherId, new Map()).get(teacherId)!;
        const relation = students.get(e.student_id) ?? students.set(e.student_id, { classes: new Set(), homeClasses: new Set(), roles: new Set() }).get(e.student_id)!;
        relation.classes.add(c.id);
        if (role === "담임") relation.homeClasses.add(c.id);
        relation.roles.add(role);
      }
    }
    rosterCache.set(day, map);
    return map;
  }

  const sameSubject = (a: SnapshotEnrollment, b: SnapshotEnrollment) => classes.get(a.class_id)?.subject === classes.get(b.class_id)?.subject;
  // 이동일이 하루 어긋난 연결도 같은 이동으로 본다.
  const linked = (a: SnapshotEnrollment, b: SnapshotEnrollment) => a.class_id !== b.class_id && a.is_transferred && b.is_transferred_in
    && Boolean(a.end_date) && [a.end_date, addDays(a.end_date!, 1)].includes(b.start_date) && sameSubject(a, b);

  // 학생 배정·유지의 유입·유출 이벤트 — 처음 쓸 때 한 번 만든다(퇴원율만 쓰는 시간표 X 겹침은 명단·수강 끝만 읽는다).
  let memo: TrackedEvent[] | null = null;
  const allEvents = (): TrackedEvent[] => {
    if (memo) return memo;
    const events: TrackedEvent[] = [];
    for (let day = addDays(baseline, 1); day <= input.end; day = addDays(day, 1)) {
      const before = roster(addDays(day, -1));
      const after = roster(day);
      for (const teacherId of new Set([...before.keys(), ...after.keys()])) {
        const prev = before.get(teacherId) ?? new Map<string, Relation>();
        const next = after.get(teacherId) ?? new Map<string, Relation>();
        for (const incoming of [true, false]) {
          const source = incoming ? next : prev;
          const other = incoming ? prev : next;
          for (const [studentId, relation] of source) {
            if (other.has(studentId)) continue; // 같은 강사가 다른 반·역할로 계속 맡는다.
            const history = enrollmentByStudent.get(studentId) ?? [];
            let type: StudentEventType = "담당 변경";
            let points = 0;
            if (incoming) {
              const starts = history.filter((e) => relation.classes.has(e.class_id) && e.start_date === day);
              const transfers = starts.filter((b) => b.is_transferred_in);
              const sameTeacher = transfers.some((b) => history.some((a) => linked(a, b) && teachersFor(a, addDays(a.end_date!, -1)).has(teacherId)));
              if (sameTeacher) type = "같은 강사 내 반이동";
              else if (transfers.length) { type = "반이동 유입"; points = 0.5; }
              else if (starts.length && !history.some((e) => e.start_date < day)) { type = "신규"; points = 1; }
              else if (starts.length) type = history.some((e) => validAtClose(e, addDays(day, -1))) ? "추가 수강" : "재등록";
            } else {
              const ended = history.filter((e) => relation.classes.has(e.class_id)
                && (e.end_date === day || classes.get(e.class_id)?.closed_at === day));
              const transfers = ended.filter((e) => e.is_transferred && e.end_date === day);
              const sameTeacher = transfers.some((a) => history.some((b) => linked(a, b) && teachersFor(b, b.start_date).has(teacherId)));
              if (sameTeacher) type = "같은 강사 내 반이동";
              else if (transfers.length) { type = "반이동 유출"; points = -0.5; }
              else if (ended.length) {
                // 다른 수업이 남아 있으면 수강종료, 학원 수강이 모두 끝나면 퇴원. 둘 다 −1점이다.
                type = history.some((e) => openClass(classes.get(e.class_id), day) && validAtClose(e, day)) ? "수강종료" : "퇴원";
                points = -1;
              }
            }
            events.push({
              teacherId, month: day.slice(0, 7), studentId, day, type, points, direction: incoming ? "유입" : "유출",
              className: [...relation.classes].map((id) => classes.get(id)?.class_name || "").join(", "),
              role: [...relation.roles].join("·"),
            });
          }
        }
      }
    }
    return (memo = events);
  };

  const exitsByStudent = new Map<string, Map<string, SnapshotEnrollment[]>>();
  for (const e of input.enrollments) {
    const c = classes.get(e.class_id);
    const day = [e.end_date, c?.closed_at].filter((d): d is string => Boolean(d)).sort()[0];
    if (!c || c.is_makeup_pool || !day || day <= e.start_date) continue;
    const days = exitsByStudent.get(e.student_id) ?? exitsByStudent.set(e.student_id, new Map()).get(e.student_id)!;
    days.set(day, [...(days.get(day) ?? []), e]);
  }

  const count = (rows: readonly StudentEvent[], type: StudentEventType) => rows.filter((r) => r.type === type).length;
  const resultCache = new Map<string, StudentTracking>();
  const churnSource: ChurnSource = {
    rosterOf: (day, teacherId) => roster(day).get(teacherId) ?? new Map(),
    teachersOn: (day) => roster(day).keys(),
    exitsOf: (studentId, start, end) => [...(exitsByStudent.get(studentId) ?? [])]
      .filter(([day]) => day >= start && day <= end).sort(([a], [b]) => a.localeCompare(b)).map(([day, ended]) => ({ day, ended })),
    enrollmentsOf: (studentId) => enrollmentByStudent.get(studentId) ?? [],
  };
  return {
    baseline,
    churnSource,
    period(teacherId: string, w: Pick<PeriodWindow, "start" | "end">): StudentTracking {
      const key = `${teacherId}|${w.start}|${w.end}`;
      const cached = resultCache.get(key);
      if (cached) return cached;
      const mine = allEvents().filter((e) => e.teacherId === teacherId);
      const detail: StudentEvent[] = mine.filter((e) => e.day >= w.start && e.day <= w.end).map((e) => ({
        studentId: e.studentId, day: e.day, type: e.type, points: e.points, direction: e.direction, className: e.className, role: e.role,
      }));
      const adjustment = detail.reduce((n, e) => n + e.points, 0);
      const value = clampScore(STUDENT_BASE_POINTS + adjustment);
      // 전월 점수도 그 달의 10점에서 다시 계산한 값이다 — 비교에만 쓴다.
      const previousMonth = addDays(w.start, -1).slice(0, 7);
      const previousPoints = clampScore(STUDENT_BASE_POINTS + mine.filter((e) => e.month === previousMonth).reduce((n, e) => n + e.points, 0));
      const previous = roster(addDays(w.start, -1)).get(teacherId) ?? new Map<string, Relation>();
      const current = roster(w.end).get(teacherId) ?? new Map<string, Relation>();
      const result: StudentTracking = {
        value, basePoints: STUDENT_BASE_POINTS, adjustment, previousPoints, previous: previous.size, current: current.size,
        change: value - previousPoints, newCount: count(detail, "신규"), exitCount: count(detail, "퇴원"),
        endedCount: count(detail, "수강종료"), transferIn: count(detail, "반이동 유입"), transferOut: count(detail, "반이동 유출"),
        unscored: detail.filter((e) => e.points === 0).length,
        homeroom: [...current.values()].filter((r) => r.roles.has("담임")).length,
        assistant: [...current.values()].filter((r) => r.roles.has("부담임")).length,
        detail,
      };
      resultCache.set(key, result);
      return result;
    },
  };
}

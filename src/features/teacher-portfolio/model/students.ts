/**
 * 학생 배정·유지 — 매월 기본 10점에서 새로 시작한다(누적·이월 없음). 기준은 그날 **마감 후** 명단이다(수강 종료일에 종료로 반영).
 * 담임 = 당시 인수인계 이력 · 부담임 = 유효한 시간표 담당. 같은 강사가 계속 맡는 반이동·역할 변경은 가감하지 않고, 추가 수강·재등록·담당 변경은 표시만(0).
 * 🔴 강사 탓이 아닌 사유(원장이 고른 사유 — 이사·졸업 등)로 그만둔 퇴원·수강종료는 감점하지 않는다 — 퇴원율과 같은 판정
 *    (`exit-reason.ts` · 원장 2026-10-14 *"사유 규칙 적용"*). 줄은 남기고 까닭(`note`)을 단다.
 */
import { axisSlotFromRow, isSeatSlot } from "@/features/attendance/teacher-axis";
import { enrollmentAttendsOnDay } from "@/features/enrollments/eligibility";
import { REASON_LABEL } from "@/features/withdrawals/types";
import { addDays } from "./dates";
import { excusedExitOf, reasonsOf, type StudentReason } from "./exit-reason";
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
 * 퇴원율이 쓰는 재료 — 그날 강사별 명단(학생 추적과 같은 명단 한 벌)과 학생별 수강 끝. 🔴 끝은 학생 수강에서 읽는다 — 명단 차이로 읽으면
 * 다른 선생님 반으로 옮긴 뒤 그만둔 학생이 '반이동 유출'로만 빠져 어느 선생님에게도 퇴원으로 안 잡혔다(적대적 리뷰 2026-10-14).
 */
export type ChurnSource = {
  rosterOf: (day: string, teacherId: string) => ReadonlyMap<string, {
    classes: ReadonlySet<string>; homeClasses: ReadonlySet<string>; roles: ReadonlySet<"담임" | "부담임">;
  }>;
  exitsOf: (studentId: string, start: string, end: string) => readonly StudentExit[];
  teachersOn: (day: string) => Iterable<string>;
  enrollmentsOf: (studentId: string) => readonly SnapshotEnrollment[];
  /**
   * 원생상담 의무 학생(원장 2026-10-19) — 그날 그 강사에게 상담 의무가 있는 학생 → 반(이름 표시용).
   * 과목마다: 학생이 그 과목에서 다니는 반들의 **담당**(반에 '담당'으로 세팅된 선생님)별로 요일을 세어 **가장 많은 담당만**(같으면 모두).
   * 교시만 들어가는 부담임은 의무가 없다 · 보고서 미발송 반은 빼되 그런 반만 다니면 그 반 담당 · `allHomerooms(subject)`가 참이면 반 담당 모두.
   */
  counselDutyOf: (day: string, teacherId: string, allHomerooms: (subject: string) => boolean) => ReadonlyMap<string, ReadonlySet<string>>;
};

export function buildStudentTracking(input: {
  from: string; end: string;
  classes: readonly SnapshotClass[]; schedules: readonly SnapshotSchedule[]; enrollments: readonly SnapshotEnrollment[];
  owner: (c: SnapshotClass, day: string) => string | null;
  /** 그날 재직 중인가(입사 전·퇴사 뒤는 교시 담당이 아니다 — 담임은 `owner`가 이미 거른다). 없으면 거르지 않는다. */
  employed?: (teacherId: string, day: string) => boolean;
  /** 강사 탓이 아닌 사유 — 학생 퇴원 사유와 원장이 고른 사유(퇴원율 세는 법). 없으면 사유를 보지 않는다(시간표 X는 명단만 읽는다). */
  reasons?: { studentReasons?: readonly StudentReason[]; excludeReasons: readonly string[]; futureEnrollments?: readonly SnapshotEnrollment[] };
}) {
  const { owner } = input;
  const studentReasons = reasonsOf(input.reasons?.studentReasons);
  const baseline = addDays(input.from, -1);
  const classes = new Map(input.classes.map((c) => [c.id, c]));
  const schedules = new Map(input.classes.map((c) => [
    c.id, input.schedules.filter((s) => s.class_id === c.id && !isSeatSlot(axisSlotFromRow(s))),
  ]));
  const enrollmentByStudent = new Map<string, SnapshotEnrollment[]>();
  for (const e of input.enrollments) (enrollmentByStudent.get(e.student_id) ?? enrollmentByStudent.set(e.student_id, []).get(e.student_id)!).push(e);
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
      if (input.employed && !input.employed(s.teacher_id, day)) continue;
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

  // 학생 × 과목의 반들 — 반마다 담당(그날 담임 이력)·학생이 그 반에 오는 요일·보고서 미발송 반인지.
  type DutyClass = { classId: string; owner: string | null; days: Set<string>; optout: boolean };
  type DutyGroup = { subject: string; rows: DutyClass[] };
  const dutyCache = new Map<string, Map<string, DutyGroup>>();
  function dutyGroups(day: string): Map<string, DutyGroup> {
    const cached = dutyCache.get(day);
    if (cached) return cached;
    const groups = new Map<string, DutyGroup>();
    for (const e of input.enrollments) {
      const c = classes.get(e.class_id);
      if (!c || !openClass(c, day) || !validAtClose(e, day)) continue;
      const key = `${e.student_id}|${c.subject}`;
      const g = groups.get(key) ?? groups.set(key, { subject: c.subject, rows: [] }).get(key)!;
      // 요일은 반의 담당 몫 — 교시만 들어가는 부담임(JJ 등)은 의무를 받지 않는다(원장 2026-10-19 *"JJ같은 부담임은 상담할 필요가 없다"*).
      const days = new Set<string>();
      for (const s of schedules.get(c.id) ?? []) {
        if (s.valid_from > day || (s.valid_to && s.valid_to < day) || !enrollmentAttendsOnDay(e.attendance_days, s.day_of_week)) continue;
        days.add(s.day_of_week);
      }
      g.rows.push({ classId: c.id, owner: owner(c, day), days, optout: c.report_optout === true });
    }
    dutyCache.set(day, groups);
    return groups;
  }
  function counselDutyOf(day: string, teacherId: string, allHomerooms: (subject: string) => boolean): Map<string, Set<string>> {
    const out = new Map<string, Set<string>>();
    for (const [key, g] of dutyGroups(day)) {
      const studentId = key.slice(0, key.indexOf("|"));
      // 보고서 미발송 반은 상담 의무도 없다(원장 2026-10-19) — 그 과목에 그런 반만 다니면 그 반 담당이 맡는다(아무도 안 맡는 학생이 없게).
      const sent = g.rows.filter((r) => !r.optout && r.owner);
      const rows = sent.length ? sent : g.rows.filter((r) => r.owner);
      let picked: DutyClass[];
      if (allHomerooms(g.subject)) picked = rows;
      else {
        const daysOf = new Map<string, Set<string>>();
        for (const r of rows) for (const d of r.days) (daysOf.get(r.owner!) ?? daysOf.set(r.owner!, new Set()).get(r.owner!)!).add(d);
        const most = Math.max(0, ...[...daysOf.values()].map((d) => d.size));
        // 요일을 모르는 반만 있으면(시간표 없음) 담당 모두 — 같으면 모두.
        picked = most === 0 ? rows : rows.filter((r) => (daysOf.get(r.owner!)?.size ?? 0) === most);
      }
      const mine = picked.filter((r) => r.owner === teacherId).map((r) => r.classId);
      if (!mine.length) continue;
      out.set(studentId, new Set([...(out.get(studentId) ?? []), ...mine]));
    }
    return out;
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
      const before = roster(addDays(day, -1)), after = roster(day);
      for (const teacherId of new Set([...before.keys(), ...after.keys()])) {
        const prev = before.get(teacherId) ?? new Map<string, Relation>(), next = after.get(teacherId) ?? new Map<string, Relation>();
        for (const incoming of [true, false]) {
          const source = incoming ? next : prev;
          const other = incoming ? prev : next;
          for (const [studentId, relation] of source) {
            if (other.has(studentId)) continue; // 같은 강사가 다른 반·역할로 계속 맡는다.
            const history = enrollmentByStudent.get(studentId) ?? [];
            let type: StudentEventType = "담당 변경";
            let points = 0;
            let note: string | null = null;
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
                // 다른 수업이 남아 있으면 수강종료, 학원 수강이 모두 끝나면 퇴원. 둘 다 −1점이다(강사 탓이 아닌 사유면 0 · 까닭을 단다).
                type = history.some((e) => openClass(classes.get(e.class_id), day) && validAtClose(e, day)) ? "수강종료" : "퇴원";
                const r = input.reasons, future = r?.futureEnrollments?.filter((e) => e.student_id === studentId) ?? [];
                const off = r ? excusedExitOf({ ended, history: [...history, ...future], classes, student: studentReasons.get(studentId), exitDay: day, excludeReasons: r.excludeReasons }) : null;
                points = off ? 0 : -1;
                if (off) note = `사유 ${REASON_LABEL[off]}`;
              }
            }
            events.push({
              teacherId, month: day.slice(0, 7), studentId, day, type, points, direction: incoming ? "유입" : "유출",
              className: [...relation.classes].map((id) => classes.get(id)?.class_name || "").join(", "),
              role: [...relation.roles].join("·"), ...(note ? { note } : {}),
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

  // 가감한 변동만 센다(사유로 감점하지 않은 퇴원·수강종료는 `excused`) — 나머지 종류는 늘 점수가 붙어 종전과 같다.
  const count = (rows: readonly StudentEvent[], type: StudentEventType) => rows.filter((r) => r.type === type && r.points !== 0).length;
  const resultCache = new Map<string, StudentTracking>();
  const churnSource: ChurnSource = {
    rosterOf: (day, teacherId) => roster(day).get(teacherId) ?? new Map(),
    teachersOn: (day) => roster(day).keys(),
    exitsOf: (studentId, start, end) => [...(exitsByStudent.get(studentId) ?? [])]
      .filter(([day]) => day >= start && day <= end).sort(([a], [b]) => a.localeCompare(b)).map(([day, ended]) => ({ day, ended })),
    enrollmentsOf: (studentId) => enrollmentByStudent.get(studentId) ?? [],
    counselDutyOf,
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
        ...(e.note ? { note: e.note } : {}),
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
        unscored: detail.filter((e) => e.points === 0).length, excused: detail.filter((e) => e.note).length,
        homeroom: [...current.values()].filter((r) => r.roles.has("담임")).length,
        assistant: [...current.values()].filter((r) => r.roles.has("부담임")).length,
        detail,
      };
      resultCache.set(key, result);
      return result;
    },
  };
}

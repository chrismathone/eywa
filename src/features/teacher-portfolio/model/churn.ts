/** Monthly withdrawal rate: unique students per teacher, including every assigned teaching period. */
import { axisSlotFromRow, isSeatSlot } from "@/features/attendance/teacher-axis";
import { enrollmentAttendsOnDay } from "@/features/enrollments/eligibility";
import { isSpecialLecture } from "@/features/classes/special-lecture";
import { normalizeReason } from "@/features/withdrawals/types";
import { monthRange, shiftMonth } from "@/lib/date-kst";
import { daysBetween, addDays, groupBy } from "./dates";
import type { ChurnMetric, SnapshotClass, SnapshotEnrollment, SnapshotSchedule } from "./types";

export function buildChurn(input: { classes: readonly SnapshotClass[]; schedules: readonly SnapshotSchedule[]; enrollments: readonly SnapshotEnrollment[]; owner: (c: SnapshotClass, day: string) => string | null }) {
  const classes = new Map(input.classes.map(c => [c.id, c]));
  const regular = (c: SnapshotClass) => !c.is_makeup_pool && !isSpecialLecture({ isSpecial: c.is_special, className: c.class_name });
  const schedules = groupBy(input.schedules.filter(s => !isSeatSlot(axisSlotFromRow(s))), s => s.class_id);
  const cache = new Map<string, Map<string, ChurnMetric>>();
  const subjectCache = new Map<string, Map<string, ReadonlySet<string>>>();
  const computed = (w: { start: string; end: string }) => {
      const key = `${w.start}|${w.end}`;
      if (!cache.has(key)) {
        const prev = monthRange(shiftMonth(w.start.slice(0, 7), -1));
        const days = daysBetween(prev.from, prev.to);
        const taught = new Map<string, Map<string, { days: Set<string>; subjects: Set<string> }>>();
        for (const day of days) for (const e of input.enrollments) {
          const c = classes.get(e.class_id);
          if (!c || !regular(c) || e.on_hold || e.start_date > day || e.end_date && (e.is_transferred ? e.end_date <= day : e.end_date < day) || c.closed_at && c.closed_at < day) continue;
          const ids = new Set<string>();
          const home = input.owner(c, day); if (home) ids.add(home);
          for (const s of schedules.get(c.id) ?? []) if (s.teacher_id && s.valid_from <= day && (!s.valid_to || s.valid_to >= day) && enrollmentAttendsOnDay(e.attendance_days, s.day_of_week)) ids.add(s.teacher_id);
          for (const id of ids) {
            const students = taught.get(id) ?? new Map(); taught.set(id, students);
            const relation = students.get(e.student_id) ?? { days: new Set<string>(), subjects: new Set<string>() }; students.set(e.student_id, relation);
            relation.days.add(day); relation.subjects.add(c.subject);
          }
        }
        const exits = new Map<string, { subject: string; date: string; className: string }[]>();
        const byStudent = groupBy(input.enrollments, e => e.student_id);
        for (const e of input.enrollments) {
          const c = classes.get(e.class_id);
          if (!c || !regular(c) || e.is_transferred || !e.end_date || e.end_date < w.start || e.end_date > w.end) continue;
          if (["graduated", "relocation", "illness", "advised"].includes(normalizeReason(e.withdrawal_reason) ?? "")) continue;
          // Ending a single class while another regular/special course in that subject remains is not subject withdrawal.
          if ((byStudent.get(e.student_id) ?? []).some(other => { const oc = classes.get(other.class_id); return other.id !== e.id && oc && !oc.is_makeup_pool && oc.subject === c.subject && (!other.end_date || other.end_date > e.end_date!) && (!oc.closed_at || oc.closed_at >= addDays(e.end_date!, 1)); })) continue;
          const rows = exits.get(e.student_id) ?? []; exits.set(e.student_id, rows);
          if (!rows.some(row => row.subject === c.subject && row.date === e.end_date)) rows.push({ subject: c.subject, date: e.end_date, className: c.class_name });
        }
        const result = new Map<string, ChurnMetric>();
        const subjectsOf = new Map<string, ReadonlySet<string>>();
        for (const [id, students] of taught) {
          const eligible = [...students].filter(([, relation]) => relation.days.size >= Math.ceil(days.length / 2));
          if (eligible.length) subjectsOf.set(id, new Set(eligible.flatMap(([, relation]) => [...relation.subjects])));
          const detail = eligible.flatMap(([studentId, relation]) => { const ended = (exits.get(studentId) ?? []).filter(e => relation.subjects.has(e.subject)); return ended.length ? [{ studentId, day: ended.map(e => e.date).sort().at(-1)!, subjects: [...new Set(ended.map(e => e.subject))], className: [...new Set(ended.map(e => e.className))].join(" · ") }] : []; });
          result.set(id, { id: "churn", max: 20, value: null, raw: eligible.length ? 100 * detail.length / eligible.length : null,
            basis: `퇴원·수강종료 ${detail.length} / 전월 담당 ${eligible.length}명`,
            reason: "담임과 교시 담당 모두에게 반영하며 같은 학생은 강사별 한 번만 셉니다. 분모는 전월 절반 이상 담당한 학생입니다. 졸업·이사·질병·권고퇴원·끝난 특강·같은 과목 반이동은 제외합니다. 보고서 작성 여부로 담당을 정하지 않습니다.", detail });
        }
        cache.set(key, result);
        subjectCache.set(key, subjectsOf);
      }
      return { result: cache.get(key)!, subjects: subjectCache.get(key)! };
  };
  return {
    period(teacherId: string, w: { start: string; end: string }): ChurnMetric {
      return computed(w).result.get(teacherId) ?? { id: "churn", max: 20, value: null, raw: null, basis: "전월 담당 학생 없음", reason: "전월 담당 학생이 없어 퇴원율을 계산할 수 없습니다.", detail: [] };
    },
    /** 그 기간 퇴원율이 계산되는 선생님(분모가 있는 사람) → 그 분모 학생을 가르친 과목. 시간표 X 겹침의 '퇴원 0'이 같은 계산을 읽는다. */
    eligibleSubjects(w: { start: string; end: string }): ReadonlyMap<string, ReadonlySet<string>> {
      return computed(w).subjects;
    },
  };
}

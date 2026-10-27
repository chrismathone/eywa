import { buildContext } from "@/features/teacher-portfolio/model/context";
import type { PortfolioSnapshot, SnapshotAttendance } from "@/features/teacher-portfolio/model/types";
import { addDays } from "@/lib/date-kst";
import type { CoreSources } from "../server/source-types";
import type { AttendanceTarget } from "./participation";

export function contributionCalendar(core: CoreSources, input: { tenant: string; today: string; capturedAt: string;
  holidays: { date: string }[]; attendance: SnapshotAttendance[] }) {
  const snapshot: PortfolioSnapshot = { tenant: { id: input.tenant, name: "" }, capturedAt: input.capturedAt, from: "2026-01-01", end: input.today,
    settings: { holidays: input.holidays, subjects: [], report_subjects: [], report_exempt: [] }, preRecord: null,
    // 현재 휴원 표식을 과거 전체에 소급하면 이미 달성한 개근까지 사라진다. 기간 이력이 없으므로
    // 정규 일정과 실제 입력이 모두 맞는 주만 인정한다. 미입력 구간을 출석으로 추정하지 않는다.
    users: core.users, classes: core.classes, enrollments: core.enrollments.map((e) => ({ ...e, on_hold: false })), schedules: core.schedules, transitions: core.transitions,
    attendance: input.attendance, reports: [], consultations: [], reviews: [], delegations: [], invoices: [], terms: [], makeupLegacy: [] };
  const context = buildContext(snapshot);
  const targets: AttendanceTarget[] = [];
  for (let day = snapshot.from; day <= input.today; day = addDays(day, 1)) {
    if (context.holidays.has(day)) continue;
    for (const cd of context.classDays(day)) for (const studentId of cd.students) for (const slot of cd.slotTimes)
      targets.push({ student_id: studentId, class_id: cd.c.id, session_date: day, slot_start: slot.start });
  }
  return { context, targets };
}

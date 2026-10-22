import { expect, it } from "vitest";
import { contributionCalendar } from "./calendar";
import type { CoreSources } from "../server/source-types";
it("현재 휴원 여부로 지난 정규 출결 대상이 바뀌지 않는다", () => {
  const core: CoreSources = { students: [], users: [], invoices: [], consultations: [], historyLinks: [], transitions: [],
    classes: [{ id: "c", class_name: "반", subject: "math", english_track: null, teacher_id: "t", is_active: true, closed_at: null, report_optout: false, is_makeup_pool: false }],
    enrollments: [{ id: "e", student_id: "s", class_id: "c", start_date: "2026-01-01", end_date: null, on_hold: false, attendance_days: null, is_transferred: false, is_transferred_in: false }],
    schedules: [{ id: "slot", class_id: "c", day_of_week: "thu", start_time: "16:00", end_time: "17:00", teacher_id: "t", slot_teacher_label: null, lab_separate: false, valid_from: "2026-01-01", valid_to: null }] };
  const input = { tenant: "t", today: "2026-01-08", capturedAt: "2026-01-08T00:00:00Z", holidays: [], attendance: [] };
  const before = contributionCalendar(core, input).targets;
  core.enrollments[0]!.on_hold = true;
  expect(before.length).toBeGreaterThan(0); expect(contributionCalendar(core, input).targets).toEqual(before);
});

import { describe, expect, it } from "vitest";
import { isTestClass, reportWorkObligations, resolveUnclassifiedReports, type WorkEnrollment, type WorkSchedule } from "./work-targets";
import { teacherWork, type WorkClass, type WorkReport } from "./teacher-work";

const cls: WorkClass = { id: "m", name: "정규반", teacherId: "t", teacherName: "강사", subject: "math", reportSource: "lesson" };
const schedule: WorkSchedule = { class_id: "m", day_of_week: "mon", start_time: "16:00:00", valid_from: "2026-01-01", valid_to: null };
const enrollment: WorkEnrollment = { class_id: "m", student_id: "s", start_date: "2026-01-01", end_date: null, on_hold: false, is_transferred: false, attendance_days: [] };
const report: WorkReport = { id: "r", classId: "m", studentId: "s", date: "2026-10-12", status: "success", videoHomework: true };
const input = { classes: [cls], schedules: [schedule], enrollments: [enrollment], attendance: [], reports: [], posts: [], from: "2026-10-12", to: "2026-10-12", nowMinutes: 17 * 60, holidays: [] };
const range = { reportFrom: input.from, videoFrom: "2026-09-13", to: input.to };
describe("강사별 작성 의무와 비율 분모", () => {
  it("반 정보가 없는 예전 보고서는 당시 수강으로 귀속하고 모호한 다른 강사에게 중복 인정하지 않는다", () => {
    const legacy = { ...report, subject: "math", teacherName: null };
    const restored = resolveUnclassifiedReports([legacy], [cls], [enrollment], [schedule]);
    expect(restored[0]).toMatchObject({ classId: "m", videoHomework: false });
    expect(reportWorkObligations({ ...input, reports: restored })[0].written).toBe(true);
    const classes = [cls, { ...cls, id: "m2", teacherId: "t2", teacherName: "다른 강사" }];
    const enr = [enrollment, { ...enrollment, class_id: "m2" }];
    expect(resolveUnclassifiedReports([legacy], classes, enr, [])).toEqual([]);
    expect(resolveUnclassifiedReports([{ ...legacy, teacherName: "다른 강사" }], classes, enr, [])[0].classId).toBe("m2");
    expect(resolveUnclassifiedReports([legacy], [], enr, [])).toEqual([]);
    expect(resolveUnclassifiedReports([{ ...legacy, subject: "english" }], [cls], [enrollment], [])).toEqual([]);
  });
  it("미작성 학생을 분모에 포함하며, 업로드와 보고서 작성·발송을 따로 센다", () => {
    const source = { ...input, enrollments: [enrollment, { ...enrollment, student_id: "s2" }], reports: [report] };
    const obligations = reportWorkObligations(source);
    expect(obligations).toHaveLength(2);
    const row = teacherWork([cls], [report], [{ classId: "m", studentId: "s", date: input.to, status: "submitted", observedAt: "2026-10-12T08:00:00Z" }], range, obligations).rows[0];
    expect(row).toMatchObject({ reportTarget: 2, reports: 1, sent: 1, pending: 1, videoAssigned: 1, videoSubmitted: 1, videoMissing: 0 });
  });
  it.each([
    { ...enrollment, on_hold: true }, { ...enrollment, start_date: "2026-10-13" },
    { ...enrollment, end_date: "2026-10-11" }, { ...enrollment, end_date: "2026-10-12", is_transferred: true },
    { ...enrollment, attendance_days: ["tue"] },
  ])("휴원·시작 전·종료·반이동 경계·분리등원을 제외한다: %j", (e) => {
    expect(reportWorkObligations({ ...input, enrollments: [e] })).toHaveLength(0);
  });
  it("일반 종료 당일은 포함하며 공휴일과 아직 시작하지 않은 수업은 제외한다", () => {
    expect(reportWorkObligations({ ...input, enrollments: [{ ...enrollment, end_date: input.to }] })).toHaveLength(1);
    expect(reportWorkObligations({ ...input, holidays: [input.to] })).toHaveLength(0);
    expect(reportWorkObligations({ ...input, nowMinutes: 15 * 60 })).toHaveLength(0);
    expect(reportWorkObligations({ ...input, schedules: [{ ...schedule, valid_to: "2026-10-11" }] })).toHaveLength(0);
  });
  it("출결 정정은 최신 상태를 쓰고 다른 날 작성해 해당 수업을 덮은 보고서는 면제한다", () => {
    const att = { id: "1", student_id: "s", class_id: "m", session_date: input.to, slot_start: null, status: "absent", recorded_at: "2026-10-12T07:00:00Z" };
    expect(reportWorkObligations({ ...input, attendance: [att] })).toHaveLength(0);
    expect(reportWorkObligations({ ...input, attendance: [att, { ...att, id: "2", status: "present", recorded_at: "2026-10-12T08:00:00Z" }] })).toHaveLength(1);
    expect(reportWorkObligations({ ...input, reports: [{ ...report, date: "2026-10-11", coversDate: input.to }] })).toHaveLength(0);
  });
  it("동일 강사의 같은 학생·과목·날짜는 한 건, 다른 강사는 별도 건이다", () => {
    const source = { ...input, classes: [cls, { ...cls, id: "m2" }], schedules: [schedule, { ...schedule, class_id: "m2" }], enrollments: [enrollment, { ...enrollment, class_id: "m2" }] };
    expect(reportWorkObligations(source)).toHaveLength(1);
    expect(reportWorkObligations({ ...source, classes: [cls, { ...cls, id: "m2", teacherId: "t2" }] })).toHaveLength(2);
  });
  it("영어는 학생 수가 아닌 반 알림장 수업일 기준이며 중복 글을 한 번만 센다", () => {
    const external = { ...cls, name: "초등E_LS2a", reportSource: "classnote" as const };
    const post = { boardName: "[EIE] Let's Speak 2a (월수금)", postedOn: input.to };
    expect(reportWorkObligations({ ...input, classes: [external], posts: [post, post] })).toEqual([{ classId: "m", studentId: "class-post", date: input.to, written: true, status: "success" }]);
  });
  it("영어 반도 그날 받을 학생이 없으면 할 일이 아니다(재원 0명·휴원뿐인 반)", () => {
    const external = { ...cls, name: "초등E_LS2a", reportSource: "classnote" as const };
    expect(reportWorkObligations({ ...input, classes: [external], enrollments: [] })).toEqual([]);
    expect(reportWorkObligations({ ...input, classes: [external], enrollments: [{ ...enrollment, on_hold: true }] })).toEqual([]);
  });
  it("테스트반과 테스트반에서 작성·배정한 수치까지 제외한다", () => {
    for (const name of ["테스트 (~26.10.01)", "고등특강(테스트) (~26.07.02)", "학원이(영어 테스트) (~26.09.30)", "학원이(테스트)", "Test class", "테스트반"]) expect(isTestClass(name), name).toBe(true);
    expect(isTestClass("레벨테스트 대비 정규반")).toBe(false);
    const classes = [{ ...cls, name: "학원이(테스트)" }];
    expect(reportWorkObligations({ ...input, classes, reports: [report] })).toEqual([]);
    expect(teacherWork(classes, [report], [], range).rows).toEqual([]);
  });
});

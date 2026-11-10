import { describe, expect, it } from "vitest";
import { buildDailyDuties, dutySubjectKey, kstDueAt, reportSubjectKey, type DailyInput, type DutySchedule, classEndAt } from "./daily";

// 2026-11-09 = 월요일. 수학 반 하나(담임 T1 · 교시 담당 비움 → 담임 폴백) + 영어 ClassNote 반 하나(반 단위 알림장 · 교시 담당 t3).
const DATE = "2026-11-09";
const math = { id: "c-math", name: "중2 A", teacherId: "t1", teacherName: "한지우", subject: "math", reportSource: "lesson" as const };
const eng = { id: "c-eng", name: "중2 영어A", teacherId: "t2", teacherName: "Kate", subject: "english", reportSource: "classnote" as const };
const slot = (over: Partial<DutySchedule> & { class_id: string }): DutySchedule =>
  ({ day_of_week: "mon", start_time: "16:20", valid_from: "2026-09-01", valid_to: null, teacher_id: null, slot_teacher_label: null, ...over });
const enroll = (classId: string, studentId: string, over: Partial<DailyInput["enrollments"][number]> = {}) =>
  ({ class_id: classId, student_id: studentId, start_date: "2026-09-01", end_date: null, on_hold: false, is_transferred: false, attendance_days: null, ...over });
const base = (over: Partial<DailyInput> = {}): DailyInput => ({
  date: DATE, holidays: new Set(), classnoteOn: true,
  classes: [math, eng],
  schedules: [slot({ class_id: "c-math" }), slot({ class_id: "c-eng", start_time: "17:00", teacher_id: "t3" })],
  enrollments: [enroll("c-math", "s1"), enroll("c-math", "s2"), enroll("c-eng", "s3")],
  attendance: [], reports: [], posts: [],
  ...over,
});
const att = (studentId: string, classId: string, status = "present", recordedAt = `${DATE}T08:00:00Z`) =>
  ({ id: `a-${studentId}-${classId}`, student_id: studentId, class_id: classId, session_date: DATE, slot_start: "16:20", status, recorded_at: recordedAt, supersedes_id: null }) as never;
const report = (studentId: string, status: string | null = null, over: Record<string, unknown> = {}) =>
  ({ id: `r-${studentId}`, classId: "c-math", studentId, date: DATE, coversDate: null, status, videoHomework: false, createdAt: `${DATE}T09:00:00Z`, sentAt: status === "success" ? `${DATE}T10:00:00Z` : null, ...over });
const classOf = { "c-math": math, "c-eng": eng } as const;
const keyOf = (kind: string, studentId: string | null, classId: "c-math" | "c-eng") =>
  kind === "attendance" || !studentId ? dutySubjectKey(studentId, classId) : reportSubjectKey(studentId, classOf[classId]);
const pick = (rows: ReturnType<typeof buildDailyDuties>, kind: string, studentId: string | null, classId: "c-math" | "c-eng" = "c-math") =>
  rows.find((r) => r.kind === kind && r.subjectKey === keyOf(kind, studentId, classId));

describe("buildDailyDuties — 출결 입력", () => {
  it("그날 시간표가 유효한 반의 명단마다 한 행 · 기록이 있으면 done(시각 = recorded_at) · 담당은 교시 담당이 없으면 담임", () => {
    const rows = buildDailyDuties(base({ attendance: [att("s1", "c-math")] }));
    expect(pick(rows, "attendance", "s1")).toMatchObject({ status: "done", ownerId: "t1", ownerSource: "homeroom", classId: "c-math", source: "attendance_record", doneAt: `${DATE}T08:00:00Z` });
    expect(pick(rows, "attendance", "s2")).toMatchObject({ status: "open", ownerId: "t1", dueAt: kstDueAt(DATE, 1, 0), doneAt: null });
    expect(pick(rows, "attendance", "s3", "c-eng")).toMatchObject({ ownerId: "t3", ownerSource: "slot" });
  });
  it("같은 날 두 반을 듣는 학생은 반마다 한 건(열쇠에 반이 든다) · 열쇠 중복은 하나만", () => {
    const rows = buildDailyDuties(base({ enrollments: [enroll("c-math", "s1"), enroll("c-eng", "s1")], attendance: [att("s1", "c-eng")] }));
    expect(pick(rows, "attendance", "s1", "c-math")).toMatchObject({ status: "open" });
    expect(pick(rows, "attendance", "s1", "c-eng")).toMatchObject({ status: "done" });
    const keys = rows.map((r) => `${r.kind}|${r.subjectKey}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it("그날 수업이 없는 반 · 시작 전 수강 · 분리등원 다른 요일 · 반 이동으로 그날 떠난 수강 · 종강한 반 · 휴원일은 의무가 아니다", () => {
    expect(buildDailyDuties(base({ schedules: [slot({ class_id: "c-math", day_of_week: "tue" })] })).filter((r) => r.classId === "c-math")).toHaveLength(0);
    expect(pick(buildDailyDuties(base({ enrollments: [enroll("c-math", "s1", { start_date: "2026-12-01" })] })), "attendance", "s1")).toBeUndefined();
    expect(pick(buildDailyDuties(base({ enrollments: [enroll("c-math", "s1", { attendance_days: ["tue", "thu"] })] })), "attendance", "s1")).toBeUndefined();
    // 반 이동은 반열림([시작, 종료)) — 종료일 당일엔 이미 새 반(#125). 일반 종료는 종료일까지 다닌다.
    expect(pick(buildDailyDuties(base({ enrollments: [enroll("c-math", "s1", { end_date: DATE, is_transferred: true })] })), "attendance", "s1")).toBeUndefined();
    expect(pick(buildDailyDuties(base({ enrollments: [enroll("c-math", "s1", { end_date: DATE })] })), "attendance", "s1")).toBeDefined();
    expect(buildDailyDuties(base({ classes: [{ ...math, closedAt: "2026-11-08" }, eng] })).filter((r) => r.classId === "c-math")).toHaveLength(0);
    expect(buildDailyDuties(base({ holidays: new Set([DATE]) }))).toEqual([]);
  });
  it("담당 축 — 교시 담당이 둘로 갈리면 담임 · 자리(JJ·LAB) 교시면 담임 · 퇴사한 교시 담당은 비운다", () => {
    const split = buildDailyDuties(base({ schedules: [slot({ class_id: "c-math", teacher_id: "t5" }), slot({ class_id: "c-math", start_time: "17:20", teacher_id: "t6" })] }));
    expect(pick(split, "attendance", "s1")).toMatchObject({ ownerId: "t1", ownerSource: "homeroom" });
    const seat = buildDailyDuties(base({ schedules: [slot({ class_id: "c-math", slot_teacher_label: "JJ" })] }));
    expect(pick(seat, "attendance", "s1")).toMatchObject({ ownerId: "t1", ownerSource: "homeroom" });
    const retired = buildDailyDuties(base({ inactiveTeacherIds: new Set(["t3"]) }));
    expect(pick(retired, "attendance", "s3", "c-eng")).toMatchObject({ ownerId: null, ownerSource: "retired" });
  });
});

describe("buildDailyDuties — 보고서 발송(작성 · 발송을 한 업무로)", () => {
  it("🔴 보고서는 발송까지가 한 업무 — 발송하는 반에는 작성 의무가 따로 없고, 안 썼어도 · 써 놓고 안 보냈어도 발송 의무가 열린 채다(끝 시각을 모르면 기한 = 다음 날 자정)", () => {
    const rows = buildDailyDuties(base({ reports: [report("s1")] }));
    expect(rows.some((r) => r.kind === "report_write")).toBe(false);
    expect(pick(rows, "report_send", "s1")).toMatchObject({ status: "open", ownerId: "t1", dueAt: kstDueAt(DATE, 2, 0), doneAt: null });
    expect(pick(rows, "report_send", "s2")).toMatchObject({ status: "open", dueAt: kstDueAt(DATE, 2, 0), doneAt: null });
  });
  it("발송 성공 = done(시각 = classnote_sent_at) · 회수 = void · 🔴 발송 기한 지남(too_old)은 열린 채(미이행으로 확정된다 — 의무에서 빠지지 않는다)", () => {
    const rows = buildDailyDuties(base({ reports: [report("s1", "success"), report("s2", "failed", { recalled: true })] }));
    expect(pick(rows, "report_send", "s1")).toMatchObject({ status: "done", source: "classnote_success", doneAt: `${DATE}T10:00:00Z` });
    expect(pick(rows, "report_send", "s2")).toMatchObject({ status: "void", source: "recalled" });
    expect(pick(buildDailyDuties(base({ reports: [report("s1", "too_old")] })), "report_send", "s1")).toMatchObject({ status: "open", source: null });
  });
  it("ClassNote를 안 쓰는 지점(발송 길이 없음)은 종전대로 작성 의무 — 쓰면 done(시각 = created_at) · 발송 의무는 없다", () => {
    const rows = buildDailyDuties(base({ classnoteOn: false, reports: [report("s1")] }));
    expect(rows.some((r) => r.kind === "report_send" && r.classId === "c-math")).toBe(false);
    expect(pick(rows, "report_write", "s1")).toMatchObject({ status: "done", source: "lesson_report", doneAt: `${DATE}T09:00:00Z` });
    expect(pick(rows, "report_write", "s2")).toMatchObject({ status: "open", dueAt: kstDueAt(DATE, 2, 0) }); // 끝 시각을 모를 때 = 발송과 같은 기한(출결 기한 + 24시간)
  });
  it("결석한 학생은 보고서 의무에서 빠지되 void('absent') 행으로 남는다(출결 의무는 기록이 있으니 done) · 미리 쓴 보고서(covers_date = 오늘)는 그날 의무를 만들지 않는다", () => {
    const rows = buildDailyDuties(base({ attendance: [att("s1", "c-math", "absent")] }));
    expect(pick(rows, "report_send", "s1")).toMatchObject({ status: "void", source: "absent", ownerId: "t1" });
    expect(pick(rows, "attendance", "s1")).toMatchObject({ status: "done" });
    const ahead = buildDailyDuties(base({ reports: [report("s2", null, { date: "2026-11-07", coversDate: DATE })] }));
    expect(pick(ahead, "report_send", "s2")).toBeUndefined();
  });
  it("같은 담당·과목의 두 반을 듣는 학생 — 열쇠는 담당×과목으로 하나 · 보고서를 어느 반으로 썼든 같은 열쇠이고 반만 따라간다", () => {
    const mathB = { ...math, id: "c-math-b", name: "중2 B" };
    const before = buildDailyDuties(base({ classes: [math, mathB, eng], schedules: [slot({ class_id: "c-math" }), slot({ class_id: "c-math-b", start_time: "18:30" })],
      enrollments: [enroll("c-math", "s1"), enroll("c-math-b", "s1")] }));
    const sends = before.filter((r) => r.kind === "report_send" && r.studentId === "s1");
    expect(sends).toHaveLength(1);
    expect(sends[0]).toMatchObject({ subjectKey: reportSubjectKey("s1", math), status: "open" });
    const after = buildDailyDuties(base({ classes: [math, mathB, eng], schedules: [slot({ class_id: "c-math" }), slot({ class_id: "c-math-b", start_time: "18:30" })],
      enrollments: [enroll("c-math", "s1"), enroll("c-math-b", "s1")], reports: [report("s1", "success", { classId: "c-math-b" })] }));
    const sent = after.filter((r) => r.kind === "report_send" && r.studentId === "s1");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ subjectKey: reportSubjectKey("s1", math), status: "done", classId: "c-math-b" });
  });
  it("영어 ClassNote 반은 반 단위 한 행(class:<id>) · 알림장을 올린 것이 곧 발송(완료 시각 = 그날 정오 · 기한은 발송과 같다)", () => {
    const rows = buildDailyDuties(base({ posts: [{ boardName: "중2 영어A", postedOn: DATE }] }));
    expect(pick(rows, "report_send", null, "c-eng")).toMatchObject({ status: "done", studentId: null, classId: "c-eng", source: "class_post", doneAt: `${DATE}T12:00:00+09:00`, dueAt: kstDueAt(DATE, 2, 0) });
    expect(rows.some((r) => r.kind === "report_write")).toBe(false);
    expect(pick(buildDailyDuties(base({})), "report_send", null, "c-eng")).toMatchObject({ status: "open" });
  });
});

describe("기한 = 수업 시각 기준(원장 2026-11-11)", () => {
  it("🔴 출결 = 그 반 수업이 끝나는 시각 · 보고서 발송 = 수업이 끝난 뒤 24시간(교시가 여럿이면 가장 늦은 끝 시각) · 끝 시각을 모르면 종전 값", () => {
    const rows = buildDailyDuties(base({ schedules: [slot({ class_id: "c-math", end_time: "19:00:00" }), slot({ class_id: "c-math", start_time: "19:00", end_time: "20:30" }), slot({ class_id: "c-eng" })] }));
    expect(pick(rows, "attendance", "s1")).toMatchObject({ dueAt: new Date(`${DATE}T20:30:00+09:00`).toISOString() });
    expect(pick(rows, "report_send", "s1")).toMatchObject({ dueAt: new Date(Date.parse(`${DATE}T20:30:00+09:00`) + 86_400_000).toISOString() });
    expect(classEndAt(DATE, [], "mon")).toBeNull();
  });
});

describe("kstDueAt", () => {
  it("KST 날짜 기준 n일 뒤 hh시를 UTC ISO로", () => {
    expect(kstDueAt("2026-11-09", 1, 0)).toBe("2026-11-09T15:00:00.000Z");
    expect(kstDueAt("2026-11-09", 1, 12)).toBe("2026-11-10T03:00:00.000Z");
  });
});

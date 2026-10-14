import { describe, expect, it } from "vitest";
import { buildStudentTracking } from "./students";
import type { SnapshotClass, SnapshotEnrollment, SnapshotSchedule } from "./types";

/** 학생 배정·유지 — 매월 10점에서 새로 시작하고 누적하지 않는다(원장 2026-10-12). */
const october = { start: "2026-10-01", end: "2026-10-11" };
const september = { start: "2026-09-01", end: "2026-09-30" };

type Fixture = { from: string; end: string; classes: SnapshotClass[]; schedules: SnapshotSchedule[]; enrollments: SnapshotEnrollment[] };
const klass = (over: Partial<SnapshotClass> = {}): SnapshotClass => ({
  id: "c", class_name: "수학반", subject: "math", english_track: null, teacher_id: "t", is_active: true, closed_at: null,
  report_optout: false, is_makeup_pool: false, ...over,
});
const slot = (over: Partial<SnapshotSchedule> = {}): SnapshotSchedule => ({
  id: "s", class_id: "c", day_of_week: "tue", start_time: "14:00", end_time: "14:50", teacher_id: "assistant", slot_teacher_label: null,
  lab_separate: false, valid_from: "2026-01-01", valid_to: null, ...over,
});
const enroll = (over: Partial<SnapshotEnrollment> = {}): SnapshotEnrollment => ({
  id: "e", student_id: "s", class_id: "c", start_date: "2026-01-01", end_date: null, on_hold: false, attendance_days: [],
  is_transferred: false, is_transferred_in: false, ...over,
});
const fixture = (): Fixture => ({ from: "2026-09-01", end: "2026-10-11", classes: [klass()], schedules: [slot()], enrollments: [enroll()] });
const result = (d: Fixture, teacherId = "t", w = october) => buildStudentTracking({ ...d, owner: (c) => c.teacher_id }).period(teacherId, w);
const addClass = (d: Fixture, teacher = "other", subject = "math") => {
  d.classes.push(klass({ id: "c2", class_name: "다른반", teacher_id: teacher, subject }));
  d.schedules.push(slot({ id: "s2", class_id: "c2", teacher_id: teacher }));
};

describe("명단과 역할", () => {
  it("변동이 없으면 기본 10점이다", () => {
    const r = result(fixture());
    expect([r.value, r.previous, r.current]).toEqual([10, 1, 1]);
  });
  it("부담임도 자기 학생으로 센다", () => {
    const r = result(fixture(), "assistant");
    expect([r.current, r.assistant]).toEqual([1, 1]);
  });
  it("담임이면서 교시 담당이어도 학생은 한 번만 센다", () => {
    const d = fixture();
    d.schedules[0].teacher_id = "t";
    expect(result(d).current).toBe(1);
  });
  it("부담임은 학생이 그 요일에 등원할 때만 맡는다", () => {
    const d = fixture();
    d.enrollments[0].attendance_days = ["thu"];
    expect([result(d, "assistant").current, result(d).current]).toEqual([0, 1]);
  });
  it("끝난 부담임 배정은 퇴원이 아니라 담당 변경이다", () => {
    const d = fixture();
    d.schedules[0].valid_to = "2026-09-30";
    const r = result(d, "assistant");
    expect([r.value, r.current, r.detail[0]?.type]).toEqual([10, 0, "담당 변경"]);
  });
});

describe("🔴 매월 1일에 새로 시작한다 — 누적·이월 없음", () => {
  it("전월에 가점이 있어도 이번 달은 10점에서 시작한다", () => {
    const d = fixture();
    d.enrollments[0].start_date = "2026-09-03";
    const r = result(d);
    expect([r.value, r.previousPoints, r.detail.length]).toEqual([10, 11, 0]);
    expect([result(d, "assistant", september).value, result(d, "assistant").value]).toEqual([11, 10]);
  });
  it("전월이 0점이어도 이번 달 시작 점수는 줄지 않는다", () => {
    const d = fixture();
    for (let i = 0; i < 30; i++) d.enrollments.push(enroll({ id: `n${i}`, student_id: `n${i}`, end_date: "2026-09-02" }));
    d.enrollments[0].end_date = "2026-10-02";
    expect([result(d, "t", september).value, result(d).value]).toEqual([0, 9]);
  });
  it("말일 종료는 그 달에 반영하고 다음 달에 다시 세지 않는다", () => {
    const d = fixture();
    d.enrollments[0].end_date = "2026-09-30";
    const before = result(d, "t", september);
    const after = result(d);
    expect([before.value, before.current, after.value, after.exitCount]).toEqual([9, 0, 10, 0]);
  });
});

describe("가감", () => {
  it("퇴원은 −1점이고 부담임에게도 반영된다", () => {
    const d = fixture();
    d.enrollments[0].end_date = "2026-10-06";
    const r = result(d);
    expect([r.value, r.exitCount, r.current]).toEqual([9, 1, 0]);
    expect(result(d, "assistant").value).toBe(9);
  });
  it("다른 과목이 남아 있어도 수강종료는 −1점이다", () => {
    const d = fixture();
    addClass(d, "other", "english");
    d.enrollments.push(enroll({ id: "e2", class_id: "c2" }));
    d.enrollments[0].end_date = "2026-10-06";
    const r = result(d);
    expect([r.endedCount, r.exitCount, r.value]).toEqual([1, 0, 9]);
  });
  it("다른 강사로의 반이동은 유출 −0.5 · 유입 +0.5다", () => {
    const d = fixture();
    addClass(d);
    Object.assign(d.enrollments[0], { end_date: "2026-10-06", is_transferred: true });
    d.enrollments.push(enroll({ id: "e2", class_id: "c2", start_date: "2026-10-06", is_transferred_in: true }));
    expect([result(d).value, result(d).transferOut]).toEqual([9.5, 1]);
    expect([result(d, "other").value, result(d, "other").transferIn]).toEqual([10.5, 1]);
  });
  it("같은 강사 안의 반이동은 가감하지 않는다 — 이동일이 하루 어긋나도", () => {
    const d = fixture();
    addClass(d, "t");
    Object.assign(d.enrollments[0], { end_date: "2026-10-06", is_transferred: true });
    d.enrollments.push(enroll({ id: "e2", class_id: "c2", start_date: "2026-10-06", is_transferred_in: true }));
    expect([result(d).value, result(d).detail.length]).toEqual([10, 0]);
    d.enrollments[1].start_date = "2026-10-07";
    expect(result(d).value).toBe(10);
    expect(result(d).detail.every((r) => r.points === 0)).toBe(true);
  });
  it("같은 강사의 여러 수업 중 하나가 끝나는 것은 유출이 아니다", () => {
    const d = fixture();
    addClass(d, "t");
    d.enrollments.push(enroll({ id: "e2", class_id: "c2" }));
    d.enrollments[0].end_date = "2026-10-06";
    expect([result(d).current, result(d).value]).toEqual([1, 10]);
  });
  it("폐강은 종료일이 안 바뀌어도 남은 수강을 끝낸다", () => {
    const d = fixture();
    d.classes[0].closed_at = "2026-10-06";
    expect([result(d).value, result(d).current]).toEqual([9, 0]);
  });
  it("신규와 퇴원이 같으면 점수는 그대로다", () => {
    const d = fixture();
    d.enrollments[0].end_date = "2026-10-06";
    d.enrollments.push(enroll({ id: "e2", student_id: "new", start_date: "2026-10-06" }));
    const r = result(d);
    expect([r.value, r.newCount, r.exitCount]).toEqual([10, 1, 1]);
  });
  it("월 점수는 0~20점 안에 든다", () => {
    const up = fixture();
    for (let i = 0; i < 30; i++) up.enrollments.push(enroll({ id: `n${i}`, student_id: `n${i}`, start_date: "2026-10-02" }));
    expect(result(up).value).toBe(20);
    const down = fixture();
    for (let i = 0; i < 30; i++) down.enrollments.push(enroll({ id: `n${i}`, student_id: `n${i}`, end_date: "2026-10-02" }));
    expect(result(down).value).toBe(0);
  });
});

describe("🔴 강사 탓이 아닌 사유는 감점하지 않는다 — 퇴원율과 같은 판정(원장 2026-10-14 '사유 규칙 적용')", () => {
  const reasons = (studentReasons: { id: string; reason: string | null; withdrawn_at?: string | null }[] = []) =>
    ({ studentReasons, excludeReasons: ["graduated", "relocation", "illness", "advised"] });
  const judged = (d: Fixture, r: Parameters<typeof buildStudentTracking>[0]["reasons"]) =>
    buildStudentTracking({ ...d, owner: (c) => c.teacher_id, reasons: r }).period("t", october);
  it("수강 종료 사유가 졸업이면 줄은 남기고 0 · 까닭을 단다 · 사유를 안 넘기면(시간표 X 명단) 종전대로", () => {
    const d = fixture();
    Object.assign(d.enrollments[0], { end_date: "2026-10-06", withdrawal_reason: "graduated" });
    const r = judged(d, reasons());
    expect([r.value, r.exitCount, r.excused, r.unscored, r.detail[0]?.points, r.detail[0]?.note]).toEqual([10, 0, 1, 1, 0, "사유 졸업"]);
    expect([result(d).value, result(d).exitCount]).toEqual([9, 1]);
  });
  it("퇴원이면 그 무렵 학생 퇴원 사유(라벨 글 '이사'도) · 옛 퇴원 사유와 수강종료엔 학생 사유를 쓰지 않는다", () => {
    const d = fixture();
    d.enrollments[0].end_date = "2026-10-06";
    expect(judged(d, reasons([{ id: "s", reason: "이사", withdrawn_at: "2026-10-06T09:00:00Z" }])).value).toBe(10);
    d.enrollments[0].withdrawal_reason = "competitor";
    expect(judged(d, reasons([{ id: "s", reason: "relocation", withdrawn_at: "2026-03-01T00:00:00Z" }])).value).toBe(9);
    const e = fixture();
    addClass(e, "other", "english");
    e.enrollments.push(enroll({ id: "e2", class_id: "c2" }));
    e.enrollments[0].end_date = "2026-10-06";
    expect(judged(e, reasons([{ id: "s", reason: "relocation", withdrawn_at: "2026-10-06" }])).endedCount).toBe(1);
  });
  it("학생 퇴원 사유는 퇴원율과 같은 때만 — 다른 과목을 곧 다니면(수강종료) 안 쓰고 · 사유 없이 끝난 줄은 그 퇴원과 함께 끝났을 때만", () => {
    const d = fixture();
    d.enrollments[0].end_date = "2026-10-06";
    // 다음 날 영어를 시작 — 배정·유지 표시는 '퇴원'이어도 퇴원율처럼 수강종료로 보고 학생 사유를 쓰지 않는다.
    addClass(d, "other", "english");
    d.enrollments.push(enroll({ id: "e2", class_id: "c2", start_date: "2026-10-07" }));
    expect(judged(d, reasons([{ id: "s", reason: "relocation", withdrawn_at: "2026-10-06" }])).value).toBe(9);
    // 수강종료로 남았다 늦게(11월) 이사 퇴원 처리 = 면제 · 그 사이 다시 등록했다 퇴원했으면(옛 그만둠) 감점.
    const late = fixture();
    late.enrollments[0].end_date = "2026-10-06";
    expect(judged(late, reasons([{ id: "s", reason: "relocation", withdrawn_at: "2026-11-20" }])).value).toBe(10);
    late.enrollments.push(enroll({ id: "e3", start_date: "2026-11-10", end_date: "2027-01-05" }));
    expect(judged(late, reasons([{ id: "s", reason: "relocation", withdrawn_at: "2027-01-05" }])).value).toBe(9);
    // 퇴원일 기록이 없는 옛 학생은 종전대로(수강 사유가 비었으면 학생 사유).
    expect(judged(fixture(), reasons([{ id: "s", reason: "relocation" }])).value).toBe(10);
  });
  it("함께 끝난 수강 중 하나라도 고른 사유가 아니면 감점 · 원장이 고른 목록을 따른다", () => {
    const d = fixture();
    addClass(d, "t");
    Object.assign(d.enrollments[0], { end_date: "2026-10-06", withdrawal_reason: "graduated" });
    d.enrollments.push(enroll({ id: "e2", class_id: "c2", end_date: "2026-10-06", withdrawal_reason: "competitor" }));
    expect(judged(d, reasons()).value).toBe(9);
    d.enrollments[1].withdrawal_reason = "졸업";
    expect(judged(d, reasons()).value).toBe(10);
    expect(judged(d, { excludeReasons: ["relocation"] }).value).toBe(9);
  });
});

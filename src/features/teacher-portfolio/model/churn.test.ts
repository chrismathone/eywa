import { describe, expect, it } from "vitest";
import { DEFAULT_CHURN_OPTIONS, type ChurnOptions } from "../evaluation/config";
import { readFileSync } from "node:fs";
import { buildChurn, CLASS_END_TEXT } from "./churn";
import { buildStudentTracking } from "./students";
import type { SnapshotClass, SnapshotEnrollment } from "./types";

/** 퇴원율 — 원장 결정 5·6(2026-10-13): 분모 = 지난달 절반 이상 맡은 학생, 강사 탓이 아닌 퇴원은 뺀다. */
const klass = (id: string, over: Partial<SnapshotClass> = {}): SnapshotClass => ({
  id, class_name: `${id}반`, subject: "math", english_track: null, teacher_id: "t", is_active: true, closed_at: null,
  report_optout: false, is_makeup_pool: false, ...over,
});
let seq = 0;
const enroll = (student: string, classId: string, start: string, end: string | null, reason: string | null = null): SnapshotEnrollment => ({
  id: `e${++seq}`, student_id: student, class_id: classId, start_date: start, end_date: end, on_hold: false, attendance_days: [],
  is_transferred: false, is_transferred_in: false, withdrawal_reason: reason,
});
const october = { start: "2026-10-01", end: "2026-10-31" };

function churn(classes: SnapshotClass[], enrollments: SnapshotEnrollment[], options: ChurnOptions = DEFAULT_CHURN_OPTIONS,
  extra: { futureEnrollments?: SnapshotEnrollment[]; studentReasons?: { id: string; reason: string | null }[] } = {}) {
  const tracking = buildStudentTracking({ from: "2026-09-01", end: "2026-10-31", classes, schedules: [], enrollments, owner: (c) => c.teacher_id });
  return buildChurn({ source: tracking.churnSource, classes: new Map(classes.map((c) => [c.id, c])), teacherId: "t", w: october, options, ...extra });
}

describe("퇴원율", () => {
  const classes = [klass("A"), klass("B", { teacher_id: "u" }), klass("SP", { is_special: true }), klass("EN", { subject: "english", teacher_id: "u" })];
  const rows = () => [
    enroll("s1", "A", "2026-08-01", null), // 계속 다님 — 분모만
    enroll("s2", "A", "2026-08-01", "2026-10-10", "competitor"), // 타 학원 — 센다
    enroll("s3", "A", "2026-08-01", "2026-10-05", "relocation"), // 이사 — 뺀다(기본)
    enroll("s4", "A", "2026-09-20", "2026-10-03", "competitor"), // 지난달 11일만 — 분모 밖
    enroll("s5", "A", "2026-08-01", "2026-10-07", "반 이동"), // 반 이동 — 뺀다
    enroll("s6", "A", "2026-08-01", "2026-10-07", "other"), enroll("s6", "B", "2026-10-08", null), // 같은 과목 다른 반(다음 날 시작)
    enroll("s7", "SP", "2026-08-01", "2026-10-02", null), // 끝난 특강
    enroll("s8", "A", "2026-08-01", "2026-10-09", "other"), enroll("s8", "EN", "2026-08-01", null), // 수학만 끊음 = 수강종료
  ];
  it("분모는 지난달 절반 이상 맡은 학생, 분자는 강사 탓인 퇴원·수강종료만 — 한 학생은 한 번", () => {
    const r = churn(classes, rows());
    expect([r.base, r.need, r.counted, r.raw]).toEqual([7, 15, 2, 28.6]);
    const note = (s: string) => r.detail.find((x) => x.studentId === s);
    expect([note("s2")?.counted, note("s3")?.note, note("s5")?.note, note("s6")?.note, note("s7")?.note, note("s8")?.type])
      .toEqual([true, "사유 이사", "반 이동", "같은 과목 다른 반을 다님", "끝난 특강", "수강종료"]);
    expect(r.detail.some((x) => x.studentId === "s4")).toBe(false);
  });
  it("원장이 고른 대로 — 이사도 세고, 수강종료는 세지 않는다", () => {
    const r = churn(classes, rows(), { excludeReasons: [], countEnded: false });
    expect([r.counted, r.raw]).toEqual([2, 28.6]);
    expect(r.detail.find((x) => x.studentId === "s3")?.counted).toBe(true);
    expect(r.detail.find((x) => x.studentId === "s8")?.note).toBe("수강종료는 세지 않음");
  });
  it("반이 문을 닫은 날 끝난 수강은 수업이 끝난 것이다 · 지난달 담당 학생이 없으면 수치 없음", () => {
    const closed = [klass("A", { closed_at: "2026-10-15" })];
    const r = churn(closed, [enroll("s1", "A", "2026-08-01", null)]);
    expect(r.detail.map((x) => x.note)).toEqual(["수업이 끝남"]);
    expect(churn([klass("A")], [enroll("s1", "A", "2026-10-02", null)]).raw).toBeNull();
  });
  it("취소된 미래 수강(종료일 = 시작일)은 다니는 반이 아니다 · 창 밖 다음 달에 시작하는 같은 과목 반은 다니는 반이다", () => {
    const cancelled = churn(classes, [enroll("s1", "A", "2026-08-01", "2026-10-10", "other"), enroll("s1", "B", "2026-10-20", "2026-10-20")]);
    expect(cancelled.detail.map((x) => [x.type, x.counted])).toEqual([["퇴원", true]]);
    const nextMonth = churn(classes, [enroll("s1", "A", "2026-08-01", "2026-10-31", "other")], DEFAULT_CHURN_OPTIONS, { futureEnrollments: [enroll("s1", "B", "2026-11-01", null)] });
    expect(nextMonth.detail.map((x) => x.note)).toEqual(["같은 과목 다른 반을 다님"]);
  });
  it("사유 — 수강에 없으면 학생의 퇴원 사유(퇴원일 때만) · 옛 영문 코드도 한글로 · 줄마다 판정해 하나라도 남으면 센다", () => {
    const viaStudent = churn(classes, [enroll("s1", "A", "2026-08-01", "2026-10-10", "퇴원에 따른 자동 종료")], DEFAULT_CHURN_OPTIONS, { studentReasons: [{ id: "s1", reason: "relocation" }] });
    expect(viaStudent.detail.map((x) => [x.reason, x.note])).toEqual([["이사", "사유 이사"]]);
    const legacy = churn(classes, [enroll("s1", "A", "2026-08-01", "2026-10-10", "moved")]);
    expect(legacy.detail.map((x) => [x.reason, x.counted])).toEqual([["이사", false]]);
    const two = [klass("A"), klass("A2", { subject: "english" })];
    const mixed = churn(two, [enroll("s1", "A", "2026-08-01", "2026-10-10", "graduated"), enroll("s1", "A2", "2026-08-01", "2026-10-10", "competitor")]);
    expect(mixed.detail.map((x) => [x.reason, x.counted])).toEqual([["타 학원으로 이동", true]]);
  });
  it("몇 달 뒤 재등록은 '다님'이 아니다 · 같은 반에 다음 날 다시 등록하면 다님 · 닫힌 반에 남은 수강은 다님이 아니다", () => {
    const later = churn(classes, [enroll("s1", "A", "2026-08-01", "2026-10-10", "other"), enroll("s1", "B", "2026-12-15", null)]);
    expect(later.detail.map((x) => [x.type, x.counted])).toEqual([["퇴원", true]]);
    const rejoin = churn(classes, [enroll("s1", "A", "2026-08-01", "2026-10-10", "other"), enroll("s1", "B", "2026-10-11", null)]);
    expect(rejoin.detail.map((x) => x.note)).toEqual(["같은 과목 다른 반을 다님"]);
    const closedOther = [klass("A"), klass("B", { teacher_id: "u", closed_at: "2026-10-01" })];
    const stale = churn(closedOther, [enroll("s1", "A", "2026-08-01", "2026-10-10", "other"), enroll("s1", "B", "2026-08-01", null)]);
    expect(stale.detail.map((x) => [x.type, x.counted])).toEqual([["퇴원", true]]);
  });
  it("구조적 종료 글은 반을 닫는 코드의 글과 같다", () => {
    const lifecycle = readFileSync("src/features/classes/server/enrollment-lifecycle.ts", "utf8");
    const period = readFileSync("src/features/classes/server/period-enrollments.ts", "utf8");
    expect(lifecycle).toContain('export const ARCHIVE_REASON = "반 폐지";');
    expect(lifecycle).toContain('export const CLOSE_TERM_REASON = "종강";');
    expect(period).toContain('export const PERIOD_END_REASON = "운영 기간 종료";');
    expect(CLASS_END_TEXT).toEqual(["반 폐지", "종강", "운영 기간 종료"]);
  });
});

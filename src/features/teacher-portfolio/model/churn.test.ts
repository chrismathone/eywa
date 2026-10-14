import { describe, expect, it } from "vitest";
import { DEFAULT_CHURN_OPTIONS, type ChurnOptions } from "../evaluation/config";
import { readFileSync } from "node:fs";
import { buildChurn, CLASS_END_TEXT } from "./churn";
import { buildChurnModel } from "./churn-model";
import { buildStudentTracking } from "./students";
import type { SnapshotClass, SnapshotEnrollment, SnapshotSchedule } from "./types";

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
  extra: { futureEnrollments?: SnapshotEnrollment[]; studentReasons?: { id: string; reason: string | null; withdrawn_at?: string | null }[] } = {}) {
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
  it("분모는 지난달 정규 수업으로 절반 이상 맡은 학생, 분자는 강사 탓인 퇴원·수강종료만 — 한 학생은 한 번", () => {
    const r = churn(classes, rows());
    expect([r.base, r.need, r.counted, r.raw]).toEqual([6, 15, 2, 33.3]);
    const note = (s: string) => r.detail.find((x) => x.studentId === s);
    expect([note("s2")?.counted, note("s3")?.note, note("s5")?.note, note("s6")?.note, note("s8")?.type])
      .toEqual([true, "사유 이사", "반 이동", "같은 과목 다른 반을 다님", "수강종료"]);
    // 지난달 11일만 맡은 학생 · 특강만 들은 학생은 분모 밖(특강은 분자에서 늘 빠진다 — 분모에 넣으면 퇴원율이 구조적으로 낮아진다).
    expect(r.detail.some((x) => x.studentId === "s4" || x.studentId === "s7")).toBe(false);
  });
  it("특강이 끝나 그 과목을 그만두면 끝난 특강으로 뺀다 · 같은 과목을 이 선생님에게 계속 들으면 줄도 없다", () => {
    const en = [klass("A", { subject: "english" }), klass("SP", { is_special: true })];
    const r = churn(en, [enroll("s1", "A", "2026-08-01", null), enroll("s1", "SP", "2026-08-01", "2026-10-02", null)]);
    expect(r.detail.map((x) => [x.note, x.counted])).toEqual([["끝난 특강", false]]);
    expect(churn(classes, [enroll("s1", "A", "2026-08-01", null), enroll("s1", "SP", "2026-08-01", "2026-10-02", null)]).detail).toEqual([]);
  });
  it("반이 닫혀 이 선생님의 같은 과목 다른 반으로 옮기면 줄이 없다 · 다른 선생님 반으로 가면 뺀 줄로 남긴다", () => {
    const closing = [klass("A", { closed_at: "2026-10-15" }), klass("C"), klass("B", { teacher_id: "u" })];
    expect(churn(closing, [enroll("s1", "A", "2026-08-01", null), enroll("s1", "C", "2026-10-15", null)]).detail).toEqual([]);
    expect(churn(closing, [enroll("s1", "A", "2026-08-01", null), enroll("s1", "B", "2026-10-15", null)]).detail.map((x) => x.note)).toEqual(["수업이 끝남"]);
  });
  it("원장이 고른 대로 — 이사도 세고, 수강종료는 세지 않는다", () => {
    const r = churn(classes, rows(), { excludeReasons: [], countEnded: false });
    expect([r.counted, r.raw]).toEqual([2, 33.3]);
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
  it("🔴 강사 탓이 아닌 사유는 퇴원·수강종료 모두 뺀다 — 수강 사유·학생 퇴원 사유 중 하나라도 · 라벨 글도(원장 2026-10-14 '모든 곳에서')", () => {
    // 수강 사유는 '기타'인데 학생 퇴원 사유가 '졸업'(그 무렵 퇴원) → 뺀다.
    const both = churn(classes, [enroll("s1", "A", "2026-08-01", "2026-10-10", "other")], DEFAULT_CHURN_OPTIONS,
      { studentReasons: [{ id: "s1", reason: "graduated", withdrawn_at: "2026-10-10T09:00:00+09:00" }] });
    expect(both.detail.map((x) => [x.reason, x.note])).toEqual([["졸업", "사유 졸업"]]);
    // 다시 등록하기 전의 옛 퇴원 사유(퇴원일이 멀다)는 이번 그만둠에 쓰지 않는다.
    const stale = churn(classes, [enroll("s1", "A", "2026-08-01", "2026-10-10", "other")], DEFAULT_CHURN_OPTIONS,
      { studentReasons: [{ id: "s1", reason: "graduated", withdrawn_at: "2026-03-02" }] });
    expect(stale.detail.map((x) => x.counted)).toEqual([true]);
    // 수강 사유가 비면 학생 퇴원 사유는 그 퇴원과 함께 끝난 수강일 때만(시간표 X와 같은 `endedWithExit`) — 그 사이 다시 등록했다
    // 퇴원했으면 쓰지 않고(사유 칸에도 안 붙인다), 수강종료로 남았다 늦게 퇴원 처리됐으면 쓴다(적대적 리뷰 2026-10-14).
    const reEnrolled = churn(classes, [enroll("s1", "A", "2026-08-01", "2026-10-10"), enroll("s1", "B", "2026-12-01", "2027-01-20")], DEFAULT_CHURN_OPTIONS,
      { studentReasons: [{ id: "s1", reason: "relocation", withdrawn_at: "2027-01-20" }] });
    expect(reEnrolled.detail.map((x) => [x.reason, x.counted])).toEqual([["사유 없음", true]]);
    const late = churn(classes, [enroll("s1", "A", "2026-08-01", "2026-10-10")], DEFAULT_CHURN_OPTIONS,
      { studentReasons: [{ id: "s1", reason: "relocation", withdrawn_at: "2026-11-25" }] });
    expect(late.detail.map((x) => [x.reason, x.note])).toEqual([["이사", "사유 이사"]]);
    // '퇴원에 따른 자동 종료'는 그 퇴원 때문에 닫힌 줄 — 퇴원일이 멀어도 학생 사유.
    const autoEnd = churn(classes, [enroll("s1", "A", "2026-08-01", "2026-10-10", "퇴원에 따른 자동 종료")], DEFAULT_CHURN_OPTIONS,
      { studentReasons: [{ id: "s1", reason: "graduated", withdrawn_at: "2026-03-02" }] });
    expect(autoEnd.detail.map((x) => [x.reason, x.note])).toEqual([["졸업", "사유 졸업"]]);
    // 수강종료(다른 과목은 다님)도 같다 · 사람이 라벨 글('이사')로 적어도.
    const ended = churn(classes, [enroll("s1", "A", "2026-08-01", "2026-10-09", "이사"), enroll("s1", "EN", "2026-08-01", null)]);
    expect(ended.detail.map((x) => [x.type, x.reason, x.note])).toEqual([["수강종료", "이사", "사유 이사"]]);
    // 수강종료엔 학생 퇴원 사유를 쓰지 않는다(그 학생은 퇴원하지 않았다).
    const keepOn = churn(classes, [enroll("s1", "A", "2026-08-01", "2026-10-09", "other"), enroll("s1", "EN", "2026-08-01", null)], DEFAULT_CHURN_OPTIONS,
      { studentReasons: [{ id: "s1", reason: "relocation", withdrawn_at: "2026-10-09" }] });
    expect(keepOn.detail.map((x) => x.counted)).toEqual([true]);
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
  it("휴원 중인 같은 과목 반은 다니는 반이다(퇴원관리와 같다) · 두 과목을 맡은 선생님도 한 과목만 끊으면 수강종료", () => {
    const hold = churn(classes, [enroll("s1", "A", "2026-08-01", "2026-10-10", "other"), { ...enroll("s1", "B", "2026-08-01", null), on_hold: true }]);
    expect(hold.detail.map((x) => x.note)).toEqual(["같은 과목 다른 반을 다님"]);
    const both = [klass("A"), klass("E", { subject: "english" })];
    const one = churn(both, [enroll("s1", "A", "2026-08-01", "2026-10-09", "other"), enroll("s1", "E", "2026-08-01", null)]);
    expect(one.detail.map((x) => [x.type, x.counted])).toEqual([["수강종료", true]]);
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

/** 담임·교시 담당 모두(2026-10-14 — main 의 교시 담당 퇴원율과 합칠 때 그 시험을 옮겨 왔다). */
describe("퇴원율 — 교시 담당 · 같은 날 반 이동", () => {
  const slot = (teacher: string, over: Partial<SnapshotSchedule> = {}): SnapshotSchedule => ({
    id: `slot-${teacher}`, class_id: "A", day_of_week: "tue", start_time: "16:00", end_time: "17:00", teacher_id: teacher,
    slot_teacher_label: null, lab_separate: false, valid_from: "2026-01-01", valid_to: null, ...over,
  });
  const run = (teacherId: string, schedules: SnapshotSchedule[], enrollments: SnapshotEnrollment[], classes = [klass("A", { teacher_id: "home" })]) => {
    const tracking = buildStudentTracking({ from: "2026-09-01", end: "2026-10-31", classes, schedules, enrollments, owner: (c) => c.teacher_id });
    return buildChurn({ source: tracking.churnSource, classes: new Map(classes.map((c) => [c.id, c])), teacherId, w: october, options: DEFAULT_CHURN_OPTIONS });
  };
  const left = () => enroll("s", "A", "2026-08-01", "2026-10-06", "schedule");
  it("담임과 교시 담당 모두 분모·분자에 든다 · 상관없는 선생님은 자료 없음", () => {
    for (const id of ["home", "period"]) expect(run(id, [slot("period")], [left()]).raw).toBe(100);
    expect(run("unrelated", [slot("period")], [left()]).raw).toBeNull();
  });
  it("등원하지 않는 요일 · 끝난 교시 배정은 그 선생님 담당이 아니다", () => {
    expect(run("period", [slot("period")], [{ ...left(), attendance_days: ["thu"] }]).raw).toBeNull();
    expect(run("period", [slot("period", { valid_to: "2026-08-31" })], [left()]).raw).toBeNull();
  });
  it("분모가 있는 선생님 → 분모 학생을 가르친 과목 · 퇴원율에 넣은 그만둠의 학생·과목(시간표 X 겹침이 같은 계산기를 읽는다)", () => {
    const classes = [klass("A", { teacher_id: "home" }), klass("EN", { subject: "english", teacher_id: "home" })];
    const schedules = [slot("period"), slot("native", { id: "slot-en", class_id: "EN" })];
    const tracking = buildStudentTracking({ from: "2026-09-01", end: "2026-10-31", classes, schedules, enrollments: [left(), enroll("s", "EN", "2026-08-01", null)], owner: (c) => c.teacher_id });
    const model = buildChurnModel({ source: tracking.churnSource, classes, options: DEFAULT_CHURN_OPTIONS });
    const subjects = model.eligibleSubjects(october);
    expect([...subjects.get("home") ?? []].sort()).toEqual(["english", "math"]);
    expect([...subjects.get("period") ?? []]).toEqual(["math"]);
    expect([...subjects.get("native") ?? []]).toEqual(["english"]);
    expect(subjects.has("unrelated")).toBe(false);
    expect(model.exits("period", october)).toEqual([{ studentId: "s", subjects: ["math"] }]);
    expect(model.exits("native", october)).toEqual([]);
    expect([model.period("home", october).counted, model.period("home", october).detail[0]?.type]).toEqual([1, "수강종료"]);
  });
  it("같은 날 끝난 반 이동이 마지막 퇴원을 가리지 않는다", () => {
    const classes = [klass("A", { teacher_id: "home" }), klass("OLD", { teacher_id: "previous" })];
    const old = { ...enroll("s", "OLD", "2026-01-01", "2026-10-06", "반 이동"), is_transferred: true };
    expect(run("home", [], [left(), old], classes).raw).toBe(100);
  });
});

/** 다른 선생님 반으로 옮긴 뒤 그만둔 학생 — 옛 선생님 명단에선 반 이동으로만 빠진다(main 퇴원율과 합칠 때 적대적 리뷰 2026-10-14). */
describe("퇴원율 — 반 이동 뒤 그만둠", () => {
  const classes = [klass("A"), klass("B", { teacher_id: "u" })];
  const moved = (end: string) => ({ ...enroll("s", "A", "2026-08-01", end, "반 이동"), is_transferred: true });
  const into = (start: string, end: string | null, reason: string | null) => ({ ...enroll("s", "B", start, end, reason), is_transferred_in: true });
  const run = (teacherId: string, enrollments: SnapshotEnrollment[], reason = "competitor") => {
    const tracking = buildStudentTracking({ from: "2026-09-01", end: "2026-10-31", classes, schedules: [], enrollments, owner: (c) => c.teacher_id });
    return buildChurn({ source: tracking.churnSource, classes: new Map(classes.map((c) => [c.id, c])), teacherId, w: october,
      options: DEFAULT_CHURN_OPTIONS, studentReasons: [{ id: "s", reason }] });
  };
  it("이 달에 옮기고 다음 날 그만두면 지난달 선생님에게 센다 · 옮겨 간 선생님은 지난달 학생이 아니다", () => {
    const r = run("t", [moved("2026-10-06"), into("2026-10-06", "2026-10-07", "퇴원에 따른 자동 종료")]);
    expect(r.detail.map((x) => [x.day, x.counted])).toEqual([["2026-10-07", true]]); // 옮긴 날은 줄을 안 남긴다(옮겨 간 반을 다녔다).
    expect(r.raw).toBe(100);
    expect(run("u", [moved("2026-10-06"), into("2026-10-06", "2026-10-07", "퇴원에 따른 자동 종료")]).raw).toBeNull();
  });
  it("옮긴 날 바로 그만두면(옮겨 간 수강이 종료일 = 시작일) 반 이동이 아니라 그만둔 것 — 사유는 학생의 퇴원 사유", () => {
    const same = [moved("2026-10-06"), into("2026-10-06", "2026-10-06", "퇴원에 따른 자동 종료")];
    expect(run("t", same).detail.map((x) => [x.reason, x.counted])).toEqual([["타 학원으로 이동", true]]);
    expect(run("t", same, "relocation").detail.map((x) => x.note)).toEqual(["사유 이사"]);
  });
  it("지난달 중간에 옮겼어도 절반 이상 맡았으면 이 달 그만둔 것을 센다 · 옮겨 간 반을 계속 다니면 세지 않는다", () => {
    expect(run("t", [moved("2026-09-20"), into("2026-09-20", "2026-10-10", "other")]).raw).toBe(100);
    expect(run("t", [moved("2026-10-06"), into("2026-10-06", null, null)]).detail).toEqual([]);
  });
  it("옮겨 갈 반이 며칠 뒤 시작인데 시작 전에 그만뒀어도 그만둔 것 · 사유는 옮겨 갈 반을 닫은 사유", () => {
    expect(run("t", [moved("2026-10-06"), into("2026-10-09", "2026-10-09", "퇴원에 따른 자동 종료")]).detail.map((x) => [x.reason, x.counted]))
      .toEqual([["타 학원으로 이동", true]]);
    const en = { ...enroll("s", "EN", "2026-08-01", null), class_id: "EN" };
    const withEnglish = [...classes, klass("EN", { subject: "english", teacher_id: "u" })];
    const tracking = buildStudentTracking({ from: "2026-09-01", end: "2026-10-31", classes: withEnglish, schedules: [], enrollments: [moved("2026-10-06"), into("2026-10-06", "2026-10-06", "relocation"), en], owner: (c) => c.teacher_id });
    const r = buildChurn({ source: tracking.churnSource, classes: new Map(withEnglish.map((c) => [c.id, c])), teacherId: "t", w: october, options: DEFAULT_CHURN_OPTIONS });
    expect(r.detail.map((x) => [x.type, x.note])).toEqual([["수강종료", "사유 이사"]]);
  });
  it("그만두고 한참 뒤 다른 선생님 반에 다시 등록했다 끊은 것은 옛 선생님 몫이 아니다(같은 학생을 두 달 세지 않는다)", () => {
    const rows = [enroll("s", "A", "2026-08-01", "2026-10-20", "competitor"), enroll("s", "B", "2026-11-25", "2026-11-28", "competitor")];
    const tracking = buildStudentTracking({ from: "2026-09-01", end: "2026-11-30", classes, schedules: [], enrollments: rows, owner: (c) => c.teacher_id });
    const at = (w: { start: string; end: string }) => buildChurn({ source: tracking.churnSource, classes: new Map(classes.map((c) => [c.id, c])), teacherId: "t", w, options: DEFAULT_CHURN_OPTIONS });
    expect(at(october).counted).toBe(1);
    expect(at({ start: "2026-11-01", end: "2026-11-30" }).counted).toBe(0);
  });
});

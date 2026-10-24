import { describe, expect, it } from "vitest";
import { courseBreakdownOf, courseTrendOf, coursesOn, type CourseRow } from "./course-trend";
import { summarizeCourses } from "@/features/students/enrollment/course-count";
import type { TrendEnrollments, TrendStudent } from "./enrolled-trend";

/** 강좌수 추이(원장 2026-10-20) — 학생·과목마다 한 번 센다 · 오늘 점은 '강좌수' 칸 규약. */
const en = (o: Partial<TrendEnrollments> = {}): TrendEnrollments => ({ firstStart: new Map(), ended: new Set(), ...o });
const student = (id: string, o: Partial<TrendStudent> = {}): TrendStudent => ({ id, status: "enrolled", enrolledAt: "2026-01-01", withdrawnAt: null, ...o });
const row = (studentId: string, classId: string, subject: string, o: Partial<CourseRow> = {}): CourseRow => ({
  studentId,
  classId,
  subject,
  start: "2026-03-02",
  end: null,
  transferred: false,
  ...o,
});
const at = (date: string) => [{ key: date, label: date, date }];

describe("coursesOn / courseTrendOf — 강좌수 추이", () => {
  it("집계 재료는 반마다 하나 · 시작 전·끝난 수강은 뺀다(반이동은 종료일부터 · 일반 종료는 종료일까지)", () => {
    const rows = [
      row("a", "jj", "math"),
      row("a", "ms", "math"),
      row("a", "ms", "math", { start: "2026-03-05" }), // 같은 반 두 줄
      row("a", "eng", "english", { start: "2026-04-01" }), // 아직 시작 전
      row("a", "old", "math", { end: "2026-03-10" }), // 3/10까지 다녔다
      row("a", "moved", "english", { end: "2026-03-10", transferred: true }), // 3/10에 옮겨 갔다
    ];
    expect(coursesOn(student("a"), rows, en(), "2026-03-10").map((e) => e.classId).sort()).toEqual(["jj", "ms", "old"]);
    expect(coursesOn(student("a"), rows, en(), "2026-03-11")).toHaveLength(2);
  });

  it("🔴 오늘 점 = '강좌수' 칸 규약 — 휴원 수강은 오늘 세지 않고, 종료일이 미래로 적힌 수강(반이동 예약 전의 원래 반)은 그날까지 센다", () => {
    const rows = [row("a", "c1", "math"), row("a", "c2", "math", { end: "2026-10-31", transferred: true }), row("a", "c3", "english", { onHold: true })];
    expect(courseTrendOf([student("a")], en(), rows, at("2026-10-20"), undefined, "2026-10-20")[0]!.count).toBe(1);
    // 지난 날짜는 휴원 이력이 없어 지금 휴원 중인 수강도 센다(재원생 추이와 같은 한계).
    expect(courseTrendOf([student("a")], en(), rows, at("2026-09-30"), undefined, "2026-10-20")[0]!.count).toBe(2);
  });

  it("🔴 오늘 점 = 상단 '강좌수' 칸(`summarizeCourses`) — 같은 수강을 두 모양으로 넘겨도 같은 수", () => {
    const today = "2026-10-20";
    const base = [
      { id: "1", student: "a", cls: "m1", subject: "math", start: "2026-03-02", end: null as string | null, transferred: false, onHold: false },
      { id: "2", student: "a", cls: "sp", subject: "math", start: "2026-10-01", end: "2026-11-14", transferred: false, onHold: false },
      { id: "3", student: "a", cls: "old", subject: "english", start: "2026-03-02", end: "2026-11-02", transferred: true, onHold: false },
      { id: "4", student: "a", cls: "new", subject: "english", start: "2026-11-02", end: null, transferred: false, onHold: false },
      { id: "5", student: "b", cls: "m1", subject: "math", start: "2026-03-02", end: null, transferred: false, onHold: true },
      { id: "6", student: "b", cls: "e1", subject: "english", start: "2026-10-25", end: null, transferred: false, onHold: false },
      { id: "7", student: "b", cls: "e2", subject: "english", start: "2026-03-02", end: "2026-10-20", transferred: false, onHold: false },
    ];
    const kpi = summarizeCourses({
      rows: base
        .filter((r) => !r.onHold && (!r.end || r.end >= today)) // 칸 조회 = 종료일 없음 + 종료일이 오늘 이후 · 휴원 아님
        .map((r) => ({ id: r.id, student_id: r.student, class_id: r.cls, start_date: r.start, end_date: r.end, is_transferred: r.transferred, class: { subject: r.subject } })),
      scope: null,
      subjects: [{ key: "math", label: "수학" }, { key: "english", label: "영어" }],
      today,
    }).total;
    const trend = courseTrendOf(
      [student("a"), student("b")],
      en(),
      base.map((r) => row(r.student, r.cls, r.subject, { start: r.start, end: r.end, transferred: r.transferred, onHold: r.onHold })),
      at(today),
      undefined,
      today,
    )[0]!.count;
    expect(kpi).toBe(3); // a: 수학 · 영어 / b: 오늘 끝나는 영어
    expect(trend).toBe(kpi);
  });

  it("재원생으로 세어지는 날만 · 과목 관리자는 그 과목 반만(`inRow`)", () => {
    const rows = [row("a", "c1", "math"), row("a", "c2", "english"), row("w", "c3", "math")];
    const students = [student("a"), student("w", { status: "withdrawn", withdrawnAt: "2026-05-01" })];
    expect(courseTrendOf(students, en(), rows, at("2026-04-30"))[0]!.count).toBe(3);
    expect(courseTrendOf(students, en(), rows, at("2026-05-31"))[0]!.count).toBe(2); // 퇴원 뒤엔 그 학생의 반을 세지 않는다
    expect(courseTrendOf(students, en(), rows, at("2026-04-30"), (e) => e.subject === "math")[0]!.count).toBe(2);
  });

  it("장부 정리 청구 날 — 반이동 줄과 마지막 반의 종료일이 같아도 한 번 · 반 없는 수강은 세지 않는다", () => {
    const k = student("k", { status: "withdrawn", withdrawnAt: "2026-07-03", cleanup: true });
    const rows = [row("k", "x", "math", { end: "2026-07-03", transferred: true }), row("k", "y", "math", { start: "2026-07-03", end: "2026-07-03" })];
    const billing = { from: "2026-01", today: "2026-10-20", months: new Map([["k", ["2026-07"]]]) };
    expect(courseTrendOf([k], en({ ended: new Set(["k"]), billing }), rows, at("2026-07-31"))[0]!.count).toBe(1);
    expect(courseTrendOf([student("a")], en(), [row("a", "c1", "math"), { ...row("a", "x", "math"), classId: null }], at("2026-04-30"))[0]!.count).toBe(1);
  });

  it("장부 정리 청구 날 — 반이동으로 닫힌 원래 반은 두 번 세지 않는다(옮겨 간 반만)", () => {
    const k = student("k", { status: "withdrawn", withdrawnAt: "2026-07-03", cleanup: true });
    const rows = [row("k", "x", "math", { end: "2026-06-28", transferred: true }), row("k", "y", "math", { start: "2026-06-28", end: "2026-07-03" })];
    const billing = { from: "2026-01", today: "2026-10-20", months: new Map([["k", ["2026-07"]]]) };
    expect(courseTrendOf([k], en({ ended: new Set(["k"]), billing }), rows, at("2026-07-31"))[0]!.count).toBe(1);
  });

  it("장부 정리 학생을 청구로 센 날은 퇴원 무렵 함께 끝난 반을 센다(재원생 추이와 같은 14일 폭)", () => {
    const k = student("k", { status: "withdrawn", withdrawnAt: "2026-07-03", cleanup: true });
    const rows = [
      row("k", "c1", "math", { end: "2026-07-03" }),
      row("k", "c2", "english", { end: "2026-06-25" }),
      row("k", "c3", "math", { end: "2026-03-01" }), // 14일보다 훨씬 전에 끝난 반
    ];
    const billing = { from: "2026-01", today: "2026-10-20", months: new Map([["k", ["2026-07"]]]) };
    const e = en({ ended: new Set(["k"]), billing });
    expect(courseTrendOf([k], e, rows, at("2026-07-31"))[0]!.count).toBe(2);
    expect(courseTrendOf([k], e, rows, at("2026-08-31"))[0]!.count).toBe(0); // 8월 청구가 없다
  });

  it("묶음으로 가르기 — 프로그램을 모르는 반은 전체에만", () => {
    const rows = [row("a", "c1", "math"), row("a", "c2", "english", { englishTrack: "eie" }), row("a", "c3", "science")];
    const group = (r: CourseRow) => (r.subject === "math" ? "math" : r.subject === "english" ? (r.englishTrack === "eie" ? "eie" : "injaewon") : null);
    const out = courseBreakdownOf([student("a")], en(), rows, at("2026-04-30"), ["eie", "injaewon", "math"] as const, group);
    expect(out.total[0]!.count).toBe(3);
    expect([out.groups.eie[0]!.count, out.groups.injaewon[0]!.count, out.groups.math[0]!.count]).toEqual([1, 0, 1]);
  });
});

it("과목별 추이의 합 = 전체 · 수학 5반 + 영어 두 프로그램 + 국어는 3(주별·월별·연도별 같은 계산)", () => {
  const subjects = [{ key: "math", label: "수학" }, { key: "advanced", label: "수학(심화)" }, { key: "english", label: "영어" }, { key: "korean", label: "국어" }];
  const rows = [...Array.from({ length: 5 }, (_, i) => row("a", `m${i}`, i === 4 ? "advanced" : "math")),
    row("a", "e1", "english", { englishTrack: "eie" }), row("a", "e2", "english"), row("a", "k", "korean"), row("a", "unknown", "")];
  const points = ["2026-03-31", "2026-04-05", "2026-12-31"].map((date) => ({ key: date, label: date, date }));
  const group = (e: CourseRow) => e.subject === "advanced" ? "math" : e.subject;
  const out = courseBreakdownOf([student("a")], en(), rows, points, ["math", "english", "korean"], group, undefined, undefined, subjects);
  expect(out.total.map((p) => p.count)).toEqual([3, 3, 3]);
  for (let i = 0; i < points.length; i++) expect(Object.values(out.groups).reduce((n, ps) => n + ps[i]!.count, 0)).toBe(out.total[i]!.count);
  expect(courseTrendOf([student("a")], en(), rows, points, undefined, undefined, subjects)).toEqual(out.total);
});

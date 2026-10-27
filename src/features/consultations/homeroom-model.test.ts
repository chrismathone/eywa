import { describe, expect, it } from "vitest";
import { buildHomeroomTeachers, homeroomMonths, lastDayOf, isHomeroomConsultClass, recentMonths, type HomeroomInput } from "./homeroom-model";

const base = (over: Partial<HomeroomInput> = {}): HomeroomInput => ({
  today: "2026-10-27",
  months: ["2026-08", "2026-09", "2026-10"],
  classes: [{ id: "c1", name: "중등M 중1", subject: "math", teacherId: "t1" }],
  staffNames: new Map([
    ["t1", "김담임"],
    ["desk", "박데스크"],
  ]),
  enrollments: [
    { studentId: "s1", classId: "c1", startDate: "2026-03-02" },
    { studentId: "s2", classId: "c1", startDate: "2026-09-15" },
  ],
  students: new Map([
    ["s1", { name: "가학생", grade: "중1" }],
    ["s2", { name: "나학생", grade: "중1" }],
  ]),
  consults: [],
  history: [],
  knownStudents: new Map([
    ["s1", "가학생"],
    ["s2", "나학생"],
    ["s3", "다퇴원"],
    ["s4", "라이동"],
  ]),
  prevMonth: "2026-09",
  ...over,
});

describe("recentMonths", () => {
  it("이번 달 포함 거꾸로 n달 · 해를 넘는다", () => {
    expect(recentMonths("2026-02-10", 4)).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });
});

describe("buildHomeroomTeachers", () => {
  it("담임 본인 상담 = self · 다른 직원만 = other · 없음 = none · 반 들어오기 전 = before(분모 밖)", () => {
    const [t] = buildHomeroomTeachers(
      base({
        consults: [
          { studentId: "s1", counselorId: "t1", date: "2026-08-03" },
          { studentId: "s1", counselorId: "t1", date: "2026-08-20" },
          { studentId: "s1", counselorId: "desk", date: "2026-09-01" },
          { studentId: "s2", counselorId: "t1", date: "2026-10-02" },
        ],
      }),
    );
    const s1 = t!.students.find((s) => s.id === "s1")!;
    const s2 = t!.students.find((s) => s.id === "s2")!;
    expect(s1.cells).toEqual(["self", "other", "none"]);
    expect(s1.selfCounts).toEqual([2, 0, 0]);
    expect(s1.lastSelf).toBe("2026-08-20");
    expect(s1.otherNames).toEqual([[], ["박데스크"], []]);
    expect(s2.cells).toEqual(["before", "none", "self"]);
    expect(t!.months).toEqual([
      { target: 1, self: 1, other: 0, none: 0 },
      { target: 2, self: 0, other: 1, none: 1 },
      { target: 2, self: 1, other: 0, none: 1 },
    ]);
  });

  it("이번 달 미상담이 맨 위", () => {
    const [t] = buildHomeroomTeachers(base({ consults: [{ studentId: "s2", counselorId: "t1", date: "2026-10-02" }] }));
    expect(t!.students.map((s) => s.id)).toEqual(["s1", "s2"]);
  });

  it("재원생 명단에 없는 학생·담임 반이 아닌 수강은 버리고, 학생이 없는 담임은 세우지 않는다", () => {
    const out = buildHomeroomTeachers(
      base({
        classes: [
          { id: "c1", name: "A", subject: "math", teacherId: "t1" },
          { id: "c2", name: "B", subject: "math", teacherId: "t2" },
        ],
        enrollments: [
          { studentId: "s1", classId: "c1", startDate: null },
          { studentId: "gone", classId: "c2", startDate: null },
          { studentId: "s2", classId: "seat", startDate: null },
        ],
      }),
    );
    expect(out.map((t) => t.id)).toEqual(["t1"]);
    expect(out[0]!.students.map((s) => s.id)).toEqual(["s1"]);
    // 시작일 모름 = 처음부터 있던 것으로(before 없음).
    expect(out[0]!.students[0]!.cells).not.toContain("before");
  });

  it("한 담임의 두 반에 있는 학생은 한 줄 · 가장 이른 시작일", () => {
    const [t] = buildHomeroomTeachers(
      base({
        classes: [
          { id: "c1", name: "A", subject: "math", teacherId: "t1" },
          { id: "c2", name: "B", subject: "english", teacherId: "t1" },
        ],
        enrollments: [
          { studentId: "s1", classId: "c1", startDate: "2026-10-01" },
          { studentId: "s1", classId: "c2", startDate: "2026-08-10" },
        ],
      }),
    );
    expect(t!.students).toHaveLength(1);
    expect(t!.students[0]!.cells[0]).toBe("none");
    expect(t!.classNames).toEqual(["A", "B"]);
    expect(t!.subjects).toEqual(["english", "math"]);
  });
});

describe("isHomeroomConsultClass", () => {
  it("특강·JJ(복습) 반은 담임 상담 대상이 아니다 — 컬럼이 먼저, 이름 JJ는 폴백", () => {
    expect(isHomeroomConsultClass({ isSpecial: false, className: "중등M 중1 BS3C", learningTrack: "regular" })).toBe(true);
    expect(isHomeroomConsultClass({ isSpecial: false, className: "초등M 개별 BS1B", learningTrack: "supplement" })).toBe(false);
    expect(isHomeroomConsultClass({ isSpecial: false, className: "초등M 개별 JJ1K", learningTrack: "regular" })).toBe(false);
    expect(isHomeroomConsultClass({ isSpecial: true, className: "중3 시험대비", learningTrack: null })).toBe(false);
    expect(isHomeroomConsultClass({ isSpecial: null, className: "내신중등특강", learningTrack: null })).toBe(false);
  });
});

describe("homeroomMonths", () => {
  it("2026-10부터만 · 이번 달은 항상 · 최대 6달", () => {
    expect(homeroomMonths("2026-10-27")).toEqual(["2026-10"]);
    expect(homeroomMonths("2026-12-01")).toEqual(["2026-10", "2026-11", "2026-12"]);
    expect(homeroomMonths("2027-06-01")).toEqual(["2027-01", "2027-02", "2027-03", "2027-04", "2027-05", "2027-06"]);
  });
});

describe("지난달 학생 수 · 퇴원생", () => {
  it("말일에 있던 학생을 세고(지금 퇴원생 포함), 지난달에 끝난 수강 중 반이동·남은 학생은 퇴원이 아니다", () => {
    const [t] = buildHomeroomTeachers(
      base({
        history: [
          { studentId: "s1", classId: "c1", startDate: "2026-03-02", endDate: null, isTransferred: false },
          { studentId: "s2", classId: "c1", startDate: "2026-09-15", endDate: null, isTransferred: false },
          { studentId: "s3", classId: "c1", startDate: "2026-03-02", endDate: "2026-09-20", isTransferred: false },
          { studentId: "s4", classId: "c1", startDate: "2026-03-02", endDate: "2026-09-30", isTransferred: true },
          { studentId: "s1", classId: "c1", startDate: "2025-03-02", endDate: "2026-09-10", isTransferred: false },
        ],
      }),
    );
    // 9/30 기준: s1·s2(9/15 입반) — s3는 9/20에 나갔고 s4는 9/30 반이동(그날 이미 새 반).
    expect(t!.prevStudents).toBe(2);
    // s3만 퇴원 — s4는 반이동, s1은 끝난 수강이 있어도 지금 이 담임 반에 있다.
    expect(t!.leftPrev).toEqual([{ id: "s3", name: "다퇴원" }]);
  });
});

describe("lastDayOf", () => {
  it("말일", () => {
    expect(lastDayOf("2026-09")).toBe("2026-09-30");
    expect(lastDayOf("2028-02")).toBe("2028-02-29");
    expect(lastDayOf("2026-12")).toBe("2026-12-31");
  });
});

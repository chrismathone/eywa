import { describe, expect, it } from "vitest";

import { resolveDayArrivals, resolveFirstClasses, type DayEnrollmentRow } from "./day-arrivals";

const TODAY = "2026-09-09";

function row(over: Partial<DayEnrollmentRow> & Pick<DayEnrollmentRow, "studentId" | "startDate">): DayEnrollmentRow {
  return {
    studentName: `학생-${over.studentId}`,
    endDate: null,
    isTransferred: false,
    isTransferredIn: false,
    onHold: false,
    ...over,
  };
}

describe("오늘 첫 수업 · 오늘 마지막 수업 (학생 단위 판정)", () => {
  it("오늘 시작한 수강 하나뿐인 학생은 '첫 수업'", () => {
    const out = resolveDayArrivals([row({ studentId: "s1", startDate: TODAY })], TODAY);
    expect(out.starting.map((s) => s.studentId)).toEqual(["s1"]);
    expect(out.ending).toEqual([]);
  });

  it("이미 다니던 학생이 반을 하나 더 받은 것은 첫 수업이 아니다 (실측: 김라윤A)", () => {
    const out = resolveDayArrivals(
      [
        row({ studentId: "s1", startDate: TODAY }),
        row({ studentId: "s1", startDate: "2026-03-02" }), // 계속 다니는 반
      ],
      TODAY,
    );
    expect(out.starting).toEqual([]);
  });

  it("반이동으로 들어온 수강은 첫 수업이 아니다", () => {
    const out = resolveDayArrivals(
      [row({ studentId: "s1", startDate: TODAY, isTransferredIn: true })],
      TODAY,
    );
    expect(out.starting).toEqual([]);
  });

  it("오늘 끝나는 수강이 있어도 남은 반이 있으면 마지막 수업이 아니다 (실측: 김지호 continues=4)", () => {
    const out = resolveDayArrivals(
      [
        row({ studentId: "s1", startDate: "2026-03-02", endDate: TODAY }),
        row({ studentId: "s1", startDate: "2026-03-02", endDate: null }),
      ],
      TODAY,
    );
    expect(out.ending).toEqual([]);
  });

  it("남은 반이 없으면 마지막 수업 — 같은 날 두 반이 끝나도 학생 한 번만 (실측: 조현준 행 2개)", () => {
    const out = resolveDayArrivals(
      [
        row({ studentId: "s1", startDate: "2026-03-02", endDate: TODAY }),
        row({ studentId: "s1", startDate: "2026-03-02", endDate: TODAY }),
      ],
      TODAY,
    );
    expect(out.ending.map((s) => s.studentId)).toEqual(["s1"]);
  });

  it("반이동으로 끝난 수강은 마지막 수업이 아니다 (그날 이미 새 반)", () => {
    const out = resolveDayArrivals(
      [row({ studentId: "s1", startDate: "2026-03-02", endDate: TODAY, isTransferred: true })],
      TODAY,
    );
    expect(out.ending).toEqual([]);
  });

  it("휴원 수강만 남으면 오늘이 마지막 수업이다", () => {
    const out = resolveDayArrivals(
      [
        row({ studentId: "s1", startDate: "2026-03-02", endDate: TODAY }),
        row({ studentId: "s1", startDate: "2026-03-02", endDate: null, onHold: true }),
      ],
      TODAY,
    );
    expect(out.ending.map((s) => s.studentId)).toEqual(["s1"]);
  });

  it("어제 끝난 수강은 오늘의 신호가 아니다", () => {
    const out = resolveDayArrivals(
      [row({ studentId: "s1", startDate: "2026-03-02", endDate: "2026-09-08" })],
      TODAY,
    );
    expect(out.ending).toEqual([]);
  });

  it("반이동으로 어제 나간 수강은 '오늘까지 다닌 것'으로 치지 않는다(반열림)", () => {
    // 어제 반이동으로 끝났고 오늘 새 반이 시작 → 첫 수업이 아니다(반이동 들어옴 표식이 없어도).
    const out = resolveDayArrivals(
      [
        row({ studentId: "s1", startDate: "2026-03-02", endDate: TODAY, isTransferred: true }),
        row({ studentId: "s1", startDate: TODAY }),
      ],
      TODAY,
    );
    expect(out.starting).toEqual([]);
  });

  it("이름은 한글 정렬, 이름이 비면 대체 문구", () => {
    const out = resolveDayArrivals(
      [
        row({ studentId: "b", studentName: "박서준", startDate: TODAY }),
        row({ studentId: "a", studentName: "김하늘", startDate: TODAY }),
        row({ studentId: "c", studentName: "", startDate: TODAY }),
      ],
      TODAY,
    );
    expect(out.starting.map((s) => s.name)).toEqual(["(학생)", "김하늘", "박서준"]);
  });
});

describe("오늘첫수업 — 첫 등원 + 새 과목 (resolveFirstClasses)", () => {
  it("처음 오는 학생 = 첫 등원, 과목은 오늘 시작한 전부", () => {
    const out = resolveFirstClasses(
      [
        row({ studentId: "s1", startDate: TODAY, subject: "math" }),
        row({ studentId: "s1", startDate: TODAY, subject: "english" }),
      ],
      TODAY,
    );
    expect(out).toEqual([{ studentId: "s1", name: "학생-s1", kind: "first", subjects: ["math", "english"] }]);
  });

  it("다니던 학생이 처음 듣는 과목 = 새 과목(그 과목만)", () => {
    const out = resolveFirstClasses(
      [
        row({ studentId: "s1", startDate: "2026-03-02", subject: "math" }),
        row({ studentId: "s1", startDate: TODAY, subject: "english" }),
        row({ studentId: "s1", startDate: TODAY, subject: "math" }),
      ],
      TODAY,
    );
    expect(out).toEqual([{ studentId: "s1", name: "학생-s1", kind: "newSubject", subjects: ["english"] }]);
  });

  it("🔴 이미 듣던 과목에 반 하나 더 받은 것은 첫 수업이 아니다", () => {
    const out = resolveFirstClasses(
      [
        row({ studentId: "s1", startDate: "2026-03-02", subject: "math" }),
        row({ studentId: "s1", startDate: TODAY, subject: "math" }),
      ],
      TODAY,
    );
    expect(out).toEqual([]);
  });

  it("🔴 반이동(옮겨 들어옴)은 새 과목 반이어도 첫 수업이 아니다", () => {
    const out = resolveFirstClasses(
      [
        row({ studentId: "s1", startDate: "2026-03-02", endDate: TODAY, isTransferred: true, subject: "math" }),
        row({ studentId: "s1", startDate: TODAY, isTransferredIn: true, subject: "english" }),
        row({ studentId: "s2", startDate: TODAY, isTransferredIn: true, subject: "math" }),
      ],
      TODAY,
    );
    expect(out).toEqual([]);
  });

  it("🔴 예전에 들었다가 끝난 과목으로 돌아온 것은 새 과목이 아니다", () => {
    const out = resolveFirstClasses(
      [
        row({ studentId: "s1", startDate: "2026-03-02", endDate: "2026-06-30", subject: "english" }),
        row({ studentId: "s1", startDate: "2026-03-02", subject: "math" }),
        row({ studentId: "s1", startDate: TODAY, subject: "english" }),
      ],
      TODAY,
    );
    expect(out).toEqual([]);
  });

  it("과목을 모르면 새 과목으로 치지 않는다(지어내지 않는다)", () => {
    const out = resolveFirstClasses(
      [
        row({ studentId: "s1", startDate: "2026-03-02", subject: "math" }),
        row({ studentId: "s1", startDate: TODAY, subject: null }),
      ],
      TODAY,
    );
    expect(out).toEqual([]);
  });

  it("🔴 새 과목은 프로그램 묶음으로 본다 — 인재원 영어 → EiE, 수학 → 수학(심화)는 새 과목이 아니다", () => {
    const subjects = [
      { key: "math", label: "수학" },
      { key: "english", label: "영어" },
      { key: "subject_1", label: "수학(심화)" },
      { key: "science", label: "과학" },
    ];
    const out = resolveFirstClasses(
      [
        // 인재원 영어 다니던 학생이 오늘 EiE 반 시작 — 같은 영어 묶음
        row({ studentId: "e", startDate: "2026-03-02", subject: "english" }),
        row({ studentId: "e", startDate: TODAY, subject: "english" }),
        // 수학 다니던 학생이 오늘 수학(심화) 시작 — 같은 수학 묶음
        row({ studentId: "m", startDate: "2026-03-02", subject: "math" }),
        row({ studentId: "m", startDate: TODAY, subject: "subject_1" }),
        // 영어 다니던 학생이 오늘 수학(심화) 시작 — 새 묶음
        row({ studentId: "x", startDate: "2026-03-02", subject: "english" }),
        row({ studentId: "x", startDate: TODAY, subject: "subject_1" }),
        // 수학 다니던 학생이 오늘 과학 시작 — 묶음 밖 과목은 키 그대로라 새 과목
        row({ studentId: "s", startDate: "2026-03-02", subject: "math" }),
        row({ studentId: "s", startDate: TODAY, subject: "science" }),
      ],
      TODAY,
      subjects,
    );
    expect(out.map((s) => [s.studentId, s.kind, s.subjects])).toEqual([
      ["s", "newSubject", ["science"]],
      ["x", "newSubject", ["subject_1"]],
    ]);
  });

  it("브리핑의 '오늘 첫 수업'은 카드와 같은 결과 전체 — 첫 등원 + 새 과목(같은 이름의 숫자는 같다)", () => {
    const rows = [
      row({ studentId: "new", studentName: "나신입", startDate: TODAY, subject: "math" }),
      row({ studentId: "old", studentName: "가재원", startDate: "2026-03-02", subject: "math" }),
      row({ studentId: "old", studentName: "가재원", startDate: TODAY, subject: "english" }),
    ];
    const card = resolveFirstClasses(rows, TODAY);
    expect(card.map((s) => [s.name, s.kind])).toEqual([
      ["가재원", "newSubject"],
      ["나신입", "first"],
    ]);
    expect(resolveDayArrivals(rows, TODAY).starting).toEqual(card);
  });
});

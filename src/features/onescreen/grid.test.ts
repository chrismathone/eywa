import { describe, it, expect } from "vitest";
import {
  buildGridRows,
  buildRowRenderMeta,
  isReportEligible,
  isRowActionable,
  planBulkApply,
  planPrevFill,
  summarizeSendGaps,
  type BulkTarget,
} from "./grid";
import type { OneScreenStudent, PrevReport } from "./types";

function stu(id: string, subjects: { name: string; today?: string }[]): OneScreenStudent {
  return {
    id,
    name: id,
    grade: "중1",
    tag: "중1",
    attendance: "출석",
    subjects: subjects.map((s) => ({ name: s.name, prev: "", today: s.today ?? "" })),
    tests: {
      daily: { score: null, max: 20, prevScore: null },
      check: { score: null, max: 20, prevScore: null },
    },
    attitude: null,
    homework: "",
    progressConfirmed: false,
    reportDraft: "",
    reportSent: false,
  };
}

describe("buildGridRows", () => {
  it("학생×과목으로 평탄화하고 과목 순서를 보존한다", () => {
    const rows = buildGridRows([
      stu("a", [{ name: "수학" }]),
      stu("b", [{ name: "수학" }, { name: "영어" }]),
    ]);
    expect(rows.map((r) => r.key)).toEqual(["a::수학", "b::수학", "b::영어"]);
    expect(rows[1]!.subjectIndex).toBe(0);
    expect(rows[2]!.subjectIndex).toBe(1);
  });

  it("과목 없는 학생은 행을 만들지 않는다", () => {
    expect(buildGridRows([stu("a", [])])).toHaveLength(0);
  });
});

describe("isRowActionable", () => {
  const sub = (over: Partial<Parameters<typeof isRowActionable>[0]> = {}) => ({
    name: "수학",
    prev: "",
    today: "1-1-1 받아올림",
    ...over,
  });

  it("진도 없으면 어떤 액션도 불가(공통 필수)", () => {
    expect(isRowActionable(sub({ today: "" }), "save")).toBe(false);
    expect(isRowActionable(sub({ today: "" }), "send")).toBe(false);
  });

  it("결석 행 — save는 포함(기록 보존), send/autowrite는 제외", () => {
    const absent = sub({ attendanceRaw: "absent" });
    expect(isRowActionable(absent, "save")).toBe(true);
    expect(isRowActionable(absent, "send")).toBe(false);
    expect(isRowActionable(absent, "autowrite")).toBe(false);
  });

  it("조퇴(early_leave)·지각·기록없음은 발송 유지", () => {
    expect(isRowActionable(sub({ attendanceRaw: "early_leave" }), "send")).toBe(true);
    expect(isRowActionable(sub({ attendanceRaw: "late" }), "send")).toBe(true);
    expect(isRowActionable(sub({}), "send")).toBe(true);
  });
});

describe("summarizeSendGaps", () => {
  it("고유 학생 수 기준으로 태도·테스트 미입력을 센다(과목 행 중복 아님)", () => {
    const a = stu("a", [{ name: "수학", today: "x" }, { name: "영어", today: "y" }]); // 태도·테스트 둘 다 미입력
    const b = stu("b", [{ name: "수학", today: "x" }]);
    b.attitude = "좋음";
    b.tests.daily.score = 18;
    b.tests.check.score = 19;
    const rows = buildGridRows([a, b]);
    expect(summarizeSendGaps(rows, { dailyEnabled: true, checkEnabled: true })).toEqual({
      missingAttitude: 1, // a 1명(행 2개여도 1명)
      missingTest: 1,
    });
  });

  it("비활성 테스트는 미입력으로 치지 않는다", () => {
    const a = stu("a", [{ name: "수학", today: "x" }]);
    a.attitude = "좋음";
    a.tests.daily.score = 18; // check는 null이지만 checkEnabled=false
    const rows = buildGridRows([a]);
    expect(summarizeSendGaps(rows, { dailyEnabled: true, checkEnabled: false })).toEqual({
      missingAttitude: 0,
      missingTest: 0,
    });
  });
});

describe("buildRowRenderMeta", () => {
  it("다과목 학생은 첫 행만 firstOfStudent, studentRow는 학생 묶음 순번(밀집)", () => {
    const rows = buildGridRows([
      stu("a", [{ name: "수학" }]),
      stu("b", [{ name: "수학" }, { name: "영어" }]),
      stu("c", [{ name: "수학" }]),
    ]);
    expect(buildRowRenderMeta(rows)).toEqual([
      { firstOfStudent: true, studentRow: 0 },
      { firstOfStudent: true, studentRow: 1 },
      { firstOfStudent: false, studentRow: 1 }, // b의 두 번째 과목 행 — 점수 nav 미부착 대상
      { firstOfStudent: true, studentRow: 2 },
    ]);
  });

  it("표시 순서 기준이라 재배열(순서 모드)된 목록에도 정합", () => {
    const [a, b] = buildGridRows([stu("a", [{ name: "수학" }]), stu("b", [{ name: "수학" }])]);
    expect(buildRowRenderMeta([b!, a!])).toEqual([
      { firstOfStudent: true, studentRow: 0 },
      { firstOfStudent: true, studentRow: 1 },
    ]);
  });
});

describe("isReportEligible", () => {
  it("오늘 진도가 있으면 true, 비었으면 false", () => {
    expect(isReportEligible({ name: "수학", prev: "", today: "1-1-1 받아올림" })).toBe(true);
    expect(isReportEligible({ name: "수학", prev: "", today: "   " })).toBe(false);
    expect(isReportEligible({ name: "수학", prev: "", today: "" })).toBe(false);
  });
});

function target(over: Partial<BulkTarget> = {}): BulkTarget {
  return {
    studentId: "a",
    subjectName: "수학",
    attitude: null,
    homework: "",
    textbook: "",
    homeworkToday: "",
    ...over,
  };
}

describe("planBulkApply", () => {
  it("빈(미지정·공백) patch 필드는 적용하지 않는다 — 값 지우기 아님", () => {
    expect(planBulkApply([target()], {}, false)).toEqual([]);
    expect(planBulkApply([target()], { textbook: "  " }, false)).toEqual([]);
  });

  it("채워진 필드만 대상 행 전체에 적용한다(기본=덮어쓰기)", () => {
    const plan = planBulkApply(
      [target({ textbook: "기존 교재" }), target({ studentId: "b" })],
      { textbook: "쎈 중2-1", homeworkToday: "p10~16" },
      false,
    );
    expect(plan).toEqual([
      { studentId: "a", subjectName: "수학", set: { textbook: "쎈 중2-1", homeworkToday: "p10~16" } },
      { studentId: "b", subjectName: "수학", set: { textbook: "쎈 중2-1", homeworkToday: "p10~16" } },
    ]);
  });

  it("onlyEmpty면 이미 값 있는 칸은 건너뛴다", () => {
    const plan = planBulkApply(
      [target({ attitude: "좋음", textbook: "기존" }), target({ studentId: "b" })],
      { attitude: "아주 좋음", textbook: "쎈" },
      true,
    );
    expect(plan).toEqual([
      { studentId: "b", subjectName: "수학", set: { attitude: "아주 좋음", textbook: "쎈" } },
    ]);
  });

  it("태도·과제(학생 단위)는 같은 학생의 두 번째 행부터 중복 적용하지 않는다", () => {
    const plan = planBulkApply(
      [target({ subjectName: "수학" }), target({ subjectName: "영어" })],
      { attitude: "좋음", homeworkToday: "복습" },
      false,
    );
    expect(plan).toEqual([
      { studentId: "a", subjectName: "수학", set: { attitude: "좋음", homeworkToday: "복습" } },
      { studentId: "a", subjectName: "영어", set: { homeworkToday: "복습" } },
    ]);
  });
});

const ATTITUDES = ["아주 좋음", "좋음", "보통", "산만함", "피곤함"] as const;
const HOMEWORKS = ["완료", "일부 미흡", "미제출"] as const;

function prevReport(over: Partial<PrevReport> = {}): PrevReport {
  return {
    date: "2026-07-13",
    progress: "1-1-1 받아올림",
    textbook: "쎈",
    homeworkToday: "p10~16",
    homeworkScore: "완료",
    attitude: "좋음",
    examInfo: "일일 18/20",
    note: "학부모 발송 본문",
    ...over,
  };
}

describe("planPrevFill", () => {
  it("빈 칸만 채운다 — 이미 입력된 칸은 유지", () => {
    const fill = planPrevFill({
      prev: prevReport(),
      current: { today: "이미 입력", attitude: null, homework: "미제출", homeworkToday: "" },
      attitudes: ATTITUDES,
      homeworks: HOMEWORKS,
    });
    expect(fill).toEqual({ attitude: "좋음", homeworkToday: "p10~16" });
  });

  it("이전 값이 없거나(prev 없음) 전부 입력돼 있으면 빈 계획", () => {
    expect(
      planPrevFill({
        prev: undefined,
        current: { today: "", attitude: null, homework: "", homeworkToday: "" },
        attitudes: ATTITUDES,
        homeworks: HOMEWORKS,
      }),
    ).toEqual({});
    expect(
      planPrevFill({
        prev: prevReport(),
        current: { today: "x", attitude: "보통", homework: "완료", homeworkToday: "y" },
        attitudes: ATTITUDES,
        homeworks: HOMEWORKS,
      }),
    ).toEqual({});
  });

  it("현 선택지에 없는 옛 태도·과제 값은 스킵한다", () => {
    const fill = planPrevFill({
      prev: prevReport({ attitude: "옛선택지", homeworkScore: "90%" }),
      current: { today: "", attitude: null, homework: "", homeworkToday: "x" },
      attitudes: ATTITUDES,
      homeworks: HOMEWORKS,
    });
    expect(fill).toEqual({ today: "1-1-1 받아올림" });
  });

  it("특이사항(note=발송 본문)은 어떤 경우에도 계획에 포함되지 않는다", () => {
    const fill = planPrevFill({
      prev: prevReport(),
      current: { today: "", attitude: null, homework: "", homeworkToday: "" },
      attitudes: ATTITUDES,
      homeworks: HOMEWORKS,
    });
    expect(Object.keys(fill)).not.toContain("note");
    expect(fill).toEqual({
      today: "1-1-1 받아올림",
      attitude: "좋음",
      homework: "완료",
      homeworkToday: "p10~16",
    });
  });
});

import { describe, expect, it } from "vitest";
import {
  EXAM_SLOT_LABEL,
  examSlotFromLabel,
  examSlotOptions,
  examSlotsFor,
  normalizeExamSlot,
} from "./exam-slots";
import { examAppliesTo, isElementaryGrade, isMiddleFirstGrade, notApplicableReason } from "./applies";
import { GRADE_MARK_KEYS, gradeMarkKeysFor } from "./types";
import { gradeCellKeeps, hasUntouchedMark } from "./keep";
import { gradeMonthOf, slotUsesMonth } from "./exam-slots";
import { monthAnchorDate, termMonths } from "./term";
import { buildOverviewColumns, overviewAvgPct, overviewColumnKey } from "./overview";
import { compareByGrade, gradeSortRank } from "./grade-rank";
import { GRADE_SORT_DEFAULT, nextGradeSort, parseGradeSort } from "./list-prefs";
import { resolveGradeSelection, selectionSlotIsValid } from "./selection";
import { axisOptionsFrom, axisValueOf, firstAxisOf, parseAxisValue } from "./subject-axis";
import {
  defaultExamDate,
  defaultTermOf,
  normalizeTerm,
  normalizeYear,
  rosterAnchorFor,
  termLabel,
  termWindow,
  termYearOptions,
} from "./term";

const SUBJECT_OPTIONS = [
  { value: "math", label: "수학" },
  { value: "english", label: "영어" },
  { value: "science", label: "과학" },
];

describe("학기 축", () => {
  it("1학기 = 3/1~8/31, 2학기 = 9/1~이듬해 2월 말일(윤년 반영)", () => {
    expect(termWindow(2026, 1)).toEqual({ start: "2026-03-01", end: "2026-08-31" });
    expect(termWindow(2026, 2)).toEqual({ start: "2026-09-01", end: "2027-02-28" });
    // 2028은 윤년 — 2027년 2학기는 2/29까지.
    expect(termWindow(2027, 2).end).toBe("2028-02-29");
  });

  it("🔴 1·2월은 전년도 2학기다 — 달력 연도로 접으면 방금 적은 기말고사가 사라진다", () => {
    expect(defaultTermOf("2027-01-15")).toEqual({ year: 2026, term: 2 });
    expect(defaultTermOf("2027-02-28")).toEqual({ year: 2026, term: 2 });
    expect(defaultTermOf("2026-03-01")).toEqual({ year: 2026, term: 1 });
    expect(defaultTermOf("2026-08-31")).toEqual({ year: 2026, term: 1 });
    expect(defaultTermOf("2026-09-22")).toEqual({ year: 2026, term: 2 });
  });

  it("명단 기준일 — 학기 안이면 오늘, 전이면 시작일, 지났으면 종료일", () => {
    expect(rosterAnchorFor(2026, 2, "2026-09-22")).toBe("2026-09-22");
    expect(rosterAnchorFor(2026, 2, "2026-05-01")).toBe("2026-09-01"); // 아직 시작 전
    expect(rosterAnchorFor(2026, 1, "2026-09-22")).toBe("2026-08-31"); // 이미 지난 학기
    expect(defaultExamDate(2026, 1, "2026-09-22")).toBe("2026-08-31");
  });

  it("모르는 값은 폴백(화면이 죽지 않는다)", () => {
    expect(normalizeTerm("3", 1)).toBe(1);
    expect(normalizeTerm("2", 1)).toBe(2);
    expect(normalizeYear("1999", 2026)).toBe(2026);
    expect(normalizeYear("2030", 2026)).toBe(2030);
    expect(termLabel(2026, 2)).toBe("2026년 2학기");
  });

  it("년도 선택지는 최신이 먼저", () => {
    const years = termYearOptions("2026-09-22", 2, 1);
    expect(years).toEqual([2027, 2026, 2025, 2024]);
  });
});

describe("시험 칸", () => {
  it("수학은 중간·기말 + 월말평가(내신 한 칸은 2026-10-14 폐지), 영어는 듣기평가가 앞에 붙고 Monthly Test(2026-11-04)가 뒤에", () => {
    expect(examSlotsFor("math")).toEqual(["midterm", "final", "monthly"]);
    expect(examSlotsFor("english")).toEqual(["listening", "midterm", "final", "monthly"]);
    // 등록만 된 다른 과목도 화면이 서야 한다 — 기본 두 칸.
    expect(examSlotsFor("science")).toEqual(["midterm", "final"]);
  });

  it("그 과목에 없는 칸은 첫 칸으로 떨어진다", () => {
    expect(normalizeExamSlot("math", "listening")).toBe("midterm");
    expect(normalizeExamSlot("english", "listening")).toBe("listening");
    expect(normalizeExamSlot("math", "zzz")).toBe("midterm");
    // 🔴 수학 중간·기말은 제 칸 그대로 — 옛 '내신' 주소는 첫 칸(중간고사)으로(원장 2026-10-14).
    expect(normalizeExamSlot("math", "midterm")).toBe("midterm");
    expect(normalizeExamSlot("math", "final")).toBe("final");
    expect(normalizeExamSlot("math", "school")).toBe("midterm");
  });

  it("라벨 왕복 — 엑셀이 이름으로 적혀 와도 읽는다", () => {
    expect(examSlotFromLabel("중간고사")).toBe("midterm");
    expect(examSlotFromLabel(" 듣기 평가 ")).toBe("listening");
    expect(examSlotFromLabel("수행평가")).toBeNull();
    expect(examSlotOptions("english").map((o) => o.label)).toEqual([
      EXAM_SLOT_LABEL.listening,
      EXAM_SLOT_LABEL.midterm,
      EXAM_SLOT_LABEL.final,
      "Monthly Test",
    ]);
  });
});

describe("과목 축(영어만 둘로)", () => {
  it("영어만 두 줄이고 라벨은 학원설정에서 온다", () => {
    expect(axisOptionsFrom(SUBJECT_OPTIONS).map((o) => o.value)).toEqual([
      "math",
      "english:eie",
      "english:injaewon",
      "science",
    ]);
    expect(axisOptionsFrom(SUBJECT_OPTIONS)[1]!.label).toBe("영어 (EiE)");
  });

  it("🔴 저장되는 과목은 english 하나 — 트랙은 축 값에만 실린다", () => {
    const axis = parseAxisValue("english:eie", ["math", "english"]);
    expect(axis).toEqual({ subject: "english", track: "eie" });
    expect(axisValueOf(axis!)).toBe("english:eie");
    expect(parseAxisValue("math", ["math", "english"])).toEqual({ subject: "math", track: null });
  });

  it("모르는 과목은 null, 영어인데 트랙이 없으면 인재원(미분류가 보이는 쪽)", () => {
    expect(parseAxisValue("zzz", ["math"])).toBeNull();
    expect(parseAxisValue("english", ["english"])).toEqual({ subject: "english", track: "injaewon" });
    expect(parseAxisValue("english:zzz", ["english"])).toEqual({ subject: "english", track: "injaewon" });
    expect(firstAxisOf(SUBJECT_OPTIONS)).toEqual({ subject: "math", track: null });
    expect(firstAxisOf([])).toBeNull();
  });
});

describe("주소 해석", () => {
  const opts = { subjectOptions: SUBJECT_OPTIONS, todayIso: "2026-09-22" };

  it("빈 주소 = 오늘이 속한 학기 · 첫 과목 · 첫 시험 칸 · 전체 반", () => {
    const sel = resolveGradeSelection({}, opts)!;
    expect(sel).toMatchObject({
      year: 2026,
      term: 2,
      subject: "math",
      track: null,
      classId: null,
      slot: "midterm",
      maxScore: 100,
    });
    expect(sel.date).toBe("2026-09-22");
    expect(selectionSlotIsValid(sel)).toBe(true);
  });

  it("🔴 시험일은 학기 밖으로 못 나간다 — 나가면 다른 학기 화면에서만 보인다", () => {
    const sel = resolveGradeSelection({ year: "2026", term: "1", date: "2026-09-10" }, opts)!;
    expect(sel.date).toBe("2026-08-31"); // 1학기 끝으로 눌림
    const ok = resolveGradeSelection({ year: "2026", term: "1", date: "2026-05-02" }, opts)!;
    expect(ok.date).toBe("2026-05-02");
  });

  it("반 id는 uuid 모양일 때만 받는다(주소 장난 방지)", () => {
    expect(resolveGradeSelection({ class: "' or 1=1" }, opts)!.classId).toBeNull();
    const uuid = "0f9b3e2a-1c4d-4f6a-9b2e-7d8c5a1b2c3d";
    expect(resolveGradeSelection({ class: uuid }, opts)!.classId).toBe(uuid);
  });

  it("만점은 1~1000만, 그 밖은 기본 100", () => {
    expect(resolveGradeSelection({ max: "50" }, opts)!.maxScore).toBe(50);
    expect(resolveGradeSelection({ max: "0" }, opts)!.maxScore).toBe(100);
    expect(resolveGradeSelection({ max: "-5" }, opts)!.maxScore).toBe(100);
    expect(resolveGradeSelection({ max: "abc" }, opts)!.maxScore).toBe(100);
  });

  it("영어를 고르면 트랙이 함께 서고, 수학엔 트랙이 없다", () => {
    expect(resolveGradeSelection({ subject: "english:eie" }, opts)!).toMatchObject({
      subject: "english",
      track: "eie",
      slot: "listening", // 영어의 첫 칸
    });
    expect(resolveGradeSelection({ subject: "math", slot: "listening" }, opts)!.slot).toBe("midterm");
  });

  it("과목이 하나도 없으면 null(화면이 '과목을 먼저 등록' 안내를 낸다)", () => {
    expect(resolveGradeSelection({}, { subjectOptions: [], todayIso: "2026-09-22" })).toBeNull();
  });
});

describe("제도상 안 치는 시험(원장 2026-09-22)", () => {
  it("🔴 초등학생은 두 학기 모두 중간·기말이 없다 — 빈 칸이 미기입으로 보이면 0을 적게 만든다", () => {
    expect(examAppliesTo("midterm", "초6", 1)).toBe(false);
    expect(examAppliesTo("midterm", "초6", 2)).toBe(false);
    expect(examAppliesTo("final", "초3", 1)).toBe(false);
    // 학원 시험(월말평가)·듣기평가는 학년과 무관하다.
    expect(examAppliesTo("monthly", "초6", 2)).toBe(true);
    expect(examAppliesTo("listening", "초6", 2)).toBe(true);
  });

  it("🔴 중1은 **2학기만** 중간·기말이 없다(원장 2026-09-23) — 1학기는 치므로 명단에 떠야 한다", () => {
    expect(examAppliesTo("midterm", "중1", 1)).toBe(true);
    expect(examAppliesTo("final", "중1", 1)).toBe(true);
    expect(examAppliesTo("midterm", "중1", 2)).toBe(false);
    expect(examAppliesTo("final", "중1", 2)).toBe(false);
    expect(examAppliesTo("midterm", "중2", 2)).toBe(true);
    expect(examAppliesTo("midterm", "고1", 2)).toBe(true);
  });

  it("🔴 모르는 학년은 막지 않는다 — 모른다고 칸을 지우면 실제로 시험 본 학생이 사라진다", () => {
    expect(examAppliesTo("midterm", null, 2)).toBe(true);
    expect(examAppliesTo("midterm", "", 2)).toBe(true);
    expect(examAppliesTo("midterm", "7세", 2)).toBe(true);
  });

  it("학년 판정은 접두로 — `중1-2` 같은 변형도 중1", () => {
    expect(isMiddleFirstGrade("중1-2")).toBe(true);
    expect(isMiddleFirstGrade("중12")).toBe(false); // 두 자리는 다른 학년
    expect(isElementaryGrade(" 초 6 ")).toBe(true);
    expect(notApplicableReason("midterm", "초6", 1)).toMatch(/초등/);
    expect(notApplicableReason("midterm", "중1", 2)).toMatch(/중1/);
    expect(notApplicableReason("midterm", "중1", 1)).toBeNull();
    expect(notApplicableReason("monthly", "초6", 2)).toBeNull();
  });
});

describe("정렬 보기 설정", () => {
  it("🔴 기본은 학년 오름차순이고 '정렬 없음'으로 못 돌아간다(묶음을 없앴으니 유일한 순서다)", () => {
    expect(GRADE_SORT_DEFAULT).toEqual({ key: "grade", dir: "asc" });
    expect(parseGradeSort(undefined)).toEqual(GRADE_SORT_DEFAULT);
    const a = nextGradeSort(GRADE_SORT_DEFAULT, "grade");
    expect(a).toEqual({ key: "grade", dir: "desc" });
    expect(nextGradeSort(a, "grade")).toEqual({ key: "grade", dir: "asc" });
    // 다른 열을 누르면 그 열 오름차순부터.
    expect(nextGradeSort(a, "name")).toEqual({ key: "name", dir: "asc" });
  });

  it("저장값이 망가져 있어도 화면은 뜬다(기본값 폴백)", () => {
    expect(parseGradeSort(undefined)).toEqual(GRADE_SORT_DEFAULT);
    expect(parseGradeSort({ key: "zzz", dir: "sideways" })).toEqual(GRADE_SORT_DEFAULT);
    expect(parseGradeSort({ key: "zzz", dir: "desc" })).toEqual({ key: "grade", dir: "desc" });
    expect(parseGradeSort({ key: "score", dir: "desc" })).toEqual({ key: "score", dir: "desc" });
  });
});

describe("표식 열은 시험마다 다르다(원장 2026-09-23)", () => {
  it("🔴 월말평가는 1차상담 하나 — 학원이 치는 시험이라 성적표를 받아 올 일이 없다", () => {
    expect(gradeMarkKeysFor("monthly")).toEqual(["ask1"]);
  });

  it("나머지 시험은 3칸 그대로(중간·기말·듣기평가·내신)", () => {
    for (const slot of ["midterm", "final", "listening", "school"]) {
      expect(gradeMarkKeysFor(slot)).toEqual(GRADE_MARK_KEYS);
    }
  });

  it("🔴 감추는 것이지 지우는 것이 아니다 — 키 자체는 늘 셋", () => {
    expect(GRADE_MARK_KEYS).toEqual(["ask1", "ask2", "received"]);
  });
});

describe("칸을 지울지 판정(적대적 리뷰 2026-09-23)", () => {
  it("점수도 표식도 '시험없음'도 없으면 지운다", () => {
    expect(gradeCellKeeps({ score: null })).toBe(false);
    expect(gradeCellKeeps({ score: 0 })).toBe(true);
    expect(gradeCellKeeps({ score: null, noExam: true })).toBe(true);
    expect(gradeCellKeeps({ score: null, marks: { ask1: "2026-09-23T00:00:00Z" } })).toBe(true);
    expect(gradeCellKeeps({ score: null, marks: { ask1: null } })).toBe(false);
  });

  it("🔴 이번 저장이 안 건드리는 표식이 켜져 있으면 지우지 않는다 — 부분 패치가 남의 기록을 지웠다", () => {
    // `점수 80 + 2차상담 켜짐`에서 점수만 지우면 패치는 {score:null}뿐이다(2차상담은 안 바뀌어 안 실린다).
    expect(gradeCellKeeps({ score: null })).toBe(false); // 이것이 옛 판정 = 행 삭제 = 2차상담 소실
    expect(gradeCellKeeps({ score: null, otherMarks: true })).toBe(true);
  });

  it("'안 건드리는 표식' 계산 — 패치에 든 키는 빼고 본다", () => {
    const db = { ask1: "t", ask2: "t", received: null };
    expect(hasUntouchedMark(db, undefined)).toBe(true); // 아무것도 안 실었다 → 둘 다 남는다
    expect(hasUntouchedMark(db, { ask1: null })).toBe(true); // ask2가 아직 켜져 있다
    expect(hasUntouchedMark(db, { ask1: null, ask2: null })).toBe(false); // 둘 다 끄는 중
    expect(hasUntouchedMark({ ask1: null, ask2: null, received: null }, undefined)).toBe(false);
  });
});

describe("월 축(원장 2026-09-23)", () => {
  it("🔴 달마다 치는 시험은 월말평가 하나 — 다른 시험에 월을 열면 한 학생의 중간고사가 둘로 갈린다", () => {
    expect(slotUsesMonth("monthly")).toBe(true);
    for (const s of ["midterm", "final", "listening", "school"] as const) {
      expect(slotUsesMonth(s)).toBe(false);
      expect(gradeMonthOf(s, "2026-10-15")).toBe(0);
    }
  });

  it("월은 **시험일에서** 나온다 — 따로 들면 날짜와 어긋난다", () => {
    expect(gradeMonthOf("monthly", "2026-10-15")).toBe(10);
    expect(gradeMonthOf("monthly", "2027-01-05")).toBe(1);
    expect(gradeMonthOf("monthly", "")).toBe(0); // 못 읽으면 '월 미지정'
  });

  it("학기의 달 — 2학기는 9~12월 + 이듬해 1·2월", () => {
    expect(termMonths(1)).toEqual([3, 4, 5, 6, 7, 8]);
    expect(termMonths(2)).toEqual([9, 10, 11, 12, 1, 2]);
  });

  it("🔴 그 달을 고르면 시험일이 그 달로 간다 — 2학기의 1·2월은 **이듬해**다", () => {
    expect(monthAnchorDate(2026, 2, 10, "2026-09-23")).toBe("2026-10-31");
    expect(monthAnchorDate(2026, 2, 1, "2026-09-23")).toBe("2027-01-31");
    expect(monthAnchorDate(2026, 2, 2, "2026-09-23")).toBe("2027-02-28"); // 학기 끝
    // 오늘이 그 달이면 오늘(사람이 대개 오늘 친 시험을 적는다).
    expect(monthAnchorDate(2026, 2, 9, "2026-09-23")).toBe("2026-09-23");
    // 학기 밖으로는 안 나간다.
    expect(monthAnchorDate(2026, 1, 3, "2026-09-23")).toBe("2026-03-31");
  });
});

describe("확인 뷰의 열(원장 2026-09-23)", () => {
  const present = [
    { slot: "monthly" as const, month: 10 },
    { slot: "midterm" as const, month: 0 },
    { slot: "monthly" as const, month: 9 },
    { slot: "monthly" as const, month: 1 },
    { slot: "monthly" as const, month: 10 }, // 같은 달이 여러 학생 → 열은 하나
  ];

  it("🔴 과목의 시험 순서대로, 월말평가는 **학기 순서**로 편다(1·2월은 맨 뒤)", () => {
    const cols = buildOverviewColumns("math", present);
    expect(cols.map((c) => c.key)).toEqual(["midterm", "monthly:9", "monthly:10", "monthly:1"]);
    expect(cols.map((c) => c.label)).toEqual(["중간고사", "9월", "10월", "1월"]);
  });

  it("🔴 값이 없는 칸은 열을 안 세운다 — 안 친 달까지 빈 열로 깔리면 표만 길어진다", () => {
    expect(buildOverviewColumns("math", []).length).toBe(0);
    // 그 과목에 없는 시험(등록만 된 과목의 월말평가)은 남아 있어도 안 세운다.
    expect(buildOverviewColumns("science", [{ slot: "monthly", month: 9 }])).toEqual([]);
  });

  it("평균은 **비율**로 센다 — 만점이 칸마다 다를 수 있다", () => {
    expect(overviewAvgPct([{ score: 80, maxScore: 100, noExam: false }])).toBe(80);
    expect(
      overviewAvgPct([
        { score: 80, maxScore: 100, noExam: false },
        { score: 10, maxScore: 20, noExam: false }, // 50%
      ]),
    ).toBe(65);
    expect(overviewAvgPct([{ score: null, maxScore: 100, noExam: true }])).toBeNull();
    expect(overviewAvgPct([])).toBeNull();
  });

  it("열 키는 월을 쓰는 시험만 월을 단다", () => {
    expect(overviewColumnKey("midterm", 0)).toBe("midterm");
    expect(overviewColumnKey("monthly", 9)).toBe("monthly:9");
  });
});

describe("학년 사다리(두 화면 공용)", () => {
  it("🔴 초 → 중 → 고 오름차순 — 문자열 정렬이면 고1이 맨 앞에 선다", () => {
    const order = ["고2", "중1", "초6", "고1", "중3", "초3"].sort(compareByGrade);
    expect(order).toEqual(["초3", "초6", "중1", "중3", "고1", "고2"]);
  });

  it("학년 축이 아닌 값은 맨 뒤(0으로 접으면 초1보다 앞에 선다)", () => {
    expect(gradeSortRank("7세")).toBeNull();
    expect(gradeSortRank("")).toBeNull();
    expect(gradeSortRank(null)).toBeNull();
    expect(["7세", "중1"].sort(compareByGrade)).toEqual(["중1", "7세"]);
  });

  it("공백은 무시한다(`초 6` = `초6`)", () => {
    expect(gradeSortRank(" 초 6 ")).toBe(gradeSortRank("초6"));
  });
});

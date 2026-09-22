import { describe, expect, it } from "vitest";
import {
  EXAM_SLOT_LABEL,
  examSlotFromLabel,
  examSlotOptions,
  examSlotsFor,
  normalizeExamSlot,
} from "./exam-slots";
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
  it("수학은 중간·기말, 영어는 듣기평가가 앞에 붙는다(원장 2026-09-22)", () => {
    expect(examSlotsFor("math")).toEqual(["midterm", "final"]);
    expect(examSlotsFor("english")).toEqual(["listening", "midterm", "final"]);
    // 등록만 된 다른 과목도 화면이 서야 한다 — 기본 두 칸.
    expect(examSlotsFor("science")).toEqual(["midterm", "final"]);
  });

  it("그 과목에 없는 칸은 첫 칸으로 떨어진다", () => {
    expect(normalizeExamSlot("math", "listening")).toBe("midterm");
    expect(normalizeExamSlot("english", "listening")).toBe("listening");
    expect(normalizeExamSlot("math", "zzz")).toBe("midterm");
  });

  it("라벨 왕복 — 엑셀이 이름으로 적혀 와도 읽는다", () => {
    expect(examSlotFromLabel("중간고사")).toBe("midterm");
    expect(examSlotFromLabel(" 듣기 평가 ")).toBe("listening");
    expect(examSlotFromLabel("수행평가")).toBeNull();
    expect(examSlotOptions("english").map((o) => o.label)).toEqual([
      EXAM_SLOT_LABEL.listening,
      EXAM_SLOT_LABEL.midterm,
      EXAM_SLOT_LABEL.final,
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

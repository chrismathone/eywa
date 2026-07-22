import { describe, expect, it } from "vitest";
import {
  boardKey,
  classKey,
  computeEnglishRates,
  dowOf,
  foldByTeacher,
  sessionDates,
  type EnglishClassInput,
} from "./english-writing";

describe("classKey ↔ boardKey — eywa 반 이름과 ClassNote 보드를 같은 키로", () => {
  it("부서 접두어와 강사 닉네임·요일 꼬리를 떼면 일치한다", () => {
    expect(classKey("중등E_초등 브릿지 C2")).toBe(boardKey("Hannah 초등 브릿지C2 (월화목)"));
    expect(classKey("중등E_중1 정규 A")).toBe(boardKey("Jane 중1 정규A (화수금)"));
    expect(classKey("고등E_고1 특별 S")).toBe(boardKey("Elsa 고1 특별S (금토)"));
  });

  it("EIE 약어를 풀네임 보드와 잇는다", () => {
    expect(classKey("LS2a")).toBe(boardKey("[EIE] Let's Speak 2a (화목금 14:20~16:20)"));
    expect(classKey("MEC1-3")).toBe(boardKey("[EIE] M.E.C 1-3 (화수금 15:00~17:00)"));
    expect(classKey("RTT2")).toBe(boardKey("[EIE] Ready To Talk 2 (화목금 16:20~18:20)"));
  });

  it("보드 이름의 여분 공백에도 견딘다", () => {
    expect(classKey("LS2b")).toBe(boardKey("[EIE]  Let's Speak 2b (화목금 14:20~16:20)"));
  });

  it("다른 반은 다른 키", () => {
    expect(classKey("중등E_중1 정규 A")).not.toBe(classKey("중등E_중1 정규 B"));
    expect(classKey("LS2a")).not.toBe(classKey("LS2b"));
  });
});

describe("dowOf / sessionDates", () => {
  it("요일을 바르게 뽑는다", () => {
    expect(dowOf("2026-07-22")).toBe("wed");
    expect(dowOf("2026-07-25")).toBe("sat");
  });

  it("공휴일을 뺀다", () => {
    const got = sessionDates("2026-07-16", "2026-07-18", new Set(["2026-07-17"]));
    expect(got).toEqual(["2026-07-16", "2026-07-18"]);
  });

  it("공휴일이 없으면 전 구간", () => {
    expect(sessionDates("2026-07-20", "2026-07-22", new Set())).toHaveLength(3);
  });
});

const cls = (over: Partial<EnglishClassInput> = {}): EnglishClassInput => ({
  classId: "c1",
  className: "중등E_중1 정규 A",
  teacher: "추민아",
  dows: ["tue", "wed", "fri"],
  ...over,
});

describe("computeEnglishRates", () => {
  const RANGE = { from: "2026-07-20", to: "2026-07-24" }; // 월~금

  it("수업 요일에 올라온 날만 작성으로 센다", () => {
    // 화·수·금 = 07-21, 07-22, 07-24 → 그중 둘 작성
    const [r] = computeEnglishRates([cls()], [
      { boardName: "Jane 중1 정규A (화수금)", postedOn: "2026-07-21" },
      { boardName: "Jane 중1 정규A (화수금)", postedOn: "2026-07-22" },
    ], RANGE);
    expect(r!.sessions).toBe(3);
    expect(r!.written).toBe(2);
    expect(r!.rate).toBe(67);
    expect(r!.unmatched).toBe(false);
  });

  it("수업 요일이 아닌 날 작성은 offSchedule로 따로 센다 — 시간표 불일치 신호", () => {
    const [r] = computeEnglishRates([cls()], [
      { boardName: "Jane 중1 정규A (화수금)", postedOn: "2026-07-21" }, // 화 — 정상
      { boardName: "Jane 중1 정규A (화수금)", postedOn: "2026-07-20" }, // 월 — 요일 밖
    ], RANGE);
    expect(r!.written).toBe(1);
    expect(r!.offSchedule).toBe(1);
  });

  it("공휴일은 분모에서 빠진다", () => {
    const [r] = computeEnglishRates([cls()], [], { ...RANGE, holidays: ["2026-07-22"] });
    expect(r!.sessions).toBe(2); // 화·금만
  });

  it("보드를 못 찾으면 unmatched — 0%가 아니라 '보드 없음'으로 구분", () => {
    const [r] = computeEnglishRates([cls({ className: "고등E_고3 정규" })], [], RANGE);
    expect(r!.unmatched).toBe(true);
    expect(r!.written).toBe(0);
  });

  it("수업일이 0이면 rate=null — 0%로 표시하면 거짓이다", () => {
    const [r] = computeEnglishRates([cls({ dows: ["sun"] })], [], RANGE);
    expect(r!.sessions).toBe(0);
    expect(r!.rate).toBeNull();
  });

  it("담당 미지정은 '(미지정)'", () => {
    const [r] = computeEnglishRates([cls({ teacher: null })], [], RANGE);
    expect(r!.teacher).toBe("(미지정)");
  });

  it("요일 라벨은 주 순서대로", () => {
    const [r] = computeEnglishRates([cls({ dows: ["fri", "tue", "wed"] })], [], RANGE);
    expect(r!.dowLabel).toBe("화수금");
  });
});

describe("foldByTeacher", () => {
  it("여러 반을 강사로 접고 낮은 작성률부터 정렬", () => {
    const rows = computeEnglishRates(
      [
        cls({ classId: "a", className: "중등E_중1 정규 A", teacher: "추민아" }),
        cls({ classId: "b", className: "중등E_중1 SKY", teacher: "추민아" }),
        cls({ classId: "c", className: "중등E_중2 정규 A", teacher: "정은지" }),
      ],
      [{ boardName: "Jane 중1 정규A (화수금)", postedOn: "2026-07-21" }],
      { from: "2026-07-20", to: "2026-07-24" },
    );
    const folded = foldByTeacher(rows);
    expect(folded.map((f) => f.teacher)).toEqual(["정은지", "추민아"]); // 0% 먼저
    const jane = folded.find((f) => f.teacher === "추민아")!;
    expect(jane.classes).toBe(2);
    expect(jane.sessions).toBe(6);
    expect(jane.written).toBe(1);
    expect(jane.rate).toBe(17);
  });

  it("빈 입력은 빈 배열", () => {
    expect(foldByTeacher([])).toEqual([]);
  });
});

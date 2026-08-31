import { describe, expect, it } from "vitest";
import {
  actualBooksOf,
  isOffGoalRecord,
  offGoalBooksOf,
  offGoalCountByDate,
  sameBookName,
  type MathRecordLike,
  type StudentGoalMap,
} from "./student-goals";

// 실측 — 초등M 개별 JJ1I 2026-08 (담임 허은진, 수요일)
const S = { gong: "공서연", kim: "김승언", park: "박서준" };
const RECORDS: MathRecordLike[] = [
  { studentId: S.gong, date: "2026-08-05", textbook: "가우스 중1-1 2권", progress: "모의고사" },
  { studentId: S.gong, date: "2026-08-12", textbook: "초6-2 최상위 ", progress: "1-1-1 (자연수)÷(자연수)" },
  { studentId: S.gong, date: "2026-08-26", textbook: "초6-2 최상위", progress: "2-4-2 간단한 자연수의 비" },
  { studentId: S.kim, date: "2026-08-05", textbook: "초6-2 쎈 ", progress: "2-5-1 원주와 원주율" },
  { studentId: S.kim, date: "2026-08-12", textbook: "쎈 6-2 ", progress: "2-5-4 원의 넓이" },
  { studentId: S.kim, date: "2026-08-19", textbook: "쎈 초6-2 ", progress: "2-6-4 구 알아보기" },
  { studentId: S.park, date: "2026-08-19", textbook: "프린트 ", progress: "소수와 거듭제곱" },
];

describe("sameBookName — 표기 흔들림은 어긋남이 아니다", () => {
  it("🔴 실측: 어절 순서만 바뀐 같은 책(수학은 학년 표기를 앞뒤 어디에나 붙인다)", () => {
    expect(sameBookName("쎈 초6-2", "초6-2 쎈 ")).toBe(true);
    expect(sameBookName("바이블 3-2", "3-2 바이블")).toBe(true);
    expect(sameBookName("중1-2 개념의 숲", "개념의 숲 중1-2")).toBe(true);
  });

  it("🔴🔴 낱말 경계를 지킨다 — 글자만 같은 다른 학년 책을 합치면 안 된다", () => {
    expect(sameBookName("가우스 중1-1 2권", "가우스 중2-1 1권")).toBe(false);
    expect(sameBookName("중 1-2", "중 2-1")).toBe(false);
    expect(sameBookName("초5-2 발전 1권(22개정)", "초5-1 발전 2권(22개정)")).toBe(false);
    expect(sameBookName("개념+유형 라이트 2-1", "개념+유형 라이트 1-2")).toBe(false);
  });

  it("어절 수가 다르면 순서 규칙을 적용하지 않는다(`쎈 6-2` ⊄ `쎈 초6-2`)", () => {
    expect(sameBookName("쎈 초6-2", "쎈 6-2 ")).toBe(false);
  });

  it("🔴 실측: 괄호·공백만 다른 같은 책", () => {
    expect(sameBookName("초4-2 발전 1권(22개정)", "초4-2발전 1권(22개정)")).toBe(true);
    expect(sameBookName("개념원리 미적분2", "개념원리미적분2")).toBe(true);
    expect(sameBookName("가우스 중2-2 3권", "가우스 중2-2-3권")).toBe(true);
  });

  it("다른 책은 다르다", () => {
    expect(sameBookName("초6-2 최상위", "가우스 중1-1 2권")).toBe(false);
    expect(sameBookName("초6-2 최상위", "프린트")).toBe(false);
  });
});

describe("isOffGoalRecord", () => {
  const goals: StudentGoalMap = {
    [S.gong]: { textbook: "초6-2 최상위", targetProgress: "2단원 비와 비율까지" },
    [S.kim]: { textbook: "쎈 초6-2", targetProgress: null },
  };

  it("목표와 다른 책이면 어긋남", () => {
    expect(isOffGoalRecord(RECORDS[0]!, goals)).toBe(true); // 공서연 8/5 가우스
  });

  it("어절 순서만 다른 같은 책은 어긋남이 아니다", () => {
    expect(isOffGoalRecord(RECORDS[3]!, goals)).toBe(false); // 김승언 8/5 "초6-2 쎈 " ↔ 목표 "쎈 초6-2"
    expect(isOffGoalRecord(RECORDS[5]!, goals)).toBe(false); // 8/19 "쎈 초6-2 "
  });

  it("⚠️ 학년 표기가 빠진 축약(`쎈 6-2`)까지는 못 접는다 — 알려진 한계", () => {
    expect(isOffGoalRecord(RECORDS[4]!, goals)).toBe(true);
  });

  it("🔴 목표가 없으면 판정하지 않는다 — 안 적은 것이 '다른 책'이 되면 안 된다", () => {
    expect(isOffGoalRecord(RECORDS[6]!, goals)).toBe(false); // 박서준은 목표 없음
    expect(isOffGoalRecord(RECORDS[0]!, {})).toBe(false);
  });

  it("🔴 목표 교재가 빈 문자열이어도 판정하지 않는다", () => {
    expect(isOffGoalRecord(RECORDS[0]!, { [S.gong]: { textbook: "", targetProgress: "x" } })).toBe(false);
  });
});

describe("offGoalCountByDate — 날짜가 키다", () => {
  it("어긋난 기록만 날짜별로 센다", () => {
    const goals: StudentGoalMap = {
      [S.gong]: { textbook: "초6-2 최상위", targetProgress: null },
      [S.kim]: { textbook: "쎈 초6-2", targetProgress: null },
    };
    // 공서연 8/5(가우스) + 김승언 8/12("쎈 6-2" 축약 — 위 한계)
    expect(offGoalCountByDate(RECORDS, goals)).toEqual({ "2026-08-05": 1, "2026-08-12": 1 });
  });

  it("목표가 하나도 없으면 빈 객체", () => {
    expect(offGoalCountByDate(RECORDS, {})).toEqual({});
  });
});

describe("actualBooksOf / offGoalBooksOf", () => {
  it("실제로 나간 교재를 등장 순으로, 원문 그대로", () => {
    expect(actualBooksOf(RECORDS, S.gong)).toEqual(["가우스 중1-1 2권", "초6-2 최상위"]);
  });

  it("표기가 갈린 것은 원문을 다 남긴다(표시는 사실 그대로)", () => {
    expect(actualBooksOf(RECORDS, S.kim)).toEqual(["초6-2 쎈", "쎈 6-2", "쎈 초6-2"]);
  });

  it("목표 밖 교재만 추린다", () => {
    const goals: StudentGoalMap = { [S.gong]: { textbook: "초6-2 최상위", targetProgress: null } };
    expect(offGoalBooksOf(RECORDS, S.gong, goals)).toEqual(["가우스 중1-1 2권"]);
  });

  it("목표가 없으면 빈 배열 — 어긋남이라 부를 수 없다", () => {
    expect(offGoalBooksOf(RECORDS, S.park, {})).toEqual([]);
  });
});

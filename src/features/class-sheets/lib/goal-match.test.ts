import { describe, expect, it } from "vitest";
import {
  actualBooksOf,
  isOffGoalLine,
  normalizeBookName,
  offGoalBooksOf,
  offGoalCountByDate,
  sameBookName,
  type MonthGoalMap,
} from "./goal-match";

/** 실측 픽스처 — 중등E_초6 SKY, 2026-08(그 반이 실제로 쓴 표기 그대로). */
const GOALS: MonthGoalMap = {
  vocab: { textbook: "능률 VOCA 중등 고난도", targetProgress: "20강" },
  listening: { textbook: null, targetProgress: null },
  reading: { textbook: "해커스 리딩스마트3", targetProgress: "책 마무리" },
  grammar: { textbook: "그래머인사이드", targetProgress: "책 마무리" },
};

const line = (skillArea: string, textbook: string | null, seat = false) => ({ skillArea, textbook, seat });

describe("normalizeBookName", () => {
  it("공백·기호를 지우고 소문자로", () => {
    expect(normalizeBookName("Grammar Inside 3")).toBe("grammarinside3");
    expect(normalizeBookName("그래머인사이드 3")).toBe("그래머인사이드3");
    expect(normalizeBookName(null)).toBe("");
  });
});

describe("sameBookName — 표기 흔들림은 어긋남이 아니다", () => {
  it("포함 관계면 같은 책(실측 3표기 중 2개가 이 규칙으로 통과)", () => {
    expect(sameBookName("그래머인사이드", "그래머인사이드LV3")).toBe(true);
    expect(sameBookName("그래머인사이드", "그래머인사이드 3")).toBe(true);
  });

  it("정말 다른 책은 다르다", () => {
    expect(sameBookName("해커스 리딩스마트3", "수능딥독")).toBe(false);
  });

  it("한글↔영문 표기까지는 못 잡는다(알려진 한계 — 표기 통일 신호로 남긴다)", () => {
    expect(sameBookName("그래머인사이드", "Grammar Inside 3")).toBe(false);
  });

  it("한쪽이 비면 비교 불가 = 경고 없음", () => {
    expect(sameBookName(null, "수능딥독")).toBe(true);
    expect(sameBookName("해커스 리딩스마트3", "")).toBe(true);
  });
});

describe("isOffGoalLine", () => {
  it("목표와 다른 책이면 어긋남", () => {
    expect(isOffGoalLine(line("reading", "수능딥독"), GOALS)).toBe(true);
  });

  it("목표대로면 아니다", () => {
    expect(isOffGoalLine(line("vocab", "능률 VOCA 중등 고난도"), GOALS)).toBe(false);
  });

  it("🔴 목표가 비어 있으면 판정하지 않는다(안 적은 것이 '다른 책'이 되면 안 된다)", () => {
    expect(isOffGoalLine(line("listening", "능률 중학영어 모고 22회 LV3"), GOALS)).toBe(false);
    expect(isOffGoalLine(line("writing", "쓰작2 서술형"), GOALS)).toBe(false); // 목표 키 자체가 없음
  });

  it("🔴 자리(JJ) 교시는 반 진도가 아니라 대상이 아니다", () => {
    expect(isOffGoalLine(line("vocab", "인재원 SRS", true), GOALS)).toBe(false);
  });

  it("교재를 안 적은 줄도 판정하지 않는다", () => {
    expect(isOffGoalLine(line("reading", null), GOALS)).toBe(false);
  });
});

describe("offGoalCountByDate — 경고는 '날짜' 단위로 센다", () => {
  const lines = [
    { ...line("vocab", "능률 VOCA 중등 고난도"), planDate: "2026-08-05" },
    { ...line("grammar", "그래머인사이드LV3"), planDate: "2026-08-05" }, // 표기 차이 = 통과
    { ...line("reading", "수능딥독"), planDate: "2026-08-05" },
    { ...line("grammar", "Grammar Inside 3"), planDate: "2026-08-19" },
    { ...line("reading", "수능딥독"), planDate: "2026-08-19" },
    { ...line("vocab", "인재원 SRS", true), planDate: "2026-08-20" }, // 자리 = 제외
  ];

  it("어긋난 줄이 있는 날만, 그 날의 건수로", () => {
    expect(offGoalCountByDate(lines, GOALS)).toEqual({ "2026-08-05": 1, "2026-08-19": 2 });
  });

  it("목표를 실제에 맞추면 그 날들이 사라진다(월간뷰에서 고칠 수 있는 이유)", () => {
    const fixed: MonthGoalMap = { ...GOALS, reading: { textbook: "수능딥독", targetProgress: "책 마무리" } };
    expect(offGoalCountByDate(lines, fixed)).toEqual({ "2026-08-19": 1 });
  });
});

describe("actualBooksOf / offGoalBooksOf — 목표 칸 아래 한 줄", () => {
  const lines = [
    line("reading", "수능딥독"),
    line("reading", "수능딥독"), // 중복은 접는다
    line("vocab", "능률 VOCA 중등 고난도"),
    line("vocab", "인재원 SRS", true), // 자리는 반 진도가 아니다
    line("vocab", "  "), // 빈 교재
  ];

  it("실제 진행 교재는 등장 순·중복 제거", () => {
    expect(actualBooksOf(lines, "reading")).toEqual(["수능딥독"]);
    expect(actualBooksOf(lines, "vocab")).toEqual(["능률 VOCA 중등 고난도"]);
  });

  it("목표 밖 교재만 따로", () => {
    expect(offGoalBooksOf(lines, "reading", GOALS)).toEqual(["수능딥독"]);
    expect(offGoalBooksOf(lines, "vocab", GOALS)).toEqual([]);
  });

  it("목표가 없으면 '어긋남'이라 부를 수 없다", () => {
    expect(offGoalBooksOf(lines, "listening", GOALS)).toEqual([]);
  });
});

/**
 * 교재 가져오기 규칙 — 스크립트(`scripts/_oneoff/import-textbooks-from-sheets.mjs`)와 **같은 파일**을 읽는다.
 * 규칙이 두 벌이면 "테스트는 통과인데 DB엔 다른 게 들어간다"가 되므로 여기서 잠근다
 * (재고 가져오기 `inventory-import-rules.mjs` ↔ `inventory-wiring.test.ts` 선례).
 */
import { describe, expect, it } from "vitest";
// 순수 ESM 규칙 파일(.mjs) — 스크립트와 **같은 소스**를 읽는 것이 이 테스트의 핵심이다.
import * as rules from "../../../scripts/_oneoff/import-textbooks-from-sheets.rules.mjs";

const {
  aggregatePlanLines,
  dominantPageTime,
  dominantSkillArea,
  dupKey,
  isNonBookTitle,
  normalizeDuration,
  planImport,
  toTextbookRow,
} = rules as {
  aggregatePlanLines: (rows: { textbook: string | null; skill_area?: string | null; page_range?: string | null }[]) => Map<string, { title: string; count: number; areas: Record<string, number>; pages: Record<string, number> }>;
  dominantPageTime: (counts: Record<string, number>) => string | null;
  dominantSkillArea: (counts: Record<string, number>) => string | null;
  dupKey: (title: string) => string;
  isNonBookTitle: (title: string) => boolean;
  normalizeDuration: (v: string | null) => string | null;
  planImport: (input: { aggregates: Map<string, { title: string; count: number; areas: Record<string, number>; pages: Record<string, number> }>; existingKeys: Set<string>; minCount: number }) => {
    insert: { title: string; skill_area: string | null; page_time: string | null; session_count: number; _count: number }[];
    skipExisting: { title: string }[];
    skipBelowMin: { title: string }[];
    skipNonBook: { title: string }[];
    dupClusters: { title: string }[][];
  };
  toTextbookRow: (agg: { title: string; areas: Record<string, number>; pages: Record<string, number> }) => { subject: string; skill_area: string | null; title: string; page_time: string | null; session_count: number };
};

describe("isNonBookTitle", () => {
  it("교재가 아닌 값만 정확히 일치로 걸러낸다", () => {
    expect(isNonBookTitle("개별교재 / 개별진도")).toBe(true);
    expect(isNonBookTitle("개별교재/개별진도")).toBe(true);
    expect(isNonBookTitle("JJ실")).toBe(true);
    expect(isNonBookTitle(" 6 ")).toBe(true); // 한 글자 잡음
    expect(isNonBookTitle("내신콘서트")).toBe(false);
    // 🔴 부분 일치로 넓히지 말 것 — 진짜 교재가 조용히 사라진다.
    expect(isNonBookTitle("개별교재 워크북")).toBe(false);
  });
});

describe("normalizeDuration", () => {
  it("시간 모양만 통과시키고 공백을 없앤다", () => {
    expect(normalizeDuration("35분")).toBe("35분");
    expect(normalizeDuration("35 분")).toBe("35분");
    expect(normalizeDuration("104")).toBe(null);
    expect(normalizeDuration("2강씩")).toBe(null);
    expect(normalizeDuration("프린트물")).toBe(null);
    expect(normalizeDuration(null)).toBe(null);
  });
});

describe("dominantSkillArea", () => {
  it("가장 많이 쓰인 영역", () => {
    // 실측: 인재원 SRS → vocab 246 / writing 62 / listening 15
    expect(dominantSkillArea({ vocab: 246, writing: 62, listening: 15 })).toBe("vocab");
  });

  it("동률이면 기본 6영역 순서가 이긴다(결정적)", () => {
    expect(dominantSkillArea({ writing: 5, vocab: 5 })).toBe("vocab");
    expect(dominantSkillArea({ speaking: 2, reading: 2 })).toBe("reading");
  });

  it("영역이 하나도 없으면 null", () => {
    expect(dominantSkillArea({})).toBe(null);
  });
});

describe("dominantPageTime", () => {
  it("최빈값이 시간이면 그 시간", () => {
    expect(dominantPageTime({ "35분": 20, "15분": 3 })).toBe("35분");
  });

  it("🔴 최빈값이 쪽수·자유 텍스트면 null — 시간 값 중 최빈을 고르지 않는다", () => {
    expect(dominantPageTime({ "104": 20, "15분": 3 })).toBe(null);
    expect(dominantPageTime({ "2강씩": 9, "30분": 2 })).toBe(null);
  });

  it("빈 값은 세지 않는다", () => {
    expect(dominantPageTime({ "": 100, "25분": 4 })).toBe("25분");
  });
});

describe("dupKey", () => {
  it("공백··-. 만 지운 비교 키", () => {
    expect(dupKey("그래머인사이드 3")).toBe(dupKey("그래머인사이드3"));
    expect(dupKey("인재원 SRS")).toBe(dupKey("인재원SRS"));
    // 🔴 LV1과 1은 다른 책일 수 있으니 같은 키가 되면 안 된다.
    expect(dupKey("그래머인사이드LV1")).not.toBe(dupKey("그래머인사이드1"));
  });
});

describe("aggregatePlanLines", () => {
  it("교재별로 횟수·영역·페이지를 모은다(원문 이름 보존)", () => {
    const agg = aggregatePlanLines([
      { textbook: " 내신콘서트 ", skill_area: "reading", page_range: "35분" },
      { textbook: "내신콘서트", skill_area: "grammar", page_range: "35분" },
      { textbook: "내신콘서트", skill_area: "reading", page_range: "" },
      { textbook: "", skill_area: "vocab", page_range: "15분" },
      { textbook: null, skill_area: "vocab", page_range: "15분" },
    ]);
    expect([...agg.keys()]).toEqual(["내신콘서트"]);
    const row = agg.get("내신콘서트")!;
    expect(row.count).toBe(3);
    expect(row.areas).toEqual({ reading: 2, grammar: 1 });
    expect(row.pages).toEqual({ "35분": 2 });
  });
});

describe("toTextbookRow", () => {
  it("차수는 만들지 않는다(session_count = 0)", () => {
    const row = toTextbookRow({ title: "PL (NTA)", areas: { listening: 134, vocab: 7 }, pages: { "15분": 100 } });
    expect(row).toEqual({ subject: "english", skill_area: "listening", title: "PL (NTA)", page_time: "15분", session_count: 0 });
  });
});

describe("planImport", () => {
  const aggregates = aggregatePlanLines([
    ...Array.from({ length: 5 }, () => ({ textbook: "내신콘서트", skill_area: "reading", page_range: "35분" })),
    ...Array.from({ length: 4 }, () => ({ textbook: "그래머인사이드 3", skill_area: "grammar", page_range: "" })),
    ...Array.from({ length: 3 }, () => ({ textbook: "그래머인사이드3", skill_area: "grammar", page_range: "" })),
    ...Array.from({ length: 2 }, () => ({ textbook: "희귀교재", skill_area: "vocab", page_range: "" })),
    ...Array.from({ length: 9 }, () => ({ textbook: "개별교재 / 개별진도", skill_area: "vocab", page_range: "" })),
  ]);

  it("임계값 미만·교재 아님·이미 있음을 갈라 센다", () => {
    const plan = planImport({ aggregates, existingKeys: new Set(["내신콘서트"]), minCount: 3 });
    expect(plan.insert.map((r) => r.title)).toEqual(["그래머인사이드 3", "그래머인사이드3"]);
    expect(plan.skipExisting.map((r) => r.title)).toEqual(["내신콘서트"]);
    expect(plan.skipBelowMin.map((r) => r.title)).toEqual(["희귀교재"]);
    expect(plan.skipNonBook.map((r) => r.title)).toEqual(["개별교재 / 개별진도"]);
  });

  it("🔴 비슷한 이름은 경고만 — 두 행 모두 그대로 들어간다", () => {
    const plan = planImport({ aggregates, existingKeys: new Set(), minCount: 3 });
    expect(plan.insert.map((r) => r.title)).toContain("그래머인사이드 3");
    expect(plan.insert.map((r) => r.title)).toContain("그래머인사이드3");
    expect(plan.dupClusters).toHaveLength(1);
    expect(plan.dupClusters[0]!.map((a) => a.title).sort()).toEqual(["그래머인사이드 3", "그래머인사이드3"]);
  });

  it("이미 있는 제목은 대소문자·앞뒤 공백을 무시하고 건너뛴다(유니크 인덱스와 같은 키)", () => {
    const one = aggregatePlanLines(Array.from({ length: 5 }, () => ({ textbook: "  Power Voca ", skill_area: "vocab", page_range: "" })));
    const plan = planImport({ aggregates: one, existingKeys: new Set(["power voca"]), minCount: 3 });
    expect(plan.insert).toHaveLength(0);
    expect(plan.skipExisting.map((r) => r.title)).toEqual(["Power Voca"]);
  });
});

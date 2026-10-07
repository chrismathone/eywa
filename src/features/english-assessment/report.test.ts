import { describe, expect, it } from "vitest";
import { scoreArea, wrongAnswerGroups, type ItemResult } from "./area";
import { gradeToLevel } from "./levels";
import { buildPeerGroup, MIN_PEERS, topPercent } from "./peers";
import { buildAssessmentReport, medalOf } from "./report";
import { SAMPLE_ASSESSMENT } from "./sample";
import type { Level } from "./levels";

const items = (level: Level, correct: number, total: number): ItemResult[] =>
  Array.from({ length: total }, (_, i) => ({ level, correct: i < correct }));

describe("학년 → 기대 수준", () => {
  it("흔한 꼴을 읽고 모르면 null", () => {
    expect(gradeToLevel("중1")).toBe(4);
    expect(gradeToLevel("중학교 1학년")).toBe(4);
    expect(gradeToLevel("초등학교 4학년")).toBe(2);
    expect(gradeToLevel("초6")).toBe(3);
    expect(gradeToLevel("고3")).toBe(9);
    expect(gradeToLevel("7세")).toBe(1);
    expect(gradeToLevel("재수")).toBeNull();
    expect(gradeToLevel(null)).toBeNull();
  });
});

describe("영역 도달 수준 — 낮은 수준부터 기준 정답률(60%)을 넘는 데까지", () => {
  it("L2까지 넘고 L3에서 멈춤 + 다음 수준 진척", () => {
    const r = scoreArea("grammar", [...items(1, 4, 4), ...items(2, 4, 6), ...items(3, 2, 6)]);
    expect(r.level).toBe(2);
    expect(r.nextLevelRate).toBeCloseTo(2 / 6);
    expect(r.rate).toBeCloseTo(10 / 16);
  });
  it("문항이 한 개뿐인 수준은 판정에서 건너뛴다(우연이 크다)", () => {
    const r = scoreArea("vocab", [...items(1, 3, 3), ...items(2, 0, 1), ...items(3, 2, 2)]);
    expect(r.level).toBe(3);
  });
  it("하나도 못 넘으면 L1, 문항이 없으면 null", () => {
    expect(scoreArea("reading", items(3, 0, 4)).level).toBe(1);
    expect(scoreArea("reading", []).level).toBeNull();
  });
});

describe("오답 분석", () => {
  it("유형별로 묶어 많이 틀린 순", () => {
    const g = wrongAnswerGroups([
      { area: "grammar", level: 3, correct: false, tag: "현재완료" },
      { area: "grammar", level: 3, correct: false, tag: "현재완료" },
      { area: "reading", level: 2, correct: false, tag: "주제 찾기" },
      { area: "reading", level: 2, correct: true, tag: "주제 찾기" },
      { area: "vocab", level: 1, correct: false },
    ]);
    expect(g.map((x) => [x.tag, x.wrong, x.total])).toEqual([
      ["현재완료", 2, 2],
      ["어휘", 1, 1],
      ["주제 찾기", 1, 2],
    ]);
  });
});

describe("동학년 비교 — 인원이 적으면 석차를 내지 않는다", () => {
  it(`${MIN_PEERS}명 미만이면 null`, () => {
    expect(buildPeerGroup([4, 4, 5])).toBeNull();
  });
  it("상위 % = 나 이상 비율(같은 수준은 같은 석차)", () => {
    const g = buildPeerGroup([1, 2, 2, 3, 4, 4, 4, 5, 6, 7])!;
    expect(topPercent(g, 7)).toBe(10);
    expect(topPercent(g, 4)).toBe(60);
    expect(topPercent(g, 1)).toBe(100);
  });
});

describe("메달 — 시험 전체 정답률", () => {
  it("90/80/70 문턱", () => {
    expect(medalOf(0.95)).toBe("gold");
    expect(medalOf(0.8)).toBe("silver");
    expect(medalOf(0.7)).toBe("bronze");
    expect(medalOf(0.69)).toBeNull();
    expect(medalOf(null)).toBeNull();
  });
});

describe("예시 학생(시안) — 레퍼런스와 같은 모양", () => {
  const r = buildAssessmentReport(SAMPLE_ASSESSMENT);
  it("영역 수준: 어휘·문법·독해 초3~4, 듣기 중1 → 종합 Lv.2", () => {
    expect(r.areas.map((a) => [a.area, a.level])).toEqual([
      ["vocab", 2],
      ["grammar", 2],
      ["listening", 4],
      ["reading", 2],
    ]);
    expect(r.overall?.level).toBe(2);
    expect(r.vsGrade).toEqual({ expected: 4, diff: -2 });
  });
  it("동학년 석차·숙제·동사변화", () => {
    expect(r.peers?.size).toBe(30);
    expect(r.peers?.topPercent).toBe(97);
    expect(r.homework?.rate).toBeCloseTo(0.9);
    expect(r.verbs).toMatchObject({ correct: 13, total: 16 }); // 틀린 3칸: writed · buyed · token
  });
  it("풀이 문장은 숫자에서만 — 이름·전체 정답률·학년 대비·다음 목표", () => {
    expect(r.summary[0]).toContain("김예시 학생은 이번 평가에서 전체");
    expect(r.summary.join(" ")).toContain("학년 기준보다 2단계 아래");
    expect(r.summary.at(-1)).toBe("다음 목표는 문법을 초5~6 수준으로 올리는 것입니다 (현재 그 수준 문항 33% 정답).");
  });
  it("선생님 코멘트는 그대로", () => {
    expect(r.teacherComment).toBe(SAMPLE_ASSESSMENT.teacherComment);
  });
  it("재료가 없으면 블록은 null(지어내지 않는다)", () => {
    const empty = buildAssessmentReport({ ...SAMPLE_ASSESSMENT, items: [], homework: null, verbForms: [], peerLevels: [], vocabSize: null });
    expect(empty.overall).toBeNull();
    expect(empty.summary).toEqual([]);
    expect(empty.homework).toBeNull();
    expect(empty.verbs).toBeNull();
    expect(empty.peers).toBeNull();
    expect(empty.vocab).toBeNull();
  });
});

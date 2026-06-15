import { describe, it, expect } from "vitest";
import {
  scoreStudent,
  renewalOf,
  ownerFor,
  primaryAction,
  levelLabel,
  includesAny,
  type RetentionSignals,
} from "./risk";

function signals(overrides: Partial<RetentionSignals> = {}): RetentionSignals {
  return {
    lastScore: 90,
    previousScore: 90,
    homeworkRate: 100,
    previousHomeworkRate: null,
    absences: 0,
    lateCount: 0,
    daysSinceCounsel: 5,
    parentSignalText: "",
    monthlyFee: 500000,
    enrollmentEndsInDays: null,
    ...overrides,
  };
}

describe("scoreStudent — 기본/등급 경계", () => {
  it("신호 없는 학생은 안정(ok), 점수 0", () => {
    const r = scoreStudent(signals());
    expect(r.score).toBe(0);
    expect(r.level).toBe("ok");
    expect(r.reasons).toEqual(["뚜렷한 위험 신호 없음"]);
  });

  it("점수 35 미만은 ok, 35~59는 warn, 60+는 risk", () => {
    // 결석2(12) + 상담공백30(10) + 숙제율<75(10) = 32 → ok
    expect(scoreStudent(signals({ absences: 2, daysSinceCounsel: 30, homeworkRate: 70 })).level).toBe("ok");
    // 성적8하락(20) + 상담공백45(15) = 35 → warn
    expect(scoreStudent(signals({ previousScore: 88, lastScore: 80, daysSinceCounsel: 45 })).level).toBe("warn");
    // 성적15하락(30) + 숙제율<60(20) + 결석3(20) = 70 → risk
    expect(scoreStudent(signals({ previousScore: 90, lastScore: 75, homeworkRate: 50, absences: 3 })).level).toBe("risk");
  });
});

describe("scoreStudent — 성적 하락 티어", () => {
  it("4/8/15점 하락 = 10/20/30점", () => {
    expect(scoreStudent(signals({ previousScore: 90, lastScore: 86 })).score).toBe(10);
    expect(scoreStudent(signals({ previousScore: 90, lastScore: 82 })).score).toBe(20);
    expect(scoreStudent(signals({ previousScore: 90, lastScore: 75 })).score).toBe(30);
  });
  it("성적 기록 없으면 하락 0", () => {
    const r = scoreStudent(signals({ lastScore: null, previousScore: null }));
    expect(r.scoreDrop).toBe(0);
  });
});

describe("scoreStudent — 숙제/출결/상담", () => {
  it("숙제율 60 미만 20점, 75 미만 10점", () => {
    expect(scoreStudent(signals({ homeworkRate: 55 })).score).toBe(20);
    expect(scoreStudent(signals({ homeworkRate: 70 })).score).toBe(10);
  });
  it("숙제 기록 없음은 0점이지만 사유에 표기", () => {
    const r = scoreStudent(signals({ homeworkRate: null }));
    expect(r.score).toBe(0);
    expect(r.reasons).toContain("숙제 기록 없음");
  });
  it("숙제율 20%p 하락 시 +10점", () => {
    // previousHomeworkRate 100 → homeworkRate 78: drop 22 (>=20) = 10. homeworkRate 78 ≥75라 등급가산 없음.
    expect(scoreStudent(signals({ previousHomeworkRate: 100, homeworkRate: 78 })).score).toBe(10);
  });
  it("결석 3회 20점, 2회 12점, 지각 3회 10점", () => {
    expect(scoreStudent(signals({ absences: 3 })).score).toBe(20);
    expect(scoreStudent(signals({ absences: 2 })).score).toBe(12);
    expect(scoreStudent(signals({ lateCount: 3 })).score).toBe(10);
  });
  it("상담 이력 없음 10점, 공백 45일 15점, 30일 10점", () => {
    expect(scoreStudent(signals({ daysSinceCounsel: null })).score).toBe(10);
    expect(scoreStudent(signals({ daysSinceCounsel: 45 })).score).toBe(15);
    expect(scoreStudent(signals({ daysSinceCounsel: 30 })).score).toBe(10);
  });
});

describe("scoreStudent — 학부모 신호 + 하한 보정", () => {
  it("환불/퇴원 신호는 최소 위험도 60으로 보정 + risk", () => {
    const r = scoreStudent(signals({ parentSignalText: "환불 문의 있었음" }));
    expect(r.score).toBe(60);
    expect(r.level).toBe("risk");
  });
  it("하한 보정도 factor 행으로 물질화 → Σpoints === score", () => {
    const r = scoreStudent(signals({ parentSignalText: "퇴원 고민 중" }));
    const sum = r.factors.reduce((s, f) => s + f.points, 0);
    expect(sum).toBe(r.score);
  });
  it("일반적으로도 Σpoints === score 불변식", () => {
    const r = scoreStudent(signals({ previousScore: 90, lastScore: 70, homeworkRate: 50, absences: 3, daysSinceCounsel: 45 }));
    const sum = r.factors.reduce((s, f) => s + f.points, 0);
    expect(sum).toBe(r.score);
    expect(r.score).toBeLessThanOrEqual(100);
  });
});

describe("renewalOf", () => {
  it("위험 점수/이탈 키워드 → 낮음(risk)", () => {
    expect(renewalOf(60, "", 0, null).tone).toBe("risk");
    expect(renewalOf(0, "환불 고민", 0, null).tone).toBe("risk");
  });
  it("중간 점수/상담공백/수강 임박 → 보통(warn)", () => {
    expect(renewalOf(40, "", 0, null).tone).toBe("warn");
    expect(renewalOf(0, "", 50, null).tone).toBe("warn");
    expect(renewalOf(0, "", 0, 14).tone).toBe("warn");
  });
  it("신호 없으면 높음(ok)", () => {
    expect(renewalOf(0, "", 5, 90).tone).toBe("ok");
  });
});

describe("보조 함수", () => {
  it("ownerFor: 위험=원장, 관심=강사명, 안정=정기관리", () => {
    expect(ownerFor("risk", "김강사")).toBe("원장 직접");
    expect(ownerFor("warn", "김강사")).toBe("김강사 강사");
    expect(ownerFor("warn", null)).toBe("담당 강사");
    expect(ownerFor("ok", "김강사")).toBe("정기 관리");
  });
  it("primaryAction: 위험+성적하락 vs 위험, 숙제, 관심, 안정", () => {
    expect(primaryAction(scoreStudent(signals({ previousScore: 90, lastScore: 70, parentSignalText: "환불" })), 100)).toContain("24시간");
    expect(primaryAction(scoreStudent(signals({ parentSignalText: "퇴원" })), 100)).toContain("원장 직접");
    expect(primaryAction(scoreStudent(signals({ absences: 2, daysSinceCounsel: 30 })), 60)).toContain("숙제");
    expect(primaryAction(scoreStudent(signals()), 100)).toBe("정기 리포트 유지");
  });
  it("levelLabel / includesAny", () => {
    expect(levelLabel("risk")).toBe("위험");
    expect(includesAny("환불 문의", ["환불"])).toBe(true);
    expect(includesAny("정상", ["환불"])).toBe(false);
  });
});

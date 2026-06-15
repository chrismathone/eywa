import { describe, it, expect } from "vitest";
import { buildRoster, summarizeRoster } from "./roster";
import { generateRetentionFixture } from "./fixtures";

const TODAY = new Date("2026-06-15T00:00:00Z");

describe("buildRoster — 가상 시드 통합 파이프라인", () => {
  const { data, cases } = generateRetentionFixture(10, TODAY);
  const roster = buildRoster(data, TODAY);
  const byId = new Map(roster.map((r) => [r.id, r]));

  it("재원생 전원이 명단에 오른다", () => {
    expect(roster).toHaveLength(10);
  });

  it("위험도 내림차순 정렬", () => {
    for (let i = 1; i < roster.length; i++) {
      expect(roster[i - 1].risk.score).toBeGreaterThanOrEqual(roster[i].risk.score);
    }
  });

  it("아키타입별 기대 위험 등급이 모두 일치", () => {
    for (const c of cases) {
      const r = byId.get(c.id);
      expect(r, `${c.id}(${c.archetype}) 누락`).toBeDefined();
      expect(r!.risk.level, `${c.name} ${c.archetype}`).toBe(c.expect);
    }
  });

  it("등급 분포: 위험 4 · 관심 4 · 안정 2", () => {
    const s = summarizeRoster(roster);
    expect(s).toMatchObject({ total: 10, risk: 4, warn: 4, ok: 2 });
  });

  it("환불 신호 학생: 점수 60으로 하한 보정 + 재등록 전망 '낮음'", () => {
    const refund = cases.find((c) => c.archetype === "환불신호")!;
    const r = byId.get(refund.id)!;
    expect(r.risk.score).toBe(60);
    expect(r.risk.level).toBe("risk");
    expect(r.risk.renewal.tone).toBe("risk");
  });

  it("성적 급락 학생: 성적 사유 + 원장 직접 + 24시간 액션", () => {
    const drop = cases.find((c) => c.archetype === "성적급락")!;
    const r = byId.get(drop.id)!;
    expect(r.risk.reasons.some((x) => x.startsWith("성적"))).toBe(true);
    expect(r.owner).toBe("원장 직접");
    expect(r.primaryAction).toContain("24시간");
  });

  it("안정 학생: 다음 연락 예약 잡혀 있음(follow-up)", () => {
    const stable = cases.find((c) => c.archetype === "안정")!;
    const r = byId.get(stable.id)!;
    expect(r.risk.level).toBe("ok");
    expect(r.nextContactDate).toBeTruthy();
  });

  it("KPI 집계: 상담 예약 2 · 재등록 위험 4 · 매출 위험 > 0", () => {
    const s = summarizeRoster(roster);
    expect(s.scheduled).toBe(2);
    expect(s.renewalRisk).toBe(4);
    expect(s.revenueRisk).toBeGreaterThan(0);
  });

  it("담당강사명이 매핑된다", () => {
    expect(roster.every((r) => !!r.teacherName)).toBe(true);
  });

  it("결정적: 같은 입력이면 같은 결과", () => {
    const again = buildRoster(generateRetentionFixture(10, TODAY).data, TODAY);
    expect(again.map((r) => `${r.id}:${r.risk.score}`)).toEqual(
      roster.map((r) => `${r.id}:${r.risk.score}`),
    );
  });
});

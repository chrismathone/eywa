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

// 2026-07-21 회귀: 출석부 숙제 체크박스가 실사용 0건이라 전원 "숙제 기록 없음"이 붙고, 그게 일일 브리핑
// 스포트라이트로 흘러 원장 화면에 사실과 반대로 보고됐다. 숙제 신호는 수업보고서가 1순위여야 한다.
describe("buildRoster — 숙제 신호는 수업보고서(homework_score)가 1순위", () => {
  const base = () => {
    const { data } = generateRetentionFixture(1, TODAY);
    // 출석부의 숙제 표시를 전부 끔 = injaewon 실데이터(homework_required=true 0건) 재현.
    data.attendance = data.attendance.map((a) => ({ ...a, homework_required: false, homework_done: false }));
    return data;
  };
  const iso = (daysAgo: number) => new Date(TODAY.getTime() - daysAgo * 86_400_000).toISOString().slice(0, 10);
  const sid = "stu-001";

  it("출석부가 비어도 수업보고서가 있으면 '숙제 기록 없음'이 붙지 않는다", () => {
    const data = base();
    data.reportHomework = [
      { student_id: sid, report_date: iso(2), homework_score: "90%" },
      { student_id: sid, report_date: iso(5), homework_score: "100%" },
    ];
    const r = buildRoster(data, TODAY)[0];
    expect(r.signals.homeworkRate).toBe(95);
    expect(r.risk.reasons).not.toContain("숙제 기록 없음");
  });

  it("원스크린 선택지(완료/미제출)도 이행률로 반영된다", () => {
    const data = base();
    data.reportHomework = [
      { student_id: sid, report_date: iso(1), homework_score: "미제출" },
      { student_id: sid, report_date: iso(3), homework_score: "미제출" },
    ];
    const r = buildRoster(data, TODAY)[0];
    expect(r.signals.homeworkRate).toBe(0);
    expect(r.risk.reasons).toContain("숙제율 0%");
    expect(r.primaryAction).toBeTruthy();
  });

  it("보고서·출석부 둘 다 없을 때만 '숙제 기록 없음'", () => {
    const data = base();
    data.reportHomework = [];
    const r = buildRoster(data, TODAY)[0];
    expect(r.signals.homeworkRate).toBeNull();
    expect(r.risk.reasons).toContain("숙제 기록 없음");
  });

  it("보고서가 없으면 출석부로 폴백(체크박스를 쓰기 시작해도 동작)", () => {
    const { data } = generateRetentionFixture(1, TODAY); // 출석부 숙제 표시 살아 있음
    data.reportHomework = [];
    const r = buildRoster(data, TODAY)[0];
    expect(r.signals.homeworkRate).not.toBeNull();
  });

  it("최근 절반이 이전보다 나빠지면 하락폭이 잡힌다", () => {
    const data = base();
    data.reportHomework = [
      { student_id: sid, report_date: iso(2), homework_score: "50%" }, // 최근(15일 이내)
      { student_id: sid, report_date: iso(25), homework_score: "100%" }, // 이전
    ];
    const r = buildRoster(data, TODAY)[0];
    expect(r.signals.homeworkRate).toBe(50);
    expect(r.signals.previousHomeworkRate).toBe(100);
    expect(r.risk.homeworkDrop).toBe(50);
  });
});

import { describe, expect, it } from "vitest";
import {
  buildDashboardPlan,
  planIncludes,
  type DashboardAreas,
  type DashboardPlan,
} from "./layout-plan";

const NONE: DashboardAreas = {
  attendance: false,
  billing: false,
  students: false,
  consultations: false,
  staff: false,
  briefing: false,
  newcomers: false,
  retention: false,
  lessonReports: false,
};
const ALL: DashboardAreas = {
  attendance: true,
  billing: true,
  students: true,
  consultations: true,
  staff: true,
  briefing: true,
  newcomers: true,
  retention: true,
  lessonReports: true,
};
const areas = (over: Partial<DashboardAreas>): DashboardAreas => ({ ...NONE, ...over });
const keys = <K extends string>(lane: { key: K }[]) => lane.map((c) => c.key);
const lanes = (p: DashboardPlan) => [p.kpis, p.care, p.body, p.charts];

/** 권한 9갈래의 전수 조합(512) — 새 갈래를 더하면 이 목록에도 더할 것. */
const FLAGS = [
  "attendance",
  "billing",
  "students",
  "consultations",
  "staff",
  "briefing",
  "newcomers",
  "retention",
  "lessonReports",
] as const satisfies readonly (keyof DashboardAreas)[];

function allCombos(): DashboardAreas[] {
  const out: DashboardAreas[] = [];
  for (let mask = 0; mask < 1 << FLAGS.length; mask++) {
    const a = { ...NONE };
    FLAGS.forEach((flag, i) => {
      a[flag] = !!(mask & (1 << i));
    });
    out.push(a);
  }
  return out;
}

describe("한 화면 격자 계획", () => {
  it("어느 권한 조합이든 각 행의 span 합은 12다(빈 행 제외)", () => {
    // 🔑 여기가 이 모듈의 핵심 계약이다 — 합이 12가 아니면 바탕화면에 빈 띠가 생기거나 칸이 넘쳐
    //    스크롤이 난다(원장 지시 "스크롤 없이 한 화면"의 실패 모드).
    const bad: string[] = [];
    for (const a of allCombos()) {
      for (const lane of lanes(buildDashboardPlan(a))) {
        if (lane.length === 0) continue;
        const sum = lane.reduce((n, c) => n + c.span, 0);
        if (sum !== 12) bad.push(`${JSON.stringify(a)} → ${keys(lane).join("+")} = ${sum}`);
      }
    }
    expect(bad, bad.join("\n")).toEqual([]);
  });

  it("한 행에 다섯 칸을 세우지 않는다", () => {
    for (const a of allCombos()) {
      for (const lane of lanes(buildDashboardPlan(a))) expect(lane.length).toBeLessThanOrEqual(4);
    }
  });

  it("칸이 하나라도 서면 empty가 아니다 — 새 행이 통째로 안 뜨는 회귀 방지", () => {
    for (const a of allCombos()) {
      const p = buildDashboardPlan(a);
      const hasCell = lanes(p).some((lane) => lane.length > 0);
      expect(p.empty, JSON.stringify(a)).toBe(!hasCell);
    }
  });

  // 2026-09-10 재설계(codex·grok 합의, 원장 승인): 같은 값을 두 번 적던 칸 셋을 걷었다 —
  // 상단 '오늘 할 일' KPI(아래 목록과 같은 숫자) · '우선 확인'(할 일 목록과 글자까지 겹침) ·
  // '오늘 브리핑' 산문(문단의 23건과 목록의 21명이 단위가 달라 서로를 부정했다).
  it("전권한 = KPI 3 · 신규생·위험 2(균등 6/6) · 본문 2(6/6) · 차트 2", () => {
    const p = buildDashboardPlan(ALL);
    expect(keys(p.kpis)).toEqual(["students", "attendance", "billing"]);
    expect(keys(p.care)).toEqual(["care", "risk"]);
    // 🔴 이 행만 균등이다 — 두 칸이 같은 모양(라벨+숫자+사유)이라 5/4로 나누면 위험 칸 사유가 잘린다.
    expect(p.care.map((c) => c.span)).toEqual([6, 6]);
    expect(keys(p.body)).toEqual(["todo", "watchlist"]);
    expect(p.body.map((c) => c.span)).toEqual([6, 6]);
    expect(keys(p.charts)).toEqual(["attendance7d", "enroll4w"]);
    // 🔴 미납 상위 목록은 전권한 화면에선 버린다(수납 타일 하나로 충분하다).
    expect(planIncludes(p, "outstanding")).toBe(false);
    // 🔴 걷어낸 셋이 되살아나지 않는다.
    expect(planIncludes(p, "briefing" as never)).toBe(false);
  });

  it("출결만 — 타일 하나 · 7일 선이 12열 · 4주 막대 없음", () => {
    const p = buildDashboardPlan(areas({ attendance: true }));
    expect(keys(p.kpis)).toEqual(["attendance"]);
    expect(keys(p.charts)).toEqual(["attendance7d"]);
    expect(p.charts[0].span).toBe(12);
    // 학생을 못 보는 사람에게 이름 목록을 세우지 않는다.
    expect(planIncludes(p, "watchlist")).toBe(false);
    // 출결 위험은 출결 재료라 위험 줄은 선다(퇴원위험 칸 없이 혼자).
    expect(keys(p.care)).toEqual(["risk"]);
  });

  it("수납만 — 타일 하나 전폭 + 미납 상위 목록을 본문으로 되살린다", () => {
    const p = buildDashboardPlan(areas({ billing: true }));
    expect(keys(p.kpis)).toEqual(["billing"]);
    expect(p.kpis[0].span).toBe(12);
    expect(keys(p.body)).toEqual(["todo", "outstanding"]);
    // 볼 수 있는 과거 데이터가 없으니 차트 행은 아예 없다(빈 상자를 세우지 않는다).
    expect(p.charts).toEqual([]);
    // 신규생·위험 재료가 하나도 없으면 그 행도 통째로 없다.
    expect(p.care).toEqual([]);
  });

  it("학생만 — 재원생 타일 + 4주 막대, 살펴볼 학생은 없다", () => {
    const p = buildDashboardPlan(areas({ students: true }));
    expect(keys(p.kpis)).toEqual(["students"]);
    expect(keys(p.charts)).toEqual(["enroll4w"]);
    // 결석·상담 둘 다 못 보면 '살펴볼 학생'에 담을 근거가 없다.
    expect(planIncludes(p, "watchlist")).toBe(false);
  });

  it("신규생만 — 케어 칸 하나가 12열을 다 쓴다", () => {
    const p = buildDashboardPlan(areas({ newcomers: true }));
    expect(keys(p.care)).toEqual(["care"]);
    expect(p.care.map((c) => c.span)).toEqual([12]);
    expect(p.empty).toBe(false);
    // 🔴 학생 열람이 더해져도 케어 칸은 하나다 — '우선 확인'은 걷어냈다(할 일 목록과 중복이었다).
    const both = buildDashboardPlan(areas({ newcomers: true, students: true }));
    expect(keys(both.care)).toEqual(["care"]);
  });

  it("퇴원위험 칸은 브리핑 열람이 함께 있을 때만 — payload가 그 칸의 유일한 재료다", () => {
    // retention 메뉴만 열려 있고 브리핑을 못 보면 숫자를 가져올 곳이 없다 → 칸을 세우지 않는다.
    expect(buildDashboardPlan(areas({ retention: true })).care).toEqual([]);
    expect(keys(buildDashboardPlan(areas({ retention: true, briefing: true })).care)).toEqual(["risk"]);
    // 브리핑만으로는 안 선다(retention 메뉴가 닫힌 학원의 payload엔 그 값이 없다).
    expect(buildDashboardPlan(areas({ briefing: true })).care).toEqual([]);
  });

  it("수업보고서만 봐도 위험 줄은 선다 — 숙제·학부모 확인의 재료가 거기다", () => {
    expect(keys(buildDashboardPlan(areas({ lessonReports: true })).care)).toEqual(["risk"]);
  });

  it("🔴 '오늘 할 일' KPI는 세우지 않는다 — 바로 아래 같은 이름의 목록이 같은 숫자를 푼다", () => {
    expect(keys(buildDashboardPlan(areas({ attendance: true })).kpis)).toEqual(["attendance"]);
    expect(keys(buildDashboardPlan(areas({ attendance: true, students: true })).kpis)).toEqual([
      "students",
      "attendance",
    ]);
    // 타일이 하나도 없는 권한(상담만)에서도 목록은 선다 — 신호는 있는데 셀 타일이 없을 뿐이다.
    const only = buildDashboardPlan(areas({ consultations: true }));
    expect(only.kpis).toEqual([]);
    expect(keys(only.body)).toEqual(["todo"]);
  });

  it("브리핑 플래그가 꺼지면 그 칸만 빠지고 남은 칸이 폭을 먹는다", () => {
    const p = buildDashboardPlan({ ...ALL, briefing: false });
    expect(keys(p.body)).toEqual(["todo", "watchlist"]);
    expect(p.body.map((c) => c.span)).toEqual([6, 6]);
  });

  it("아무 권한도 없으면 empty — 빈 격자를 그리지 않는다", () => {
    const p = buildDashboardPlan(NONE);
    expect(p.empty).toBe(true);
    expect(lanes(p).every((l) => l.length === 0)).toBe(true);
  });
});

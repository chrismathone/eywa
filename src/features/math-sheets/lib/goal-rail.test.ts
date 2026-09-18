import { describe, expect, it } from "vitest";
import { buildGoalRail, railDiffLabel, railX, RAIL_TOLERANCE } from "./goal-rail";

const DAYS = ["2026-08-03", "2026-08-06", "2026-08-10", "2026-08-13", "2026-08-17", "2026-08-20", "2026-08-24", "2026-08-27"];
const P = (date: string, position: number) => ({ date, position });

describe("buildGoalRail — Start·Plan·Now·End", () => {
  it("🔴 위치가 한 번도 안 잡혔으면 판정하지 않는다(no-data)", () => {
    const r = buildGoalRail({ startBefore: null, goalEnd: 500, points: [], dayDates: DAYS, today: "2026-08-20" });
    expect(r.status).toBe("no-data");
    expect(r.diff).toBeNull();
    expect(r.progressPct).toBeNull();
  });

  it("🔴 목표가 없으면 경고가 아니라 no-goal — 움직인 폭은 말한다", () => {
    const r = buildGoalRail({
      startBefore: 470,
      goalEnd: null,
      points: [P("2026-08-03", 472), P("2026-08-13", 480)],
      dayDates: DAYS,
      today: "2026-08-20",
    });
    expect(r.status).toBe("no-goal");
    expect(r.moved).toBe(10);
    expect(r.diff).toBeNull();
    expect(railDiffLabel(r)).toBeNull();
  });

  it("계획 = Start~End를 수업일로 등분 · 4/8 지났으면 절반", () => {
    // Start 470 → End 490(20블록). 8일 중 4일 지남 → Plan 480.
    const r = buildGoalRail({
      startBefore: 470,
      goalEnd: 490,
      points: [P("2026-08-03", 472), P("2026-08-13", 478)],
      dayDates: DAYS,
      today: "2026-08-13",
    });
    expect(r.elapsedDays).toBe(4);
    expect(r.plan).toBe(480);
    expect(r.now).toBe(478);
    expect(r.diff).toBe(-2);
    expect(r.status).toBe("behind");
    expect(r.progressPct).toBe(40);
    expect(railDiffLabel(r)).toBe("2블록 느림");
  });

  it("🔴 ±1블록는 계획대로 — 한 블록를 두 번에 나눠 하는 건 정상이다", () => {
    expect(RAIL_TOLERANCE).toBe(1);
    const r = buildGoalRail({
      startBefore: 470,
      goalEnd: 490,
      points: [P("2026-08-13", 479)],
      dayDates: DAYS,
      today: "2026-08-13",
    });
    expect(r.diff).toBe(-1);
    expect(r.status).toBe("on");
    expect(railDiffLabel(r)).toBe("계획대로");
  });

  it("계획보다 앞서면 ahead", () => {
    const r = buildGoalRail({
      startBefore: 470,
      goalEnd: 490,
      points: [P("2026-08-13", 485)],
      dayDates: DAYS,
      today: "2026-08-13",
    });
    expect(r.status).toBe("ahead");
    expect(railDiffLabel(r)).toBe("5블록 빠름");
  });

  it("목표에 닿으면 done — 그 뒤로 더 나가도 느리다고 하지 않는다", () => {
    const r = buildGoalRail({
      startBefore: 470,
      goalEnd: 490,
      points: [P("2026-08-13", 492)],
      dayDates: DAYS,
      today: "2026-08-13",
    });
    expect(r.status).toBe("done");
    expect(r.progressPct).toBe(100);
    expect(railDiffLabel(r)).toBe("목표 도달 (+2블록)");
  });

  it("🔴 아직 수업이 한 번도 안 지났으면 판정하지 않는다(not-started)", () => {
    const r = buildGoalRail({
      startBefore: 470,
      goalEnd: 490,
      points: [],
      dayDates: DAYS,
      today: "2026-08-01",
    });
    expect(r.status).toBe("not-started");
    expect(r.diff).toBeNull();
    expect(r.plan).toBe(470);
  });

  it("🔴 목표가 시작 위치보다 앞이 아니면 goal-behind — 견줄 구간이 없다", () => {
    const r = buildGoalRail({
      startBefore: 490,
      goalEnd: 480,
      points: [P("2026-08-03", 491)],
      dayDates: DAYS,
      today: "2026-08-13",
    });
    expect(r.status).toBe("goal-behind");
    expect(r.diff).toBeNull();
  });

  it("Now의 날짜도 함께 돌려준다(이 달 기록이 없으면 null)", () => {
    const withPoints = buildGoalRail({
      startBefore: 470,
      goalEnd: 490,
      points: [P("2026-08-03", 472), P("2026-08-06", 474)],
      dayDates: DAYS,
      today: "2026-08-13",
    });
    expect(withPoints.nowDate).toBe("2026-08-06");
    const noPoints = buildGoalRail({ startBefore: 470, goalEnd: 490, points: [], dayDates: DAYS, today: "2026-08-13" });
    expect(noPoints.now).toBe(470);
    expect(noPoints.nowDate).toBeNull();
  });

  it("🔴 학년을 건너는 목표도 한 줄로 선다 — 중2 위치에서 중3 목표(트랙을 갈라 '목표 없음'이 되면 안 된다)", () => {
    // 글로벌 위치라 시작 400(중2) → 목표 420(중3)은 그냥 20블록 구간이다. 4/8일 지남 → 계획 410.
    const r = buildGoalRail({
      startBefore: 400,
      goalEnd: 420,
      points: [P("2026-08-13", 408)],
      dayDates: DAYS,
      today: "2026-08-13",
    });
    expect(r.status).toBe("behind");
    expect(r.plan).toBe(410);
    expect(r.progressPct).toBe(40);
  });

  it("달 전 기록이 없으면 이 달 첫 기록이 Start다", () => {
    const r = buildGoalRail({
      startBefore: null,
      goalEnd: 480,
      points: [P("2026-08-06", 472), P("2026-08-03", 470)],
      dayDates: DAYS,
      today: "2026-08-06",
    });
    expect(r.start).toBe(470);
    expect(r.now).toBe(472);
  });

  it("🔴 미리 적힌 미래 기록은 Now에 안 들어간다 — 지금 어디는 오늘 기준", () => {
    const r = buildGoalRail({
      startBefore: 470,
      goalEnd: 490,
      points: [P("2026-08-03", 472), P("2026-08-27", 489)],
      dayDates: DAYS,
      today: "2026-08-06",
    });
    expect(r.now).toBe(472);
  });

  it("복습으로 되돌아간 날은 그대로 뒤로 간다 — 최댓값으로 부풀리지 않는다", () => {
    const r = buildGoalRail({
      startBefore: 470,
      goalEnd: 490,
      points: [P("2026-08-03", 480), P("2026-08-06", 475)],
      dayDates: DAYS,
      today: "2026-08-06",
    });
    expect(r.now).toBe(475);
  });
});

describe("railX — 레일 위 좌표", () => {
  it("Start=0 · End=100 · Plan은 사이", () => {
    const r = buildGoalRail({
      startBefore: 470,
      goalEnd: 490,
      points: [P("2026-08-13", 478)],
      dayDates: DAYS,
      today: "2026-08-13",
    });
    expect(railX(r, r.start)).toBe(0);
    expect(railX(r, r.end)).toBe(100);
    expect(railX(r, r.plan)).toBe(50);
    expect(railX(r, r.now)).toBe(40);
  });

  it("목표가 없으면 20블록를 가득으로 본다(종전 레일과 같은 눈금)", () => {
    const r = buildGoalRail({
      startBefore: 470,
      goalEnd: null,
      points: [P("2026-08-13", 480)],
      dayDates: DAYS,
      today: "2026-08-13",
    });
    expect(railX(r, r.now)).toBe(50);
  });
});

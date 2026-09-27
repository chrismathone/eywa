import { describe, expect, it } from "vitest";
import { IDLE_MS, MAX_GAP_MS, UsageMeter } from "./meter";

const ON = { visible: true, focused: true };
const UNFOCUSED = { visible: true, focused: false };
const HIDDEN = { visible: false, focused: false };
const NEVER = Number.NEGATIVE_INFINITY;

/** t0부터 step마다 표본을 떠서 [from, to] 구간을 흘려보낸다. */
function run(m: UsageMeter, from: number, to: number, lastInputAt: number, state = ON, step = 5_000) {
  for (let t = from + step; t <= to; t += step) m.sample(t, lastInputAt, state);
}

describe("UsageMeter — 화면 시간과 활동 시간을 함께 센다", () => {
  it("포커스만 있고 입력이 없으면 화면 시간만 쌓인다(멍하니 띄워 둔 시간)", () => {
    const m = new UsageMeter(0);
    m.navigate(0, NEVER, "/timetable", ON);
    run(m, 0, 120_000, NEVER);
    expect(m.drain()).toEqual([{ route: "/timetable", visits: 1, openSec: 120, activeSec: 0 }]);
  });

  it("마지막 입력 후 60초까지만 활동으로 친다", () => {
    const m = new UsageMeter(0);
    m.navigate(0, 0, "/students", ON);
    run(m, 0, 180_000, 0);
    const [item] = m.drain();
    expect(item).toMatchObject({ openSec: 180, activeSec: IDLE_MS / 1000 });
  });

  it("쉬다가 돌아온 입력에서 구간을 끊으면, 쉬던 시간은 활동으로 새지 않는다", () => {
    const m = new UsageMeter(0);
    m.navigate(0, NEVER, "/billing", ON);
    m.sample(3_000, NEVER, ON); // 3초 멍 → 입력(세션이 여기서 끊는다)
    m.sample(5_000, 3_000, ON); // 입력 뒤 2초
    expect(m.drain()).toEqual([{ route: "/billing", visits: 1, openSec: 5, activeSec: 2 }]);
  });

  it("숨은 화면(최소화·가려진 창·다른 탭)은 아무것도 안 센다 — 방문도", () => {
    const m = new UsageMeter(0);
    m.navigate(0, 0, "/classes", HIDDEN);
    run(m, 0, 60_000, 0, HIDDEN);
    expect(m.drain()).toEqual([]);
  });

  it("포커스 없는 창이라도 입력이 들어오면 활동한 만큼 센다(활동 ⊆ 화면)", () => {
    const m = new UsageMeter(0);
    m.navigate(0, NEVER, "/ecs", UNFOCUSED);
    run(m, 0, 20_000, NEVER, UNFOCUSED); // 입력 없음 → 0
    m.sample(20_000, NEVER, UNFOCUSED);
    run(m, 20_000, 30_000, 20_000, UNFOCUSED); // 입력 후 10초
    expect(m.drain()).toEqual([{ route: "/ecs", visits: 1, openSec: 10, activeSec: 10 }]);
  });

  it("틱 사이가 길면(절전) 최대 구간만 센다", () => {
    const m = new UsageMeter(0);
    m.navigate(0, NEVER, "/dashboard", ON);
    m.sample(3_600_000, NEVER, ON);
    expect(m.drain()[0]!.openSec).toBe(MAX_GAP_MS / 1000);
  });

  it("화면을 옮기면 직전 화면까지 적립하고 새 화면 방문을 센다 · 같은 화면 재진입은 방문을 안 늘린다", () => {
    const m = new UsageMeter(0);
    m.navigate(0, 0, "/students", ON);
    m.navigate(10_000, 0, "/students", ON);
    m.navigate(20_000, 0, "/students/[id]", ON);
    m.navigate(30_000, 0, "/students", ON);
    m.sample(40_000, 0, ON); // 방문은 그 화면에 시간이 처음 쌓일 때 센다
    const byRoute = Object.fromEntries(m.drain().map((i) => [i.route, i]));
    expect(byRoute["/students"]).toMatchObject({ visits: 2, openSec: 30 });
    expect(byRoute["/students/[id]"]).toMatchObject({ visits: 1, openSec: 10 });
  });

  it("drain은 초 단위로 꺼내고 나머지는 다음 번으로 넘긴다 · 활동 초가 화면 초를 넘지 않는다", () => {
    const m = new UsageMeter(0);
    m.navigate(0, 0, "/a", ON);
    m.sample(2_500, 0, ON);
    expect(m.drain()).toEqual([{ route: "/a", visits: 1, openSec: 2, activeSec: 2 }]);
    m.sample(3_000, 0, ON); // 누적 나머지 0.5 + 0.5 = 1초
    expect(m.drain()).toEqual([{ route: "/a", visits: 0, openSec: 1, activeSec: 1 }]);
    expect(m.drain()).toEqual([]);
  });

  it("떠난 화면의 부스러기는 지운다(메모리가 방문 화면 수만큼 자라지 않게)", () => {
    const m = new UsageMeter(0);
    m.navigate(0, 0, "/a", ON);
    m.navigate(1_500, 0, "/b", ON);
    expect(m.drain().map((i) => i.route)).toEqual(["/a"]); // /a 1초 꺼내고 0.5초 나머지 → 떠났으니 삭제
    m.sample(2_500, 0, ON);
    expect(m.drain().map((i) => i.route)).toEqual(["/b"]); // /a 나머지가 되살아나지 않는다
  });

  it("화면이 정해지기 전(navigate 전)엔 아무것도 안 센다", () => {
    const m = new UsageMeter(0);
    m.sample(10_000, 0, ON);
    expect(m.drain()).toEqual([]);
  });
});

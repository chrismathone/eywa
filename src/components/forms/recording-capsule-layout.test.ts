import { describe, expect, it } from "vitest";
import { CAPSULE_HEIGHT, CAPSULE_WIDTH, type Box } from "./recording-panel-placement";
import { STACK_GAP, settleCapsule } from "./recording-capsule-layout";

/** 원장 2026-10-16 "녹음 아이콘들은 겹치려고 이동시키면 겹쳐지지않고 자동으로 깔끔하게 정렬되게" */
const VIEW = { width: 1440, height: 900 };
const icon = (left: number, top: number): Box => ({ left, top, width: CAPSULE_WIDTH, height: CAPSULE_HEIGHT });
const crowded = (a: { left: number; top: number }, others: Box[]) => others.some((b) =>
  a.left < b.left + b.width + STACK_GAP && b.left < a.left + CAPSULE_WIDTH + STACK_GAP
  && a.top < b.top + b.height + STACK_GAP && b.top < a.top + CAPSULE_HEIGHT + STACK_GAP);
const STEP = CAPSULE_HEIGHT + STACK_GAP;

describe("settleCapsule — 녹음 아이콘끼리 겹치지 않게", () => {
  it("아무것도 안 겹치면 놓은 자리 그대로(화면 안으로만)", () => {
    expect(settleCapsule({ left: 300, top: 200 }, [icon(1336, 760)], VIEW)).toEqual({ left: 300, top: 200 });
    expect(settleCapsule({ left: -50, top: 2000 }, [], VIEW)).toEqual({ left: 16, top: 900 - CAPSULE_HEIGHT - 16 });
  });

  it("다른 아이콘 위에 반쯤 겹쳐 놓으면 그 아이콘의 줄(같은 왼쪽 끝)에 간격을 맞춰 붙는다 — 놓은 곳에 가까운 쪽", () => {
    const other = icon(600, 400);
    const below = settleCapsule({ left: 630, top: 430 }, [other], VIEW);
    expect(below).toEqual({ left: 600, top: 400 + STEP });
    const above = settleCapsule({ left: 580, top: 370 }, [other], VIEW);
    expect(above).toEqual({ left: 600, top: 400 - STEP });
  });

  it("쌓인 줄 한가운데에 놓으면 빈칸을 찾아 들어간다 — 어느 것과도 겹치지 않는다", () => {
    const stack = [icon(1336, 764), icon(1336, 764 - STEP), icon(1336, 764 - 2 * STEP)];
    const at = settleCapsule({ left: 1330, top: 700 }, stack, VIEW);
    expect(at.left).toBe(1336);
    expect(crowded(at, stack)).toBe(false);
    expect([764 - 3 * STEP]).toContain(at.top);
  });

  it("바짝 붙여 놓아도(겹치지 않았지만 간격보다 가깝게) 줄에 맞춘다", () => {
    const at = settleCapsule({ left: 600 + CAPSULE_WIDTH + 4, top: 405 }, [icon(600, 400)], VIEW);
    expect(crowded(at, [icon(600, 400)])).toBe(false);
    expect(at.top === 400 || at.left === 600).toBe(true);
  });

  it("줄이 화면 위·아래로 꽉 차면 옆 줄로", () => {
    const tall = { width: 1440, height: 200 };
    const others = [icon(1336, 16), icon(1336, 16 + STEP)];
    const at = settleCapsule({ left: 1336, top: 50 }, others, tall);
    expect(crowded(at, others)).toBe(false);
    expect(at.left).toBe(1336 - (CAPSULE_WIDTH + STACK_GAP));
  });

  it("새 아이콘은 오른쪽 아래 기본 자리에서 기존 아이콘을 피해 위로 쌓인다", () => {
    const base = { left: 1440 - CAPSULE_WIDTH - 16, top: 900 - CAPSULE_HEIGHT - 80 };
    const first = settleCapsule(base, [], VIEW);
    const second = settleCapsule(base, [icon(first.left, first.top)], VIEW);
    const third = settleCapsule(base, [icon(first.left, first.top), icon(second.left, second.top)], VIEW);
    expect(first).toEqual(base);
    expect(second).toEqual({ left: base.left, top: base.top - STEP });
    expect(third).toEqual({ left: base.left, top: base.top - 2 * STEP });
  });
});

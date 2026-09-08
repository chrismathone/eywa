import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_WINDOW, MIN_H, MIN_W, ROUTE_WINDOW_SIZE, resizeFloor, resizeRect, windowMinSize } from "./window-geometry";

/**
 * 창 최소 크기 강제 + 탭 접힘 금지 가드 (원장 2026-09-03).
 *
 * *"창이 줄어들어도 기존 4열 스타일을 유지하는 게 오히려 가독성이 뛰어남 · 하나의 버튼이 가로로 굉장히 길어지는
 * 최악의 가독성은 필요없음 · 차라리 '최소 크기 위반' 경고 안내 페이지를 띄우거나 창 크기를 최소 크기보다 줄이려고
 * 할 때 경고를 띄우고 줄어들지 않도록 · 앞으로도 탭접힘은 금지"*
 *
 * 세 겹: ① 리사이즈는 그 창의 최소 크기에서 멈춘다 ② 그래도 작으면 창 안 안내(WindowMinSizeNotice) ③ 다열 보드는 접지 않는다.
 */
const SRC = join(resolve(process.cwd()), "src");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");
const B = { width: 1920, height: 1080 };

describe("창 최소 크기 = 그 메뉴의 기본 크기", () => {
  it("등록된 메뉴는 ROUTE_WINDOW_SIZE, 없으면 DEFAULT_WINDOW, 상세는 부모를 상속", () => {
    expect(windowMinSize("enrollment")).toEqual(ROUTE_WINDOW_SIZE.enrollment);
    expect(windowMinSize("enrollment/abc-123")).toEqual(ROUTE_WINDOW_SIZE.enrollment);
    expect(windowMinSize("nope")).toEqual(DEFAULT_WINDOW);
    // 등록상담 칸반은 4열이 서는 폭이어야 한다(칸 4 × 250 + 틈).
    expect(ROUTE_WINDOW_SIZE.enrollment.w).toBeGreaterThanOrEqual(1100);
  });

  it("🔴 리사이즈는 최소 크기에서 멈춘다 — 안쪽으로 더 끌어도 줄지 않는다", () => {
    const min = windowMinSize("enrollment");
    const start = { x: 100, y: 100, w: min.w + 200, h: min.h + 100 };
    const r = resizeRect(start, "se", -600, -600, B, min);
    expect(r.w).toBe(min.w);
    expect(r.h).toBe(min.h);
    // 왼쪽 변을 끌면 오른쪽 변이 고정된 채 멈춘다.
    const l = resizeRect(start, "w", 900, 0, B, min);
    expect(l.w).toBe(min.w);
    expect(l.x + l.w).toBe(start.x + start.w);
  });

  it("최소 크기가 없는 창(비라우트)은 전역 바닥 그대로", () => {
    const r = resizeRect({ x: 0, y: 0, w: 800, h: 600 }, "se", -900, -900, B);
    expect(r.w).toBe(MIN_W);
    expect(r.h).toBe(MIN_H);
  });

  it("캔버스가 최소 크기보다 작으면 캔버스가 상한 — 창이 화면 밖으로 나가지 않는다", () => {
    const small = { width: 900, height: 600 };
    expect(resizeFloor({ w: 1120, h: 720 }, small)).toEqual({ w: 900, h: 600 });
    const r = resizeRect({ x: 0, y: 0, w: 900, h: 600 }, "se", -300, -300, small, { w: 1120, h: 720 });
    expect(r.w).toBe(900);
    expect(r.h).toBe(600);
  });
});

describe("배선 — 바닥·안내·탭 접힘 금지", () => {
  it("포인터 리사이즈와 store.resizeBy가 같은 바닥(windowMinSize)을 쓴다", () => {
    expect(read("components/workspace/use-pointer-resize.ts")).toContain("windowMinSize(w.params.id)");
    expect(read("components/workspace/window-store.ts")).toContain("windowMinSize(w.params.id)");
    // 바닥에 닿으면 힌트 — FloatingWindow의 [data-min-hint]를 hook이 만진다.
    expect(read("components/workspace/floating-window.tsx")).toContain("data-min-hint");
    expect(read("components/workspace/use-pointer-resize.ts")).toContain("[data-min-hint]");
  });

  it("창(임베드) 본문 맨 위에 최소 크기 위반 안내가 선다 · [창 최대화]는 부모가 받는다", () => {
    expect(read("app/(shell)/layout.tsx")).toContain("<WindowMinSizeNotice />");
    // 판정은 창 크롬을 뺀 본문 크기 — 안 빼면 정확히 최소 크기로 연 창에도 안내가 뜬다.
    expect(read("components/workspace/window-min-size-notice.tsx")).toContain("WINDOW_CHROME");
    // 타이틀바(h-9=36)+선(1)+테두리(2) = 39. 타이틀바를 바꾸면 이 상수도.
    expect(read("components/workspace/floating-window.tsx")).toMatch(/flex h-9 shrink-0 touch-none items-center border-b/);
    expect(read("components/workspace/window-min-size-notice.tsx")).toContain("eywa-window-maximize");
    expect(read("components/workspace/workspace-canvas.tsx")).toContain('data.type === "eywa-window-maximize"');
  });

  it("🔴 등록상담 칸반은 창이 좁아도 4열 — 탭으로 접지 않는다", () => {
    const src = read("app/(shell)/enrollment/_components/enrollment-kanban.tsx");
    expect(src).toContain("grid-cols-4");
    // 반응형 접힘의 흔적 셋: 브레이크포인트 앞의 열 수 · 좁은 화면 탭바 · 활성 탭만 보이기.
    expect(src).not.toMatch(/(sm|md|lg|xl|2xl):grid-cols-/);
    expect(src).not.toContain("xl:hidden");
    expect(src).not.toMatch(/visible\s*\?\s*"flex"/);
  });
});

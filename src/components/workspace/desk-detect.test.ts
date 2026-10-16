import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DESK_CHANGE_EVENT, DESK_MOUSE_KEY, DESKTOP_MIN_WIDTH, deskDetectScript } from "./desk-detect";

/**
 * 데스크톱 셸 판정 스크립트(루트 레이아웃 `<head>`)를 **그대로 실행**해 본다 — 원장 2026-10-16 갤럭시북(터치 모니터)
 * *"화면을 아무리 축소해도 대시보드가 상단임"*: 브라우저가 마우스·터치패드를 없다고 보고하는 기기는 실제 움직임으로 판정한다.
 */
type Env = { fine: boolean; width: number };
let env: Env;
let mqs: Record<string, { listeners: Array<() => void> }>;
const added: Array<[string, EventListenerOrEventListenerObject]> = [];
// 스크립트가 만든 MutationObserver — 시험마다 끊는다(남으면 다음 시험의 속성 정리에 반응해 결과를 흐린다).
const observers: MutationObserver[] = [];
const tick = () => new Promise((r) => setTimeout(r, 0));

function install(next: Env) {
  env = next;
  mqs = {};
  window.matchMedia = ((q: string) => {
    const entry = (mqs[q] ??= { listeners: [] });
    return {
      get matches() {
        return q.includes("any-pointer") ? env.fine : env.width >= DESKTOP_MIN_WIDTH;
      },
      addEventListener: (_t: string, f: () => void) => entry.listeners.push(f),
    };
  }) as unknown as typeof window.matchMedia;
}
const run = () => new Function(deskDetectScript())();
const html = () => document.documentElement;
function move(pointerType: string) {
  const e = new Event("pointermove");
  Object.defineProperty(e, "pointerType", { value: pointerType });
  window.dispatchEvent(e);
}
function changeWidth(w: number) {
  env.width = w;
  for (const m of Object.values(mqs)) for (const f of m.listeners) f();
}

beforeEach(() => {
  html().removeAttribute("data-desk");
  html().removeAttribute("data-mouse");
  html().removeAttribute("data-print");
  localStorage.clear();
  const Orig = globalThis.MutationObserver;
  vi.stubGlobal(
    "MutationObserver",
    class extends Orig {
      constructor(cb: MutationCallback) {
        super(cb);
        observers.push(this);
      }
    },
  );
  const orig = window.addEventListener.bind(window);
  vi.spyOn(window, "addEventListener").mockImplementation((type: string, fn: EventListenerOrEventListenerObject, o?: boolean | AddEventListenerOptions) => {
    added.push([type, fn]);
    orig(type, fn, o);
  });
});
afterEach(() => {
  for (const o of observers.splice(0)) o.disconnect();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const [t, f] of added.splice(0)) window.removeEventListener(t, f);
});

describe("deskDetectScript — 실제 마우스 움직임으로 데스크톱 셸", () => {
  it("정상 데스크톱(넓음 + 브라우저가 마우스 보고) = data-desk · data-mouse 없음", () => {
    install({ fine: true, width: 1440 });
    run();
    expect(html().hasAttribute("data-desk")).toBe(true);
    expect(html().hasAttribute("data-mouse")).toBe(false);
  });

  it("🔴 정상 데스크톱은 마우스를 움직여도 기억하지 않는다 — 나중에 '마우스 없음'이 돼도 모바일로 돌아간다", () => {
    install({ fine: true, width: 1440 });
    run();
    move("mouse");
    expect(localStorage.getItem(DESK_MOUSE_KEY)).toBeNull();
    // 같은 기기가 '마우스 없음'이 되면(키보드 분리 · 태블릿 모드) 종전처럼 모바일 셸.
    env.fine = false;
    for (const m of Object.values(mqs)) for (const f of m.listeners) f();
    expect(html().hasAttribute("data-desk")).toBe(false);
    expect(html().hasAttribute("data-mouse")).toBe(false);
    // 그 상태에서 실제로 마우스가 움직이면 그때 기억한다.
    move("mouse");
    expect(localStorage.getItem(DESK_MOUSE_KEY)).toBe("1");
    expect(html().hasAttribute("data-desk")).toBe(true);
  });

  it("🔴 React가 <html> 속성을 지우면(루트 다시 만들기) 표시를 다시 붙인다 — 한 번 붙이고 멈춘다", async () => {
    localStorage.setItem(DESK_MOUSE_KEY, "1");
    install({ fine: false, width: 1440 });
    const changed = vi.fn();
    window.addEventListener(DESK_CHANGE_EVENT, changed);
    run();
    expect(changed).toHaveBeenCalledTimes(1);
    html().removeAttribute("data-desk");
    html().removeAttribute("data-mouse");
    await tick();
    expect(html().hasAttribute("data-desk")).toBe(true);
    expect(html().hasAttribute("data-mouse")).toBe(true);
    await tick();
    expect(changed).toHaveBeenCalledTimes(2); // 되붙일 때 한 번 — 되돌기를 반복하지 않는다
    // 다른 속성(React의 lang 등)엔 돌지 않는다.
    html().setAttribute("lang", "ko");
    await tick();
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it("인쇄하는 동안 data-print — 표시(data-desk)는 그대로 두고 CSS가 무시한다", () => {
    install({ fine: true, width: 1440 });
    run();
    window.dispatchEvent(new Event("beforeprint"));
    expect(html().hasAttribute("data-print")).toBe(true);
    expect(html().hasAttribute("data-desk")).toBe(true);
    window.dispatchEvent(new Event("afterprint"));
    expect(html().hasAttribute("data-print")).toBe(false);
  });

  it("🔴 터치 모니터 PC(넓음 + 마우스 보고 없음) — 손가락·S펜으론 안 켜지고, 터치패드를 움직이면 켜져 기억된다", () => {
    install({ fine: false, width: 1440 });
    const changed = vi.fn();
    window.addEventListener(DESK_CHANGE_EVENT, changed);
    run();
    expect(html().hasAttribute("data-desk")).toBe(false);
    move("touch");
    move("pen");
    expect(html().hasAttribute("data-desk")).toBe(false);
    move("mouse");
    expect(html().hasAttribute("data-desk")).toBe(true);
    expect(html().hasAttribute("data-mouse")).toBe(true);
    expect(localStorage.getItem(DESK_MOUSE_KEY)).toBe("1");
    expect(changed).toHaveBeenCalledTimes(1); // useIsDesktop이 듣는다
  });

  it("한 번 본 브라우저는 다음 접속부터 첫 페인트 전에 바로 데스크톱", () => {
    localStorage.setItem(DESK_MOUSE_KEY, "1");
    install({ fine: false, width: 1440 });
    run();
    expect(html().hasAttribute("data-desk")).toBe(true);
  });

  it("폭은 그대로 경계 — 좁으면 모바일, 넓히면 데스크톱(마우스를 본 브라우저)", () => {
    localStorage.setItem(DESK_MOUSE_KEY, "1");
    install({ fine: false, width: 1000 });
    run();
    expect(html().hasAttribute("data-desk")).toBe(false);
    expect(html().hasAttribute("data-mouse")).toBe(true); // 손 기기 숨김(no-mouse)은 풀린다
    changeWidth(1300);
    expect(html().hasAttribute("data-desk")).toBe(true);
    changeWidth(900);
    expect(html().hasAttribute("data-desk")).toBe(false);
  });

  it("폰·태블릿(마우스 보고도 움직임도 없음)은 그대로 모바일", () => {
    install({ fine: false, width: 1366 });
    run();
    move("touch");
    expect(html().hasAttribute("data-desk")).toBe(false);
    expect(html().hasAttribute("data-mouse")).toBe(false);
    expect(localStorage.getItem(DESK_MOUSE_KEY)).toBeNull();
  });

  it("저장소가 막혀도(사생활 모드 등) 판정은 돈다 — 기억만 못 한다", () => {
    install({ fine: false, width: 1440 });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    run();
    move("mouse");
    expect(html().hasAttribute("data-desk")).toBe(true);
  });
});

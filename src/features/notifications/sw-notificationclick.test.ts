import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

/**
 * 휴대폰 푸시 알림 클릭(`public/sw.js` notificationclick) — 전수검사(2026-09-11) `$[2].findings[9]`.
 *
 * PC 브라우저도 '휴대폰 알림 켜기'로 구독할 수 있다(벨 행은 기기를 가리지 않는다). 그런데 PC 작업면의
 * **플로팅 창(iframe)도 window 클라이언트로 잡힌다**(`frameType: "nested"`). 옛 코드는 matchAll 첫 클라이언트를
 * 그대로 이동시켜서, 마지막으로 만진 게 창이면 **그 창이 embed 없는 학생 상세로 바뀌었다**(창 이름과 다른 화면 +
 * 창 안에 전체 셸). 최상위 작업면을 이동시키면 딥링크 창 열기(`useDeepLinkWindow`)가 제 창으로 띄운다.
 */
const SW = readFileSync(join(process.cwd(), "public/sw.js"), "utf8");

type Handler = (event: unknown) => void;
type FakeClient = {
  frameType: string | undefined;
  url: string;
  focus: ReturnType<typeof vi.fn>;
  navigate: ReturnType<typeof vi.fn>;
};

function fakeClient(frameType: string | undefined, url = "https://aywa.test/dashboard"): FakeClient {
  const c: FakeClient = {
    frameType,
    url,
    focus: vi.fn(async () => c),
    navigate: vi.fn(async () => c),
  };
  return c;
}

/** sw.js를 가짜 `self`로 실행해 리스너를 받아 낸다(파일을 그대로 읽는다 — 사본으로 테스트하지 않는다). */
function loadSw(clients: FakeClient[], navigator?: object) {
  const handlers: Record<string, Handler> = {};
  const openWindow = vi.fn(async () => null);
  const self = {
    navigator,
    addEventListener: (type: string, fn: Handler) => {
      handlers[type] = fn;
    },
    skipWaiting: vi.fn(),
    clients: { matchAll: vi.fn(async () => clients), openWindow, claim: vi.fn() },
    registration: { showNotification: vi.fn() },
  };
  new Function("self", SW)(self);
  return { handlers, openWindow };
}

async function clickNotification(clients: FakeClient[], link = "/students/s1", navigator?: object) {
  const { handlers, openWindow } = loadSw(clients, navigator);
  let done: Promise<unknown> = Promise.resolve();
  handlers.notificationclick!({
    notification: { close: vi.fn(), data: { link } },
    waitUntil: (p: Promise<unknown>) => {
      done = p;
    },
  });
  await done;
  return { openWindow };
}

describe("sw.js notificationclick — PC 판정(userAgentData.mobile)", () => {
  it("🔴 PC 확정(mobile=false)이면 창이 없어도 새 탭 — 그 탭엔 작성 중인 화면이 있을 수 있다(원스크린·셔틀·배경 폼)", async () => {
    const top = fakeClient("top-level");
    const { openWindow } = await clickNotification([top], "/students/s1", { userAgentData: { mobile: false } });
    expect(top.navigate).not.toHaveBeenCalled();
    expect(openWindow).toHaveBeenCalledWith("/students/s1");
  });

  it("모바일 확정(mobile=true)이면 종전대로 열린 탭을 옮긴다(폰에서 창이 쌓이지 않게)", async () => {
    const top = fakeClient("top-level");
    const { openWindow } = await clickNotification([top], "/students/s1", { userAgentData: { mobile: true } });
    expect(top.navigate).toHaveBeenCalledWith("/students/s1");
    expect(openWindow).not.toHaveBeenCalled();
  });

  it("값이 없는 브라우저(사파리·파이어폭스)는 창(nested) 판정 그대로", async () => {
    const noUa = {};
    const lone = fakeClient("top-level");
    const r1 = await clickNotification([lone], "/students/s1", noUa);
    expect(lone.navigate).toHaveBeenCalledWith("/students/s1");
    expect(r1.openWindow).not.toHaveBeenCalled();
    const win = fakeClient("nested", "https://aywa.test/ecs?embed=1");
    const top = fakeClient("top-level");
    const r2 = await clickNotification([win, top], "/students/s1", noUa);
    expect(top.navigate).not.toHaveBeenCalled();
    expect(r2.openWindow).toHaveBeenCalledWith("/students/s1");
  });
});

describe("sw.js notificationclick — 창을 옮기지 않는다", () => {
  it("🔴 PC 작업면(플로팅 창이 떠 있다)이면 어느 탭도 옮기지 않고 새 탭으로 연다 — 작업면을 다시 실으면 창 입력이 날아간다", async () => {
    const win = fakeClient("nested", "https://aywa.test/ecs?embed=1");
    const top = fakeClient("top-level");
    const { openWindow } = await clickNotification([win, top]);
    expect(win.navigate).not.toHaveBeenCalled();
    expect(top.navigate).not.toHaveBeenCalled();
    expect(openWindow).toHaveBeenCalledWith("/students/s1");
  });

  it("창이 순서상 뒤에 와도 같다(최근 포커스 순서와 무관)", async () => {
    const top = fakeClient("top-level");
    const win = fakeClient("nested", "https://aywa.test/ecs?embed=1");
    const { openWindow } = await clickNotification([top, win]);
    expect(top.navigate).not.toHaveBeenCalled();
    expect(openWindow).toHaveBeenCalledWith("/students/s1");
  });

  it("폰(창 없음)은 종전대로 열려 있는 최상위 창을 옮긴다(창이 쌓이지 않게)", async () => {
    const top = fakeClient("top-level");
    const { openWindow } = await clickNotification([top]);
    expect(top.navigate).toHaveBeenCalledWith("/students/s1");
    expect(top.focus).toHaveBeenCalled();
    expect(openWindow).not.toHaveBeenCalled();
  });

  it("최상위 창이 없고 창(iframe)만 잡히면 새 창을 연다", async () => {
    const win = fakeClient("nested", "https://aywa.test/ecs?embed=1");
    const { openWindow } = await clickNotification([win]);
    expect(win.navigate).not.toHaveBeenCalled();
    expect(openWindow).toHaveBeenCalledWith("/students/s1");
  });

  it("다른 창이 연 최상위 창(auxiliary)도 최상위로 친다", async () => {
    const aux = fakeClient("auxiliary");
    const { openWindow } = await clickNotification([aux]);
    expect(aux.navigate).toHaveBeenCalledWith("/students/s1");
    expect(openWindow).not.toHaveBeenCalled();
  });

  it("frameType을 모르는 브라우저는 종전대로 첫 창을 쓴다(폰에서 창이 쌓이지 않게)", async () => {
    const unknown = fakeClient(undefined);
    const { openWindow } = await clickNotification([unknown]);
    expect(unknown.navigate).toHaveBeenCalledWith("/students/s1");
    expect(openWindow).not.toHaveBeenCalled();
  });

  it("열린 창이 없으면 새 창", async () => {
    const { openWindow } = await clickNotification([]);
    expect(openWindow).toHaveBeenCalledWith("/students/s1");
  });

  it("🔴 sw.js에 fetch 핸들러를 두지 않는다(CLAUDE.md — 폰에만 옛 코드가 남는 캐싱 사고 방지)", () => {
    const { handlers } = loadSw([]);
    expect(handlers.fetch).toBeUndefined();
  });
});

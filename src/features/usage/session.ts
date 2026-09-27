import {
  FLUSH_MS,
  HOVER_DWELL_MS,
  IDLE_MS,
  MAX_ITEMS_PER_BEACON,
  TICK_MS,
  USAGE_ENDPOINT,
  UsageMeter,
  type FrameState,
  type UsageItem,
} from "./meter";

/**
 * 이용 분석 **브라우저 배선** — 한 문서(배경 또는 창 iframe 하나)에 계측기를 붙인다.
 * [`usage-tracker.tsx`](./usage-tracker.tsx)만 부른다(클라 전용 — 서버에서 import 금지).
 *
 * 🔴 반응속도 1순위 — 입력 이벤트 처리기는 **시각 한 번 적는 것**이 전부다(capture+passive라 입력을 막지 않는다).
 *    무거운 일(적립)은 5초 틱과 상태가 바뀌는 순간에만, 전송은 10분마다·숨을 때만(비콘이라 화면을 안 기다린다).
 * 🔑 창(iframe)마다 따로 돈다 — 입력은 **그 창 문서에만** 들어오므로 활동 시간이 창별로 정확히 갈린다.
 *    최소화·가려진 창은 부모가 `visibilityState`를 hidden으로 덮어 주므로(frame-visibility.ts) 저절로 안 센다.
 * 🔴 배경 문서의 **셸 크롬**(`[data-usage-chrome]` = 사이드바·메뉴 판·검색 팰릿·창 캔버스) 위 입력은 배경 화면의 활동이
 *    아니다 — 뺀다. 창 모드에서 사이드바로 창을 열 때마다 배경(대개 대시보드)에 60초씩 활동이 붙어 1위로 부풀던 것.
 *    새 크롬(메뉴를 여는 층)을 만들면 루트에 이 표식을 달 것.
 */

export type UsageSession = { setRoute(route: string): void; stop(): void };

const CHROME = "[data-usage-chrome], [data-window-id]";

/**
 * 이 문서가 **화면을** 잡고 있는가 — 자식 창(iframe)에 포커스가 있으면 부모는 아니고, 크롬(사이드바 버튼 등)에
 * 포커스가 남아 있어도 아니다(메뉴를 눌러 창을 연 뒤 그 창을 읽는 동안 배경 화면 시간이 새지 않게).
 */
function ownsFocus(): boolean {
  if (!document.hasFocus()) return false;
  const el = document.activeElement;
  return el?.tagName !== "IFRAME" && !el?.closest?.(CHROME);
}

function frameState(): FrameState {
  return { visible: document.visibilityState === "visible", focused: ownsFocus() };
}

function send(items: UsageItem[]): void {
  for (let i = 0; i < items.length; i += MAX_ITEMS_PER_BEACON) {
    const body = JSON.stringify({ v: 1, items: items.slice(i, i + MAX_ITEMS_PER_BEACON) });
    try {
      if (navigator.sendBeacon?.(USAGE_ENDPOINT, new Blob([body], { type: "application/json" }))) continue;
    } catch {
      /* 아래 fetch로 */
    }
    void fetch(USAGE_ENDPOINT, {
      method: "POST",
      body,
      keepalive: true,
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
    }).catch(() => {});
  }
}

function onShellChrome(e: Event): boolean {
  const t = e.target as Element | null;
  return typeof t?.closest === "function" && t.closest(CHROME) !== null;
}

const INPUT_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart", "touchmove"] as const;

export function startUsageSession(initialRoute: string): UsageSession {
  const meter = new UsageMeter(Date.now());
  let lastInputAt = Number.NEGATIVE_INFINITY;
  let hoverSince = 0;
  meter.navigate(Date.now(), lastInputAt, initialRoute, frameState());

  const sample = () => meter.sample(Date.now(), lastInputAt, frameState());
  const flush = () => {
    sample();
    const items = meter.drain();
    if (items.length > 0) send(items);
  };
  const markInput = (t: number) => {
    // 쉬다가 돌아온 첫 입력 — 여기서 구간을 끊어야 쉬던 시간이 활동으로 새지 않는다.
    if (t - lastInputAt > IDLE_MS) meter.sample(t, lastInputAt, frameState());
    lastInputAt = t;
  };
  const onInput = (e: Event) => {
    const t = Date.now();
    if (t - lastInputAt < 1000 || onShellChrome(e)) return;
    markInput(t);
  };
  const onMove = (e: Event) => {
    const t = Date.now();
    if (t - lastInputAt < 1000 || onShellChrome(e)) return;
    if (ownsFocus()) return markInput(t);
    if (hoverSince === 0) hoverSince = t;
    else if (t - hoverSince >= HOVER_DWELL_MS) markInput(t);
  };
  const onLeave = () => {
    hoverSince = 0;
  };
  const onVisibility = () => (document.visibilityState === "hidden" ? flush() : sample());

  const opts: AddEventListenerOptions = { capture: true, passive: true };
  for (const ev of INPUT_EVENTS) window.addEventListener(ev, onInput, opts);
  window.addEventListener("pointermove", onMove, opts);
  document.documentElement.addEventListener("pointerleave", onLeave);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("focus", sample);
  window.addEventListener("blur", sample);
  window.addEventListener("pagehide", flush);
  const tick = window.setInterval(sample, TICK_MS);
  const flusher = window.setInterval(flush, FLUSH_MS);

  return {
    setRoute(route) {
      meter.navigate(Date.now(), lastInputAt, route, frameState());
    },
    stop() {
      flush();
      window.clearInterval(tick);
      window.clearInterval(flusher);
      for (const ev of INPUT_EVENTS) window.removeEventListener(ev, onInput, opts);
      window.removeEventListener("pointermove", onMove, opts);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", sample);
      window.removeEventListener("blur", sample);
      window.removeEventListener("pagehide", flush);
    },
  };
}

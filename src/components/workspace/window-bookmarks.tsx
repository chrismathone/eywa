"use client";

import { useWindowStore } from "./window-store";
import { iframeRegistry } from "./route-window";

// 수납관리 창의 "진짜 책갈피" — 창 프레임 바깥(오른쪽)에 삐져나온 종이 탭. iframe 안이 아니라
// 부모 프레임에 그려 창 테두리 밖으로 나온다(billing-tabs는 창일 때 숨고 이게 대체). 탭 클릭 →
// postMessage로 iframe billing 페이지가 client router.replace(즉시 전환, 리로드 없음). 활성 탭은
// 창별 nav 스택의 현재 URL(?tab=)에서 직접 파생 — 단일 소스(별도 state·effect 없음).
const TABS: { key: string; label: string; cls: string; ring: string }[] = [
  { key: "billing", label: "수납", cls: "bg-primary-soft text-primary border-primary/25", ring: "ring-primary/40" },
  { key: "textbooks", label: "교재", cls: "bg-blue-soft text-blue border-blue/25", ring: "ring-blue/40" },
  { key: "expenses", label: "지출", cls: "bg-purple-soft text-purple border-purple/25", ring: "ring-purple/40" },
  { key: "calculator", label: "계산기", cls: "bg-amber-soft text-amber border-amber/25", ring: "ring-amber/40" },
];

function tabFromUrl(url: string | undefined): string {
  const t = new URLSearchParams(url?.split("?")[1] ?? "").get("tab");
  return t === "textbooks" || t === "expenses" || t === "calculator" ? t : "billing";
}

export function WindowBookmarks({ winId }: { winId: string }) {
  const nav = useWindowStore((s) => s.nav[winId]);
  const active = tabFromUrl(nav?.[nav.length - 1]);

  function go(tab: string) {
    const cw = iframeRegistry.get(winId)?.contentWindow;
    cw?.postMessage({ type: "eywa:billing-tab", tab }, location.origin);
  }

  return (
    <div className="absolute top-1/2 left-full z-10 flex -translate-y-1/2 flex-col gap-1.5">
      {TABS.map((t) => {
        const on = t.key === active;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => go(t.key)}
            aria-current={on ? "page" : undefined}
            title={t.label}
            className={`pointer-events-auto flex items-center justify-center rounded-r-md border border-l-0 py-3.5 shadow-card transition-all duration-150 ${t.cls} ${
              on
                ? `${t.ring} w-9 font-bold ring-2 ring-inset`
                : "w-7 opacity-70 hover:w-8 hover:opacity-100"
            }`}
            style={{ writingMode: "vertical-rl", textOrientation: "upright" }}
          >
            <span className="text-[12px] tracking-[0.18em]">{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}

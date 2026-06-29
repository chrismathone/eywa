"use client";

import { useEffect, useRef, useState } from "react";
import { LayoutPanelTop, type LucideIcon } from "lucide-react";
import { NAV_GROUPS } from "@/lib/navigation";
import { EyIcon } from "@/components/icons/eywa-icons";
import { useWindowStore, instanceLabel } from "./window-store";

// 라우트 창 칩 아이콘 — 레일과 동일(NAV_GROUPS의 lucide). 학생 요약창은 EyIcon seed.
const ICON_BY_MENU: Record<string, LucideIcon> = {};
for (const g of NAV_GROUPS) for (const it of g.items) ICON_BY_MENU[it.menuKey] = it.icon;

/**
 * 하단 중앙 독/스위처 — **자동 숨김(맥 독식)**. 평소엔 하단 가장자리에 작은 핸들로 숨어 본문(페이지네이션·
 * 버튼)을 안 가리고, 마우스를 핸들/하단으로 가져가면 독이 떠오른다. 칩 클릭=focus/복원, 가운데클릭=닫기.
 * ⚠️ 창이 **1개만 열려 있으면**(최소화 아님) 전환할 대상이 없어 독 자체를 숨긴다(중복·겹침 제거).
 */
export function WindowSwitcher() {
  const windows = useWindowStore((s) => s.windows);
  const order = useWindowStore((s) => s.order);
  const focusedId = useWindowStore((s) => s.focusedId);
  const restore = useWindowStore((s) => s.restore);
  const close = useWindowStore((s) => s.close);
  const enterSpotlight = useWindowStore((s) => s.enterSpotlight);

  const [revealed, setRevealed] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (hideTimer.current) clearTimeout(hideTimer.current); }, []);
  const clearHide = () => { if (hideTimer.current) clearTimeout(hideTimer.current); };
  const reveal = () => { clearHide(); setRevealed(true); }; // 독 진입 — 숨김 취소
  const scheduleHide = () => { clearHide(); hideTimer.current = setTimeout(() => setRevealed(false), 280); };
  // 핸들 호버 = 일단 띄우되, 독까지 못 오면(다른 데로 가면) 다시 숨도록 hide 예약.
  const peek = () => { setRevealed(true); scheduleHide(); };

  const list = order.map((id) => windows[id]).filter(Boolean);
  if (list.length === 0) return null;
  const openCount = list.filter((w) => !w.minimized).length;
  // 창 1개만 열려 있으면(=지금 보는 그 창) 전환 대상이 없음 → 독 숨김. (최소화 1개면 복원 위해 유지.)
  if (list.length === 1 && openCount === 1) return null;

  return (
    <>
      {/* 평소: 하단 가장자리 작은 핸들 — 본문 거의 안 가림(중앙 좁은 폭). 호버하면 독이 떠오름. */}
      {!revealed ? (
        <div
          className="pointer-events-auto absolute bottom-0.5 left-1/2 z-50 -translate-x-1/2 cursor-pointer px-5 pt-2 pb-1"
          onMouseEnter={peek}
          aria-hidden
        >
          <span className="bg-line-strong/45 hover:bg-line-strong block h-1.5 w-10 rounded-full transition" />
        </div>
      ) : null}

      {/* 전체 독 — revealed일 때만 떠오름(슬라이드업). 숨김 시 pointer-events 차단 → 본문 클릭이 그대로 통과. */}
      <div
        data-slot="window-switcher"
        onMouseEnter={reveal}
        onMouseLeave={scheduleHide}
        className={`border-line bg-card/95 shadow-modal absolute bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1.5 rounded-full border px-2 py-1.5 backdrop-blur transition-all duration-200 ${
          revealed ? "opacity-100" : "pointer-events-none translate-y-6 opacity-0"
        }`}
      >
        {openCount >= 2 ? (
          <button
            type="button"
            onClick={() => enterSpotlight()}
            title="스포트라이트 (포커스 크게 + 나머지 커버)"
            aria-label="스포트라이트"
            className="text-text-dim hover:bg-bg-soft hover:text-foreground mr-0.5 flex size-7 items-center justify-center rounded-full transition"
          >
            <LayoutPanelTop size={15} strokeWidth={2} />
          </button>
        ) : null}
        {list.map((w) => {
          const active = w.id === focusedId && !w.minimized;
          const Icon =
            w.kind === "route"
              ? (ICON_BY_MENU[w.params.id] ?? ICON_BY_MENU[w.params.id.split("/")[0]])
              : null;
          const label = instanceLabel(w.id, w.params.title);
          return (
            <button
              key={w.id}
              type="button"
              onClick={() => restore(w.id)}
              onAuxClick={(e) => {
                e.preventDefault();
                close(w.id);
              }}
              title={`${label}${w.minimized ? " (최소화됨)" : ""}`}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] transition ${
                active ? "bg-primary text-primary-foreground" : "text-text-dim hover:bg-bg-soft"
              } ${w.minimized ? "opacity-60" : ""}`}
            >
              {Icon ? <Icon size={13} strokeWidth={1.85} /> : <EyIcon name="seed" size={12} />}
              <span className="max-w-[120px] truncate">{label}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}

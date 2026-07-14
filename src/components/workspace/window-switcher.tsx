"use client";

import { useEffect, useRef, useState } from "react";
import { LayoutPanelTop } from "@/components/icons/eywa-icon-compat";
import { NAV_GROUPS } from "@/lib/navigation";
import { EyIcon, type EywaIconName } from "@/components/icons/eywa-icons";
import { useWindowStore, instanceLabel } from "./window-store";

// 라우트 창 칩 아이콘 — 레일과 동일한 Eywa 아이콘. 학생 요약창은 user.
const ICON_BY_MENU: Record<string, EywaIconName> = {};
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

  const list = order.map((id) => windows[id]).filter(Boolean);
  if (list.length === 0) return null;
  const openCount = list.filter((w) => !w.minimized).length;
  // 창 1개만 열려 있으면(=지금 보는 그 창) 전환 대상이 없음 → 독 숨김. (최소화 1개면 복원 위해 유지.)
  if (list.length === 1 && openCount === 1) return null;

  return (
    // 하단 중앙 hot-zone — 핸들(숨김 표시)과 독을 **한 컨테이너**로 묶는다(호버 핸들러는 이 컨테이너에만).
    // reveal 시 컨테이너의 자식만 핸들→독+브리지로 바뀌고 컨테이너 엘리먼트 자체는 그대로라(언마운트·
    // 재마운트 없음) 마우스가 안에 그대로 남는다. 컨테이너는 **내용 크기**라 독을 항상 정확히 감싸므로
    // 창 수와 무관하게 폭 데드존이 없다. 컨테이너를 벗어날 때만(onMouseLeave) 숨김 예약 → "호버 후
    // 클릭하면 사라짐" 버그 해소. 숨김일 땐 작은 핸들만 차지해 본문(페이지네이션 등) 클릭을 거의 안 가린다.
    <div
      onMouseEnter={reveal}
      onMouseLeave={scheduleHide}
      className="pointer-events-auto absolute bottom-0 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center"
    >
      {revealed ? (
        <>
          <div
            data-slot="window-switcher"
            className="border-line bg-card/95 shadow-modal animate-in fade-in slide-in-from-bottom-1 flex items-center gap-1.5 rounded-full border px-2 py-1.5 backdrop-blur duration-150"
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
              const iconName =
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
                  {iconName ? (
                    <EyIcon name={iconName} size={13} strokeWidth={1.8} />
                  ) : (
                    <EyIcon name="user" size={12} />
                  )}
                  <span className="max-w-[120px] truncate">{label}</span>
                </button>
              );
            })}
          </div>
          {/* 브리지 — 독 아래~바닥(독 폭만큼). 핸들(바닥 중앙)에서 독까지 마우스 경로를 한 컨테이너로 잇는다. */}
          <div className="h-4 w-full" aria-hidden />
        </>
      ) : (
        // 숨김: 작은 핸들만. 컨테이너 hover(onMouseEnter)가 reveal → 자식이 독으로 바뀐다.
        <div className="cursor-pointer px-5 pt-3 pb-1.5" aria-hidden>
          <span className="bg-line-strong/45 hover:bg-line-strong block h-1.5 w-10 rounded-full transition" />
        </div>
      )}
    </div>
  );
}

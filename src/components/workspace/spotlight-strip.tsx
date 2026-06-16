"use client";

import { useEffect } from "react";
import { X, type LucideIcon } from "lucide-react";
import { NAV_GROUPS } from "@/lib/navigation";
import { EyIcon } from "@/components/icons/eywa-icons";
import { useWindowStore, type Win } from "./window-store";

const MAX_VISIBLE = 4; // 이보다 많으면 앞 3개 + "+N" 스택 카드(애플뮤직식 …처리)

// 라우트 menuKey → 아이콘(레일과 동일). 학생 요약창은 seed.
const ICON_BY_MENU: Record<string, LucideIcon> = {};
for (const g of NAV_GROUPS) for (const it of g.items) ICON_BY_MENU[it.menuKey] = it.icon;

// 커버 색 팔레트(앨범 커버 느낌) — 인덱스 순환.
const COVERS = [
  "bg-primary/12 text-primary",
  "bg-blue/12 text-blue",
  "bg-rose/12 text-rose",
  "bg-amber/15 text-amber",
  "bg-purple/12 text-purple",
  "bg-gold/15 text-gold",
];

function CoverCard({ win, accent, onClick }: { win: Win; accent: string; onClick: () => void }) {
  const Icon = win.kind === "route" ? ICON_BY_MENU[win.params.id] : null;
  return (
    <button
      type="button"
      onClick={onClick}
      title={win.params.title}
      className="group border-line bg-card hover:border-primary/50 shadow-card flex w-[132px] shrink-0 flex-col overflow-hidden rounded-lg border transition hover:-translate-y-0.5"
    >
      <div className={`flex h-9 items-center justify-center ${accent}`}>
        {Icon ? <Icon size={16} strokeWidth={1.9} /> : <EyIcon name="seed" size={15} />}
      </div>
      <div className="px-2 py-1.5 text-left">
        <p className="text-foreground truncate text-[11px] font-semibold">{win.params.title}</p>
        {win.params.subtitle ? (
          <p className="text-text-faint truncate text-[10px]">{win.params.subtitle}</p>
        ) : (
          <p className="text-text-faint text-[10px]">창</p>
        )}
      </div>
    </button>
  );
}

/**
 * 스포트라이트 하단 커버 스트립 — 비포커스 창들을 "커버 카드"로 가로 나열(클릭=상단으로 swap).
 * 너무 많으면 애플뮤직식 "+N" 스택 카드로 축약. 좌측 나가기 버튼·Esc로 해제.
 */
export function SpotlightStrip() {
  const spotlight = useWindowStore((s) => s.spotlight);
  const windows = useWindowStore((s) => s.windows);
  const order = useWindowStore((s) => s.order);
  const focusedId = useWindowStore((s) => s.focusedId);
  const focus = useWindowStore((s) => s.focus);
  const exitSpotlight = useWindowStore((s) => s.exitSpotlight);

  useEffect(() => {
    if (!spotlight) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") exitSpotlight();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [spotlight, exitSpotlight]);

  if (!spotlight) return null;
  // 포커스(상단 큰 창) 제외, 비최소화 창 = 스트립 카드. 최근(앞)부터.
  const others = order
    .filter((id) => id !== focusedId && !windows[id]?.minimized)
    .map((id) => windows[id])
    .reverse();

  const overflow = others.length > MAX_VISIBLE;
  const visible = overflow ? others.slice(0, MAX_VISIBLE - 1) : others;
  const hiddenCount = overflow ? others.length - (MAX_VISIBLE - 1) : 0;
  const firstHidden = overflow ? others[MAX_VISIBLE - 1] : null;

  return (
    <div className="animate-in fade-in-0 slide-in-from-bottom-2 pointer-events-auto absolute bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-end gap-2 duration-200">
      <button
        type="button"
        onClick={exitSpotlight}
        title="스포트라이트 나가기 (Esc)"
        aria-label="스포트라이트 나가기"
        className="border-line bg-card/95 text-text-dim hover:text-foreground shadow-card mb-1 flex size-9 shrink-0 items-center justify-center rounded-full border backdrop-blur transition"
      >
        <X size={15} strokeWidth={2} />
      </button>
      {visible.map((w, i) => (
        <CoverCard key={w.id} win={w} accent={COVERS[i % COVERS.length]} onClick={() => focus(w.id)} />
      ))}
      {firstHidden ? (
        <button
          type="button"
          onClick={() => focus(firstHidden.id)}
          title={`${hiddenCount}개 더 — 다음 창 올리기`}
          className="border-line bg-bg-soft text-text-dim hover:border-primary/50 hover:text-foreground flex h-[72px] w-[56px] shrink-0 items-center justify-center rounded-lg border text-[13px] font-bold transition"
        >
          +{hiddenCount}
        </button>
      ) : null}
    </div>
  );
}

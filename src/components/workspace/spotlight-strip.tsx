"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Layers, X, type LucideIcon } from "lucide-react";
import { NAV_GROUPS } from "@/lib/navigation";
import { EyIcon } from "@/components/icons/eywa-icons";
import { useWindowStore } from "./window-store";

const MAX_VISIBLE = 4; // 이보다 많으면 앞 3장 부채 + "+N" 페이지 스택(책 뒤장 …처리)

// 라우트 menuKey → 아이콘(레일과 동일). 학생 요약창은 seed.
const ICON_BY_MENU: Record<string, LucideIcon> = {};
for (const g of NAV_GROUPS) for (const it of g.items) ICON_BY_MENU[it.menuKey] = it.icon;

// 아이콘 칩 tint + 책등(spine) 색 — 인덱스 순환(책 표지 느낌).
const COVERS = [
  "bg-primary/12 text-primary",
  "bg-blue/12 text-blue",
  "bg-rose/12 text-rose",
  "bg-amber/15 text-amber",
  "bg-purple/12 text-purple",
  "bg-gold/15 text-gold",
];
const SPINE = ["bg-primary", "bg-blue", "bg-rose", "bg-amber", "bg-purple", "bg-gold"];

const OVERLAP = 86; // 카드 겹침(px) — 페이지 엣지처럼 일부만 보이게(책 fore-edge)
const STEP = 7; // 부채 갈래각(deg) — 가운데 기준 좌우로 펼쳐짐
const TILT = 15; // 페이지 깊이(rotateY, deg)
const ORIGIN = "50% 96%"; // 회전 피벗(카드 하단 근처) → 위로 펼쳐지는 공작새 부채

// 앨범 한 장(페이지) — 열린 창 또는 배경 라우트. 배경 카드는 "배경" 표식 + Layers 마크로 구분.
type StripItem = {
  key: string;
  title: string;
  subtitle?: string;
  Icon: LucideIcon | null; // null → 학생 요약(seed)
  isBackground: boolean;
  onClick: () => void;
};

// 책 한 장(페이지) — 부채꼴로 겹쳐 세워두고, 호버 시 그 페이지만 펼쳐 세움(책 넘기기).
function FanCard({
  item,
  index,
  count,
  hovered,
  setHovered,
}: {
  item: StripItem;
  index: number;
  count: number; // 부채 전체 장수(가운데 정렬용)
  hovered: number | null;
  setHovered: (i: number | null) => void;
}) {
  const isHot = hovered === index;
  const mid = (count - 1) / 2;
  const spin = (index - mid) * STEP; // 가운데=0, 좌(-)·우(+)로 갈래
  const arc = Math.abs(index - mid) * 5; // 바깥장일수록 살짝 아래로(아치)

  const transform = isHot
    ? "rotate(0deg) rotateY(0deg) translateY(-22px) scale(1.07)"
    : `rotate(${spin}deg) rotateY(-${TILT}deg) translateY(${arc}px)`;

  const Icon = item.Icon;
  return (
    <button
      type="button"
      onClick={item.onClick}
      onMouseEnter={() => setHovered(index)}
      onMouseLeave={() => setHovered(null)}
      title={item.isBackground ? `${item.title} — 배경과 교체` : item.title}
      style={{
        marginLeft: index === 0 ? 0 : -OVERLAP,
        zIndex: isHot ? 100 : index + 1,
        transform,
        transformOrigin: ORIGIN,
      }}
      className={`group/card border-line shadow-card relative h-[132px] w-[176px] shrink-0 rounded-l-md rounded-r-xl border transition-transform duration-200 ease-out will-change-transform ${
        item.isBackground ? "bg-bg-soft" : "bg-card"
      }`}
    >
      {/* 책등(spine) — 왼쪽 색 띠 */}
      <span
        className={`absolute inset-y-0 left-0 w-[5px] rounded-l-md ${SPINE[index % SPINE.length]} opacity-80`}
        aria-hidden
      />
      {/* 페이지 엣지(오른쪽 fore-edge) — 종이 결 음영 */}
      <span
        className="pointer-events-none absolute inset-y-1.5 right-0 w-3.5 rounded-r-xl"
        style={{ background: "repeating-linear-gradient(90deg, rgba(13,17,16,0.06) 0 1px, transparent 1px 3px)" }}
        aria-hidden
      />
      {/* 배경 표식 */}
      {item.isBackground ? (
        <span className="text-text-faint absolute top-2 right-3 flex items-center gap-1 font-mono text-[9px] tracking-wider uppercase">
          <Layers size={10} /> 배경
        </span>
      ) : null}
      <span className="absolute inset-0 flex flex-col px-3.5 py-3 pl-5 text-left">
        <span className={`flex size-9 items-center justify-center rounded-lg ${COVERS[index % COVERS.length]}`}>
          {Icon ? <Icon size={18} strokeWidth={1.9} /> : <EyIcon name="seed" size={17} />}
        </span>
        <span className="mt-auto block min-w-0">
          <span className="text-foreground block truncate text-[12.5px] font-bold">{item.title}</span>
          <span className="text-text-faint block truncate text-[10px]">
            {item.isBackground ? "교체하기" : (item.subtitle ?? "창")}
          </span>
        </span>
      </span>
    </button>
  );
}

// 남은 페이지 묶음 — 뒤로 겹친 종이 더미 + "+N"(책 뒷장이 더 있다는 신호). 부채 오른쪽 끝 갈래.
function PageStack({
  hiddenCount,
  index,
  count,
  onClick,
}: {
  hiddenCount: number;
  index: number;
  count: number;
  onClick: () => void;
}) {
  const mid = (count - 1) / 2;
  const spin = (index - mid) * STEP;
  const arc = Math.abs(index - mid) * 5;
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${hiddenCount}개 더 — 다음 페이지 올리기`}
      style={{
        marginLeft: -OVERLAP + 26,
        zIndex: index + 1,
        transform: `rotate(${spin}deg) rotateY(-${TILT}deg) translateY(${arc}px)`,
        transformOrigin: ORIGIN,
      }}
      className="relative h-[132px] w-[120px] shrink-0 transition-transform duration-200 hover:-translate-y-2.5"
    >
      <span className="border-line bg-card absolute inset-0 translate-x-2.5 translate-y-1.5 rounded-l-md rounded-r-xl border opacity-45" aria-hidden />
      <span className="border-line bg-card absolute inset-0 translate-x-1 translate-y-0.5 rounded-l-md rounded-r-xl border opacity-70" aria-hidden />
      <span className="border-line bg-bg-soft text-text-dim shadow-card relative flex h-full w-full items-center justify-center rounded-l-md rounded-r-xl border text-[16px] font-bold">
        +{hiddenCount}
      </span>
    </button>
  );
}

/**
 * 스포트라이트 하단 커버 스트립 — 비포커스 창 + 배경 라우트를 "책 페이지"처럼 부채꼴로 겹쳐 세운다.
 * 창 카드 클릭 = 상단으로 swap, 배경 카드 클릭 = 포커스 창 ⇄ 배경 교체. 너무 많으면 "+N" 축약.
 * 좌측 나가기 버튼·Esc로 해제.
 */
export function SpotlightStrip() {
  const router = useRouter();
  const spotlight = useWindowStore((s) => s.spotlight);
  const windows = useWindowStore((s) => s.windows);
  const order = useWindowStore((s) => s.order);
  const focusedId = useWindowStore((s) => s.focusedId);
  const background = useWindowStore((s) => s.background);
  const focus = useWindowStore((s) => s.focus);
  const swapFocusedWithBackground = useWindowStore((s) => s.swapFocusedWithBackground);
  const exitSpotlight = useWindowStore((s) => s.exitSpotlight);
  const [hovered, setHovered] = useState<number | null>(null);

  useEffect(() => {
    if (!spotlight) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") exitSpotlight();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [spotlight, exitSpotlight]);

  if (!spotlight) return null;

  function swapBg(bgId: string) {
    swapFocusedWithBackground(bgId);
    // 교체 후 새 활성 배경(= 방금 내려간 옛 포커스)으로 메인 프레임 이동.
    const st = useWindowStore.getState();
    const active = st.background.find((b) => b.id === st.activeBackgroundId);
    if (active?.href) router.push(active.href);
  }

  // 포커스(상단 큰 창) 제외한 창 = 페이지(최근부터). + 배경 라우트도 페이지로(교체용).
  const windowItems: StripItem[] = order
    .filter((id) => id !== focusedId && !windows[id]?.minimized)
    .map((id) => windows[id])
    .reverse()
    .map((w) => ({
      key: w.id,
      title: w.params.title,
      subtitle: w.params.subtitle,
      Icon: w.kind === "route" ? (ICON_BY_MENU[w.params.id] ?? null) : null,
      isBackground: false,
      onClick: () => focus(w.id),
    }));
  const bgItems: StripItem[] = background.map((b) => ({
    key: `bg:${b.id}`,
    title: b.title,
    Icon: ICON_BY_MENU[b.id] ?? null,
    isBackground: true,
    onClick: () => swapBg(b.id),
  }));
  const items = [...windowItems, ...bgItems];

  const overflow = items.length > MAX_VISIBLE;
  const visible = overflow ? items.slice(0, MAX_VISIBLE - 1) : items;
  const hiddenCount = overflow ? items.length - (MAX_VISIBLE - 1) : 0;
  const firstHidden = overflow ? items[MAX_VISIBLE - 1] : null;
  const slots = visible.length + (firstHidden ? 1 : 0); // 부채 전체 장수(가운데 정렬용)

  return (
    <div className="animate-in fade-in-0 slide-in-from-bottom-3 pointer-events-auto absolute bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-end gap-3 duration-200">
      <button
        type="button"
        onClick={exitSpotlight}
        title="스포트라이트 나가기 (Esc)"
        aria-label="스포트라이트 나가기"
        className="border-line bg-card/95 text-text-dim hover:text-foreground shadow-card mb-2 flex size-9 shrink-0 items-center justify-center rounded-full border backdrop-blur transition"
      >
        <X size={15} strokeWidth={2} />
      </button>
      <div className="flex items-end pr-4" onMouseLeave={() => setHovered(null)}>
        {visible.map((item, i) => (
          <FanCard key={item.key} item={item} index={i} count={slots} hovered={hovered} setHovered={setHovered} />
        ))}
        {firstHidden ? (
          <PageStack hiddenCount={hiddenCount} index={visible.length} count={slots} onClick={firstHidden.onClick} />
        ) : null}
      </div>
    </div>
  );
}

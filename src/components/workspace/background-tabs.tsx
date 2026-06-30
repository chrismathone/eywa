"use client";

import { useRef } from "react";
import { useRouter } from "next/navigation";
import { Layers } from "lucide-react";
import { useWindowStore, type WindowParams } from "./window-store";

const POP_DRAG = 22; // 탭을 아래로(캔버스 쪽) 이만큼 끌면 창으로 꺼냄

/**
 * 배경 탭 스트립 — 헤더 우측(검색 왼쪽)에 인라인. 배경 스택이 2개 이상일 때만 노출(기본 1개=대시보드면 숨김).
 * 탭 순서 = 들어온 순서(삽입순) 고정 — 선택해도 재정렬되지 않고 하이라이트만 이동.
 * 좌클릭 = 그 배경으로 전환, 아래로 드래그/우클릭 = 창으로 꺼내기(backgroundToWindow).
 */
export function BackgroundTabs() {
  const router = useRouter();
  const background = useWindowStore((s) => s.background);
  const activeId = useWindowStore((s) => s.activeBackgroundId);
  const setBackground = useWindowStore((s) => s.setBackground);
  const backgroundToWindow = useWindowStore((s) => s.backgroundToWindow);
  const spotlight = useWindowStore((s) => s.spotlight);

  if (background.length <= 1) return null;
  // 앨범(스포트라이트) 모드에선 포커스 창이 배경을 완전히 덮는다 → 배경탭은 의미가 없고, 활성 배경
  // 하이라이트가 실제 보이는 배경과 어긋나 보일 수 있어(현재 라우트가 배경 스택 밖일 때) 숨긴다.
  if (spotlight) return null;

  function popToWindow(id: string) {
    backgroundToWindow(id);
    // 활성(보이는) 배경을 꺼냈다면 새 활성 배경으로 메인 프레임 이동. 아니면 현재 경로라 무동작.
    const st = useWindowStore.getState();
    const active = st.background.find((b) => b.id === st.activeBackgroundId);
    if (active?.href) router.push(active.href);
  }

  function selectBackground(b: WindowParams) {
    // 하이라이트를 즉시(결정적) 갱신 + 메인 프레임 이동. pathname 효과가 같은 값을 재확인(멱등).
    setBackground(b);
    if (b.href) router.push(b.href);
  }

  return (
    <div
      data-slot="background-tabs"
      className="border-line bg-card hidden min-w-0 items-center gap-1 rounded-full border py-1 pr-2 pl-1.5 md:flex"
    >
      <span className="text-text-faint mr-0.5 flex items-center gap-1 font-mono text-[10px] tracking-wider uppercase">
        <Layers size={11} /> 배경
      </span>
      {background.map((b) => (
        <BackgroundTab
          key={b.id}
          b={b}
          active={b.id === activeId}
          onSelect={selectBackground}
          onPop={popToWindow}
        />
      ))}
    </div>
  );
}

/** 배경 탭 1개 — 좌클릭=전환, 아래로 드래그=창으로 꺼내기(우클릭도 동일). 드래그 시 click 억제. */
function BackgroundTab({
  b,
  active,
  onSelect,
  onPop,
}: {
  b: WindowParams;
  active: boolean;
  onSelect: (b: WindowParams) => void;
  onPop: (id: string) => void;
}) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const dragged = useRef(false);

  return (
    <button
      type="button"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        start.current = { x: e.clientX, y: e.clientY };
        dragged.current = false;
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (!s || dragged.current) return;
        const dy = e.clientY - s.y;
        const dx = e.clientX - s.x;
        // 아래로(캔버스 쪽) 충분히 끌면 창으로 꺼냄. 수평 우세 이동은 무시(오작동 방지).
        if (dy > POP_DRAG && Math.abs(dy) >= Math.abs(dx)) {
          dragged.current = true;
          onPop(b.id); // 이 버튼은 곧 언마운트 → 뒤따르는 click 미발생
        }
      }}
      onPointerUp={(e) => {
        e.currentTarget.releasePointerCapture?.(e.pointerId);
        start.current = null;
      }}
      onClick={() => {
        if (dragged.current) {
          dragged.current = false;
          return;
        }
        onSelect(b);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onPop(b.id);
      }}
      title={`${b.title} — 클릭: 이 배경 보기 / 아래로 드래그·우클릭: 창으로 꺼내기`}
      className={`max-w-[120px] cursor-grab touch-none truncate rounded-full px-2.5 py-0.5 text-[12px] transition active:cursor-grabbing ${
        active ? "bg-primary text-primary-foreground" : "text-text-dim hover:bg-bg-soft"
      }`}
    >
      {b.title}
    </button>
  );
}

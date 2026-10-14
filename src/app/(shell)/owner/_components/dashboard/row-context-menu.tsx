"use client";

import { useEffect, useLayoutEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import s from "./live-editor.module.css";

export type RowMenuItem = { label: string; run: () => void; danger?: boolean };
/** `source` = 메뉴를 연 순간의 배치 서명(자리 + 제목·옵션 전부) — 그사이 배치가 바뀌면(되돌리기 등) 옛 배치로 계산한 항목이 되살아나지 않게 메뉴를 내린다. */
export type RowMenuState = { x: number; y: number; title: string; at: number; items: RowMenuItem[]; source: unknown };

/**
 * 캔버스 우클릭 메뉴(원장 2026-10-14 *"원하는 곳에서 우클릭해서 이곳에 행 추가"*) — 문서 맨 위에 떠서(포털 + fixed)
 * 카드 경계에 잘리지 않는다([[#128]]). 화면 밖으로 나가지 않게 자리를 고치고, 바깥 클릭·Esc·스크롤(휠·스크롤바·키)·창 크기 변경·
 * 초점이 메뉴 밖으로 나갈 때(Tab) 닫힌다.
 * 화살표·Enter로도 고를 수 있다. 첫 프레임은 visibility가 아니라 opacity로 숨긴다(#128 — 숨긴 채로는 초점이 안 간다).
 */
export function RowContextMenu({ menu, close }: { menu: RowMenuState; close: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    el.style.left = `${Math.max(4, Math.min(menu.x, window.innerWidth - box.width - 4))}px`;
    el.style.top = `${Math.max(4, Math.min(menu.y, window.innerHeight - box.height - 4))}px`;
    el.style.opacity = "1";
    el.style.pointerEvents = "auto";
    el.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
  }, [menu]);
  useEffect(() => {
    const outside = (ev: Event) => { if (!root.current?.contains(ev.target as Node)) close(); };
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("wheel", outside, true);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("wheel", outside, true);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [close]);
  const onKey = (ev: ReactKeyboardEvent) => {
    const buttons = [...(root.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); close(); }
    else if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      buttons[(i + (ev.key === "ArrowDown" ? 1 : buttons.length - 1)) % buttons.length]?.focus();
    }
  };
  if (typeof document === "undefined") return null;
  return createPortal(
    <div ref={root} role="menu" aria-label={menu.title} className={s.rowMenu} style={{ left: menu.x, top: menu.y, opacity: 0, pointerEvents: "none" }}
      onKeyDown={onKey} onContextMenu={(ev) => ev.preventDefault()}
      onBlur={(ev) => { if (ev.relatedTarget && !root.current?.contains(ev.relatedTarget as Node)) close(); }}>
      <div className={s.rowMenuTitle}>{menu.title}</div>
      {menu.items.map((item) => (
        <button key={item.label} type="button" role="menuitem" data-danger={item.danger || undefined}
          onClick={() => { close(); item.run(); }}>{item.label}</button>
      ))}
    </div>,
    document.body,
  );
}

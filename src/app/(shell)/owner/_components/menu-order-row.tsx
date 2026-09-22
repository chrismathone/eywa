"use client";

import type { ReactNode } from "react";

import { EyIcon, type AywaIconName } from "@/components/icons/aywa-icons";
import { MenuGlyph } from "@/components/icons/menu-glyph";

/**
 * '탭 및 메뉴 구성'의 한 줄(표시 체크 · 그림 · 이름 · 안내 · 순서 버튼) — 관리자뷰·강사뷰 편집기가 **같은 모양**을 쓴다.
 * 두 목록이 다른 줄 모양이면 같은 화면의 두 면이 다른 도구처럼 읽힌다.
 */
export function MenuOrderRow({
  label,
  icon,
  on,
  locked = false,
  hints,
  first,
  last,
  onToggle,
  onMove,
}: {
  label: string;
  icon: AywaIconName;
  /** 지금 표시 중인가(체크). */
  on: boolean;
  /** 감출 수 없는 줄 — 체크가 잠기고 늘 켜진 채로 보인다. */
  locked?: boolean;
  /** 이름 아래 작은 안내 줄들(왜 안 보일 수 있는지 등). */
  hints?: ReactNode[];
  first: boolean;
  last: boolean;
  onToggle: () => void;
  onMove: (delta: -1 | 1) => void;
}) {
  const shown = on || locked;
  return (
    <li className="border-line flex items-center gap-2 rounded-lg border px-2 py-1.5">
      <input
        type="checkbox"
        checked={shown}
        disabled={locked}
        onChange={onToggle}
        aria-label={`${label} 표시`}
        className="border-line accent-primary size-4 shrink-0 rounded disabled:opacity-50"
      />
      <MenuGlyph name={icon} size={18} className="shrink-0" />
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-xs font-bold ${shown ? "text-foreground" : "text-text-faint line-through"}`}>
          {label}
        </span>
        {hints?.filter(Boolean).map((h, i) => (
          <span key={i} className="text-text-faint block text-xs">
            {h}
          </span>
        ))}
      </span>
      <span className="flex shrink-0 items-center gap-0.5">
        <OrderButton label={`${label} 위로`} disabled={first} onClick={() => onMove(-1)} icon="arrowUp" />
        <OrderButton label={`${label} 아래로`} disabled={last} onClick={() => onMove(1)} icon="arrowDown" />
      </span>
    </li>
  );
}

/** 순서 이동 버튼 — 조작 자리라 선화(EyIcon). 문자 화살표(▲▼)는 글리프 가드가 막는다. */
function OrderButton({
  label,
  disabled,
  onClick,
  icon,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  icon: "arrowUp" | "arrowDown";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="text-text-faint hover:text-foreground hover:bg-bg-soft rounded p-1 disabled:opacity-30 disabled:hover:bg-transparent"
    >
      <EyIcon name={icon} size={14} />
    </button>
  );
}

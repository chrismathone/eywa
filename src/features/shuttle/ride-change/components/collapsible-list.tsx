"use client";

import { Children, useState, type ReactNode } from "react";

/**
 * 긴 내역을 **앞 몇 건만** 보여 주고 나머지는 [펼쳐보기]로 — 관리자 '학부모 등하원' 카드의 변경 내역(사용자 2026-09-30
 * "한번에 다 보이니 너무 정신이 없다"). 최신이 먼저라 접어도 가장 최근 변경은 늘 보인다.
 * 🔑 접은 줄 수를 버튼에 적는다(몇 건이 숨었는지 모르면 접기가 은폐가 된다).
 * 펼침 상태는 화면 안의 일시 상태라 계정에 저장하지 않는다(보기 설정이 아니라 한 번 들여다보는 동작).
 */
export function CollapsibleList({
  children,
  initial = 2,
  className,
}: {
  /** 한 건 = 자식 하나(`<li>`). */
  children: ReactNode;
  /** 접혀 있을 때 보여 줄 건수. */
  initial?: number;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const items = Children.toArray(children);
  const hidden = items.length - initial;
  return (
    <>
      <ol className={className}>{open || hidden <= 0 ? items : items.slice(0, initial)}</ol>
      {hidden > 0 ? (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="text-primary mt-1 text-xs font-bold"
        >
          {open ? "접기" : `펼쳐보기 · ${hidden}건 더`}
        </button>
      ) : null}
    </>
  );
}

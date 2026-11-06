"use client";

import { useEffect, type RefObject } from "react";

/**
 * 칸을 꽉 채운 카드의 몸통 — 넘치면 스크롤바 없이 위·아래 가장자리를 흐리게(원장 2026-11-05 *"스크롤 없이 페이드아웃효과를 주고
 * 스크롤 되게"*). `data-fade` = top · bottom · both(스타일은 layout.module.css `.scrollBody`). 내용이 바뀌거나 칸 크기가 바뀌어도 다시 잰다.
 */
export function useScrollFade(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const top = el.scrollTop > 2;
      const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 2;
      const v = top && bottom ? "both" : bottom ? "bottom" : top ? "top" : "";
      if (v) el.setAttribute("data-fade", v);
      else el.removeAttribute("data-fade");
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    const mo = new MutationObserver(update);
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
      mo.disconnect();
    };
  }, [ref]);
}

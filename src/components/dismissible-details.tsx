"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useOutsideDismiss } from "@/components/forms/use-outside-dismiss";

/**
 * 상세 상자를 **띄워서** 펼치는 `<details>` — 바깥을 누르거나 Esc면 닫는다.
 * 흐름 안에서 펼치는 `<details>`는 아래를 밀어낼 뿐이라 summary만으로 충분하지만, 띄운 상자는 아래 툴바를 덮으므로
 * 닫을 길이 더 있어야 한다(gotcha #128). 바깥 클릭은 닫기만 하고 아래 버튼까지 가지 않는다(`useOutsideDismiss` 규약).
 * - Esc는 문서 어디에 초점이 있어도 닫는다(본문을 눌러 글을 고르면 초점이 상자 밖으로 나간다).
 * - JS가 붙기 전에 열린 상자도 붙는 순간 열린 것으로 본다(서버 렌더라 첫 클릭이 하이드레이션보다 빠를 수 있다).
 */
export function DismissibleDetails({ className, children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement | null>(null);
  const [open, setOpen] = useState(false);
  const attach = useCallback((el: HTMLDetailsElement | null) => {
    ref.current = el;
    if (el?.open) setOpen(true);
  }, []);
  const close = useCallback((refocus: boolean) => {
    const el = ref.current;
    if (el) el.open = false;
    setOpen(false);
    if (refocus) el?.querySelector("summary")?.focus();
  }, []);
  useOutsideDismiss(open, (target) => ref.current?.contains(target) ?? false, () => close(false));
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      close(true);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, close]);
  return (
    <details ref={attach} className={className} onToggle={(e) => setOpen(e.currentTarget.open)}>
      {children}
    </details>
  );
}

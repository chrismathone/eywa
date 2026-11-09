"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import styles from "./overlay-guide.module.css";

/**
 * 안내(기준·설명) = 펼침이 아니라 오버레이 — 눌러도 페이지 길이가 변하지 않는다(원장 2026-11-09 *"항상 안내는 이런식으로"*).
 * 단추 바로 아래에 떠서 내용을 덮고, 바깥을 누르거나 Esc로 닫는다. `<details>`로 본문을 밀어내는 안내는 이것으로 바꾼다.
 */
export function OverlayGuide({ label, children, className = "", align = "start" }: { label: ReactNode; children: ReactNode; className?: string; /** 오른쪽 끝에 놓인 단추면 "end" — 안내가 화면 밖으로 나가지 않게 오른쪽에 맞춘다. */ align?: "start" | "end" }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  return (
    <div ref={root} className={`${styles.root} ${className}`}>
      <button type="button" className={styles.trigger} aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>
        <span aria-hidden className={styles.mark}>i</span>{label}<span aria-hidden className={styles.caret}>{open ? "▴" : "▾"}</span>
      </button>
      {open ? (
        <div id={id} role="dialog" aria-label={typeof label === "string" ? label : "안내"} className={`${styles.panel} ${align === "end" ? styles.end : ""}`}>
          <button type="button" className={styles.close} aria-label="닫기" onClick={() => setOpen(false)}>×</button>
          {children}
        </div>
      ) : null}
    </div>
  );
}

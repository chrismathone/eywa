"use client";

import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import styles from "./mobile-scroll-row.module.css";

const ScrollRowContext = createContext(false);
export const useMobileScrollRow = () => useContext(ScrollRowContext);

/** Preserve a desktop row on touch screens; fades indicate only the hidden content. */
export function MobileScrollRow({ children, className = "" }: { children: ReactNode; className?: string }) {
  const viewport = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const update = () => {
      el.parentElement!.dataset.left = String(el.scrollLeft > 1);
      el.parentElement!.dataset.right = String(el.scrollLeft < el.scrollWidth - el.clientWidth - 1);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    el.addEventListener("scroll", update, { passive: true });
    return () => {
      observer.disconnect();
      el.removeEventListener("scroll", update);
    };
  }, []);

  return (
    <ScrollRowContext.Provider value={true}>
      <div className={`${styles.row} ${className}`} data-mobile-scroll-row="">
        <div ref={viewport} className={styles.viewport}>
          <div className={styles.content}>{children}</div>
        </div>
      </div>
    </ScrollRowContext.Provider>
  );
}

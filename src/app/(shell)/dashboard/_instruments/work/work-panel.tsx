"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { EyIcon } from "@/components/icons/aywa-icons";
import { useWorkRaised } from "./work-context";

/** 업무 창 껍데기 — 상세 창과 같은 모양(오른쪽에서 열림 · Esc로 닫힘 · 닫으면 연 자리로 초점). */
export function WorkPanel({ eyebrow, title, onClose, children }: { eyebrow: string; title: string; onClose: () => void; children: ReactNode }) {
  const panel = useRef<HTMLElement>(null);
  const raised = useWorkRaised();
  useEffect(() => {
    const from = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() => panel.current?.focus({ preventScroll: true }));
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => { cancelAnimationFrame(frame); document.removeEventListener("keydown", onKey); if (from?.isConnected) from.focus({ preventScroll: true }); };
  }, [onClose]);
  return createPortal(
    // `work-layer` = 강사 홈에서만 셸 머리글(미니셸 z-60) 위로(work.css) — 운영실 · 업무 완성도는 종전 층(사이드바 · 공지 팝업과의 위아래 그대로).
    <div className={raised ? "aywa-instruments work-layer" : "aywa-instruments"}>
      <div className="drawer-root is-open">
        <div className="drawer-scrim" onClick={onClose} />
        <aside ref={panel} className="drawer work-drawer" role="dialog" aria-modal="true" aria-labelledby="work-title" tabIndex={-1}>
          <header className="drawer-head">
            <div><span className="drawer-period">{eyebrow}</span><h2 id="work-title">{title}</h2></div>
            <button type="button" className="drawer-close" onClick={onClose} aria-label="닫기"><EyIcon name="close" size={16} aria-hidden /></button>
          </header>
          <div className="drawer-body">{children}</div>
        </aside>
      </div>
    </div>,
    document.body,
  );
}

/** 단계 막대 — 담당자 보고 · 관리자 검토 · 마감. */
export function StagePips({ stage, text }: { stage: number; text: string }) {
  return <span className="work-pips">{[0, 1, 2].map((i) => <i key={i} className={i < stage ? "done" : i === stage ? "now" : undefined} />)}<b>{text}</b></span>;
}

export const md = (iso: string | null) => (iso ? `${Number(iso.slice(5, 7))}.${iso.slice(8, 10)}` : "—");
/** 표 칸용 짧은 시각 — `10.21 13:00`(KST). */
export function stamp(iso: string): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.month}.${p.day} ${p.hour === "24" ? "00" : p.hour}:${p.minute}`;
}
export const hm = (iso: string) => new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { useNoticeDismiss } from "../popup-store";
import type { ActivePopup } from "../server/queries";

/**
 * 공지 팝업 카드 — 그리드(flex-wrap) 아이템. 절대배치·드래그 없이 부모 레이어가 앵커별로 타일링한다(겹침 없음).
 * footer 체크박스("7일간/다시 보지 않기")로 dismiss(브라우저 localStorage). 닫기=헤더 X 또는 footer 닫기.
 */
export function NoticePopupCard({ popup }: { popup: ActivePopup }) {
  const dismiss = useNoticeDismiss((s) => s.dismiss);
  const [closed, setClosed] = useState(false);
  const [dontWeek, setDontWeek] = useState(false);
  const [dontForever, setDontForever] = useState(false);

  if (closed) return null;

  const close = () => {
    if (dontForever) dismiss(popup.id, "forever", popup.updatedAt);
    else if (dontWeek) dismiss(popup.id, "week", popup.updatedAt);
    setClosed(true);
  };

  return (
    <div
      className="pointer-events-auto bg-card border-line shadow-modal animate-in fade-in-0 zoom-in-95 flex max-h-[82vh] flex-col overflow-hidden rounded-xl border duration-200"
      style={{ width: popup.width, maxWidth: "calc(100vw - 2rem)" }}
      role="dialog"
      aria-label={popup.title}
    >
      <header className="bg-bg-soft border-line flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2">
        <span className="text-foreground truncate text-[13px] font-bold">{popup.title}</span>
        <button
          type="button"
          aria-label="닫기"
          onClick={close}
          className="text-text-dim hover:bg-line-strong/30 hover:text-foreground flex size-6 shrink-0 items-center justify-center rounded-[3px] transition"
        >
          <X size={15} strokeWidth={2} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {popup.imageSrc ? (
          popup.linkUrl ? (
            <a href={popup.linkUrl} target="_blank" rel="noopener noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element -- signed/외부 URL 이미지 */}
              <img src={popup.imageSrc} alt={popup.title} className="block w-full" />
            </a>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- signed/외부 URL 이미지
            <img src={popup.imageSrc} alt={popup.title} className="block w-full" />
          )
        ) : null}
        {popup.body ? (
          <p className="text-text-dim px-4 py-3 text-sm whitespace-pre-wrap">{popup.body}</p>
        ) : null}
        {popup.linkUrl ? (
          <div className="px-4 pb-3">
            <a
              href={popup.linkUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-primary hover:bg-primary/90 inline-flex items-center rounded-md px-3 py-1.5 text-xs font-semibold text-white transition"
            >
              {popup.linkLabel || "자세히 보기"}
            </a>
          </div>
        ) : null}
      </div>

      <footer className="border-line bg-bg-soft/50 flex shrink-0 flex-wrap items-center justify-between gap-2 border-t px-3 py-2">
        <div className="text-text-dim flex items-center gap-3 text-[11px]">
          <label className="flex cursor-pointer items-center gap-1">
            <input type="checkbox" checked={dontWeek} onChange={(e) => setDontWeek(e.target.checked)} />
            7일간 보지 않기
          </label>
          <label className="flex cursor-pointer items-center gap-1">
            <input type="checkbox" checked={dontForever} onChange={(e) => setDontForever(e.target.checked)} />
            다시 보지 않기
          </label>
        </div>
        <button
          type="button"
          onClick={close}
          className="border-line text-text-dim hover:bg-bg-soft hover:text-foreground rounded-md border px-2.5 py-1 text-xs transition"
        >
          닫기
        </button>
      </footer>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "@/components/icons/eywa-icon-compat";
import { useNoticeDismiss } from "../popup-store";
import type { ActivePopup } from "../server/queries";

/**
 * 공지 팝업 카드 — 그리드(flex-wrap) 아이템. 절대배치·드래그 없이 부모 레이어가 앵커별로 타일링한다(겹침 없음).
 * footer 체크박스("7일간/다시 보지 않기")로 dismiss(브라우저 localStorage). 닫기=헤더 X 또는 footer 닫기.
 * 이미지 클릭 = 원본 크기 라이트박스(카드 폭에 맞춰 축소된 썸네일을 화면 가득 크게 — body 포털 z-100, 레이어 z-55 위).
 */
export function NoticePopupCard({ popup }: { popup: ActivePopup }) {
  const dismiss = useNoticeDismiss((s) => s.dismiss);
  const [closed, setClosed] = useState(false);
  const [dontWeek, setDontWeek] = useState(false);
  const [dontForever, setDontForever] = useState(false);
  const [zoomed, setZoomed] = useState(false);

  // 라이트박스 열림 중 Esc로 닫기(이벤트 핸들러라 #25 effect-setState 룰 무관 — 리스너 등록/해제만).
  useEffect(() => {
    if (!zoomed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setZoomed(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomed]);

  if (closed) return null;

  const close = () => {
    if (dontForever) dismiss(popup.id, "forever", popup.updatedAt);
    else if (dontWeek) dismiss(popup.id, "week", popup.updatedAt);
    setClosed(true);
  };

  return (
    <>
      <div
        className="pointer-events-auto bg-card border-line shadow-modal animate-in fade-in-0 zoom-in-95 flex max-h-[82vh] flex-col overflow-hidden rounded-2xl border duration-200"
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
            className="text-text-dim hover:bg-line-strong/30 hover:text-foreground flex size-6 shrink-0 items-center justify-center rounded-xs transition"
          >
            <X size={15} strokeWidth={1.8} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {popup.imageSrc ? (
            <button
              type="button"
              onClick={() => setZoomed(true)}
              className="block w-full cursor-zoom-in"
              title="클릭하면 원본 크기로 봅니다"
              aria-label="이미지 원본 크기로 보기"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- signed/외부 URL 이미지 */}
              <img src={popup.imageSrc} alt={popup.title} className="block w-full" />
            </button>
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
                className="bg-primary hover:bg-primary/90 inline-flex items-center rounded-lg px-3 py-1.5 text-xs font-bold text-white transition"
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
              <input
                type="checkbox"
                checked={dontForever}
                onChange={(e) => setDontForever(e.target.checked)}
              />
              다시 보지 않기
            </label>
          </div>
          <button
            type="button"
            onClick={close}
            className="border-line text-text-dim hover:bg-bg-soft hover:text-foreground rounded-lg border px-2.5 py-1 text-xs transition"
          >
            닫기
          </button>
        </footer>
      </div>

      {/* 원본 크기 라이트박스 — body 포털(레이어 z-55 위). 바깥/X/Esc로 닫힘. 이미지는 화면에 꽉 차게(원본보다 크게 확대는 안 함).
          print:hidden = body 포털이라 레이어의 print:hidden을 상속 못 받음 → 열린 채 인쇄 시 오버레이가 문서 위에 찍히는 것 차단(인쇄 감사 ⑤⑥ 패턴). */}
      {zoomed && popup.imageSrc && typeof document !== "undefined"
        ? createPortal(
            <div
              className="bg-ink/85 animate-in fade-in-0 fixed inset-0 z-[100] flex items-center justify-center p-4 backdrop-blur-sm duration-150 print:hidden"
              onClick={() => setZoomed(false)}
              role="dialog"
              aria-modal="true"
              aria-label={`${popup.title} 이미지`}
            >
              <button
                type="button"
                aria-label="닫기"
                onClick={() => setZoomed(false)}
                className="fixed top-4 right-4 z-[101] flex size-9 items-center justify-center rounded-full bg-black/40 text-white transition hover:bg-black/60"
              >
                <X size={20} />
              </button>
              {/* eslint-disable-next-line @next/next/no-img-element -- signed/외부 URL 이미지 */}
              <img
                src={popup.imageSrc}
                alt={popup.title}
                className="max-h-[92vh] max-w-[92vw] cursor-zoom-out rounded-md object-contain shadow-2xl"
                onClick={() => setZoomed(false)}
              />
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

"use client";

import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { createPortal } from "react-dom";
import { X } from "@/components/icons/eywa-icon-compat";
import { WindowLink } from "@/components/workspace/window-link";
import { useNoticeDismiss } from "../popup-store";
import type { ActivePopup } from "../server/queries";

const LINK_CLASS =
  "bg-primary hover:bg-primary/90 inline-flex items-center rounded-lg px-3 py-1.5 text-xs font-bold text-white transition";

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
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  // 라이트박스 열림 중 Esc로 닫기(이벤트 핸들러라 #25 effect-setState 룰 무관 — 리스너 등록/해제만).
  useEffect(() => {
    if (!zoomed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setZoomed(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomed]);

  // ── 헤더를 잡고 옮기기 ──────────────────────────────────────
  // 레이어가 앵커로 타일링하므로 위치 자체는 건드리지 않고 **옮긴 만큼의 오프셋**만 기억한다.
  // 이동 중엔 store도 서버도 안 건드린다(팝업은 세션 동안만 그 자리에 있으면 충분).
  // ⚠️ 훅은 early return(`closed`)보다 **위**에 있어야 한다(rules-of-hooks).
  const drag = useRef<{ sx: number; sy: number; ox: number; oy: number; id: number } | null>(null);
  const startDrag = (e: RPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return; // 좌클릭만 — 우클릭 메뉴·보조버튼은 그대로
    if ((e.target as HTMLElement).closest("button")) return; // 닫기 X를 누르는 중이면 드래그 아님
    drag.current = { sx: e.clientX, sy: e.clientY, ox: offset.x, oy: offset.y, id: e.pointerId };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onDrag = (e: RPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    setOffset({ x: d.ox + (e.clientX - d.sx), y: d.oy + (e.clientY - d.sy) });
  };
  const endDrag = (e: RPointerEvent<HTMLElement>) => {
    if (!drag.current) return;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  if (closed) return null;

  // 사이트 안쪽 경로인가 — `//`(프로토콜 상대)는 외부라 제외한다.
  const isInternal = !!popup.linkUrl && popup.linkUrl.startsWith("/") && !popup.linkUrl.startsWith("//");

  const close = () => {
    if (dontForever) dismiss(popup.id, "forever", popup.updatedAt);
    else if (dontWeek) dismiss(popup.id, "week", popup.updatedAt);
    setClosed(true);
  };

  return (
    <>
      <div
        // 흰 카드 + 얇은 회색 테두리라 흰 배경 페이지에 묻혀 "팝업인지 아닌지" 구분이 안 됐다
        // (원장 지적 2026-07-31). 테두리를 진하게 + 브랜드색 링 + 그림자를 키워 경계를 세운다.
        className="pointer-events-auto bg-card border-line-strong ring-primary/15 animate-in fade-in-0 zoom-in-95 flex max-h-[82vh] flex-col overflow-hidden rounded-2xl border shadow-2xl ring-4 duration-200"
        style={{
          width: popup.width,
          maxWidth: "calc(100vw - 2rem)",
          // 사용자가 옮긴 만큼만 원위치에서 밀어준다(레이어 타일링은 그대로 두고 시각적 이동만).
          transform: offset.x || offset.y ? `translate(${offset.x}px, ${offset.y}px)` : undefined,
        }}
        role="dialog"
        aria-label={popup.title}
      >
        {/* 헤더 = 이동 손잡이. 팝업이 화면 정중앙에 고정돼 뒤를 가리면 치울 방법이 없었다(원장 지적 2026-07-31). */}
        <header
          onPointerDown={startDrag}
          onPointerMove={onDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className="bg-primary flex shrink-0 cursor-grab items-center justify-between gap-2 px-3 py-2 text-white select-none active:cursor-grabbing"
        >
          <span className="truncate text-[13px] font-bold">{popup.title}</span>
          <button
            type="button"
            aria-label="닫기"
            onClick={close}
            className="flex size-6 shrink-0 items-center justify-center rounded-xs text-white/80 transition hover:bg-white/20 hover:text-white"
          >
            <X size={15} strokeWidth={1.8} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {popup.imageSrc ? (
            // 링크가 있는 공지는 **사진을 눌러도 그리로 간다**(원장 지시 2026-07-31) — 안내 이미지를
            // 보고 "그래서 어디로 가지?"가 되지 않게. 링크 없는 공지는 종전대로 원본 크기 확대.
            isInternal ? (
              <WindowLink
                href={popup.linkUrl!}
                title={popup.linkLabel || popup.title}
                onNavigate={close}
                className="block w-full cursor-pointer"
                ariaLabel={`${popup.linkLabel || popup.title}(으)로 이동`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- signed/외부 URL 이미지 */}
                <img src={popup.imageSrc} alt={popup.title} className="block w-full" />
              </WindowLink>
            ) : (
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
            )
          ) : null}
          {popup.body ? (
            <p className="text-text-dim px-4 py-3 text-sm whitespace-pre-wrap">{popup.body}</p>
          ) : null}
          {popup.linkUrl ? (
            <div className="px-4 pb-3">
              {/* 내부 경로(/me 등)를 `target="_blank"`로 열면 **새 탭에서 셸이 다시 뜨고 이 팝업도 다시 뜬다**
                  → 눌러도 제자리처럼 보이는 무한 루프(원장 제보 2026-07-31). 내부는 창 시스템으로 열고
                  팝업은 닫는다([[#86]]). 외부 링크(http…)만 새 탭 유지. */}
              {isInternal ? (
                <WindowLink
                  href={popup.linkUrl}
                  title={popup.linkLabel || popup.title}
                  onNavigate={close}
                  className={LINK_CLASS}
                >
                  {popup.linkLabel || "자세히 보기"}
                </WindowLink>
              ) : (
                <a href={popup.linkUrl} target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>
                  {popup.linkLabel || "자세히 보기"}
                </a>
              )}
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

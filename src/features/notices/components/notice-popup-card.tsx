"use client";

import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { createPortal } from "react-dom";
// 강사뷰 화면 언어(2026-09-03) — 껍데기 글자만. 제목·본문은 0249a 번역 캐시가 맡는다.
import { useSheetT } from "@/features/teacher-view/lang-context";
import { X } from "@/components/icons/eywa-icon-compat";
import { WindowLink } from "@/components/workspace/window-link";
import type { DismissMode } from "../dismiss";
import { dismissNoticePopup, undismissNoticePopup } from "../server/dismiss-actions";
import type { ActivePopup } from "../server/queries";

const LINK_CLASS =
  "bg-primary hover:bg-primary/90 inline-flex items-center rounded-lg px-3 py-1.5 text-xs font-bold text-white transition";

/**
 * 공지 팝업 카드 — 그리드(flex-wrap) 아이템. 절대배치·드래그 없이 부모 레이어가 앵커별로 타일링한다(겹침 없음).
 * footer 체크박스("7일간/다시 보지 않기")로 dismiss — **계정 단위 DB 저장**(0162a). 닫기=헤더 X 또는 footer 닫기.
 * ⚠️ 저장은 **체크하는 순간**이다(닫을 때가 아니라). 옛 구현은 닫기 핸들러에서만 기록해, 체크만 하고
 * 새로고침·이동하면 조용히 날아갔다 — 링크 클릭으로 카드가 닫히는 경로까지 생겨 더 잦아졌다.
 * 두 체크박스는 상호배타(한쪽을 켜면 다른 쪽이 꺼진다) — 같은 축의 강도 선택이라 동시 선택은 뜻이 없다.
 * 이미지 클릭 = 원본 크기 라이트박스(카드 폭에 맞춰 축소된 썸네일을 화면 가득 크게 — body 포털 z-100, 레이어 z-55 위).
 */
export function NoticePopupCard({ popup }: { popup: ActivePopup }) {
  // 껍데기 글자만 사전을 탄다 — 제목·본문·링크 라벨은 **서버가 이미 번역본으로 내려준다**(0249a).
  const t = useSheetT();
  const [closed, setClosed] = useState(false);
  const [mode, setMode] = useState<DismissMode | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
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

  // 닫기는 이 화면에서 치우기만 한다 — "안 보기" 저장은 이미 체크 시점에 끝났다(위 주석).
  const close = () => setClosed(true);

  /** 체크 즉시 저장(해제면 삭제). 실패하면 체크 상태를 되돌리고 이유를 보여준다 — 조용히 삼키면 다음 진입에 또 뜬다. */
  const choose = async (next: DismissMode | null) => {
    const prev = mode;
    setMode(next); // 낙관적 반영(왕복 동안 체크가 튀지 않게)
    setSaveError(null);
    setSaving(true);
    const res = next === null
      ? await undismissNoticePopup(popup.id)
      : await dismissNoticePopup(popup.id, next);
    setSaving(false);
    if ("error" in res) {
      setMode(prev);
      setSaveError(res.error);
    }
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
          <span className="truncate text-sm font-bold">{popup.title}</span>
          <button
            type="button"
            aria-label={t("popup.close")}
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
                title={t("popup.zoomTitle")}
                aria-label={t("popup.zoomAria")}
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
                  {popup.linkLabel || t("popup.more")}
                </WindowLink>
              ) : (
                <a href={popup.linkUrl} target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>
                  {popup.linkLabel || t("popup.more")}
                </a>
              )}
            </div>
          ) : null}
        </div>

        <footer className="border-line bg-bg-soft/50 flex shrink-0 flex-wrap items-center justify-between gap-2 border-t px-3 py-2">
          <div className="text-text-dim flex items-center gap-3 text-xs">
            <label className="flex cursor-pointer items-center gap-1">
              <input
                type="checkbox"
                checked={mode === "week"}
                disabled={saving}
                onChange={(e) => void choose(e.target.checked ? "week" : null)}
              />
              {t("popup.hideWeek")}
            </label>
            <label className="flex cursor-pointer items-center gap-1">
              <input
                type="checkbox"
                checked={mode === "forever"}
                disabled={saving}
                onChange={(e) => void choose(e.target.checked ? "forever" : null)}
              />
              {t("popup.hideForever")}
            </label>
          </div>
          <button
            type="button"
            onClick={close}
            className="border-line text-text-dim hover:bg-bg-soft hover:text-foreground rounded-lg border px-2.5 py-1 text-xs transition"
          >
            {t("popup.close")}
          </button>
          {saveError ? (
            <p role="status" className="text-danger w-full text-xs">
              {saveError}
            </p>
          ) : null}
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
                aria-label={t("popup.close")}
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

"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HOVER_CARD_MAX_H, HOVER_CARD_SHELL, HOVER_CARD_WIDTH } from "./card-style";
import { decodeTip, TIP_ATTR, type ResolvedTip } from "./tip";

/**
 * **앱 전역 메모 툴팁** — `data-tip`을 단 자리에 마우스를 올리면 시간표 학생 카드와 **같은 모양**의 카드가 뜬다.
 *
 * 원장 2026-09-15: *"왠만하면 모든 곳의 메모는 시간표에서 사진올린것처럼 생기면 좋겠네. 그냥 메모처럼하니까
 * 너무 보기가 불편하다랄까?"* — 브라우저 기본 툴팁(회색 메모 상자)을 앱 카드로 바꾼다.
 *
 * 🔑 **문서마다 한 장**이다(루트 레이아웃에 한 번 마운트 · 창=iframe이라 창마다 한 장). 칸은 속성 한 줄만 달고
 *    이 레이어가 그리므로, 출석부처럼 칸이 수천 개인 격자에서도 칸당 비용이 0이다(상태·이벤트·포털 없음).
 * 🔴 **`title`과 같이 쓰지 말 것** — 둘 다 달면 카드 옆에 회색 메모 상자가 겹쳐 뜬다(고치려던 그 모양이다).
 * ⚠️ 터치엔 hover가 없다 — 기본 툴팁도 마찬가지였으니 **손해는 없지만**, 폰에서 꼭 읽혀야 하는 사실은
 *    툴팁이 아니라 글자로 적을 것(디자인 규약).
 */

/** 카드가 뜨기까지 기다리는 시간(ms) — 격자를 스칠 때 카드가 번쩍이지 않게. 한 장이 떠 있는 동안엔 즉시 갈아탄다. */
const OPEN_DELAY_MS = 300;
/** 커서에서 카드까지 띄우는 거리(px) — 커서가 카드에 가려지지 않게. */
const CURSOR_GAP = 16;
/** 화면 가장자리 여백(px). */
const EDGE = 8;

type OpenTip = {
  card: ResolvedTip;
  x: number;
  y: number;
  /** 카드를 연 순간의 커서 세로 위치 — 실제 높이를 잰 뒤 자리를 다시 잡는 데 쓴다. */
  cursorY: number;
};

/** 커서 위치에서 카드가 화면 안에 들어오는 자리 — 시간표 hover 카드와 **같은 규칙**(폭·높이 상수 공유). */
function placeCard(clientX: number, clientY: number): { x: number; y: number } {
  const vw = typeof window === "undefined" ? 1024 : window.innerWidth;
  const vh = typeof window === "undefined" ? 768 : window.innerHeight;
  let x = clientX + CURSOR_GAP;
  if (x + HOVER_CARD_WIDTH > vw - EDGE) x = clientX - HOVER_CARD_WIDTH - CURSOR_GAP;
  if (x < EDGE) x = EDGE;
  let y = clientY + CURSOR_GAP;
  if (y + HOVER_CARD_MAX_H > vh - EDGE) y = Math.max(EDGE, vh - EDGE - HOVER_CARD_MAX_H);
  return { x, y };
}

export function HoverTipLayer() {
  const [tip, setTip] = useState<OpenTip | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);

  /**
   * 뜬 **뒤에** 실제 높이로 자리를 고친다 — 처음엔 최대 높이(320px)를 가정해 클램프하므로, 한두 줄짜리 메모가
   * 화면 아래쪽에서 커서와 한참 떨어져 뜬다(적대 리뷰 2026-09-15 [하]). 카드는 `pointer-events-none`이라
   * 자리가 바뀌어도 포인터 판정에 영향이 없다.
   * ⚠️ 한 번만 수렴한다 — 높이는 `y`와 무관해서 고친 뒤 다시 재면 같은 값이 나온다. 위·아래 **양쪽**으로 고친다:
   *    카드 내용이 갈리며 길어지면(메모 저장 직후) 아래가 화면 밖으로 나가기 때문이다(재리뷰 2026-09-15).
   */
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!tip || !el) return;
    const h = el.offsetHeight;
    if (h <= 0) return;
    // 🔴 최대 높이에 닿은 카드도 **건너뛰지 않는다**(3차 재리뷰) — 짧은 카드로 아래쪽에 자리를 잡은 뒤 내용이
    //    갈려 길어지면(메모 저장) 옛 자리가 남아 카드 아래가 화면 밖으로 나간다. 그때는 최대 높이로 클램프한다.
    const height = Math.min(h, HOVER_CARD_MAX_H);
    const want = Math.min(tip.cursorY + CURSOR_GAP, window.innerHeight - EDGE - height);
    const y = Math.max(EDGE, want);
    if (Math.abs(y - tip.y) > 1) setTip((cur) => (cur === tip ? { ...cur, y } : cur));
  }, [tip]);

  useEffect(() => {
    /** 지금 카드를 띄운 자리(속성을 가진 엘리먼트)와 그때의 속성 값 — 값이 바뀌면 카드도 따라간다. */
    let anchor: Element | null = null;
    let raw: string | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let open = false;
    let lastX = 0;
    let lastY = 0;

    const close = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      anchor = null;
      raw = null;
      if (open) {
        open = false;
        setTip(null);
      }
    };

    /**
     * 지금 카드를 띄우면 안 되는 상황 — 버튼을 누른 채 끌고 있거나(격자 범위 선택·드래그 채우기),
     * 시간표에서 반·학생을 끌고 있을 때. 🔴 판정은 **렌더 밖**(플래그·클래스)이라 화면을 다시 그리지 않는다.
     */
    const busy = (buttons: number) =>
      buttons !== 0 || document.body.classList.contains("tt-dragging");

    const show = (card: ResolvedTip) => {
      open = true;
      setTip({ card, ...placeCard(lastX, lastY), cursorY: lastY });
    };

    const onOver = (e: PointerEvent) => {
      // 터치·펜은 hover가 없다 — 탭 한 번에 카드가 떠서 화면을 가리는 쪽이 더 나쁘다.
      if (e.pointerType === "touch") return;
      lastX = e.clientX;
      lastY = e.clientY;
      const target = e.target instanceof Element ? e.target.closest(`[${TIP_ATTR}]`) : null;
      if (!target) {
        if (anchor) close();
        return;
      }
      if (busy(e.buttons)) {
        close();
        return;
      }
      const next = target.getAttribute(TIP_ATTR);
      if (target === anchor && next === raw) return;
      const card = decodeTip(next);
      if (!card) {
        close();
        return;
      }
      anchor = target;
      raw = next;
      if (timer) clearTimeout(timer);
      // 이미 한 장이 떠 있으면 **즉시** 갈아탄다(칸마다 300ms를 다시 기다리면 표를 읽을 수 없다).
      if (open) {
        show(card);
        return;
      }
      timer = setTimeout(() => {
        timer = null;
        if (anchor === target) show(card);
      }, OPEN_DELAY_MS);
    };

    const onMove = (e: PointerEvent) => {
      if (!anchor) return;
      lastX = e.clientX;
      lastY = e.clientY;
      if (busy(e.buttons)) {
        close();
        return;
      }
      // 🔴 칸이 DOM에서 빠지거나(리렌더로 노드 교체) 커서가 그 밖으로 나가면 닫는다 — `pointerover`만 믿으면
      //    노드가 커서 아래에서 사라진 카드가 굳는다(시간표 hover 카드가 겪은 그 버그).
      if (!anchor.isConnected) {
        close();
        return;
      }
      const target = e.target;
      if (!(target instanceof Node) || !anchor.contains(target)) {
        close();
        return;
      }
      // 같은 칸의 메모가 바뀌었으면(저장 직후) 떠 있는 카드도 따라간다.
      const next = anchor.getAttribute(TIP_ATTR);
      if (next !== raw) {
        const card = decodeTip(next);
        raw = next;
        if (!card) close();
        else if (open) setTip((cur) => (cur ? { ...cur, card } : cur));
      }
    };

    const onOut = (e: PointerEvent) => {
      // 창 밖으로 나가면 relatedTarget이 없다 — 그때도 닫는다.
      if (!e.relatedTarget) close();
    };

    document.addEventListener("pointerover", onOver, true);
    document.addEventListener("pointermove", onMove, true);
    document.addEventListener("pointerout", onOut, true);
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("keydown", close, true);
    document.addEventListener("wheel", close, true);
    document.addEventListener("scroll", close, true);
    document.addEventListener("visibilitychange", close);
    window.addEventListener("blur", close);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("pointerover", onOver, true);
      document.removeEventListener("pointermove", onMove, true);
      document.removeEventListener("pointerout", onOut, true);
      document.removeEventListener("pointerdown", close, true);
      document.removeEventListener("keydown", close, true);
      document.removeEventListener("wheel", close, true);
      document.removeEventListener("scroll", close, true);
      document.removeEventListener("visibilitychange", close);
      window.removeEventListener("blur", close);
    };
  }, []);

  if (!tip || typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={cardRef}
      role="tooltip"
      className={`${HOVER_CARD_SHELL} pointer-events-none fixed z-[9999] overflow-y-auto`}
      style={{ left: tip.x, top: tip.y, width: HOVER_CARD_WIDTH, maxHeight: HOVER_CARD_MAX_H }}
    >
      <TipCardView card={tip.card} />
    </div>,
    document.body,
  );
}

/**
 * 카드 본문 — 시간표 학생 카드와 **같은 뼈대**: 머리(이름 굵게 + 오른쪽 메타) · 구분선 · `라벨 값` 줄 · 문장.
 * 🔴 값은 텍스트로만 그린다(줄바꿈은 `whitespace-pre-line`으로 살린다) — 카드에 마크업을 흘려보내지 않는다.
 */
export function TipCardView({ card }: { card: ResolvedTip }) {
  const { rows, lines } = card;
  const hasHead = !!card.title || !!card.meta;
  return (
    <div className="space-y-2 break-keep text-xs">
      {hasHead ? (
        <div className="flex items-start justify-between gap-2">
          <span className="text-foreground min-w-0 text-sm font-bold">{card.title}</span>
          {card.meta ? (
            <span className="text-text-dim shrink-0 text-right text-xs leading-tight">{card.meta}</span>
          ) : null}
        </div>
      ) : null}
      {rows.length > 0 ? (
        <div className={`space-y-1 ${hasHead ? "border-line border-t pt-1.5" : ""}`}>
          {rows.map(([label, value], i) => (
            <div key={`${label}-${i}`} className="flex gap-2">
              <span className="text-primary shrink-0 font-bold">{label}</span>
              <span className="text-foreground min-w-0 whitespace-pre-line">{value}</span>
            </div>
          ))}
        </div>
      ) : null}
      {lines.length > 0 ? (
        <div className={`space-y-0.5 ${hasHead || rows.length > 0 ? "border-line border-t pt-1.5" : ""}`}>
          {lines.map((line, i) => (
            <p key={`${line}-${i}`} className="text-foreground whitespace-pre-line">
              {line}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

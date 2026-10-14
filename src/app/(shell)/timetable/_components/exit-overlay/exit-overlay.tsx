"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { shiftMonth } from "@/lib/date-kst";
import { isExitOverlayHotkey, type ExitOverlayData } from "@/features/withdrawals/exit-overlay-model";
import { loadExitOverlay } from "@/features/withdrawals/server/exit-overlay-actions";
import { isTimetableDragging } from "../drag-flag";
import { ExitOverlayCard, type ExitOverlayState } from "./exit-overlay-card";

const LOAD_FAILED = "퇴원 목록을 불러오지 못했습니다. 잠시 뒤 다시 눌러 주세요.";

/** 커서 옆 자리 — 오른쪽 아래가 기본, 넘치면 왼쪽·위로 접고 화면 안에 붙든다(시간표 hover 카드와 같은 규칙). */
export function placeNear(at: { x: number; y: number }, size: { w: number; h: number }, view: { w: number; h: number }) {
  let left = at.x + 16;
  if (left + size.w > view.w - 8) left = at.x - size.w - 16;
  if (left < 8) left = Math.max(8, Math.min(at.x + 16, view.w - size.w - 8));
  let top = at.y + 16;
  if (top + size.h > view.h - 8) top = Math.max(8, view.h - 8 - size.h);
  return { left, top };
}

/** 우리 카드가 아닌 팝업이 열려 있나 — 키를 친 자리가 팝업 안이거나, 모달 팝업이 문서에 떠 있다. */
function otherDialogOpen(target: EventTarget | null, mine: HTMLElement | null): boolean {
  const inside = target instanceof Element ? target.closest('[role="dialog"], [role="alertdialog"]') : null;
  if (inside && inside !== mine) return true;
  return [...document.querySelectorAll('[aria-modal="true"]')].some((el) => el !== mine);
}

/**
 * **시간표 X 겹침** — 시간표 어디서든 X(한글 입력 상태의 ㅌ도)를 누르면 마우스 옆에 석 달 퇴원(수강종료 포함)이 뜬다(원장 2026-10-14).
 * 다시 X · Esc · 바깥 클릭으로 닫고, ←/→로 석 달 묶음을 한 달씩 옮긴다. 데이터는 **누를 때만** 읽는다(첫 화면 비용 0).
 * 🔴 끄는 중(학생·반 드래그)엔 열지 않는다 · 입력칸에서 친 X는 글자다(`isExitOverlayHotkey`).
 * ⚠️ 닫으면 받아 둔 달도 버린다 — 다시 열 때는 최신으로 읽는다(그사이 퇴원 처리가 있었을 수 있다).
 */
export function TimetableExitOverlay({ subject }: { subject: string }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<ExitOverlayState>({ status: "loading" });
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const openAt = useRef({ x: 0, y: 0 });
  const cache = useRef(new Map<string, ExitOverlayData>());
  const seq = useRef(0);
  const cardRef = useRef<HTMLDivElement>(null);

  const load = useCallback(
    (anchor: string | null) => {
      const key = anchor ?? "";
      const hit = cache.current.get(key);
      const id = ++seq.current;
      if (hit) {
        setState({ status: "ready", data: hit });
        return;
      }
      // 달을 옮길 땐 직전 묶음을 흐리게 남긴다 — 처음 열 때만 '불러오는 중'.
      setState((s) => ({ status: "loading", prev: s.status === "ready" ? s.data : s.status === "loading" ? s.prev : undefined }));
      loadExitOverlay({ subject, anchor })
        .then((r) => {
          if (id !== seq.current) return; // 그사이 다른 달을 눌렀거나 닫았다 — 늦게 온 답으로 덮지 않는다
          if (!r.ok) return setState({ status: "error", error: r.error });
          cache.current.set(key, r.data);
          cache.current.set(r.data.anchor, r.data);
          setState({ status: "ready", data: r.data });
        })
        .catch(() => {
          if (id === seq.current) setState({ status: "error", error: LOAD_FAILED });
        });
    },
    [subject],
  );

  const close = useCallback(() => {
    seq.current++;
    cache.current.clear();
    setOpen(false);
  }, []);

  const show = useCallback(() => {
    openAt.current = pointer.current ?? { x: Math.round(window.innerWidth / 3), y: 96 };
    setState({ status: "loading" });
    setOpen(true);
    load(null);
  }, [load]);

  const shift = useCallback(
    (delta: -1 | 1) => {
      if (state.status !== "ready") return;
      const { data } = state;
      if ((delta < 0 && !data.canOlder) || (delta > 0 && !data.canNewer)) return;
      load(shiftMonth(data.anchor, delta));
    },
    [state, load],
  );

  // 커서 자리 기억 — 키를 누른 순간 그 옆에 연다.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      pointer.current = { x: e.clientX, y: e.clientY };
    };
    document.addEventListener("pointermove", onMove, { passive: true });
    return () => document.removeEventListener("pointermove", onMove);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isExitOverlayHotkey(e)) {
        // 끄는 중이거나 다른 팝업(반 이동·수강 종료 확인 등)이 떠 있으면 그 팝업의 일이다 — 위에 겹쳐 열지 않는다.
        if (isTimetableDragging() || otherDialogOpen(e.target, cardRef.current)) return;
        e.preventDefault();
        if (open) close();
        else show();
        return;
      }
      if (!open) return;
      if (e.key === "Escape") return close();
      const el = e.target as HTMLElement | null;
      if (el?.tagName === "INPUT" || el?.tagName === "TEXTAREA" || el?.tagName === "SELECT" || el?.isContentEditable) return;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        shift(e.key === "ArrowLeft" ? -1 : 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close, show, shift]);

  // 바깥을 누르면 닫는다(카드 안 클릭·스크롤은 그대로).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (cardRef.current && e.target instanceof Node && cardRef.current.contains(e.target)) return;
      close();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [open, close]);

  // 자리 잡기 — 그리기 전에(깜빡임 없이) 실제 크기를 재서 커서 옆에 둔다. 창 크기가 바뀌면 다시.
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!open || !el) return;
    const place = () => {
      const { left, top } = placeNear(openAt.current, { w: el.offsetWidth, h: el.offsetHeight }, { w: window.innerWidth, h: window.innerHeight });
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open, state]);

  if (!open) return null;
  return createPortal(
    <div ref={cardRef} role="dialog" aria-label="퇴원 석 달" className="fixed z-[9998]" style={{ left: -9999, top: -9999 }}>
      <ExitOverlayCard state={state} onOlder={() => shift(-1)} onNewer={() => shift(1)} onClose={close} />
    </div>,
    document.body,
  );
}

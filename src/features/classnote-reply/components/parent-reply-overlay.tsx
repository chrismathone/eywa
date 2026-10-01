"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { kstDateTime, ReplyThread } from "./reply-thread";
import { useReplyThread } from "./use-reply-thread";

/** 벨 단추 표시(알림 벨이 단다, 값 = 그 벨의 id) — 오버레이가 그 단추 자리, 벨 목록이 열리던 그 자리에 겹쳐 뜬다. */
export const BELL_ANCHOR_ATTR = "data-notification-bell";
const MARGIN = 12;
const GAP = 6;
const WIDTH = 440;
const MAX_HEIGHT = 760;
/** 아래 공간이 이만큼 있으면 아래로 연다(벨이 위에 있는 모바일·강사 미니셸). 아니면 넓은 쪽으로 — 데스크톱 벨은 사이드바 **맨 아래**다. */
const MIN_BELOW = 360;

type Pos = { left: number; width: number; maxHeight: number; top?: number; bottom?: number };
type Rect = { top: number; bottom: number; right: number };

/** 그 벨 단추의 화면 좌표 — 숨은(크기 0) 벨은 건너뛴다. 못 찾으면 null. */
function bellRect(anchorId: string | undefined): Rect | null {
  for (const el of Array.from(document.querySelectorAll(`[${BELL_ANCHOR_ATTR}]`))) {
    if (anchorId && el.getAttribute(BELL_ANCHOR_ATTR) !== anchorId) continue;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return r;
  }
  return null;
}

/**
 * 벨 목록(드롭다운 `align="end"`)과 같은 자리 — 오른쪽 끝을 벨 단추 오른쪽에 맞추되 화면 안으로 당기고,
 * 아래 공간이 넉넉하면 벨 아래로, 아니면(사이드바 맨 아래 벨) 벨 **위로** 연다(목록이 뒤집혀 열리던 것과 같다).
 */
export function overlayPos(r: Rect | null, vw: number, vh: number): Pos {
  const width = Math.max(0, Math.min(WIDTH, vw - MARGIN * 2));
  const maxLeft = Math.max(MARGIN, vw - width - MARGIN);
  if (!r) return { top: 56, left: maxLeft, width, maxHeight: Math.min(MAX_HEIGHT, Math.max(200, vh - 56 - MARGIN)) };
  const left = Math.min(Math.max(MARGIN, r.right - width), maxLeft);
  const below = vh - r.bottom - GAP - MARGIN;
  const above = r.top - GAP - MARGIN;
  if (below >= MIN_BELOW || below >= above) return { top: r.bottom + GAP, left, width, maxHeight: Math.min(MAX_HEIGHT, Math.max(200, below)) };
  return { bottom: vh - r.top + GAP, left, width, maxHeight: Math.min(MAX_HEIGHT, Math.max(200, above)) };
}

/** 쓰던 답글이 있나 — 있으면 바깥 클릭·Esc로 닫지 않는다(입력이 사라지지 않게, #69). 닫으려면 '← 알림 목록'. */
const hasDraft = (el: HTMLElement | null) => !!el && Array.from(el.querySelectorAll("textarea")).some((t) => t.value.trim());
/**
 * 이 창 **위에 뜬** 대화상자(영상·사진 팝업·삭제·전송 확인)가 있나 — 있으면 그 위의 클릭·Esc는 이 오버레이가 가로채지 않는다.
 * 🔴 `[role="dialog"]` 전부로 보면 안 된다 — 플로팅 창(`data-window-dialog`)·메뉴 판은 늘 그 역할을 달고 있어 창 모드에선 바깥 클릭·Esc가 영영 안 먹는다.
 * 모달만 본다: 공용 Dialog(`data-slot="dialog-content"`) · 확인창(`role="alertdialog"`) · `aria-modal="true"`.
 */
const otherDialogOpen = () => !!document.querySelector('[data-slot="dialog-content"],[role="alertdialog"],[aria-modal="true"]');
const samePos = (a: Pos, b: Pos) => a.left === b.left && a.width === b.width && a.maxHeight === b.maxHeight && a.top === b.top && a.bottom === b.bottom;

/**
 * 학부모 글 답글 창 — **벨 알림 목록 위에 겹치는 오버레이**(원장 2026-10-01 *"가운데 열리지 말고 이 답글창 위에 오버레이식으로"*).
 * 벨 드롭다운은 닫히고, 같은 자리(그 벨 단추 기준, 목록과 같은 정렬)·비슷한 폭에 이 창이 뜬다. 포털 + fixed라 어떤 카드의 overflow에도
 * 잘리지 않는다(#128) — 그래서 크기 변화·스크롤마다 자리를 다시 잰다.
 *   닫기(← 알림 목록)·Esc = **목록으로 돌아간다**(`onClose("back")` — 벨이 목록을 다시 열고 읽던 자리로) · 바깥 클릭 = 그냥 닫는다(`"dismiss"`).
 * 영상·사진 팝업·삭제 확인 같은 다른 대화상자가 떠 있는 동안, 그리고 쓰던 답글이 있는 동안은 바깥 클릭·Esc를 무시한다('← 알림 목록'은 한 번 묻는다).
 * 플로팅 창(iframe) 안을 누르면 바깥 클릭으로 본다(그 문서의 pointerdown은 여기 안 온다 — 이 문서의 blur로 안다).
 * ⚠️ 호출부는 `key={messageId}`로 마운트할 것(effect 안 setState 금지, #25).
 */
export function ParentReplyOverlay({ messageId = null, notificationId, anchorId, onClose, hideReaction = false }: {
  messageId?: string | null;
  notificationId?: string;
  /** 이 창을 연 벨의 id(`BELL_ANCHOR_ATTR` 값) — 화면에 벨이 둘이어도 연 그 벨에 붙는다 */
  anchorId?: string;
  onClose: (how: "back" | "dismiss") => void;
  hideReaction?: boolean;
}) {
  const view = useReplyThread(messageId, hideReaction, notificationId);
  const [pos, setPos] = useState<Pos>(() => overlayPos(bellRect(anchorId), window.innerWidth, window.innerHeight));
  const panelRef = useRef<HTMLDivElement | null>(null);
  // 호출부(벨)는 렌더마다 새 onClose를 넘긴다(벨은 알림 폴링으로 자주 다시 그린다) — 리스너·포커스 effect가 그때마다 다시 돌면
  // 답글을 쓰던 입력칸에서 포커스를 빼앗는다. 최신 콜백은 ref로만 읽는다.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  const close = useCallback((how: "back" | "dismiss") => onCloseRef.current(how), []);
  // 쓰던 답글이 있는데 '← 알림 목록'을 누르면 한 번 묻는다(Esc·바깥 클릭은 아예 닫지 않는다).
  const [confirmBack, setConfirmBack] = useState(false);
  const back = () => (hasDraft(panelRef.current) ? setConfirmBack(true) : close("back"));

  useEffect(() => {
    // 처음 한 번만 — 벨 드롭다운이 닫히며 포커스를 단추로 돌려주는 순간과 겹치므로 한 프레임 뒤에 이 창으로 옮긴다.
    const raf = requestAnimationFrame(() => panelRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    // 같은 자리면 상태를 바꾸지 않는다 — 쓰레드 안을 스크롤할 때마다 창 전체가 다시 그려지지 않게.
    const place = () => {
      const next = overlayPos(bellRect(anchorId), window.innerWidth, window.innerHeight);
      setPos((prev) => (samePos(prev, next) ? prev : next));
    };
    const onScroll = (e: Event) => {
      if (e.target instanceof Node && panelRef.current?.contains(e.target)) return; // 이 창 안 스크롤은 자리와 무관하다
      place();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || e.isComposing || otherDialogOpen() || hasDraft(panelRef.current)) return;
      e.preventDefault();
      close("back");
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (!t || panelRef.current?.contains(t) || otherDialogOpen() || hasDraft(panelRef.current)) return;
      close("dismiss");
    };
    // 플로팅 창(iframe) 안을 누르면 이 문서엔 pointerdown이 오지 않는다 — 대신 이 문서가 포커스를 잃고 iframe이 활성 요소가 된다.
    // 탭 전환(활성 요소 그대로)은 닫지 않는다.
    const onBlur = () => {
      window.setTimeout(() => {
        if (document.activeElement instanceof HTMLIFrameElement && !otherDialogOpen() && !hasDraft(panelRef.current)) close("dismiss");
      }, 0);
    };
    window.addEventListener("resize", place);
    window.addEventListener("scroll", onScroll, true); // 벨이 든 영역이 스크롤되면 따라간다
    window.addEventListener("blur", onBlur);
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [close, anchorId]);

  const { ctx } = view;
  const ok = ctx?.ok ? ctx : null;
  const style: CSSProperties = { left: pos.left, width: pos.width, maxHeight: pos.maxHeight, top: pos.top, bottom: pos.bottom };
  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label="학부모 글 답글"
      aria-modal="false"
      data-reply-overlay=""
      tabIndex={-1}
      style={style}
      className="bg-popover text-popover-foreground ring-foreground/10 animate-in fade-in-0 fixed z-50 flex flex-col gap-3 overflow-hidden rounded-xl p-3 text-sm shadow-lg ring-1 outline-none duration-100"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-foreground text-sm font-bold">학부모 {ok?.message.source === "comment" ? "댓글" : "글"}에 답글</p>
          <p className="text-text-dim text-xs">{ok ? [ok.message.boardName, kstDateTime(ok.message.postedAt)].filter(Boolean).join(" · ") : "ClassNote 그 글에 댓글로 올라갑니다"}</p>
        </div>
        <button type="button" onClick={back} className="text-text-dim hover:bg-line/60 hover:text-foreground focus-visible:outline-primary shrink-0 rounded-lg px-2 py-1 text-xs font-bold">
          ← 알림 목록
        </button>
      </div>
      {!ctx ? (
        <p className="text-text-dim text-sm">불러오는 중…</p>
      ) : !ctx.ok ? (
        <p className="text-danger text-sm">{ctx.error}</p>
      ) : (
        <ReplyThread view={view} ctx={ctx} hideReaction={hideReaction} />
      )}
      <ConfirmDialog
        open={confirmBack}
        title="쓰던 답글"
        message="쓰던 답글이 있습니다. 보내지 않고 알림 목록으로 돌아갈까요?"
        confirmLabel="돌아가기"
        cancelLabel="계속 쓰기"
        onConfirm={() => { setConfirmBack(false); close("back"); }}
        onCancel={() => {
          setConfirmBack(false);
          // 확인창 단추가 사라지면 포커스가 body로 떨어져 다음 입력이 창(iframe) 쪽으로 갈 수 있다 — 쓰던 칸으로 돌려준다.
          requestAnimationFrame(() => panelRef.current?.querySelector("textarea")?.focus());
        }}
      />
    </div>,
    document.body,
  );
}

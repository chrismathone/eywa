"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LaneCol } from "@/features/timetable-cell-memo/grid-index";
import { placeBeside } from "@/features/timetable-cell-memo/placement";
import { clampMemoSize, primaryMemo, type CellMemo } from "@/features/timetable-cell-memo/rules";
import { bodyCellOf, viewport, type MemoTarget } from "@/features/timetable-cell-memo/ui/cell-dom";
import { MemoEditor } from "@/features/timetable-cell-memo/ui/memo-editor";
import { MemoMenu } from "@/features/timetable-cell-memo/ui/memo-menu";
import { FloatingNote } from "@/features/timetable-cell-memo/ui/memo-note";
import { removeCellMemo } from "@/features/timetable-cell-memo/ui/remove-memo";
import { memosOfTarget, useCellMarks } from "@/features/timetable-cell-memo/ui/use-cell-marks";
import { useMemoAside } from "@/features/timetable-cell-memo/ui/use-memo-aside";
import { upsertMemo, useWeekMemos } from "@/features/timetable-cell-memo/ui/use-week-memos";
import { closeOpenHoverCards } from "./hover-cards";

/**
 * 영어 강사뷰 **칸 메모 레이어**(원장 2026-10-22 *"각 셀마다 우클릭해서 엑셀처럼 메모"*) — 표 **옆에** 서는 클라 조각.
 *
 * 🔴 표를 감싸지 않는다 — 서버가 그린 수천 칸을 그대로 두고, 표 위의 이벤트를 위임으로 받는다(우클릭·마우스 올림).
 *    메모 상태가 바뀌어도 격자는 다시 그려지지 않는다("드래그는 화면을 다시 그리지 않는다"와 같은 결): 표식은 칸 속성 하나
 *    (`use-cell-marks.ts` · 삼각형은 globals.css), 상자·메뉴는 포털이다.
 * 🔴 보기만 되는 사람 = 표식·보기 상자만(우클릭은 브라우저 기본 메뉴). 표가 없으면(0394a 미적용) 아무것도 안 붙는다.
 * 수업 칸의 메모는 정보 카드 오른쪽 2열로(`aside-registry` → `HoverCard`), 빈 칸은 이 레이어가 칸 옆에 띄운다.
 */
const HOVER_GRACE_MS = 160;
type Props = { tenantId: string; subject: string; weekMonday: string; canEdit: boolean; lanes: LaneCol[]; firstMin: number; stepMin: number };
type Handlers = { context: (e: MouseEvent) => void; over: (e: MouseEvent) => void; leave: () => void };

export function TeacherCellMemoLayer({ tenantId, subject, weekMonday, canEdit, lanes, firstMin, stepMin }: Props) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const hoverRef = useRef<HTMLDivElement>(null);
  const { status, memos, applyLocal } = useWeekMemos({ tenantId, subject, weekMonday });
  const { identify, memosAt } = useCellMarks(anchorRef, { memos, lanes, firstMin, stepMin, weekMonday });
  const editable = canEdit && status === "ok";
  const [menu, setMenu] = useState<{ week: string; x: number; y: number; target: MemoTarget } | null>(null);
  const [hover, setHover] = useState<{ week: string; target: MemoTarget; left: number; top: number } | null>(null);
  const [editor, setEditor] = useState<{ week: string; key: number; target: MemoTarget; memo: CellMemo | null; left: number; top: number } | null>(null);
  // 주를 넘기면 지난 주 칸의 상자·메뉴는 그리지 않는다(편집 상자는 내려가며 남은 입력을 저장한다).
  const editorOpen = editor?.week === weekMonday ? editor : null;
  const hoverOpen = hover?.week === weekMonday ? hover : null;
  const menuOpen = menu?.week === weekMonday ? menu : null;
  const live = useRef({ weekMonday, editable, editorTd: null as Element | null });
  const grace = useRef<number | null>(null);
  useEffect(() => {
    live.current = { weekMonday, editable, editorTd: editorOpen?.target.td ?? null };
  });

  const graceCancel = useCallback(() => {
    if (grace.current !== null) window.clearTimeout(grace.current);
    grace.current = null;
  }, []);
  const hideSoon = useCallback(() => {
    grace.current ??= window.setTimeout(() => ((grace.current = null), setHover(null)), HOVER_GRACE_MS);
  }, []);
  const openEditor = useCallback(
    (t: MemoTarget, memo: CellMemo | null, rect?: DOMRect) => {
      graceCancel();
      setHover(null);
      setMenu(null);
      closeOpenHoverCards();
      const at = rect
        ? { left: Math.round(rect.left), top: Math.round(rect.top) }
        : placeBeside(t.td.getBoundingClientRect(), clampMemoSize(memo?.width, memo?.height), viewport());
      setEditor({ week: live.current.weekMonday, key: Date.now(), target: t, memo, ...at });
    },
    [graceCancel],
  );

  // 수업 칸 = 정보 카드 오른쪽 2열(원장 *"정보 1열, 메모 2열"*).
  useMemoAside({ anchorRef, live, identify, memosAt, openEditor });

  const handlers = useRef<Handlers>({ context: () => {}, over: () => {}, leave: () => {} });
  useEffect(() => {
    handlers.current = {
      context(e) {
        const root = anchorRef.current?.parentElement;
        const td = root && editable ? bodyCellOf(e.target, root) : null;
        const t = td ? identify(td) : null;
        if (!t) return; // 보기만 되는 사람·표 밖 = 브라우저 기본 메뉴
        e.preventDefault();
        graceCancel();
        setHover(null);
        closeOpenHoverCards();
        setMenu({ week: weekMonday, x: e.clientX, y: e.clientY, target: t });
      },
      over(e) {
        const root = anchorRef.current?.parentElement;
        const el = e.target instanceof Element ? e.target : null;
        // 수업 칩 위는 정보 카드가 2열로 보여 준다 — 여기선 띄우지 않는다.
        const td = root && el && !el.closest("[data-memo-chip]") ? bodyCellOf(el, root) : null;
        if (td && hoverOpen?.target.td === td) return graceCancel();
        const t = td && !menuOpen && editorOpen?.target.td !== td ? identify(td) : null;
        const list = t ? memosAt(t) : [];
        if (!t || !td || list.length === 0) return hoverOpen ? hideSoon() : undefined;
        const p = primaryMemo(list, t.spec.keyStart)!;
        graceCancel();
        setHover({ week: weekMonday, target: t, ...placeBeside(td.getBoundingClientRect(), clampMemoSize(p.width, p.height), viewport()) });
      },
      leave: hideSoon, // 표 밖으로 — 한 번뿐이라 조건 없이(방금 연 상자가 아직 렌더 전이어도 닫힌다)
    };
  });
  useEffect(() => {
    const root = anchorRef.current?.parentElement;
    if (!root) return;
    const context = (e: MouseEvent) => handlers.current.context(e);
    const over = (e: MouseEvent) => handlers.current.over(e);
    const leave = () => handlers.current.leave();
    root.addEventListener("contextmenu", context);
    root.addEventListener("mouseover", over);
    root.addEventListener("mouseleave", leave);
    return () => {
      root.removeEventListener("contextmenu", context);
      root.removeEventListener("mouseover", over);
      root.removeEventListener("mouseleave", leave);
      graceCancel();
    };
  }, [graceCancel]);

  // 보기 상자는 표를 굴리면 닫는다(자리가 어긋난다) — 상자 안 스크롤(긴 메모 읽기)은 빼고.
  useEffect(() => {
    if (!hoverOpen) return;
    const close = (e: Event) => {
      if (!(e.target instanceof Node) || !hoverRef.current?.contains(e.target)) setHover(null);
    };
    document.addEventListener("wheel", close, true);
    document.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("wheel", close, true);
      document.removeEventListener("scroll", close, true);
    };
  }, [hoverOpen]);

  const closeMenu = useCallback(() => setMenu(null), []);

  const cellMemos = useMemo(() => (editorOpen ? memosOfTarget(memos, editorOpen.target) : []), [memos, editorOpen]);
  const hoverMemos = hoverOpen ? memosOfTarget(memos, hoverOpen.target) : [];
  const hoverPrimary = hoverOpen ? primaryMemo(hoverMemos, hoverOpen.target.spec.keyStart) : null;
  const menuPrimary = menuOpen ? primaryMemo(memosOfTarget(memos, menuOpen.target), menuOpen.target.spec.keyStart) : null;
  return (
    <>
      <span ref={anchorRef} hidden data-cell-memo-anchor="" />
      {hoverOpen && hoverPrimary ? (
        <FloatingNote
          boxRef={hoverRef}
          at={{ left: hoverOpen.left, top: hoverOpen.top }}
          onEnter={graceCancel}
          onLeave={hideSoon}
          memos={hoverMemos}
          size={clampMemoSize(hoverPrimary.width, hoverPrimary.height)}
          canEdit={editable}
          onActivate={(r) => openEditor(hoverOpen.target, hoverPrimary, r)}
        />
      ) : null}
      {menuOpen && editable ? (
        <MemoMenu
          x={menuOpen.x}
          y={menuOpen.y}
          hasMemo={menuPrimary != null}
          onAdd={() => openEditor(menuOpen.target, null)}
          onEdit={() => openEditor(menuOpen.target, menuPrimary)}
          onDelete={() => {
            setMenu(null);
            if (menuPrimary) void removeCellMemo(menuPrimary, menuOpen.target.spec.col, (u) => applyLocal(menuOpen.week, u));
          }}
          onClose={closeMenu}
        />
      ) : null}
      {editorOpen ? (
        <MemoEditor
          key={editorOpen.key}
          target={editorOpen.target}
          memo={editorOpen.memo}
          cellMemos={cellMemos}
          at={{ left: editorOpen.left, top: editorOpen.top }}
          subject={subject}
          onSaved={(m) => applyLocal(editorOpen.week, (l) => upsertMemo(l, m))}
          onRemoved={(id) => applyLocal(editorOpen.week, (l) => l.filter((m) => m.id !== id))}
          onResized={(id, s) => applyLocal(editorOpen.week, (l) => l.map((m) => (m.id === id ? { ...m, ...s } : m)))}
          onClose={() => setEditor(null)}
        />
      ) : null}
    </>
  );
}

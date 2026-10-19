"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PageMaximizeButton } from "@/components/page-maximize/page-maximize-button";
import { EditingBadge } from "@/features/presence/editing-badge";
import { useEditPresence } from "@/features/presence/edit-presence";
import { DEFAULT_COL_W, DEFAULT_ROW_H } from "../doc";
import { unpackSheet, type PackedSheet } from "../pack";
import { FormulaBar } from "./formula-bar";
import { startingSheet } from "./memo-cache";
import { ConflictBanner, SaveStatus } from "./save-status";
import { SheetGrid } from "./sheet-grid";
import { SheetMenu } from "./sheet-menu";
import { SheetToolbar } from "./sheet-toolbar";
import { scrollSplitTo } from "./split-panes";
import { useCellEditor } from "./use-cell-editor";
import { useMemoAutosave } from "./use-memo-autosave";
import { useSheetActions } from "./use-sheet-actions";
import { useSheetKeys } from "./use-sheet-keys";
import { useSheetModel } from "./use-sheet-model";

/**
 * 메모 시트 — 영어 시간표 오른쪽 엑셀 판(원장 2026-10-19). 자기 스크롤을 가진 창 하나:
 * 머리(이름·저장 상태) → 서식 툴바 → 칸 주소·글자 줄 → 판.
 * 편집 = 시간표 '전체' 권한(서버가 같은 문으로 다시 막는다). 그 밖에는 보기·복사만.
 */
export function MemoSheet({
  cacheKey,
  subject,
  packed,
  version,
  updatedAt,
  canEdit,
}: {
  /** 지점×과목 — 이 탭에서 마지막으로 저장한 판을 기억하는 자리(memo-cache.ts). */
  cacheKey: string;
  subject: string;
  packed: PackedSheet;
  version: number;
  updatedAt: string | null;
  canEdit: boolean;
}) {
  // 뒤로 가기로 돌아오면 서버 판이 옛것일 수 있다 — 이 탭에서 더 새로 저장했거나 보내는 중인 판이 있으면 그것으로 연다.
  const [start] = useState(() =>
    startingSheet(cacheKey, { doc: unpackSheet(packed, DEFAULT_COL_W, DEFAULT_ROW_H), version, updatedAt }),
  );
  const dirtyRef = useRef<() => void>(() => {});
  const model = useSheetModel(() => start.doc, () => dirtyRef.current());
  const getDoc = useCallback(() => model.docRef.current, [model.docRef]);
  const save = useMemoAutosave({
    subject,
    cacheKey,
    enabled: canEdit,
    initialVersion: start.version,
    initialUpdatedAt: start.updatedAt,
    initialFlight: start.flight,
    getDoc,
  });
  useEffect(() => {
    dirtyRef.current = save.markDirty;
  }, [save.markDirty]);

  const viewportRef = useRef<HTMLDivElement>(null);
  const editor = useCellEditor(model, canEdit, viewportRef);
  const { commit } = editor;
  const settle = useCallback(() => commit(0, 0), [commit]);
  const actions = useSheetActions(model, settle);
  const flush = useCallback(() => void save.flush(), [save]);
  const keys = useSheetKeys({ model, editor, actions, canEdit, flush });
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const [focused, setFocused] = useState(false);
  const scope = `memo-sheet:${subject}`;
  useEditPresence(scope, canEdit && focused);

  // 시트 판이 화면에서 완전히 벗어나면(시간표 쪽으로 넘김) 초점을 놓는다 — 안 보이는 칸이 키를 받아
  // Delete·되돌리기가 몰래 먹고 자동 저장되던 것을 막는다(적대 리뷰 2026-10-19).
  // 감지기는 한 번만 건다 — `settle`은 그릴 때마다 바뀌어 deps에 넣으면 키 입력마다 끊고 다시 건다(최신 값은 ref로).
  const sectionRef = useRef<HTMLElement>(null);
  const settleRef = useRef(settle);
  useEffect(() => {
    settleRef.current = settle;
  }, [settle]);
  useEffect(() => {
    const el = sectionRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => {
      if (entry && !entry.isIntersecting && el.contains(document.activeElement)) {
        settleRef.current();
        (document.activeElement as HTMLElement | null)?.blur();
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const state = save.state;
  return (
    <section
      ref={sectionRef}
      aria-label="메모 시트"
      className="bg-card shadow-card flex h-full min-h-0 flex-col overflow-hidden rounded-2xl"
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      <div className="border-line flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-2">
        <button type="button" className="border-line hover:bg-bg-soft rounded-md border px-2 py-0.5 text-sm" onClick={() => scrollSplitTo("timetable")}>
          ← 시간표
        </button>
        <h2 className="text-base font-bold">메모 시트</h2>
        <EditingBadge scope={scope} />
        <span className="ml-auto">
          <SaveStatus state={state} canEdit={canEdit} onRetry={flush} />
        </span>
        {/* 최대화 중의 '원래대로' — 시간표 툴바의 같은 버튼은 시간표 판과 함께 밀려나므로 여기에도 둔다(최대화 때만 보인다). */}
        <span data-maximize-toolbar-toggle="" className="hidden shrink-0 items-center">
          <PageMaximizeButton />
        </span>
      </div>
      {canEdit ? (
        <div className="border-line border-b px-3 py-2">
          <SheetToolbar model={model} actions={actions} focusRef={editor.taRef} canEdit={canEdit} />
        </div>
      ) : null}
      <FormulaBar model={model} canEdit={canEdit} onDone={editor.focus} />
      {state.kind === "conflict" ? (
        <ConflictBanner
          updatedAt={state.updatedAt}
          onTakeTheirs={() => {
            const theirs = unpackSheet(state.packed, DEFAULT_COL_W, DEFAULT_ROW_H);
            editor.cancel();
            model.reset(theirs);
            save.takeTheirs(state.version, state.updatedAt, theirs);
          }}
          onKeepMine={() => save.keepMine(state.version)}
        />
      ) : null}
      <SheetGrid model={model} editor={editor} keys={keys} canEdit={canEdit} viewportRef={viewportRef} onMenu={(x, y) => setMenu({ x, y })} />
      {menu ? <SheetMenu x={menu.x} y={menu.y} canEdit={canEdit} actions={actions} onClose={closeMenu} /> : null}
    </section>
  );
}

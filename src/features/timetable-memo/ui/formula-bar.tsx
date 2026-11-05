"use client";

import { useEffect, useRef } from "react";
import { writeLockedPlaceholder } from "@/lib/write-lock";
import { SHEET_LIMITS, cellKey, cellName } from "../doc";
import { setTexts } from "../ops";
import type { SheetModel } from "./use-sheet-model";

/**
 * 수식 입력줄 자리(엑셀 맨 위 줄) — 왼쪽 칸 주소(A1 · 범위면 A1:C5) + 지금 칸 글자. 여기서 고쳐 Enter를 눌러도 들어간다.
 * 수식은 없다(글자 그대로) — 긴 글을 넓게 보며 고치는 자리.
 * 🔴 비제어 입력 + **사람이 고쳤나**(`edited`) — 안 고쳤으면 초점이 있어도 칸 글자를 따라가고(툴바 '되돌리기'가
 *    칸을 바꿔도 옛 글자가 남지 않게), 고친 것만 확정한다. key에 글자를 넣지 말 것 — 판 입력이 확정되는 순간(초점이
 *    이리로 오며 판 입력칸이 blur → 확정) 이 입력이 새 요소로 갈려 초점이 허공으로 사라진다.
 */
export function FormulaBar({ model, canEdit, onDone }: { model: SheetModel; canEdit: boolean; onDone: () => void }) {
  const { doc, sel, range } = model;
  const { r, c } = sel.anchor;
  const text = doc.cells[cellKey(r, c)]?.t ?? "";
  const ref = useRef<HTMLInputElement>(null);
  const edited = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (el && !edited.current) el.value = text;
  }, [text, r, c]);
  const single = range.r0 === range.r1 && range.c0 === range.c1;
  const merged = model.merges.get(cellKey(r, c));
  const name =
    single || (merged && merged.rs - 1 === range.r1 - range.r0 && merged.cs - 1 === range.c1 - range.c0)
      ? cellName(sel.anchor)
      : `${cellName({ r: range.r0, c: range.c0 })}:${cellName({ r: range.r1, c: range.c1 })}`;
  const commit = (value: string) => {
    if (!edited.current) return;
    edited.current = false;
    const now = model.docRef.current.cells[cellKey(r, c)]?.t ?? "";
    if (value !== now) model.apply((d) => setTexts(d, [{ r, c, t: value }]));
  };
  return (
    <div className="border-line flex items-stretch border-b text-sm">
      <div className="border-line num flex w-[92px] shrink-0 items-center justify-center border-r font-bold" aria-label="칸 주소">
        {name}
      </div>
      <input
        ref={ref}
        key={`${r},${c}`}
        defaultValue={text}
        // 🔴 읽기 권한이면 **비활성** + 안내(원장 2026-11-05, write-lock.ts). 복사는 이 칸이 아니라 판(Ctrl+C·우클릭 '복사')이
        //    맡으므로 readOnly로 남겨 둘 이유가 없다. 글자가 차 있어 안내가 가리면 머리줄의 SaveStatus가 같은 말을 한다.
        disabled={!canEdit}
        placeholder={canEdit ? undefined : writeLockedPlaceholder("timetable")}
        maxLength={SHEET_LIMITS.text}
        aria-label="칸 글자"
        className="min-w-0 flex-1 bg-transparent px-2 py-1 outline-none"
        onInput={() => {
          edited.current = true;
        }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Enter") {
            e.preventDefault();
            commit(e.currentTarget.value);
            onDone();
          } else if (e.key === "Escape") {
            e.preventDefault();
            edited.current = false;
            e.currentTarget.value = model.docRef.current.cells[cellKey(r, c)]?.t ?? "";
            onDone();
          }
        }}
        onBlur={(e) => {
          if (canEdit) commit(e.currentTarget.value);
        }}
      />
    </div>
  );
}

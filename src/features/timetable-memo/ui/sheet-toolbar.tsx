"use client";

import type { ReactNode, RefObject } from "react";
import { TOOLBAR_CHIP, TOOLBAR_CHIP_OFF, TOOLBAR_CHIP_ON } from "@/components/toolbar-controls";
import { DEFAULT_FONT, DEFAULT_FONT_PT } from "../doc";
import { styleAt } from "../ops";
import { FONT_CHOICES, FONT_SIZES } from "../style-css";
import { BorderPicker } from "./border-picker";
import { ColorPicker } from "./color-picker";
import { ToolGroupLabel, ToolItem, ToolPopover } from "./tool-popover";
import type { SheetActions, ToggleFlag } from "./use-sheet-actions";
import type { SheetModel } from "./use-sheet-model";

/**
 * 서식 툴바 — 엑셀 '홈' 탭의 서식 묶음. 단추마다 글자 라벨(아이콘만 있는 단추 금지 — 디자인 규약).
 * 🔴 누를 때 판의 초점을 뺏지 않는다(`onMouseDown` preventDefault · 팝오버는 닫히면 판으로 초점을 돌린다) —
 *    서식을 바꾸고 바로 이어 칠 수 있어야 엑셀처럼 쓴다.
 */
const FLAGS: { flag: ToggleFlag; label: ReactNode; title: string }[] = [
  { flag: "b", label: <b>B</b>, title: "굵게 (Ctrl+B)" },
  { flag: "i", label: <i className="font-serif">I</i>, title: "기울임 (Ctrl+I)" },
  { flag: "u", label: <u>U</u>, title: "밑줄 (Ctrl+U)" },
  { flag: "st", label: <s>S</s>, title: "취소선 (Ctrl+5)" },
];

/** 고르고 닫기 — 팝오버 항목 공통. */
const then = (close: () => void, fn: () => void) => () => {
  fn();
  close();
};

function Chip({ on = false, title, onPress, disabled, children }: { on?: boolean; title: string; onPress: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={on}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onPress}
      className={`${TOOLBAR_CHIP} ${on ? TOOLBAR_CHIP_ON : TOOLBAR_CHIP_OFF} justify-center disabled:opacity-50`}
    >
      {children}
    </button>
  );
}

export function SheetToolbar({ model, actions, focusRef, canEdit }: { model: SheetModel; actions: SheetActions; focusRef: RefObject<HTMLElement | null>; canEdit: boolean }) {
  const { doc, range, history } = model;
  const s = styleAt(doc, range.r0, range.c0);
  const off = !canEdit;
  const fontLabel = FONT_CHOICES.find((f) => f.value === (s.ff ?? DEFAULT_FONT))?.label ?? s.ff ?? DEFAULT_FONT;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Chip title="되돌리기 (Ctrl+Z)" onPress={actions.undo} disabled={off || history.undo === 0}>되돌리기</Chip>
      <Chip title="다시 실행 (Ctrl+Y)" onPress={actions.redo} disabled={off || history.redo === 0}>다시 실행</Chip>
      <span className="bg-line mx-0.5 h-5 w-px" aria-hidden />
      <ToolPopover label={fontLabel} title="글꼴" focusRef={focusRef} disabled={off}>
        {(close) =>
          FONT_CHOICES.map((f) => (
            <ToolItem key={f.value} active={f.value === (s.ff ?? DEFAULT_FONT)} onPick={then(close, () => actions.style({ ff: f.value === DEFAULT_FONT ? null : f.value }))}>
              <span style={{ fontFamily: `"${f.value}", sans-serif` }}>{f.label}</span>
            </ToolItem>
          ))
        }
      </ToolPopover>
      <ToolPopover label={<span className="num">{s.fs ?? DEFAULT_FONT_PT}</span>} title="글자 크기(pt)" focusRef={focusRef} disabled={off}>
        {(close) => (
          <div className="grid grid-cols-3 gap-0.5">
            {FONT_SIZES.map((n) => (
              <ToolItem key={n} active={n === (s.fs ?? DEFAULT_FONT_PT)} onPick={then(close, () => actions.style({ fs: n === DEFAULT_FONT_PT ? null : n }))}>
                <span className="num">{n}</span>
              </ToolItem>
            ))}
          </div>
        )}
      </ToolPopover>
      {FLAGS.map((f) => (
        <Chip key={f.flag} title={f.title} on={!!s[f.flag]} onPress={() => actions.toggle(f.flag)} disabled={off}>
          {f.label}
        </Chip>
      ))}
      <ToolPopover
        label={<><span>글자색</span><span aria-hidden className="ring-line inline-block size-3.5 rounded-sm ring-1" style={{ background: s.fc ?? "#000000" }} /></>}
        title="글자색"
        focusRef={focusRef}
        disabled={off}
      >
        {(close) => <ColorPicker value={s.fc} none="기본(검정)" onPick={(hex) => then(close, () => actions.style({ fc: hex === "#000000" ? null : hex }))()} />}
      </ToolPopover>
      <ToolPopover
        label={<><span>채우기</span><span aria-hidden className="ring-line inline-block size-3.5 rounded-sm ring-1" style={{ background: s.bg ?? "#ffffff" }} /></>}
        title="채우기 색"
        focusRef={focusRef}
        disabled={off}
      >
        {(close) => <ColorPicker value={s.bg} none="채우기 없음" onPick={(hex) => then(close, () => actions.style({ bg: hex === "#ffffff" ? null : hex }))()} />}
      </ToolPopover>
      <ToolPopover label="정렬" title="가로·세로 정렬" focusRef={focusRef} disabled={off}>
        {(close) => (
          <>
            <ToolGroupLabel>가로</ToolGroupLabel>
            {(["left", "center", "right"] as const).map((ha) => (
              <ToolItem key={ha} active={(s.ha ?? "left") === ha} onPick={then(close, () => actions.style({ ha: ha === "left" ? null : ha }))}>
                {ha === "left" ? "왼쪽" : ha === "center" ? "가운데" : "오른쪽"}
              </ToolItem>
            ))}
            <ToolGroupLabel>세로</ToolGroupLabel>
            {(["top", "middle", "bottom"] as const).map((va) => (
              <ToolItem key={va} active={(s.va ?? "bottom") === va} onPick={then(close, () => actions.style({ va: va === "bottom" ? null : va }))}>
                {va === "top" ? "위" : va === "middle" ? "가운데" : "아래"}
              </ToolItem>
            ))}
          </>
        )}
      </ToolPopover>
      <ToolPopover label="줄바꿈" title="글자가 칸보다 길 때" focusRef={focusRef} disabled={off}>
        {(close) =>
          ([["overflow", "넘치게(옆 칸이 비면)"], ["wrap", "줄바꿈"], ["clip", "자르기"]] as const).map(([wr, label]) => (
            <ToolItem key={wr} active={(s.wr ?? "overflow") === wr} onPick={then(close, () => actions.style({ wr: wr === "overflow" ? null : wr }))}>
              {label}
            </ToolItem>
          ))
        }
      </ToolPopover>
      <ToolPopover label="병합" title="셀 병합" focusRef={focusRef} disabled={off}>
        {(close) => (
          <>
            <ToolItem onPick={then(close, () => actions.merge())}>셀 병합</ToolItem>
            <ToolItem onPick={then(close, () => actions.unmerge())}>병합 해제</ToolItem>
          </>
        )}
      </ToolPopover>
      <ToolPopover label="테두리" title="테두리" focusRef={focusRef} disabled={off}>
        {(close) => <BorderPicker onPick={(mode, line) => then(close, () => actions.borders(mode, line))()} />}
      </ToolPopover>
      <ToolPopover label="행·열" title="행·열 넣기와 지우기" focusRef={focusRef} disabled={off}>
        {(close) => (
          <>
            <ToolItem onPick={then(close, () => actions.insertRows("above"))}>위에 행 넣기</ToolItem>
            <ToolItem onPick={then(close, () => actions.insertRows("below"))}>아래에 행 넣기</ToolItem>
            <ToolItem onPick={then(close, () => actions.deleteRows())}>행 지우기</ToolItem>
            <ToolItem onPick={then(close, () => actions.insertCols("left"))}>왼쪽에 열 넣기</ToolItem>
            <ToolItem onPick={then(close, () => actions.insertCols("right"))}>오른쪽에 열 넣기</ToolItem>
            <ToolItem onPick={then(close, () => actions.deleteCols())}>열 지우기</ToolItem>
          </>
        )}
      </ToolPopover>
      <ToolPopover label="지우기" title="내용·서식 지우기" focusRef={focusRef} disabled={off}>
        {(close) => (
          <>
            <ToolItem onPick={then(close, () => actions.clearContents())}>내용 지우기 (Delete)</ToolItem>
            <ToolItem onPick={then(close, () => actions.clearFormats())}>서식 지우기</ToolItem>
          </>
        )}
      </ToolPopover>
    </div>
  );
}

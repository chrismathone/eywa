"use client";

/**
 * 특이사항 칸 — 평소엔 좁고, **적을 때만 스티커 메모처럼 펼쳐진다**.
 *
 * 원장 2026-08-28: *"특이사항 열너비 조금만 줄여줘 현재의 80% 정도"* → *"물론 그 뒤로도 계속 적을 수
 * 있지만 기본 열너비"* → *"적을때는 스티커메모처럼 창이 커지고 다 적고 닫으면 일부만 보이게"*.
 *
 * 열을 좁히면 쓰는 자리가 같이 좁아진다 — 그래서 **폭은 열이, 쓰는 자리는 포커스가** 정하게 갈랐다.
 * 표의 열 폭은 그대로 두고(줄맞춤·`grid-rows-subgrid`가 걸려 있다), 포커스 동안만 그 칸 위로 뜬다.
 *
 * 🔑 **한 요소만 쓴다**(입력 하나가 접혔다 펴진다). 접힘용 미리보기와 펼침용 입력을 따로 두면 포커스가
 *    갈아타면서 커서 위치·IME 조합·`defaultValue` 동기화가 전부 깨진다.
 * 🔑 **자리는 스페이서가 지킨다.** 입력을 `absolute`로 띄우면 칸이 0높이로 접혀 행이 밀리므로, 칸 안에
 *    한 줄 높이(h-5) 상자를 항상 두고 입력은 그 위에 겹친다 — 펼쳐도 표는 1px도 안 움직인다.
 * ⚠️ 펼침 치수는 **인라인 style**로 준다. `SHEET_INPUT`의 `w-full h-5`와 같은 속성을 클래스로 덮으면
 *    이기는 쪽을 문자열 순서가 아니라 Tailwind가 CSS를 찍은 순서가 정한다([ui-box](../ui-box.ts) ⚠️).
 * ⚠️ **오른쪽에 붙여 왼쪽으로** 펼친다. 특이사항은 맨 오른쪽 열이라 오른쪽으로 펼치면 옆 요일 카드를
 *    침범한다(주간 시트는 요일이 가로로 붙어 있다).
 * ⚠️ Enter는 여기서도 **다음 행**이다(`handleGridNavKey`) — 줄바꿈은 Shift+Enter. 표 안의 모든 칸이
 *    같은 약속을 쓰므로 이 칸만 다르게 두지 말 것.
 */
import { useState } from "react";
import { handleGridNavKey } from "@/features/onescreen/components/grid-nav";
import { SHEET_INPUT } from "../ui-box";

/** 펼친 스티커 메모 치수(px) — 좁아진 열(기본 폼 104px)에서도 한눈에 보이는 최소 크기. */
export const NOTE_POPOUT_W = 248;
export const NOTE_POPOUT_H = 88;

export function NoteCell({
  defaultValue,
  disabled,
  label,
  navCol,
  navRow,
  onChange,
}: {
  defaultValue: string;
  disabled: boolean;
  /** aria-label 전문(학생 이름 + '특이사항'). */
  label: string;
  navCol: string;
  navRow: number;
  onChange: (next: string) => void;
}) {
  const [open, setOpen] = useState(false);
  // 🔴 입력은 **비제어**(defaultValue)로 둔다 — 이 표의 다른 칸과 같은 규약이고, 저장이 디바운스라
  //    제어로 바꾸면 저장 왕복이 커서를 되감는다. 아래 상태는 **툴팁 문자열용 거울**일 뿐이다.
  const [mirror, setMirror] = useState(defaultValue);
  return (
    // pr-1 없음 — 주간 표 원본과 동일(옮기며 폭을 바꾸지 않는다).
    <td className="py-px">
      <div className="relative h-5">
        {/* 🔴 **줄높이·세로여백을 branch마다 명시한다.** `<input>`은 글자를 알아서 세로 가운데 두지만
            `<textarea>`는 안 그런다 — 20px(h-5) 상자에 기본 세로여백(≈2px)과 20px 줄높이가 겹치면
            글자가 잘리거나 밀린다(오늘 면 진도 칸도 같은 이유로 `py-[0.3rem] leading-[1.2]`를 박아 뒀다).
            ⚠️ 가로여백(px-1)은 `SHEET_INPUT` 것을 그대로 쓴다 — 같은 속성을 덮으면 이기는 쪽을 Tailwind가
               CSS를 찍은 순서가 정한다([ui-box](../ui-box.ts) ⚠️). 세로여백·줄높이는 SHEET_INPUT에 없어 안전. */}
        <textarea
          className={`${SHEET_INPUT} absolute top-0 left-0 resize-none ${
            open
              ? "shadow-card scrollbar-thin z-30 overflow-auto py-1 leading-[1.35] whitespace-pre-wrap"
              : "overflow-hidden py-px leading-[13px] whitespace-nowrap"
          }`}
          // 펼침 치수·정박·바탕은 **인라인**으로(위 ⚠️). 바탕을 인라인으로 두는 이유: 같은 축의
          // 클래스를 두 번 적으면 이기는 쪽이 문자열 순서가 아니라 CSS 순서로 정해져([[#116]]),
          // 지는 날엔 펼친 메모 뒤로 아랫줄이 그대로 비친다. 인라인은 항상 이긴다.
          // (2026-09-03부터 `SHEET_INPUT` 자체가 `bg-card`라 접힌 상태도 흰색이다.)
          style={
            open
              ? {
                  left: "auto",
                  right: 0,
                  width: NOTE_POPOUT_W,
                  height: NOTE_POPOUT_H,
                  backgroundColor: "var(--card)",
                }
              : undefined
          }
          rows={1}
          defaultValue={defaultValue}
          disabled={disabled}
          aria-label={label}
          data-nav-col={navCol}
          data-nav-row={navRow}
          onKeyDown={handleGridNavKey}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onChange={(e) => {
            setMirror(e.target.value);
            onChange(e.target.value);
          }}
          // 접혔을 때 안 보이는 뒷부분은 마우스 오버로 읽는다(열이 좁아진 만큼의 보상).
          title={!open && mirror ? mirror : undefined}
        />
      </div>
    </td>
  );
}

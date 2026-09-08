"use client";

import { chipProps, colorLabel, dotProps } from "@/features/calendar/color";
import type { CalendarColor, CalendarTag } from "@/features/calendar/types";
import { ColorPicker } from "./color-picker";

/**
 * 일정 등록·수정 다이얼로그의 **색 설명 영역** — 원장 2026-08-19: *"일정 색상에 따라 태그 관리했는데
 * 등록할 때는 색상에 대한 설명 같은 게 부족함."*
 *
 * 세 조각이 한 가지를 말한다: ① 어떤 태그가 무슨 색인지(범례) ② 지금 이 일정이 무슨 색이 되는지
 * (규칙 문장) ③ 그래서 달력에서 어떻게 보이는지(미리보기 칩). 색 규칙 자체는 `eventDisplayColor`
 * 단일 소스 그대로 — **태그가 있으면 태그색이 이긴다**.
 */

/**
 * 태그 색 범례 — 등록하는 자리에서 "무슨 색이 무슨 태그인지"를 보여준다.
 * 클릭하면 그 태그로 선택되므로 설명이자 단축키다(다시 누르면 해제).
 * 태그가 많아도 패널을 밀지 않게 자체 스크롤.
 */
export function TagLegend({
  tags,
  selectedId,
  onPick,
}: {
  tags: CalendarTag[];
  selectedId: string;
  onPick: (id: string) => void;
}) {
  return (
    <div className="mt-1.5 flex max-h-[76px] flex-wrap gap-1 overflow-y-auto">
      {tags.map((t) => {
        const dot = dotProps(t.color);
        const on = selectedId === t.id;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onPick(on ? "" : t.id)}
            aria-pressed={on}
            title={`${t.name} · ${colorLabel(t.color)}`}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition ${
              on
                ? "border-primary text-foreground font-medium"
                : "border-line text-text-dim hover:border-primary/50 hover:text-foreground"
            }`}
          >
            <span
              className={`size-2 shrink-0 rounded-full ${dot.className}`}
              style={dot.style}
              aria-hidden
            />
            {t.name}
          </button>
        );
      })}
    </div>
  );
}

/** 저장 전 미리보기 — 이 일정이 달력에서 어떤 칩으로 보이는지 그대로 그린다. */
export function EventPreview({ title, color }: { title: string; color: CalendarColor }) {
  const chip = chipProps(color);
  return (
    <span
      className={`inline-block max-w-full truncate rounded px-1.5 py-0.5 text-xs leading-tight font-medium ${chip.className}`}
      style={chip.style}
    >
      {title}
    </span>
  );
}

/**
 * 색 필드 — 태그가 있으면 "태그색을 따른다"는 규칙을 문장으로 말하고, 없으면 색 선택기를 편다.
 * 어느 쪽이든 **미리보기**로 끝난다(설명보다 그림이 빠르다).
 */
export function EventColorField({
  selectedTag,
  color,
  onColorChange,
}: {
  selectedTag: CalendarTag | null;
  color: CalendarColor;
  onColorChange: (c: CalendarColor) => void;
}) {
  if (selectedTag) {
    const dot = dotProps(selectedTag.color);
    return (
      <div className="space-y-1.5">
        <p className="text-text-dim flex flex-wrap items-center gap-1.5 text-xs break-keep">
          <span
            className={`size-4 shrink-0 rounded-full ${dot.className}`}
            style={dot.style}
            aria-hidden
          />
          색은 <b className="text-foreground">{selectedTag.name}</b> 태그색(
          {colorLabel(selectedTag.color)})을 따릅니다 — 태그를 바꾸면 색도 바뀝니다.
        </p>
        <EventPreview title="이렇게 보입니다" color={selectedTag.color} />
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      <ColorPicker value={color} onChange={onColorChange} label="일정 색" />
      <p className="text-text-faint text-xs break-keep">
        태그 없이 등록할 때 쓰는 색입니다 — 태그를 고르면 태그색이 우선합니다.
      </p>
      <EventPreview title="이렇게 보입니다" color={color} />
    </div>
  );
}

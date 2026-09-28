"use client";

import { useState } from "react";
import { EyIcon, type AywaIconName } from "@/components/icons/aywa-icons";
import { PickerDialog, type PickerOption } from "./picker-dialog";

/**
 * 고른 것 = 지울 수 있는 칩 · 끝에 '고르기' → 고르기 창. 많이 고르면 앞 8개 + "외 N개"(펼치기).
 * 칩은 반전(학원색 연한 바탕 + 진한 글자)이라 한눈에 고른 것이 보인다.
 */
const SHOWN = 8;

export type ChipItem = { key: string; label: string; icon?: AywaIconName };

export function ChipField({
  items,
  onRemove,
  empty,
  addLabel,
  picker,
  extra,
}: {
  items: ChipItem[];
  onRemove: (key: string) => void;
  empty: string;
  addLabel: string;
  picker: {
    title: string;
    description?: string;
    groups: readonly { id: string; label: string }[];
    options: readonly PickerOption[];
    picked: readonly string[];
    onApply: (keys: string[]) => void;
  };
  extra?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, SHOWN);

  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
      {items.length === 0 ? <span className="text-text-faint text-sm">{empty}</span> : null}
      {shown.map((it) => (
        <span key={it.key} className="bg-primary-soft text-primary inline-flex items-center gap-1 rounded-full py-0.5 pr-1 pl-2.5 text-sm font-medium">
          {it.icon ? <EyIcon name={it.icon} size={14} /> : null}
          {it.label}
          <button type="button" onClick={() => onRemove(it.key)} aria-label={`${it.label} 빼기`} className="hover:bg-primary/15 rounded-full p-0.5">
            <EyIcon name="close" size={12} />
          </button>
        </span>
      ))}
      {items.length > SHOWN ? (
        <button type="button" onClick={() => setAll((v) => !v)} className="text-primary text-sm underline-offset-2 hover:underline">
          {all ? "접기" : `외 ${items.length - SHOWN}개`}
        </button>
      ) : null}
      {extra}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="border-line text-text-dim hover:text-foreground hover:bg-bg-soft inline-flex items-center gap-1 rounded-full border border-dashed px-2.5 py-0.5 text-sm"
      >
        <EyIcon name="plus" size={14} />
        {addLabel}
      </button>
      <PickerDialog open={open} onOpenChange={setOpen} {...picker} />
    </div>
  );
}

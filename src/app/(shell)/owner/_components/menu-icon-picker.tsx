"use client";

import { useState } from "react";
import { AYWA_ICON_CATALOG, type AywaIconName } from "@/components/icons/aywa-icons";
import { hasMenuGlyph, MenuGlyph } from "@/components/icons/menu-glyph";
const icons = AYWA_ICON_CATALOG.filter((i) => hasMenuGlyph(i.name));

export function MenuIconPicker({ value, label, onChange }: { value: AywaIconName; label: string; onChange: (icon: AywaIconName) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  return <div className="relative shrink-0">
    <button type="button" aria-label={`${label} 아이콘 선택`} aria-expanded={open} onClick={() => setOpen(!open)} className="border-line hover:bg-bg-soft flex size-10 items-center justify-center rounded-lg border"><MenuGlyph name={value} size={24} /></button>
    {open ? <div className="border-line bg-card shadow-modal absolute top-12 left-0 z-30 w-64 rounded-xl border p-3" role="dialog" aria-label={`${label} 아이콘`}>
      <div className="mb-2 flex justify-between"><span className="text-sm font-bold">아이콘 선택</span><button type="button" className="text-text-dim text-xs" onClick={() => setOpen(false)}>닫기</button></div>
      <input aria-label="아이콘 검색" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="이름으로 찾기" className="border-line mb-2 w-full rounded-md border px-2 py-1 text-sm" />
      <div className="grid max-h-60 grid-cols-5 gap-1 overflow-y-auto">{icons.filter((i) => `${i.label} ${i.meaning}`.includes(query.trim())).map((i) => <button type="button" key={i.name} title={i.label} aria-label={i.label} aria-pressed={value === i.name} onClick={() => { onChange(i.name); setOpen(false); }} className={`flex size-10 items-center justify-center rounded-md ${value === i.name ? "bg-primary-soft ring-primary ring-1" : "hover:bg-bg-soft"}`}><MenuGlyph name={i.name} size={26} /></button>)}</div>
    </div> : null}
  </div>;
}

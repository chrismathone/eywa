"use client";

import { useIsMac, modKey } from "@/lib/use-platform";

export function ShortcutsList() {
  const isMac = useIsMac();
  const mod = modKey(isMac);
  const items = [
    { keys: `${mod} + K`, description: "전역 검색" },
    { keys: `${mod} + N`, description: "새 학생" },
    { keys: "G + D", description: "대시보드로 이동" },
    { keys: "G + S", description: "학생목록으로 이동" },
    { keys: "G + B", description: "수납관리로 이동" },
  ];
  return (
    <ul className="space-y-2">
      {items.map((s) => (
        <li key={s.description} className="flex items-center justify-between">
          <span className="text-text-dim text-[12px]">{s.description}</span>
          <kbd className="bg-bg-soft text-foreground border-line rounded-md border px-2 py-0.5 font-mono text-[11px] font-bold">
            {s.keys}
          </kbd>
        </li>
      ))}
    </ul>
  );
}

export function HeroSearchHint() {
  const isMac = useIsMac();
  return (
    <span className="font-mono text-[10px] text-white/60">
      {isMac ? "⌘K" : "Ctrl+K"}
    </span>
  );
}

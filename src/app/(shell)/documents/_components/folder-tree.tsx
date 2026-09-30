"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Folder, FolderOpen } from "@/components/icons/aywa-icon-compat";
import { categoryPath, flattenCategories, type DocumentCategoryOption } from "@/features/documents/categories";
import { FolderDropTarget, FolderName } from "./folder-interactions";
import { FolderFavoriteToggle } from "./folder-favorite-toggle";
import { useShownFolderKey } from "./folder-navigation";

type FolderTreeProps = {
  categories: DocumentCategoryOption[];
  counts: Record<string, number> | null;
  activeKey: string | null;
  hrefs: Record<string, string>;
  favoriteKeys: string[];
};

function ancestorKeys(categories: DocumentCategoryOption[], key: string | null): string[] {
  return key ? categoryPath(categories, key).slice(0, -1).map((c) => c.key) : [];
}

export function FolderTree({ categories, counts, activeKey: committedKey, hrefs, favoriteKeys }: FolderTreeProps) {
  // 선택 표시는 누르는 즉시(탐색기 낙관 값) — 서버 응답을 기다리지 않는다.
  const activeKey = useShownFolderKey(committedKey);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(ancestorKeys(categories, activeKey)));
  // 진입 경로가 바뀌면 그 조상만 **더** 펼친다. 예전엔 트리를 통째로 다시 만들어(key 교체) 사용자가 펼쳐 둔 폴더가
  // 접히고 줄이 위로 밀렸다 — 더블클릭의 두 번째 클릭이 다른 폴더에 떨어지고, 편집 중인 이름 칸도 사라졌다.
  // 열린 뒤에는 여전히 자유롭게 접을 수 있다(같은 경로에선 다시 펼치지 않는다).
  const [seenKey, setSeenKey] = useState(activeKey);
  if (seenKey !== activeKey) {
    setSeenKey(activeKey);
    const missing = ancestorKeys(categories, activeKey).filter((k) => !expanded.has(k));
    if (missing.length) setExpanded(new Set([...expanded, ...missing]));
  }
  const parents = new Set(categories.map((c) => c.parentKey).filter(Boolean));
  const rows = flattenCategories(categories);
  const favorites = new Set(favoriteKeys);
  return (
    <ul className="max-h-64 space-y-0.5 overflow-auto lg:max-h-[60vh]" aria-label="폴더 목록">
      {rows.map(({ category: c, depth, path }) => {
        if (path.slice(0, -1).some((p) => !expanded.has(p.key))) return null;
        const active = c.key === activeKey;
        const open = expanded.has(c.key);
        const Icon = active || open ? FolderOpen : Folder;
        const pathLabel = path.map((p) => p.label).join(" / ");
        return (
          <li key={c.key}>
            <FolderDropTarget folderKey={c.key} onHoverExpand={() => setExpanded((prev) => prev.has(c.key) ? prev : new Set(prev).add(c.key))}
              className={`flex items-center rounded-md ${active ? "bg-primary/10 text-primary font-bold" : "text-text-dim hover:bg-bg-soft"}`}
              style={{ paddingLeft: depth * 14, minWidth: depth * 14 + 150 }}>
              {parents.has(c.key) ? (
                <button type="button" className="flex size-6 shrink-0 items-center justify-center rounded hover:bg-primary/10 disabled:opacity-50"
                  aria-label={`${pathLabel} ${open ? "접기" : "펼치기"}`} aria-expanded={open}
                  onClick={() => setExpanded((prev) => { const next = new Set(prev); if (next.has(c.key)) next.delete(c.key); else next.add(c.key); return next; })}>
                  {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                </button>
              ) : <span className="w-6 shrink-0" />}
              <div className="flex min-w-0 flex-1 items-center gap-2 pr-2 text-sm">
                <Icon className={`size-4 shrink-0 ${active ? "text-primary" : "text-amber"}`} strokeWidth={1.8} />
                <FolderName folder={c} href={hrefs[c.key]} active={active} title={pathLabel} />
                <span className="num text-text-faint text-xs" title="하위 폴더 문서 포함">{counts ? counts[c.key] ?? 0 : "—"}</span>
                <FolderFavoriteToggle folderKey={c.key} pathLabel={pathLabel} favorite={favorites.has(c.key)} atLimit={favoriteKeys.length >= 10} />
              </div>
            </FolderDropTarget>
          </li>
        );
      })}
    </ul>
  );
}

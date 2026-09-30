"use client";

import { Folder, FolderOpen } from "@/components/icons/aywa-icon-compat";
import { categoryPath, categoryTreeCounts, type DocumentCategoryOption } from "@/features/documents/categories";
import { CategoryManager } from "./category-manager";
import { FolderTree } from "./folder-tree";
import { FolderDropTarget } from "./folder-interactions";
import { FolderFavoriteToggle } from "./folder-favorite-toggle";
import { FolderNavLink, useShownFolderKey } from "./folder-navigation";

// 탐색기 좌측 폴더 팬 — 개인 즐겨찾기, 서식 분류 폴더, (권한 있으면) 수납관리 연동 폴더.
// 클라 컴포넌트: 누른 폴더를 서버 응답 전에 선택된 모양으로 바꾼다(탐색기 낙관 값, folder-navigation.tsx).
// 주소는 서버 페이지가 지어 넘긴다(`href`·`hrefs` — 정렬·검색·embed 보존 규칙은 page.tsx buildHref 한 곳).
// 분류 폴더는 학원장이 관리하는 테넌트 데이터(0161a) — 쓰기 권한이 있으면 목록 아래에 '분류 관리'가 붙는다.

export type FolderItem = { key: string | null; label: string; count: number | null; href: string };

function FolderLink({ f, active }: { f: FolderItem; active: boolean }) {
  const Icon = active ? FolderOpen : Folder;
  return (
    <FolderNavLink
      href={f.href}
      folderKey={f.key}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors ${
        active ? "bg-primary/10 text-primary font-bold" : "text-text-dim hover:bg-bg-soft hover:text-foreground"
      }`}
    >
      <Icon className={`size-4 shrink-0 ${active ? "text-primary" : "text-amber"}`} strokeWidth={1.8} />
      <span className="min-w-0 flex-1 truncate">{f.label}</span>
      <span className="text-text-faint num text-xs whitespace-nowrap" title={f.count === null ? "문서 수를 불러오지 못했습니다" : undefined}>{f.count ?? "—"}</span>
    </FolderNavLink>
  );
}

export function FolderNav({
  folders,
  linkedFolders,
  activeKey: committedKey,
  hrefs,
  categories,
  counts,
  canManage,
  favoriteKeys,
}: {
  folders: FolderItem[];
  linkedFolders: FolderItem[];
  activeKey: string | null;
  /** 분류 키 → 그 폴더 주소(트리·즐겨찾기 공용). */
  hrefs: Record<string, string>;
  /** 분류 관리 다이얼로그가 편집하는 원본 목록(폴더와 달리 '전체 문서'는 없다). */
  categories: DocumentCategoryOption[];
  counts: Record<string, number> | null;
  canManage: boolean;
  favoriteKeys: string[];
}) {
  const activeKey = useShownFolderKey(committedKey);
  const byKey = new Map(categories.map((category) => [category.key, category]));
  const favorites = favoriteKeys.flatMap((key) => { const category = byKey.get(key); return category ? [category] : []; });
  const treeCounts = counts ? categoryTreeCounts(categories, counts) : null;
  return (
    <nav aria-label="문서 폴더" className="mb-3 min-w-0 space-y-1 lg:mb-0">
      {favorites.length > 0 ? <div aria-label="즐겨찾기 폴더" className="space-y-0.5 border-b border-line pb-2 mb-2">
        <p className="flex items-center justify-between px-2.5 pb-1 text-xs font-semibold text-text-dim">
          <span>즐겨찾기</span><span className="num text-text-faint">{favorites.length}/10</span>
        </p>
        {favorites.map((category) => {
          const pathLabel = categoryPath(categories, category.key).map((part) => part.label).join(" / ");
          const active = category.key === activeKey;
          return <FolderDropTarget key={category.key} folderKey={category.key}
            className={`flex min-w-0 items-center rounded-md ${active ? "bg-primary/10 text-primary font-bold" : "text-text-dim hover:bg-bg-soft"}`}>
            <FolderNavLink href={hrefs[category.key]} folderKey={category.key} title={pathLabel} aria-current={active ? "page" : undefined}
              className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-1 text-sm">
              <Folder className="size-4 shrink-0 text-amber" strokeWidth={1.8} />
              <span className="min-w-0 flex-1 truncate">{category.label}</span>
              <span className="num text-text-faint shrink-0 text-xs">{treeCounts ? treeCounts[category.key] ?? 0 : "—"}</span>
            </FolderNavLink>
            <FolderFavoriteToggle folderKey={category.key} pathLabel={pathLabel} favorite atLimit={favorites.length >= 10} />
          </FolderDropTarget>;
        })}
      </div> : null}
      {folders.filter((f) => f.key === null).map((f) => (
        <FolderDropTarget key={f.key ?? "all"} folderKey={null} className="rounded-md">
          <FolderLink f={f} active={f.key === activeKey} />
        </FolderDropTarget>
      ))}
      <FolderTree categories={categories} counts={treeCounts}
        activeKey={committedKey} hrefs={hrefs}
        favoriteKeys={favoriteKeys} />
      {counts === null ? <p role="status" className="px-2.5 text-xs">문서 수 조회 실패. 새로고침해 주세요.</p> : null}
      {canManage && counts ? <CategoryManager categories={categories} counts={counts} /> : null}
      {linkedFolders.length > 0 ? (
        <>
          {/* 연동 폴더 구분 — 행 자체는 수납관리(textbook_orders·tuition_quotes) 소유, 여긴 읽기 전용 링크 */}
          <p className="text-text-faint border-line mt-2 w-full border-t pt-2 pl-2.5 text-xs lg:mt-2">
            수납관리 연동
          </p>
          {linkedFolders.map((f) => (
            <FolderLink key={f.key} f={f} active={f.key === activeKey} />
          ))}
        </>
      ) : null}
    </nav>
  );
}

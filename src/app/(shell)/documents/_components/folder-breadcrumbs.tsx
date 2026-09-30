"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronRight } from "@/components/icons/aywa-icon-compat";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
// 경로 이동도 폴더 팬과 같은 탐색기 이동(누르는 즉시 선택 표시 + 목록 흐림) — 탐색기 밖에선 평범한 Link다.
import { FolderNavLink } from "./folder-navigation";

export type FolderCrumb = { key: string; label: string; href: string };

export function FolderBreadcrumbs({ path, rootHref }: { path: FolderCrumb[]; rootHref: string }) {
  // 위치가 달라지면 이전 경로의 측정값과 열린 메뉴도 함께 초기화한다.
  return <BreadcrumbTrail key={JSON.stringify(path)} path={path} rootHref={rootHref} />;
}

function BreadcrumbTrail({ path, rootHref }: { path: FolderCrumb[]; rootHref: string }) {
  const navRef = useRef<HTMLElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  const [hiddenCount, setHiddenCount] = useState(() =>
    path.length > 3 || path.reduce((n, c) => n + c.label.length, 0) > 36 ? Math.max(0, path.length - 2) : 0);

  useEffect(() => {
    const nav = navRef.current;
    const ruler = rulerRef.current;
    if (!nav || !ruler || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const available = nav.clientWidth;
      if (!available) return;
      const widths = Array.from(ruler.children, (el) => el.getBoundingClientRect().width);
      const [rootWidth, ellipsisWidth, ...folders] = widths;
      const fullWidth = rootWidth + folders.reduce((sum, width) => sum + width, 0);
      if (fullWidth <= available || path.length < 2) { setHiddenCount(0); return; }
      const keepParent = path.length > 2 && rootWidth + ellipsisWidth + folders.slice(-2).reduce((sum, width) => sum + width, 0) <= available;
      setHiddenCount(path.length - (keepParent ? 2 : 1));
    });
    observer.observe(nav);
    observer.observe(ruler); // 글꼴이 늦게 로드되어도 다시 측정한다.
    return () => observer.disconnect();
  }, [path]);

  const fullPath = ["전체 문서", ...path.map((c) => c.label)].join(" / ");
  const hidden = path.slice(0, hiddenCount);
  return <nav ref={navRef} aria-label="현재 폴더 경로" title={fullPath} className="relative min-w-0 max-w-full flex-1 basis-56 text-sm">
    <ol className="flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap">
      <li className="shrink-0"><FolderNavLink href={rootHref} folderKey={null} className="text-text-dim hover:text-primary" aria-current={!path.length ? "page" : undefined}>전체 문서</FolderNavLink></li>
      {hidden.length ? <li className="flex shrink-0 items-center gap-1.5">
        <ChevronRight className="size-3 text-text-faint" />
        <DropdownMenu>
          <DropdownMenuTrigger aria-label="생략된 상위 폴더 보기" title="생략된 상위 폴더 보기"
            className="inline-flex size-6 items-center justify-center rounded text-text-dim hover:bg-bg-soft hover:text-primary">…</DropdownMenuTrigger>
          <DropdownMenuContent className="w-auto max-w-[min(32rem,calc(100vw-2rem))]" align="start">
            {hidden.map((c, i) => <DropdownMenuItem key={c.key} render={<FolderNavLink href={c.href} folderKey={c.key} />}>
              <span className="break-words whitespace-normal">{path.slice(0, i + 1).map((p) => p.label).join(" / ")}</span>
            </DropdownMenuItem>)}
          </DropdownMenuContent>
        </DropdownMenu>
      </li> : null}
      {path.slice(hiddenCount).map((c, i, visible) => <li key={c.key} className="flex min-w-0 items-center gap-1.5">
        <ChevronRight className="size-3 shrink-0 text-text-faint" />
        <FolderNavLink href={c.href} folderKey={c.key} title={path.slice(0, hiddenCount + i + 1).map((p) => p.label).join(" / ")}
          className={`min-w-0 truncate ${i === visible.length - 1 ? "font-semibold text-foreground" : "text-text-dim hover:text-primary"}`}
          aria-current={i === visible.length - 1 ? "page" : undefined}>{c.label}</FolderNavLink>
      </li>)}
    </ol>
    <div aria-hidden="true" className="pointer-events-none invisible absolute inset-0 overflow-hidden">
      <div ref={rulerRef} className="flex w-max items-center whitespace-nowrap">
        <span>전체 문서</span>
        <span className="inline-flex items-center gap-1.5 pl-1.5"><ChevronRight className="size-3" /><span className="size-6">…</span></span>
        {path.map((c, i) => <span key={c.key} className={`inline-flex items-center gap-1.5 pl-1.5 ${i === path.length - 1 ? "font-semibold" : ""}`}>
          <ChevronRight className="size-3" />{c.label}
        </span>)}
      </div>
    </div>
  </nav>;
}

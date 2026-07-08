import Link from "next/link";
import { Folder, FolderOpen } from "lucide-react";

// 탐색기 좌측 폴더 팬 — 서식 분류 폴더 + (권한 있으면) 수납관리 연동 폴더(교재 요청서·수강료 견적서).
// 서버 컴포넌트(함수 prop hrefFor는 같은 렌더 패스의 서버 부모가 넘김 — 클라 경계 없음).

export type FolderItem = { key: string | null; label: string; count: number };

function FolderLink({ f, active, href }: { f: FolderItem; active: boolean; href: string }) {
  const Icon = active ? FolderOpen : Folder;
  return (
    <Link
      href={href}
      className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors ${
        active ? "bg-primary/10 text-primary font-semibold" : "text-text-dim hover:bg-bg-soft hover:text-foreground"
      }`}
    >
      <Icon className={`size-4 shrink-0 ${active ? "text-primary" : "text-amber"}`} strokeWidth={1.8} />
      <span className="min-w-0 flex-1 truncate">{f.label}</span>
      <span className="text-text-faint num text-xs whitespace-nowrap">{f.count}</span>
    </Link>
  );
}

export function FolderNav({
  folders,
  linkedFolders,
  activeKey,
  hrefFor,
}: {
  folders: FolderItem[];
  linkedFolders: FolderItem[];
  activeKey: string | null;
  hrefFor: (key: string | null) => string;
}) {
  return (
    <nav aria-label="문서 분류" className="mb-3 flex flex-wrap gap-1 lg:mb-0 lg:flex-col">
      {folders.map((f) => (
        <FolderLink key={f.key ?? "all"} f={f} active={f.key === activeKey} href={hrefFor(f.key)} />
      ))}
      {linkedFolders.length > 0 ? (
        <>
          {/* 연동 폴더 구분 — 행 자체는 수납관리(textbook_orders·tuition_quotes) 소유, 여긴 읽기 전용 링크 */}
          <p className="text-text-faint border-line mt-2 w-full border-t pt-2 pl-2.5 text-[11px] lg:mt-2">
            수납관리 연동
          </p>
          {linkedFolders.map((f) => (
            <FolderLink key={f.key} f={f} active={f.key === activeKey} href={hrefFor(f.key)} />
          ))}
        </>
      ) : null}
    </nav>
  );
}

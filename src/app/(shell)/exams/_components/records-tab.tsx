import type { ReactNode } from "react";
import { ToolbarButton } from "@/components/toolbar";

type Href = (patch: Record<string, string>) => string;

/**
 * 성적 원장 면의 머리 줄 — 몇 건 중 어디를 보고 있는지 + 앞뒤 페이지.
 * 옛 '이전·다음' 맨 글자 링크는 표 아래 구석에 있어 없는 줄 알았다 — 위·아래 둘 다에 같은 줄을 둔다.
 */
export function RecordsPager({ page, pageSize, total, href, note }: {
  page: number; pageSize: number; total: number; href: Href; note?: ReactNode;
}) {
  const start = total ? (page - 1) * pageSize + 1 : 0;
  const end = Math.min(total, page * pageSize);
  const last = Math.max(1, Math.ceil(total / pageSize));
  return <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
    <p className="text-text-dim"><b className="num text-foreground">{start}–{end}</b> / <span className="num">{total}</span>건{note ? <> · {note}</> : null}</p>
    {last > 1 ? <div className="flex items-center gap-1.5">
      {page > 1 ? <ToolbarButton href={href({ page: String(page - 1) })}>‹ 이전</ToolbarButton> : <ToolbarButton disabled>‹ 이전</ToolbarButton>}
      <span className="num text-text-dim px-1">{page} / {last}</span>
      {page < last ? <ToolbarButton href={href({ page: String(page + 1) })}>다음 ›</ToolbarButton> : <ToolbarButton disabled>다음 ›</ToolbarButton>}
    </div> : null}
  </div>;
}

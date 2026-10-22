"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useSheetT } from "@/features/teacher-view/lang-context";

const PAGE_SIZE = 5;

/** 이력은 5건씩. 본문·수신자·수정/취소는 항목을 펼쳤을 때 읽고 조작한다. */
export function NoticeHistory<T extends { id: string }>({
  title, empty, rows, children,
}: {
  title: string;
  empty: string;
  rows: readonly T[];
  children: (row: T) => ReactNode;
}) {
  const [page, setPage] = useState(0);
  const t = useSheetT();
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  return <section className="bg-card border-line shadow-card min-w-0 rounded-2xl border px-4 py-3">
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-foreground text-sm font-bold">{title} <span className="text-text-faint font-normal">{rows.length}</span></h3>
      {pages > 1 ? <nav aria-label={title} className="flex items-center gap-2 text-xs">
        <Button size="sm" variant="outline" aria-label={t("os.n.historyPrev")} disabled={current === 0} onClick={() => setPage(current - 1)}>‹</Button>
        <span aria-live="polite">{current + 1} / {pages}</span>
        <Button size="sm" variant="outline" aria-label={t("os.n.historyNext")} disabled={current === pages - 1} onClick={() => setPage(current + 1)}>›</Button>
      </nav> : null}
    </div>
    {!rows.length ? <p className="text-text-faint text-xs">{empty}</p> : <ul className="divide-line divide-y">
      {rows.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE).map(row => <li key={row.id}>{children(row)}</li>)}
    </ul>}
  </section>;
}

export function NoticeHistoryItem({ title, status, children }: { title: string; status: ReactNode; children: ReactNode }) {
  const t = useSheetT();
  return <details className="group py-2">
    <summary className="flex cursor-pointer list-none items-center gap-2 rounded-sm py-1 text-xs [&::-webkit-details-marker]:hidden">
      <span aria-hidden className="shrink-0 transition-transform group-open:rotate-90">›</span>
      <span className="text-foreground line-clamp-2 min-w-0 flex-1 wrap-anywhere">{title}</span>
      <span className="shrink-0">{status}</span>
      <span className="text-text-faint shrink-0 group-open:hidden">{t("os.n.historyDetails")}</span>
      <span className="text-text-faint hidden shrink-0 group-open:inline">{t("os.n.historyClose")}</span>
    </summary>
    <div className="border-line mt-2 max-h-80 overflow-y-auto border-t pt-2 pr-1">{children}</div>
  </details>;
}

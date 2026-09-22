"use client";

import { ClipboardList } from "@/components/icons/aywa-icon-compat";
import { WindowLink } from "@/components/workspace/window-link";
import { usePrintWindow } from "@/components/workspace/print-window";
import type { LinkedDocRow } from "@/features/documents/linked";

// 연동 폴더(교재 요청서·수강료 견적서) 행 — DocumentRow와 같은 컬럼 구성의 읽기 전용 링크 행.
// 원본은 다른 테이블 소유라 고정/삭제/다운로드 없음. 클릭 = printId 있으면 A4 인쇄 창, 없으면 일반 창.

const titleCls = "text-foreground hover:text-primary min-w-0 truncate text-left font-medium hover:underline";

function dateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "numeric", day: "numeric" });
}

export function LinkedDocumentRow({ doc }: { doc: LinkedDocRow }) {
  const openPrint = usePrintWindow();
  return (
    <tr className="border-line hover:bg-bg-soft/50 border-t transition-colors">
      <td className="px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <ClipboardList className="text-rose size-4 shrink-0" />
          {doc.printId ? (
            <button
              type="button"
              onClick={(e) => openPrint({ id: doc.printId!, href: doc.href, title: doc.typeLabel }, e)}
              className={titleCls}
              title={doc.typeLabel}
            >
              {doc.title}
            </button>
          ) : (
            <WindowLink href={doc.href} title={doc.typeLabel} className={titleCls}>
              {doc.title}
            </WindowLink>
          )}
        </div>
        {doc.description ? <p className="text-text-faint mt-0.5 truncate pl-6 text-xs">{doc.description}</p> : null}
      </td>
      <td className="text-text-dim px-3 py-2 whitespace-nowrap">{doc.categoryLabel}</td>
      <td className="text-text-dim px-3 py-2 whitespace-nowrap">{doc.typeLabel}</td>
      <td className="text-text-dim num px-3 py-2 text-right whitespace-nowrap">—</td>
      <td className="text-text-dim px-3 py-2 whitespace-nowrap">{dateLabel(doc.createdAt)}</td>
      <td className="text-text-dim px-3 py-2 whitespace-nowrap">{doc.byName ?? "—"}</td>
      <td className="px-3 py-2" />
    </tr>
  );
}

"use client";

import { useMemo, useState } from "react";
import { EyIcon } from "@/components/icons/aywa-icons";
import { Button } from "@/components/ui/button";
import { CONTROL_H_SM } from "@/components/ui/control-scale";
import type { ColumnFormat, SettledReport } from "@/features/assistant/report";
import { kstToday } from "@/lib/date-kst";
import {
  columnAlign,
  columnTotals,
  csvFileName,
  effectiveFormat,
  firstSortDir,
  formatCell,
  sortRows,
  toCsv,
  type Align,
  type SortDir,
} from "./report-format";

type Dataset = SettledReport["datasets"][string];
export type ReportTableColumn = { column: string; label: string; format?: ColumnFormat };

/** 처음 보이는 행 수 · '더 보기' 한 번에 늘리는 행 수. */
const FIRST_ROWS = 20;
const MORE_ROWS = 50;

const ALIGN_TEXT: Record<Align, string> = { left: "text-left", center: "text-center", right: "text-right" };
const ALIGN_FLEX: Record<Align, string> = { left: "justify-start", center: "justify-center", right: "justify-end" };

/**
 * 보고서 표 — 열 머리 고정(스크롤해도 남는다) · 머리를 눌러 정렬(오름 → 내림 → 원래 순서) · 숫자·원·%·날짜(KST) 서식 ·
 * 합계 줄(요청한 칸) · 행이 많으면 '더 보기' · 엑셀(CSV, UTF-8 BOM) 내려받기. 정렬은 받은 행 전체에 건다(보이는 행만이 아니라).
 * 🔴 칸 값은 글자로만 그린다(DB에서 온 학부모 글 등 — HTML로 읽지 않는다).
 */
export function ReportTable({
  columns,
  dataset,
  totals,
  downloadTitle,
}: {
  columns: readonly ReportTableColumn[];
  dataset: Dataset;
  totals?: readonly string[];
  /** CSV 파일 이름에 쓰는 표 제목. */
  downloadTitle: string;
}) {
  const [sort, setSort] = useState<{ column: string; dir: SortDir } | null>(null);
  const [shown, setShown] = useState(FIRST_ROWS);

  const cols = useMemo(
    () =>
      columns.map((c) => {
        const values = dataset.rows.map((r) => r[c.column]);
        const format = effectiveFormat(c.format, values);
        return { ...c, format, align: columnAlign(format, values) };
      }),
    [columns, dataset.rows],
  );
  const rows = useMemo(() => {
    if (!sort) return dataset.rows;
    const col = cols.find((c) => c.column === sort.column);
    return col ? sortRows(dataset.rows, sort.column, sort.dir, col.format) : dataset.rows;
  }, [cols, dataset.rows, sort]);
  const sums = useMemo(() => (totals?.length ? columnTotals(dataset.rows, cols, totals) : null), [cols, dataset.rows, totals]);

  const total = rows.length;
  const visible = rows.slice(0, shown);
  const left = total - visible.length;

  const toggleSort = (column: string, format: ColumnFormat) => {
    setSort((cur) => {
      const first = firstSortDir(format);
      if (!cur || cur.column !== column) return { column, dir: first };
      if (cur.dir === first) return { column, dir: first === "asc" ? "desc" : "asc" };
      return null; // 세 번째 누름 = 원래 순서
    });
  };

  const download = (from: HTMLElement) => {
    const csv = toCsv(cols, rows);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = csvFileName(downloadTitle, kstToday());
    // 링크는 버튼 옆(판 안)에 잠깐 붙인다 — 모달이 바깥을 비활성으로 묶어도 영향이 없게.
    (from.parentElement ?? document.body).appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // 합계 줄의 이름 칸 — 첫 칸이 합계 칸이 아니면 거기에 '합계', 맞으면 값 앞에 붙인다.
  const firstIsSum = !!sums && cols[0] !== undefined && Object.hasOwn(sums, cols[0].column);
  const sumLabel = dataset.truncated ? `합계(받은 ${total.toLocaleString("ko-KR")}행)` : "합계";

  return (
    <div>
      <div className="max-h-[min(64vh,560px)] overflow-auto overscroll-x-contain">
        <table className="w-full border-separate border-spacing-0 text-sm [&_tr>*:not(:first-child)]:border-l [&_tr>*:not(:first-child)]:border-l-line-faint">
          <thead className="sticky top-0 z-[1]">
            <tr>
              {cols.map((c) => {
                const current = sort && sort.column === c.column ? sort.dir : null;
                // 화살표: 정렬 중이면 지금 방향(진하게), 아니면 누르면 걸릴 방향(흐리게) — 공용 SortArrow와 같은 꼴.
                const dir = current ?? firstSortDir(c.format);
                return (
                  <th
                    key={c.column}
                    scope="col"
                    aria-sort={current === "asc" ? "ascending" : current === "desc" ? "descending" : "none"}
                    className={`bg-bg-soft border-line h-10 border-b px-2 font-bold whitespace-nowrap ${ALIGN_TEXT[c.align]}`}
                  >
                    {/* 버튼 이름 = 열 이름 그대로(숨김 글자를 섞으면 칸마다 열 제목이 길게 읽힌다) — 상태는 aria-sort가 말한다. */}
                    <button
                      type="button"
                      onClick={() => toggleSort(c.column, c.format)}
                      className={`${CONTROL_H_SM} hover:bg-muted inline-flex w-full cursor-pointer items-center gap-1 rounded-md px-1 ${ALIGN_FLEX[c.align]} ${current ? "text-primary" : ""}`}
                    >
                      <span>{c.label}</span>
                      <EyIcon name={dir === "desc" ? "arrowDown" : "arrowUp"} size={14} strokeWidth={current ? 2.6 : 1.6} className={current ? "" : "opacity-40"} />
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={cols.length} className="h-24 text-center">
                  해당하는 자료가 없습니다.
                </td>
              </tr>
            ) : (
              visible.map((row, i) => (
                <tr key={i} className="hover:bg-muted/60 [&>td]:border-line [&:not(:first-child)>td]:border-t">
                  {cols.map((c) => {
                    const numeric = c.format === "number" || c.format === "won" || c.format === "percent";
                    const dated = c.format === "date" || c.format === "datetime";
                    const text = formatCell(row[c.column], c.format);
                    return (
                      <td
                        key={c.column}
                        className={`h-10 px-3 py-2 align-middle ${ALIGN_TEXT[c.align]} ${numeric ? "num whitespace-nowrap" : c.align === "left" ? "" : "whitespace-nowrap"}`}
                      >
                        {/* 긴 글은 폭을 묶어 줄바꿈(표 칸의 max-width는 자동 배치에서 안 먹는다 — 안쪽 상자로 묶는다). */}
                        {c.align === "left" && !dated ? <div className="max-w-[28rem] min-w-[10rem] whitespace-pre-line">{text}</div> : text}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
          {sums && total > 0 ? (
            <tfoot className="sticky bottom-0 z-[1]">
              <tr>
                {cols.map((c, i) => {
                  const has = Object.hasOwn(sums, c.column);
                  const value = has ? sums[c.column] : undefined;
                  return (
                    <td
                      key={c.column}
                      className={`bg-bg-soft border-line-strong h-10 border-t px-3 font-bold whitespace-nowrap ${has ? `num ${ALIGN_TEXT[c.align]}` : i === 0 ? "text-center" : ""}`}
                    >
                      {i === 0 && !firstIsSum ? sumLabel : null}
                      {i === 0 && firstIsSum ? `${sumLabel} ` : null}
                      {has ? formatCell(value ?? null, c.format) : null}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
      <div className="border-line flex flex-wrap items-center gap-x-3 gap-y-2 border-t px-4 py-2.5">
        <span className="text-sm whitespace-nowrap">
          <b className="num">{total.toLocaleString("ko-KR")}</b>행
          {dataset.truncated ? <span className="text-amber ml-1.5 font-bold">· 일부만 받았습니다</span> : null}
        </span>
        {left > 0 ? (
          <span className="flex items-center gap-1.5">
            <Button type="button" variant="outline" onClick={() => setShown((n) => n + MORE_ROWS)}>
              {`${Math.min(MORE_ROWS, left).toLocaleString("ko-KR")}행 더 보기`}
            </Button>
            {left > MORE_ROWS ? (
              <Button type="button" variant="ghost" onClick={() => setShown(total)}>
                {`모두 보기(${total.toLocaleString("ko-KR")}행)`}
              </Button>
            ) : null}
          </span>
        ) : null}
        <Button type="button" variant="outline" onClick={(e) => download(e.currentTarget)} className="ml-auto" disabled={total === 0}>
          <EyIcon name="download" />
          엑셀(CSV) 내려받기
        </Button>
      </div>
    </div>
  );
}

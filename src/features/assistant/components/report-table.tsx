"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { EyIcon } from "@/components/icons/aywa-icons";
import { Button } from "@/components/ui/button";
import { CONTROL_H_SM } from "@/components/ui/control-scale";
import type { ColumnFormat, SettledReport } from "@/features/assistant/report";
import { tipProps } from "@/components/hover-tip/tip";
import { kstToday } from "@/lib/date-kst";
import { entityHref, inferredEntityLink, type ReportEntityLink } from "../entity-links";
import { ASSISTANT_NAVIGATE_EVENT } from "./assistant-hotkey";
import { rosterOwnerMissing } from "../report-checks";
import { fitColumn, mayOverflow, oneLine, tableMinWidth } from "./report-columns";
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
export type ReportTableColumn = { column: string; label: string; format?: ColumnFormat; link?: ReportEntityLink };

/** 처음 보이는 행 수 · '더 보기' 한 번에 늘리는 행 수. */
const FIRST_ROWS = 20;
const MORE_ROWS = 50;
const OWNER_UNCONFIRMED = "__assistant_owner_unconfirmed";

const ALIGN_TEXT: Record<Align, string> = { left: "text-left", center: "text-center", right: "text-right" };
const ALIGN_FLEX: Record<Align, string> = { left: "justify-start", center: "justify-center", right: "justify-end" };
/**
 * 두 줄 머리의 정렬 단추 — 열 제목 글이지 툴바 컨트롤이 아니다(control-scale의 '한 줄' 규칙 밖 · 세로 패딩 없이 칸 높이를 따른다).
 * 값보다 훨씬 긴 열 제목만 어절 단위로 두 줄에 접는다(report-columns `twoLineWidth` — 원장 2026-11-11 *"열너비도 스마트하게"*).
 */
const HEAD_TWO_LINE = "min-h-(--control-h-sm) leading-tight";

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
  const ownerMissing = rosterOwnerMissing(columns);
  // 예전 답·시간 제한 답에도 담당 칸은 남긴다. 원본 조회를 바꾸거나 '담당 없음'으로 단정하지 않는다.
  const sourceRows = useMemo<Dataset["rows"]>(() => ownerMissing ? dataset.rows.map(row => ({ ...row, [OWNER_UNCONFIRMED]: "미확인" })) : dataset.rows, [ownerMissing, dataset.rows]);

  const cols = useMemo(
    () =>
      (ownerMissing ? [...columns, { column: OWNER_UNCONFIRMED, label: "담당" } as ReportTableColumn] : columns).map((c) => {
        const values = sourceRows.map((r) => r[c.column]);
        const format = effectiveFormat(c.format, values);
        return { ...c, format, align: columnAlign(format, values), texts: values.map((v) => formatCell(v, format)) };
      }),
    [columns, ownerMissing, sourceRows],
  );
  const rows = useMemo(() => {
    if (!sort) return sourceRows;
    const col = cols.find((c) => c.column === sort.column);
    return col ? sortRows(sourceRows, sort.column, sort.dir, col.format) : sourceRows;
  }, [cols, sourceRows, sort]);
  const sums = useMemo(() => (totals?.length ? columnTotals(sourceRows, cols, totals) : null), [cols, sourceRows, totals]);
  // 열 폭 — 값 · 머리 · 합계 줄 글까지 한 줄로 들어가게(합계가 칸 밖으로 새지 않게).
  const fits = useMemo(
    () =>
      cols.map((c, i) => {
        const extra = [
          ...(sums && Object.hasOwn(sums, c.column) ? [`${i === 0 ? "합계(받은 000행) " : ""}${formatCell(sums[c.column] ?? null, c.format)}`] : []),
          ...(sums && i === 0 ? ["합계(받은 000행)"] : []),
        ];
        return fitColumn(c.label, [...c.texts, ...extra]);
      }),
    [cols, sums],
  );
  const minWidth = useMemo(() => tableMinWidth(fits), [fits]);

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
        {/* 한 줄 고정 행 · 열 폭은 내용에 맞춤(report-columns) — 긴 글 열만 남은 폭을 나누고 넘치면 말줄임 + 카드. */}
        <table style={{ minWidth }} className="w-full table-fixed border-separate border-spacing-0 text-sm [&_tr>*:not(:first-child)]:border-l [&_tr>*:not(:first-child)]:border-l-line-faint">
          <colgroup>
            {fits.map((f, i) => (
              <col key={cols[i]!.column} style={f.width === null ? undefined : { width: f.width }} />
            ))}
          </colgroup>
          <thead className="sticky top-0 z-[1]">
            <tr>
              {cols.map((c, ci) => {
                const current = sort && sort.column === c.column ? sort.dir : null;
                // 머리가 값보다 훨씬 긴 열은 머리를 두 줄로 접는다(report-columns fitColumn — 열 폭은 값이 정한다).
                const wrap = !!fits[ci]?.wrapHead;
                // 화살표: 정렬 중이면 지금 방향(진하게), 아니면 누르면 걸릴 방향(흐리게) — 공용 SortArrow와 같은 꼴.
                const dir = current ?? firstSortDir(c.format);
                return (
                  <th
                    key={c.column}
                    scope="col"
                    aria-sort={current === "asc" ? "ascending" : current === "desc" ? "descending" : "none"}
                    className={`bg-bg-soft border-line h-10 overflow-hidden border-b px-2 font-bold ${wrap ? "py-1" : "whitespace-nowrap"} ${ALIGN_TEXT[c.align]}`}
                  >
                    {/* 버튼 이름 = 열 이름 그대로(숨김 글자를 섞으면 칸마다 열 제목이 길게 읽힌다) — 상태는 aria-sort가 말한다. */}
                    <button
                      type="button"
                      onClick={() => toggleSort(c.column, c.format)}
                      className={`${wrap ? HEAD_TWO_LINE : CONTROL_H_SM} hover:bg-muted inline-flex w-full cursor-pointer items-center gap-1 rounded-md px-1 ${ALIGN_FLEX[c.align]} ${current ? "text-primary" : ""}`}
                    >
                      {wrap ? (
                        <span title={c.label} className="line-clamp-2 min-w-0 break-keep [overflow-wrap:anywhere]">
                          {c.label}
                        </span>
                      ) : (
                        <span className="min-w-0 truncate">{c.label}</span>
                      )}
                      <EyIcon name={dir === "desc" ? "arrowDown" : "arrowUp"} size={14} strokeWidth={current ? 2.6 : 1.6} className={`shrink-0 ${current ? "" : "opacity-40"}`} />
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
                  {cols.map((c, ci) => {
                    const numeric = c.format === "number" || c.format === "won" || c.format === "percent";
                    const text = formatCell(row[c.column], c.format);
                    const link = c.link ?? inferredEntityLink(c.column, c.label, downloadTitle, dataset.columns);
                    const href = link && c.format === "text" && typeof row[c.column] === "string" && text.trim() ? entityHref(link, row) : null;
                    // 한 줄 고정 — 넘칠 수 있는 칸만 원문 전체를 마우스 오버 카드로(문서마다 한 장인 레이어 · 글자로만 그린다).
                    const tip = mayOverflow(text, fits[ci]!) ? tipProps({ lines: [text], wide: text.length > 60 }) : {};
                    return (
                      <td
                        key={c.column}
                        {...tip}
                        className={`h-10 overflow-hidden px-3 py-0 align-middle text-ellipsis whitespace-nowrap ${ALIGN_TEXT[c.align]} ${numeric ? "num" : ""}`}
                      >
                        {href ? <Link href={href} prefetch={false} onNavigate={() => window.dispatchEvent(new Event(ASSISTANT_NAVIGATE_EVENT))} className="text-primary rounded-sm font-medium underline decoration-primary/40 underline-offset-4 hover:decoration-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">{oneLine(text)}</Link> : oneLine(text)}
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
                      className={`bg-bg-soft border-line-strong h-10 overflow-hidden border-t px-3 font-bold text-ellipsis whitespace-nowrap ${has ? `num ${ALIGN_TEXT[c.align]}` : i === 0 ? "text-center" : ""}`}
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

"use client";

import type { OtherBook } from "@/features/textbooks/book-plans";
import css from "./plan-card.module.css";

const md = (date: string) => `${Number(date.slice(5, 7))}.${date.slice(8, 10)}`;

/**
 * 교재목록에 차시표가 없는 교재(수요일 개별심화 반의 `수매씽 2-2` 등) — 계획은 세울 수 없어 **최근 보고서만** 적는다.
 * 차시를 지어내지 않는다(교재목록에 차시를 등록하면 그때 로드맵이 선다).
 */
export function OtherBookBody({ book }: { book: OtherBook }) {
  return (
    <>
      <div className={css.row}><h4>{book.name}</h4><span className={css.right}>최근 {book.records.length}회 · 발송된 보고서</span></div>
      <ul className={css.records}>
        {book.records.map((r, i) => (
          <li key={`${r.date}-${i}`}>
            <time>{md(r.date)}</time>
            <span>{(r.progress ?? "—").replace(/^수학\s+/gm, "").split(/\r?\n/).join(" / ")}</span>
            {r.className ? <small>{r.className}</small> : null}
          </li>
        ))}
      </ul>
    </>
  );
}

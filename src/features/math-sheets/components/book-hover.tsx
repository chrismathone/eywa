"use client";

import type { CSSProperties, ReactNode } from "react";
import css from "./plan-card.module.css";

/**
 * 교재 한 권의 차시별 소단원 — 마우스를 올리면(키보드 포커스 포함) 뜬다(원장 2026-10-20 *"전체목표와 3개월에도
 * 마우스 호버 올리면 소단원 별로 차시 바로바로 볼수있게"*). 차시표는 교재목록(`textbook_lessons`)이 단일 소스.
 * `align="end"`면 오른쪽 끝에 맞춘다(카드 오른쪽 밖으로 넘치지 않게).
 */
export function BookHover({ title, period, notes, lessonUnits, lessonCount, at, align = "start", children, className, style, ...data }: {
  title: string;
  period?: string;
  /** 기간 아래 한 줄씩 — 그 권에 걸린 내신기간 등. */
  notes?: string[];
  lessonUnits: string[][];
  lessonCount: number;
  /** 지금 이 권의 몇 차시인가(있으면 그 줄을 강조). */
  at?: number | null;
  align?: "start" | "end";
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** 칸 상태 표식(`data-state`·`data-partial`) — 스타일이 읽는다. */
  "data-state"?: string;
  "data-partial"?: boolean;
}) {
  return (
    <div {...data} className={`${css.hover} ${className ?? ""}`} style={style} tabIndex={0} aria-label={`${title} 차시 보기`}>
      {children}
      <div className={css.pop} data-align={align} role="tooltip">
        <b>{title}</b>
        {period ? <small>{period}</small> : null}
        {notes?.map((n) => <small key={n} data-note>{n}</small>)}
        {lessonUnits.length ? (
          <ol>
            {lessonUnits.map((units, i) => (
              <li key={i} data-now={at === i + 1 || undefined}>
                <span>{i + 1}차시</span>
                {units.join(" · ") || "—"}
              </li>
            ))}
          </ol>
        ) : (
          <em>교재목록에 차시표가 아직 없습니다 — {lessonCount}차시로 가정</em>
        )}
      </div>
    </div>
  );
}

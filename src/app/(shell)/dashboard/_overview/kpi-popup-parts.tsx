"use client";

import type { ReactNode } from "react";
import { WindowLink } from "@/components/workspace/window-link";
import { number } from "./charts";
import s from "./overview.module.css";

/** 팝업 머리 줄 — 카드와 **같은 숫자**를 다시 적는다(카드·팝업·목적지가 같은 수라는 확인). */
export function PopupTotal({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <p className={s.popupTotal}>
      {label} <b>{number(value)}</b>
      {unit}
    </p>
  );
}

export function PopupEmpty({ children }: { children: ReactNode }) {
  return <p className={s.popupEmpty}>{children}</p>;
}

export type CountRow = {
  key: string;
  label: string;
  value: number;
  href?: string | null;
  note?: string;
  color?: string;
};

/** 분류별 인원 — 링크가 있으면 그 목록 창을 연다(팝업은 링크 클릭 때 닫힌다). */
export function CountList({ rows, unit = "명" }: { rows: CountRow[]; unit?: string }) {
  return (
    <div className={s.kpiCounts}>
      {rows.map((row) => {
        const body = (
          <>
            <span style={row.color ? { color: row.color } : undefined}>
              {row.label}
              {row.note ? <small>{row.note}</small> : null}
            </span>
            <b>
              {number(row.value)}
              <small>{unit}</small>
            </b>
          </>
        );
        return row.href ? (
          <WindowLink
            key={row.key}
            href={row.href}
            className={s.kpiCountRow}
            ariaLabel={`${row.label} ${number(row.value)}${unit} 목록 열기`}
          >
            {body}
          </WindowLink>
        ) : (
          <div key={row.key} className={s.kpiCountRow}>
            {body}
          </div>
        );
      })}
    </div>
  );
}

/** 이름 — 열 수 있으면 상세 창 링크, 아니면 글자만. */
export function NameCell({
  href,
  title,
  ariaLabel,
  children,
}: {
  href: string | null;
  title?: string;
  ariaLabel?: string;
  children: ReactNode;
}) {
  if (!href) return <b className={s.kpiName} title={title}>{children}</b>;
  return (
    <WindowLink href={href} title={title} ariaLabel={ariaLabel} className={`${s.kpiName} ${s.studentLink}`}>
      {children}
    </WindowLink>
  );
}

export function Tag({ tone = "info", children }: { tone?: "info" | "caution" | "muted"; children: ReactNode }) {
  const cls = tone === "caution" ? s.kpiTagCaution : tone === "muted" ? s.kpiTagMuted : s.kpiTag;
  return <span className={cls}>{children}</span>;
}

/** "2026-09-11" → "9/11". */
export const monthDay = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

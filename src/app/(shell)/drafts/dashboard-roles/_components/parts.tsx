"use client";

/**
 * 시안 공용 조각 — 소프트 패널·구조화 행·막대·배지. 시안 다섯 벌이 같은 문법을 쓰게 한 곳에 둔다.
 * 글자는 토큰만(text-xs 14 바닥), 두께는 medium/bold 둘, 카드 = `bg-card shadow-card rounded-2xl`,
 * 본문 배지 = 알약, 색 = 뜻(tone)에서. 왼쪽 색 띠·이니셜 배지는 쓰지 않는다.
 */
import type { ReactNode } from "react";
import { Pill } from "@/components/atoms/pill";
import { useSubjectMaps } from "@/features/owner/operations-context";
import { SUBJECT_BORDER } from "@/features/owner/subjects";
import { toneColor, type SemanticTone } from "@/lib/design/semantic-color";

export function Panel({
  title,
  count,
  note,
  children,
  className = "",
}: {
  title: string;
  count?: ReactNode;
  note?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`bg-card shadow-card flex flex-col rounded-2xl ${className}`}>
      <header className="flex items-baseline justify-between gap-2 px-4 pt-3.5 pb-2">
        <div className="flex items-baseline gap-2">
          <h3 className="text-foreground text-sm font-bold">{title}</h3>
          {count != null ? <span className="num text-xs">{count}</span> : null}
        </div>
        {note ? <div className="text-xs">{note}</div> : null}
      </header>
      <div className="flex min-h-0 flex-1 flex-col px-4 pb-4">{children}</div>
    </section>
  );
}

/** 구조화 행 — 이름 bold + 설명 + 오른쪽 값/배지(Editorial 문법 ⑤). */
export function Row({ name, desc, right }: { name: ReactNode; desc?: ReactNode; right?: ReactNode }) {
  return (
    <div className="border-line flex items-center gap-3 border-t py-2 first:border-t-0">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-bold">{name}</div>
        {desc ? <div className="truncate text-xs">{desc}</div> : null}
      </div>
      {right ? <div className="flex shrink-0 items-center gap-1.5">{right}</div> : null}
    </div>
  );
}

export function ToneBadge({ tone, children }: { tone: SemanticTone; children: ReactNode }) {
  return <Pill color={toneColor(tone)}>{children}</Pill>;
}

/** 과목 배지 — 상태(채운 배지)와 형태로 가르려고 테두리 배지. 라벨·색은 학원설정. */
export function SubjectBadge({ subject }: { subject: string }) {
  const maps = useSubjectMaps();
  return (
    <span className={`rounded-pill inline-flex items-center border px-2.5 text-xs font-bold whitespace-nowrap ${SUBJECT_BORDER[maps.colorOf(subject)]}`}>
      {maps.labelOf(subject)}
    </span>
  );
}

/** 가로 막대 목록(가벼운 CSS — 차트 라이브러리 없이). */
export function HBars({
  items,
  barClass = "bg-primary",
  format = (v: number) => String(v),
}: {
  items: { label: string; value: number; barClass?: string }[];
  barClass?: string;
  format?: (v: number) => string;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="flex flex-col gap-2">
      {items.map((it) => (
        <li key={it.label} className="grid grid-cols-[7rem_1fr_auto] items-center gap-2 text-xs">
          <span className="truncate font-medium">{it.label}</span>
          <span className="bg-bg-soft h-2.5 overflow-hidden rounded-full">
            <span className={`block h-full rounded-full ${it.barClass ?? barClass}`} style={{ width: `${(it.value / max) * 100}%` }} />
          </span>
          <span className="num font-bold">{format(it.value)}</span>
        </li>
      ))}
    </ul>
  );
}

/** 세로 막대(월 추이). 값 라벨을 막대 위에 적는다. */
export function Columns({
  labels,
  values,
  barClass = "bg-primary",
  height = "h-28",
}: {
  labels: readonly string[];
  values: readonly number[];
  barClass?: string;
  height?: string;
}) {
  const max = Math.max(1, ...values);
  return (
    <div className="flex items-end gap-2">
      {values.map((v, i) => (
        <div key={labels[i]} className="flex flex-1 flex-col items-center gap-1">
          <span className="num text-xs font-bold">{v.toLocaleString("ko-KR")}</span>
          <div className={`flex w-full items-end ${height}`}>
            <div className={`w-full rounded-t-md ${barClass}`} style={{ height: `${Math.max(4, (v / max) * 100)}%` }} />
          </div>
          <span className="num text-xs">{labels[i]}</span>
        </div>
      ))}
    </div>
  );
}

/** 진행률 막대 + 숫자(작성률·출석률). 기준 미달이면 주의색. */
export function Meter({ value, warnBelow = 85 }: { value: number; warnBelow?: number }) {
  const low = value < warnBelow;
  return (
    <span className="flex items-center gap-2">
      <span className="bg-bg-soft h-2 w-20 overflow-hidden rounded-full">
        <span className={`block h-full rounded-full ${low ? "bg-amber" : "bg-green"}`} style={{ width: `${value}%` }} />
      </span>
      <span className={`num text-xs font-bold ${low ? "text-amber" : ""}`}>{value}%</span>
    </span>
  );
}

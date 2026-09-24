import type { ReactNode } from "react";
import { Pill } from "@/components/atoms/pill";
import { toneColor } from "@/lib/design/semantic-color";
import { planLabel, planTone } from "@/features/super-admin/labels";

/**
 * 슈퍼관리자 화면들이 함께 쓰는 작은 부품 — 화면마다 카드·숫자 포맷·플랜 배지를 손으로 적던 것을 한 벌로.
 * 🔴 화면 로컬 `Kpi`·`Stat`·`KpiCard`를 다시 만들지 말 것 — 지표는 [`BigStat`](../atoms/big-stat.tsx)(가드가 잡는다).
 * ⚠️ 서버 컴포넌트 — 상태가 없다(클라 화면이 import해도 된다).
 */

export const fmtNum = (n: number) => n.toLocaleString("ko-KR");

export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" }) : "—";

export function PlanPill({ plan }: { plan: string }) {
  return <Pill color={toneColor(planTone(plan))}>{planLabel(plan)}</Pill>;
}

/**
 * 헤더 달린 소프트 패널(Editorial ③ + "이질적 다섹션은 헤더 달린 카드") — 제목·보조 설명·오른쪽 동작.
 * `flush`면 본문에 안쪽 여백을 주지 않는다(표·목록이 카드 끝까지 닿게).
 */
export function Panel({
  id,
  title,
  description,
  action,
  flush = false,
  children,
}: {
  id?: string;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  flush?: boolean;
  /** 없으면 머리만 있는 카드(설명 + 동작 버튼) — 아래 구분선도 긋지 않는다. */
  children?: ReactNode;
}) {
  const hasBody = children !== undefined && children !== null;
  return (
    <section id={id} className="bg-card shadow-card scroll-mt-4 overflow-hidden rounded-2xl">
      <header className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-3 ${hasBody ? "border-line border-b" : ""}`}>
        <div className="min-w-0">
          <h3 className="text-foreground text-base font-bold">{title}</h3>
          {description ? <p className="text-foreground mt-0.5 text-sm">{description}</p> : null}
        </div>
        {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
      </header>
      {hasBody ? <div className={flush ? "" : "p-4"}>{children}</div> : null}
    </section>
  );
}

/** 표 머리 칸 공용 — 짧은 값 가운데 · 긴 글 왼쪽 · 금액 오른쪽(제목도 같은 쪽, 데이터 표 규약). */
export const TH = "text-foreground bg-bg-soft px-3 py-2.5 text-sm font-bold whitespace-nowrap";
/** 표 열 구분선 — 표 한 곳에서 옅은 선(`--line-faint`)으로(데이터 표 규약). */
export const TABLE_COL_LINES = "[&_tr>*:not(:first-child)]:border-l [&_tr>*:not(:first-child)]:border-line-faint";

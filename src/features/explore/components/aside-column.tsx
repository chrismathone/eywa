"use client";

import type { ExploreAside, ExploreCenter } from "../model";
import { FlowInsightCard } from "./flow-insight-card";

type Props = {
  center: ExploreCenter;
  aside: ExploreAside | undefined;
};

/**
 * 왼쪽 열(원장 2026-11-03 *"공간이 많이 남으니까 공간 활용"*) — 고정 사실 몇 줄 + (원생) AI 흐름 분석 카드.
 * 넓은 화면(≥2xl)에선 도넛 왼쪽 세로 한 열, 그보다 좁으면 도넛 아래 같은 폭에 두 장 나란히(explore-view의 grid 자리).
 * ⚠️ 지나온 중심 더미는 두지 않는다 — 상단 탐색 경로와 겹쳐 공간만 먹었다(원장 지적 2026-11-03).
 */
export function AsideColumn({ center, aside }: Props) {
  if (!aside) return null;
  return (
    <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-1">
      {aside.facts.length > 0 ? (
        <section className="bg-card shadow-card rounded-2xl p-4" aria-label="기본 정보">
          <h2 className="text-foreground mb-2 text-sm font-bold">기본 정보</h2>
          <dl className="space-y-1.5">
            {aside.facts.map((f) => (
              <div key={f.label} className="flex items-start justify-between gap-3 text-sm">
                <dt className="text-text-dim shrink-0 text-xs">{f.label}</dt>
                <dd className="text-foreground min-w-0 text-right break-keep">{f.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
      {aside.flow ? <FlowInsightCard studentId={center.id} items={aside.flow.items} state={aside.flow.state} canRefresh={aside.flow.canRefresh} /> : null}
    </div>
  );
}

"use client";

import { useMemo, type CSSProperties, type ReactNode } from "react";
import { MENU_ICON } from "@/components/icons/aywa-icons";
import { MenuGlyph } from "@/components/icons/menu-glyph";
import type { KpiKey, PanelId } from "@/features/dashboard/overview/layout";
import type { OverviewSnapshot } from "@/features/dashboard/overview/model";
import { BREAKPOINTS, layoutAt } from "@/features/dashboard/layout/flow";
import { dropEmptyHeadings } from "@/features/dashboard/layout/engine";
import { cardDef, menusOf } from "@/features/dashboard/layout/registry";
import { isEmptyCard, summaryOf } from "@/features/dashboard/layout/summary";
import { isHeadingId, type Item } from "@/features/dashboard/layout/types";
import { KpiCard } from "./kpi-card";
import g from "./grid-board.module.css";

/** 카드가 그려지는가 — 읽는 영역 중 하나라도 스냅샷에 왔는가(`Panel`의 `visible`과 같은 판정). 재원생 추이는 강사 스코프면 숨는다. */
function drawable(id: string, snap: OverviewSnapshot): boolean {
  const def = cardDef(id);
  if (!def) return false;
  if (id === "panel:enrolledTrend") {
    const t = snap.sections.enrolledTrend;
    if (t && t.data === null && t.at !== null) return false;
  }
  return def.areas.some((a) => !!snap.sections[a]);
}

/** 요약형(½×1) — KPI 칸과 같은 모양의 작은 위젯. 누르면 그 카드 전체가 팝업으로 열린다. */
function SummaryTile({ item, snap, full, amounts }: { item: Item; snap: OverviewSnapshot; full: ReactNode; amounts: boolean }) {
  const def = cardDef(item.id)!;
  const sum = summaryOf(item.id, snap, { amounts });
  const title = item.title ?? def.label;
  const failed = def.areas.some((a) => snap.sections[a]?.error);
  return (
    <KpiCard
      label={def.label}
      rename={item.title}
      value={sum?.value ?? "—"}
      unit={sum?.unit ?? ""}
      detail={sum?.detail ?? "정보를 불러오지 못했습니다"}
      error={failed}
      icon={<MenuGlyph name={MENU_ICON[menusOf(def)[0] ?? "dashboard"]} size={20} />}
      popupTitle={title}
      jump={null}
    >
      {full}
    </KpiCard>
  );
}

/**
 * 역할별 배치(학원 설정 '대시보드 관리')의 보기 화면 — 순서 + 크기를 `flow.ts`가 흘린 자리에 카드를 놓는다.
 * 넓은 창·중간·폰 세 가지 자리를 미리 계산해 CSS 변수로 싣고, 컨테이너 폭(`@container dashboard`)이 고른다 — 셋 다 같은 순서다.
 * 🔴 줄의 남는 칸은 그 줄 카드들이 나눠 채운다(빈 공간 금지). 그래서 **실제로 그려질 카드만** 흘린다 — 권한·조회 실패로 빠진 카드 자리가 구멍이 되지 않게.
 */
export function GridBoard({
  items,
  snapshot,
  panels,
  kpis,
}: {
  items: readonly Item[];
  snapshot: OverviewSnapshot;
  panels: Partial<Record<PanelId, ReactNode>>;
  kpis: Partial<Record<KpiKey, ReactNode>>;
}) {
  const shown = useMemo(
    () => dropEmptyHeadings(items.filter((i) => isHeadingId(i.id) || drawable(i.id, snapshot))),
    [items, snapshot],
  );
  const places = useMemo(
    () => Object.fromEntries(BREAKPOINTS.map((bp) => [bp, new Map(layoutAt(shown, bp).map((p) => [p.id, p]))])),
    [shown],
  );
  const amounts = snapshot.view?.monthAmounts ?? true;
  return (
    <div className={g.grid} data-overview="free-grid">
      {shown.map((item) => {
        const d = places.desktop!.get(item.id)!;
        const m = places.medium!.get(item.id)!;
        const s = places.mobile!.get(item.id)!;
        const vars = {
          "--dx": d.x + 1, "--dy": d.y + 1, "--dw": d.w, "--dh": d.h,
          "--mx": m.x + 1, "--my": m.y + 1, "--mw": m.w,
          "--sx": s.x + 1, "--sy": s.y + 1, "--sw": s.w,
        } as CSSProperties;
        if (isHeadingId(item.id)) {
          return (
            <div key={item.id} className={`${g.cell} ${g.heading}`} style={vars} data-cell="heading">
              <span>{item.title}</span>
              {item.note ? <p>{item.note}</p> : null}
            </div>
          );
        }
        const def = cardDef(item.id)!;
        const key = def.key;
        const node = def.kind === "kpi" ? kpis[key as KpiKey] : panels[key as PanelId];
        return (
          <div
            key={item.id}
            className={g.cell}
            style={vars}
            data-cell={def.kind}
            data-wide-cell={d.w >= 12 || undefined}
            data-cell-empty={isEmptyCard(item.id, snapshot) || undefined}
          >
            {item.mode === "summary" && def.kind === "panel" ? (
              <SummaryTile item={item} snap={snapshot} full={node} amounts={amounts} />
            ) : (
              node
            )}
          </div>
        );
      })}
    </div>
  );
}

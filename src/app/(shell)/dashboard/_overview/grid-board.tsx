"use client";

import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { MENU_ICON } from "@/components/icons/aywa-icons";
import { MenuGlyph } from "@/components/icons/menu-glyph";
import type { KpiKey, PanelId } from "@/features/dashboard/overview/layout";
import type { OverviewSnapshot } from "@/features/dashboard/overview/model";
import { BREAKPOINTS, layoutAt } from "@/features/dashboard/layout/flow";
import { dropEmptyHeadings } from "@/features/dashboard/layout/engine";
import { positionItems } from "@/features/dashboard/layout/fixed-grid";
import { fitContentRows } from "@/features/dashboard/layout/grid-rows";
import { cardDef, menusOf } from "@/features/dashboard/layout/registry";
import { isEmptyCard, summaryOf } from "@/features/dashboard/layout/summary";
import { isHeadingId, isSpaceId, isStructuralId, type Item } from "@/features/dashboard/layout/types";
import { KpiCard } from "./kpi-card";
import g from "./grid-board.module.css";

/** 카드가 그려지는가 — 읽는 영역 중 하나라도 스냅샷에 왔는가(`Panel`의 `visible`과 같은 판정). 재원생 추이는 강사 스코프면 숨는다. */
function drawable(id: string, snap: OverviewSnapshot): boolean {
  const def = cardDef(id);
  if (!def) return false;
  // 재원생·강좌수 추이는 강사 스코프면 숨는다(조회는 됐는데 값이 null — overview.tsx 패널과 같은 판정).
  if (id === "panel:enrolledTrend" || id === "panel:courseTrend") {
    const t = id === "panel:enrolledTrend" ? snap.sections.enrolledTrend : snap.sections.courseTrend;
    if (t && t.data === null && t.at !== null) return false;
  }
  return def.areas.some((a) => !!snap.sections[a]);
}

/** 요약형(½×1) — KPI 칸과 같은 모양의 작은 위젯. 누르면 그 카드 전체가 팝업으로 열린다. */
function SummaryTile({ item, snap, full, amounts }: { item: Item; snap: OverviewSnapshot; full: ReactNode; amounts: boolean }) {
  const def = cardDef(item.id)!;
  const sum = summaryOf(item.id, snap, { amounts });
  const title = `${item.title ?? def.label}${snap.view?.academyWide.includes(item.id) ? " (학원 전체)" : ""}`;
  const failed = def.areas.some((a) => snap.sections[a]?.error);
  return (
    <KpiCard
      label={title}
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
 * 데스크톱·중간 폭은 저장한 행·열·크기를 보존한다. 카드가 빠져도 다른 카드를 늘리거나 빈칸을 채우지 않는다.
 * 폰에서는 같은 배치를 읽기 좋은 목록으로 보여 준다. 저장된 좌표는 바꾸지 않는다.
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
  const ref = useRef<HTMLDivElement>(null);
  const [heights, setHeights] = useState<Record<string, number>>({});
  const base = useMemo(
    () => dropEmptyHeadings(positionItems(items).filter((i) => isStructuralId(i.id) || drawable(i.id, snapshot)).sort((a, b) => a.y - b.y || a.x - b.x)),
    [items, snapshot],
  );
  const shown = useMemo(() => fitContentRows(base, heights), [base, heights]);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    let frame = 0;
    const measure = () => {
      const gap = parseFloat(getComputedStyle(root).rowGap) || 16;
      const next: Record<string, number> = {};
      root.querySelectorAll<HTMLElement>("[data-auto-height]").forEach((content) => {
        const panel = content.closest<HTMLElement>('[data-overview="panel"]');
        const cell = content.closest<HTMLElement>('[data-cell]');
        if (!panel || !cell?.dataset.dashboardCard) return;
        const style = getComputedStyle(panel);
        const extra = ["paddingTop", "paddingBottom", "borderTopWidth", "borderBottomWidth"] as const;
        const height = extra.reduce((sum, key) => sum + (parseFloat(style[key]) || 0), 0)
          + [...panel.children].reduce((sum, child) => {
            const style = getComputedStyle(child);
            return sum + child.getBoundingClientRect().height + (parseFloat(style.marginTop) || 0) + (parseFloat(style.marginBottom) || 0);
          }, 0);
        next[cell.dataset.dashboardCard] = Math.ceil((height + gap) / (64 + gap));
      });
      setHeights((prev) => JSON.stringify(prev) === JSON.stringify(next) ? prev : next);
    };
    const observer = new ResizeObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); });
    root.querySelectorAll('[data-auto-height], [data-cell="panel"] [data-overview="panel-header"]').forEach((el) => observer.observe(el));
    observer.observe(root);
    measure();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [base]);
  const places = useMemo(
    () => Object.fromEntries(BREAKPOINTS.map((bp) => [bp, new Map((bp === "mobile" ? layoutAt(shown.filter((i) => !isSpaceId(i.id)), bp) : shown).map((p) => [p.id, p]))])),
    [shown],
  );
  const amounts = snapshot.view?.monthAmounts ?? true;
  return (
    <div ref={ref} className={g.grid} data-overview="free-grid" data-fixed-grid="true">
      {shown.map((item) => {
        const d = places.desktop!.get(item.id)!;
        const m = places.medium!.get(item.id)!;
        const s = places.mobile!.get(item.id) ?? d;
        const vars = {
          "--dx": d.x + 1, "--dy": d.y + 1, "--dw": d.w, "--dh": d.h,
          "--mx": m.x + 1, "--my": m.y + 1, "--mw": m.w,
          "--sx": s.x + 1, "--sy": s.y + 1, "--sw": s.w,
        } as CSSProperties;
        if (isSpaceId(item.id)) return <div key={item.id} className={`${g.cell} ${g.space}`} style={vars} data-cell="space" data-dashboard-card={item.id} aria-label="빈 행" />;
        if (isHeadingId(item.id)) {
          return (
            <div key={item.id} className={`${g.cell} ${g.heading}`} style={vars} data-cell="heading" data-dashboard-card={item.id}>
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
            className={`${g.cell} ${item.id === "panel:teacherWork" ? g.fitCell : ""}`}
            style={vars}
            data-cell={def.kind}
            data-dashboard-card={item.id}
            data-wide-cell={d.w >= 12 || undefined}
            data-narrow-cell={d.w <= 2 || undefined}
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

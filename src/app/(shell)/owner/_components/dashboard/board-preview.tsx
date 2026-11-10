"use client";

import { useMemo } from "react";
import type { MenuKey } from "@/lib/permissions";
import { boardOf } from "@/features/dashboard/layout/board";
import { cardDef } from "@/features/dashboard/layout/registry";
import { DASHBOARD_VERSION, type Bundle, type Item } from "@/features/dashboard/layout/types";
import { resolveView } from "@/features/dashboard/layout/view";
import b from "./board-editor.module.css";

const CORE_LABEL = { newcomers: "신입생 90일", management: "경영 분석", workRecords: "업무 작성센터" } as const;
const name = (id: string, items: readonly Item[]) => items.find((i) => i.id === id)?.title ?? cardDef(id)?.label ?? id;

/**
 * 이 역할이 실제로 보는 모양 — 서버와 **같은 판정**(`resolveView` — 메뉴 권한 상한 · 열 수 없는 핵심 업무 칸 제외)으로 거른 뒤
 * 새 대시보드의 자리 그대로 이름만 그린다(값은 그리지 않는다 — 원장 시점 원본을 다른 역할 모양으로 비춰 보이는 오해를 피한다).
 */
export function BoardPreview({ items, role, menus, subjectLabel }: { items: readonly Item[]; role: Bundle; menus: ReadonlySet<MenuKey>; subjectLabel?: string }) {
  const view = useMemo(() => resolveView({
    stored: { version: DASHBOARD_VERSION, layouts: [{ role, items: [...items] }] }, bundle: role, menus, subjectLabels: subjectLabel ? [subjectLabel] : [],
  }), [items, role, menus, subjectLabel]);
  const seen = view.items ?? [];
  const board = boardOf(seen);
  const kpi = (k: string) => name(`kpi:${k}`, seen);
  const panel = (p: string) => <li key={p}>{name(`panel:${p}`, seen)}</li>;
  return (
    <aside className={b.preview} aria-label="이 역할이 보는 대시보드">
      <h3>이 역할이 보는 화면</h3>
      {board.core.length ? <div className={b.pCore}>{board.core.map((k) => <span key={k}>{CORE_LABEL[k]}</span>)}</div> : null}
      <h4>한눈에 보기</h4>
      <div className={b.pSummary}>
        <span className={b.pBrief}>오늘의 브리핑</span>
        <div className={b.pKpis}>{board.glance.map((k) => <span key={k}>{kpi(k)}</span>)}</div>
      </div>
      {board.trend.length ? <><h5>추이 · 비교</h5><ul className={b.pCards}>{board.trend.map(panel)}</ul></> : null}
      {board.mix.length ? <><h5>비중 · 구성</h5><ul className={b.pCards}>{board.mix.map(panel)}</ul></> : null}
      <h4>오늘 운영</h4>
      {board.kpis.length ? <div className={b.pKpis} data-strip>{board.kpis.map((k) => <span key={k}>{kpi(k)}</span>)}</div> : null}
      <p className={b.pNote}>확인할 일 · 업무 요청</p>
      {board.today.filter((s) => s.panels.length).map((s) => (
        <div key={s.id}><h5>{s.title || "이름 없는 구역"}</h5><ul className={b.pCards}>{s.panels.map(panel)}</ul></div>
      ))}
      <p className={b.pNote}>경영 현황 = 위 KPI · 추이 · 구성 · 오늘 운영 구역을 한 화면에.{seen.some((i) => i.id === "panel:billingMonth") && !view.monthAmounts ? " 수납 금액은 가려집니다(건수만)." : ""}{seen.some((i) => cardDef(i.id)?.options.includes("phones")) && !view.phones ? " 일정 전화번호는 가려집니다." : ""}</p>
    </aside>
  );
}

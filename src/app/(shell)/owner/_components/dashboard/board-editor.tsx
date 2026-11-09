"use client";

import type { ReactNode } from "react";
import type { MenuKey } from "@/lib/permissions";
import { GLANCE_MAX } from "@/features/dashboard/layout/board";
import { addSection, moveKpi, moveSection, removeSection, renameSection, setKpi, toggleCore, type EditBoard } from "@/features/dashboard/layout/board-edit";
import { BOARD_KPIS, cardDef, missingMenuLabel } from "@/features/dashboard/layout/registry";
import { CORE_KEYS, type Bundle, type CoreKey } from "@/features/dashboard/layout/types";
import { canOpenCore } from "@/features/dashboard/layout/view";
import { CardList, RowButtons } from "./board-cards";
import b from "./board-editor.module.css";

const CORE_LABEL: Record<CoreKey, string> = { newcomers: "신입생 90일 집중관리", management: "경영 분석", workRecords: "업무 작성센터" };

type Props = { board: EditBoard; role: Bundle; menus: ReadonlySet<MenuKey>; readOnly: boolean; onChange: (next: EditBoard) => void };

function Block({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return (
    <section className={b.block}>
      <header><h3>{title}</h3><p>{note}</p></header>
      {children}
    </section>
  );
}

/** KPI 표 — 칸마다 '한눈에 보기'(6칸까지) · '오늘 운영'(오늘 운영·경영 현황 띠) 두 곳을 켜고 끈다. 켠 칸만 순서를 바꾼다. */
function KpiTable({ board, menus, readOnly, onChange }: Props) {
  const placed = board.kpis.map((i) => i.id);
  const rest = BOARD_KPIS.map((k) => `kpi:${k}`).filter((id) => !placed.includes(id));
  const glanceCount = board.kpis.filter((i) => i.glance).length;
  return (
    <table className={b.kpis}>
      <thead><tr><th>칸</th><th>한눈에 보기 <small>{glanceCount}/{GLANCE_MAX}</small></th><th>오늘 운영 · 경영 현황</th><th className="sr-only">순서</th></tr></thead>
      <tbody>
        {[...placed, ...rest].map((id) => {
          const def = cardDef(id);
          if (!def) return null;
          const item = board.kpis.find((i) => i.id === id);
          const at = placed.indexOf(id);
          const key = def.key as (typeof BOARD_KPIS)[number];
          const hidden = missingMenuLabel(def, menus);
          return (
            <tr key={id} data-muted={!item || hidden ? "" : undefined}>
              <td>{def.label}{hidden ? <span className={b.tag} data-tip={`${hidden} 권한이 없어 이 역할에는 보이지 않습니다`}>권한 없음</span> : null}</td>
              <td><input type="checkbox" aria-label={`${def.label} 한눈에 보기`} disabled={readOnly || (!item?.glance && glanceCount >= GLANCE_MAX)}
                checked={!!item?.glance} onChange={(e) => onChange(setKpi(board, key, { glance: e.target.checked }))} /></td>
              <td><input type="checkbox" aria-label={`${def.label} 오늘 운영`} disabled={readOnly}
                checked={!!item && item.today !== false} onChange={(e) => onChange(setKpi(board, key, { today: e.target.checked }))} /></td>
              <td>{item ? <RowButtons label={def.label} readOnly={readOnly}
                onUp={at > 0 ? () => onChange(moveKpi(board, id, -1)) : undefined}
                onDown={at < placed.length - 1 ? () => onChange(moveKpi(board, id, 1)) : undefined} /> : null}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/**
 * 새 대시보드 배치 편집 — 화면의 자리 그대로 칸을 나눈다(원장 2026-11-09 *"보기별 칸 목록"*):
 * 핵심 업무 → 한눈에 보기(KPI 6칸 · 추이·비교 · 비중·구성) → 오늘 운영 구역. 경영 현황은 이 모두를 한 화면에 모아 보여 준다.
 */
export function BoardEditor(p: Props) {
  const { board, role, menus, readOnly, onChange } = p;
  return (
    <div className={b.editor}>
      <Block title="핵심 업무" note="맨 위 바로가기 칸 · 이 역할이 열 수 없는 화면은 켜도 서지 않습니다">
        <div className={b.core}>
          {CORE_KEYS.map((k) => {
            const blocked = !canOpenCore(`core:${k}`, role, menus);
            return (
              <label key={k} data-muted={blocked ? "" : undefined}>
                <input type="checkbox" disabled={readOnly} checked={board.core.includes(k)} onChange={(e) => onChange(toggleCore(board, k, e.target.checked))} />
                {CORE_LABEL[k]}{blocked ? <span className={b.tag}>이 역할은 열 수 없음</span> : null}
              </label>
            );
          })}
        </div>
      </Block>
      <Block title="KPI 칸" note={`한눈에 보기 머리 칸은 ${GLANCE_MAX}칸까지 · 오늘 운영과 경영 현황은 켠 칸 전부`}>
        <KpiTable {...p} />
      </Block>
      <Block title="한눈에 보기 · 추이 · 비교" note="과목 탭과 비교가 있는 카드">
        <CardList {...p} items={board.trend} spot="trend" />
      </Block>
      <Block title="한눈에 보기 · 비중 · 구성" note="지금 구성과 비율 카드">
        <CardList {...p} items={board.mix} spot="mix" />
      </Block>
      <Block title="오늘 운영" note="확인할 일 · 업무 요청 아래에 서는 구역 · 구역 이름과 순서를 정합니다">
        <div className={b.sections}>
          {board.today.map((s, at) => (
            <div key={s.head.id} className={b.section}>
              <div className={b.sectionHead}>
                <input aria-label="구역 이름" maxLength={40} disabled={readOnly} value={s.head.title ?? ""}
                  onChange={(e) => onChange(renameSection(board, s.head.id, { title: e.target.value }))} />
                <input aria-label="구역 설명" maxLength={80} disabled={readOnly} value={s.head.note ?? ""} placeholder="한 줄 설명(선택)"
                  onChange={(e) => onChange(renameSection(board, s.head.id, { note: e.target.value }))} />
                <RowButtons label={`${s.head.title ?? "구역"} 구역`} readOnly={readOnly}
                  onUp={at > 0 ? () => onChange(moveSection(board, s.head.id, -1)) : undefined}
                  onDown={at < board.today.length - 1 ? () => onChange(moveSection(board, s.head.id, 1)) : undefined}
                  onRemove={() => onChange(removeSection(board, s.head.id))} />
              </div>
              <CardList {...p} items={s.panels} spot={s.head.id} />
            </div>
          ))}
          {readOnly ? null : <button type="button" className={b.addSection} onClick={() => onChange(addSection(board).board)}>+ 구역 추가</button>}
        </div>
      </Block>
    </div>
  );
}

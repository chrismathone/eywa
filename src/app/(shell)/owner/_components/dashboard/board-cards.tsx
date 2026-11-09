"use client";

import { EyIcon } from "@/components/icons/aywa-icons";
import type { MenuKey } from "@/lib/permissions";
import type { PanelId } from "@/features/dashboard/overview/layout";
import { movePanel, patchPanel, placePanel, removePanel, type EditBoard, type Spot } from "@/features/dashboard/layout/board-edit";
import { CARDS, cardDef, missingMenuLabel } from "@/features/dashboard/layout/registry";
import type { Bundle, Item } from "@/features/dashboard/layout/types";
import { optionOn, sensitiveReason } from "./badges";
import b from "./board-editor.module.css";

type Common = { board: EditBoard; role: Bundle; menus: ReadonlySet<MenuKey>; readOnly: boolean; onChange: (next: EditBoard) => void };

/** 한 줄 단추 — 위·아래·빼기. */
export function RowButtons({ label, onUp, onDown, onRemove, readOnly }: { label: string; onUp?: () => void; onDown?: () => void; onRemove?: () => void; readOnly: boolean }) {
  if (readOnly) return null;
  return (
    <span className={b.rowButtons}>
      <button type="button" aria-label={`${label} 위로`} disabled={!onUp} onClick={onUp}><EyIcon name="arrowUp" size={14} aria-hidden /></button>
      <button type="button" aria-label={`${label} 아래로`} disabled={!onDown} onClick={onDown}><EyIcon name="arrowDown" size={14} aria-hidden /></button>
      {onRemove ? <button type="button" aria-label={`${label} 빼기`} onClick={onRemove}><EyIcon name="close" size={14} aria-hidden /></button> : null}
    </span>
  );
}

/** 카드 한 줄 — 이름 · 권한/민감 꼬리표 · 민감 옵션 · 순서 단추. */
function CardRow({ item, at, count, spot, ...p }: Common & { item: Item; at: number; count: number; spot: Spot }) {
  const def = cardDef(item.id);
  if (!def) return null;
  const hidden = missingMenuLabel(def, p.menus);
  const sensitive = sensitiveReason(item.id, p.role);
  const option = def.options[0];
  return (
    <li className={b.row} data-muted={hidden ? "" : undefined}>
      <span className={b.name}>{item.title ?? def.label}</span>
      {hidden ? <span className={b.tag} data-tip={`${hidden} 권한이 없어 이 역할에는 보이지 않습니다`}>권한 없음 · {hidden}</span> : null}
      {sensitive ? <span className={b.tag} data-tone="warn" data-tip={sensitive}>민감</span> : null}
      {option ? (
        <label className={b.option}>
          <input type="checkbox" disabled={p.readOnly} checked={optionOn(item, option, p.role)}
            onChange={(e) => p.onChange(patchPanel(p.board, item.id, { [option]: e.target.checked }))} />
          {option === "amounts" ? "금액 보이기" : "전화번호 그대로"}
        </label>
      ) : null}
      <RowButtons label={def.label} readOnly={p.readOnly}
        onUp={at > 0 ? () => p.onChange(movePanel(p.board, spot, item.id, -1)) : undefined}
        onDown={at < count - 1 ? () => p.onChange(movePanel(p.board, spot, item.id, 1)) : undefined}
        onRemove={() => p.onChange(removePanel(p.board, item.id))} />
    </li>
  );
}

/** 카드 목록 한 자리(추이·구성·오늘 운영 구역) + '카드 넣기'. 다른 자리에 있는 카드를 고르면 이리로 옮긴다. */
export function CardList({ items, spot, ...p }: Common & { items: readonly Item[]; spot: Spot }) {
  const here = new Set(items.map((i) => i.id));
  const where = new Map<string, string>([
    ...p.board.trend.map((i) => [i.id, "추이 · 비교"] as const),
    ...p.board.mix.map((i) => [i.id, "비중 · 구성"] as const),
    ...p.board.today.flatMap((s) => s.panels.map((i) => [i.id, s.head.title ?? "구역"] as const)),
  ]);
  const choices = CARDS.filter((c) => c.kind === "panel" && !here.has(c.id));
  return (
    <div className={b.cards}>
      {items.length ? (
        <ol className={b.list}>{items.map((item, at) => <CardRow key={item.id} {...p} item={item} at={at} count={items.length} spot={spot} />)}</ol>
      ) : <p className={b.empty}>넣은 카드가 없습니다 · 이 칸은 화면에 서지 않습니다.</p>}
      {p.readOnly ? null : (
        <select className={b.add} value="" aria-label="카드 넣기" onChange={(e) => e.target.value && p.onChange(placePanel(p.board, e.target.value as PanelId, spot))}>
          <option value="">+ 카드 넣기</option>
          {choices.map((c) => <option key={c.id} value={c.key}>{c.label}{where.has(c.id) ? ` (지금 ${where.get(c.id)} → 옮김)` : ""}</option>)}
        </select>
      )}
    </div>
  );
}

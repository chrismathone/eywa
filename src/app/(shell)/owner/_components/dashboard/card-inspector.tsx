"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { MenuKey } from "@/lib/permissions";
import { patchItem, placedIds, removeItem, resizeItem } from "@/features/dashboard/layout/engine";
import { cardDef, missingMenuLabel, type SizePreset } from "@/features/dashboard/layout/registry";
import { GRID_COLS, MAX_GRID_Y, MAX_ROW_SPAN, isHeadingId, isSpaceId, isStructuralId, type Bundle, type Item } from "@/features/dashboard/layout/types";
import { gridHeight, placeItem } from "@/features/dashboard/layout/fixed-grid";
import { exposureOf, optionOn, scopeLine, sensitiveReason } from "./badges";
import e from "./editor.module.css";

/** 크기 단추의 작은 모양 — 24열 격자에서의 비율 그대로. */
function SizeShape({ z }: { z: SizePreset }) {
  return <span className={e.sizeShape} style={{ width: 6 + z.w * 1.4, height: 8 + (z.h - 1) * 9 }} aria-hidden />;
}

function GridNumber({ label, value, max, onCommit }: { label: string; value: number; max: number; onCommit: (n: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  const [seen, setSeen] = useState(value);
  if (seen !== value) { setSeen(value); setDraft(String(value)); }
  const save = () => {
    const n = Number(draft);
    if (!draft.trim() || !Number.isFinite(n)) { setDraft(String(value)); return; }
    const next = Math.max(1, Math.min(max, Math.round(n)));
    setDraft(String(next));
    if (next !== value) onCommit(next);
  };
  return <label>{label}<Input type="number" min={1} max={max} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={save} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); save(); } }} /></label>;
}

/** 제목 입력 — 치는 동안은 이 칸만, Enter·포커스 이탈에 한 번 저장 이력(글자마다 되돌리기 칸이 쌓이지 않게). */
function TextField({ label, value, placeholder, max, onCommit }: { label: string; value: string; placeholder: string; max: number; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setDraft(value);
  }
  return (
    <label>
      {label}
      <Input
        value={draft}
        maxLength={max}
        placeholder={placeholder}
        onChange={(ev) => setDraft(ev.target.value)}
        onBlur={() => draft !== value && onCommit(draft)}
        onKeyDown={(ev) => {
          if (ev.key === "Enter") {
            ev.preventDefault();
            if (draft !== value) onCommit(draft);
          }
        }}
      />
    </label>
  );
}

/**
 * 고른 카드의 설정 — 제목 · 크기(프리셋) · 공개 옵션(금액·전화번호) · 이 역할에서 어떻게 보이는지(권한·과목 범위·민감) · 빼기.
 * 폰엔 hover가 없어서 꼬리표의 이유는 여기에 **글자로** 적는다.
 */
export function CardInspector({
  item,
  items,
  role,
  menus,
  onCommit,
  onRemoved,
  onClose,
}: {
  item: Item;
  items: Item[];
  role: Bundle;
  menus: ReadonlySet<MenuKey>;
  onCommit: (next: Item[]) => void;
  onRemoved: (id: string, before: Item[]) => void;
  onClose: () => void;
}) {
  const heading = isHeadingId(item.id);
  const def = cardDef(item.id);
  const missing = def ? missingMenuLabel(def, menus) : null;
  const sensitive = sensitiveReason(item.id, role);
  const scope = scopeLine(item.id, role);
  const sizes = def?.sizes.map((z) => ({ ...z, h: gridHeight({ id: item.id, ...z }) })) ?? [];
  const current = sizes.find((z) => z.w === item.w && z.h === item.h && z.mode === item.mode);
  const lastCard = !isStructuralId(item.id) && placedIds(items).length <= 1;
  const exposure = exposureOf(items, role, menus);
  const remove = () => {
    const before = [...items];
    onCommit(removeItem(items, item.id));
    onRemoved(item.id, before);
  };
  return (
    <aside className={e.inspector} aria-label="고른 카드 설정">
      <div className="flex items-start justify-between gap-2">
        <h3>{heading ? "구역 제목" : isSpaceId(item.id) ? "빈 행" : def?.label}</h3>
        <Button variant="ghost" size="sm" onClick={onClose}>
          닫기
        </Button>
      </div>
      <TextField
        label={heading ? "제목" : "카드 제목"}
        value={item.title ?? ""}
        placeholder={heading ? "구역 이름" : (def?.label ?? "")}
        max={40}
        onCommit={(v) => onCommit(patchItem(items, item.id, { title: v }))}
      />
      {heading ? (
        <TextField label="설명(선택)" value={item.note ?? ""} placeholder="예: 오늘 할 일" max={80} onCommit={(v) => onCommit(patchItem(items, item.id, { note: v }))} />
      ) : null}
      <div className="grid grid-cols-2 gap-2" aria-label="행·열 위치와 크기">
        {([
          ["x", "시작 열", (item.x ?? 0) + 1, GRID_COLS - item.w + 1],
          ["y", "시작 행", (item.y ?? 0) + 1, MAX_GRID_Y - item.h + 1],
          ["w", "너비 (열)", item.w, GRID_COLS - (item.x ?? 0)],
          ["h", "높이 (행)", item.h, MAX_ROW_SPAN],
        ] as const).map(([key, label, value, max]) => (
          <GridNumber key={key} label={label} value={value} max={max} onCommit={(v) => {
            if (key === "x" || key === "y") onCommit(placeItem(items, item, key === "x" ? v - 1 : item.x ?? 0, key === "y" ? v - 1 : item.y ?? 0));
            else onCommit(resizeItem(items, item.id, { w: item.w, h: item.h, mode: item.mode, [key]: v }));
          }} />
        ))}
      </div>
      <p className="text-xs">위치는 24열 격자에 저장됩니다. 확장한 카드와 겹치는 카드만 아래로 이동합니다.</p>
      {def && def.sizes.length > 1 ? (
        <div>
          <p className="mb-1 font-semibold">크기</p>
          <div className={e.sizes} role="group" aria-label="크기">
            {sizes.map((z) => (
              <button key={z.key} type="button" className={e.sizeBtn} aria-pressed={current?.key === z.key} title={z.hint} onClick={() => onCommit(resizeItem(items, item.id, z))}>
                <SizeShape z={{ ...z, h: Math.ceil(z.h / 4) }} />
                {z.label}
              </button>
            ))}
          </div>
          <p className="mt-1">{current ? `${current.hint}${current.mode === "summary" ? " — 누르면 카드 전체가 열립니다" : ""}` : ""}</p>
        </div>
      ) : null}
      {def?.options.includes("amounts") ? (
        <label className="flex-row! items-start gap-2!">
          <input type="checkbox" className="accent-primary mt-1 size-4" checked={optionOn(item, "amounts", role)} onChange={(ev) => onCommit(patchItem(items, item.id, { amounts: ev.target.checked }))} />
          <span>
            금액(미수 잔액) 보이기
            <br />
            <small>
              {exposure.billing6
                ? "6개월 청구·수납 카드가 함께 있어 이번 달 청구·수납 금액은 그 카드로 보입니다. 끄면 이 카드는 건수만 보입니다."
                : "끄면 완납·미납 건수만 보입니다(금액은 서버가 비워서 보냅니다)."}
            </small>
          </span>
        </label>
      ) : null}
      {def?.options.includes("phones") ? (
        <label className="flex-row! items-start gap-2!">
          <input type="checkbox" className="accent-primary mt-1 size-4" checked={optionOn(item, "phones", role)} onChange={(ev) => onCommit(patchItem(items, item.id, { phones: ev.target.checked }))} />
          <span>
            일정 제목의 전화번호 그대로 보이기
            <br />
            <small>
              {optionOn(item, "phones", role) && !exposure.phones && !missing
                ? "다른 일정 카드가 가리고 있어 아직 가려집니다 — 일정 카드를 모두 켜야 그대로 보입니다."
                : "끄면 뒤 네 자리만 남기고 가립니다(010-****-5678)."}
            </small>
          </span>
        </label>
      ) : null}
      {missing ? (
        <p className={e.note} data-tone="danger">
          이 역할은 {missing} 권한이 없어 이 카드가 보이지 않습니다. (개인 예외로 그 메뉴를 연 직원에게는 보입니다.)
        </p>
      ) : null}
      {sensitive ? (
        <p className={e.note} data-tone="warn">
          민감 — {sensitive}. 원장 외 역할에는 기본으로 빠져 있는 카드입니다.
        </p>
      ) : null}
      {scope ? <p className={e.note}>{scope}</p> : null}
      <Button variant="outline" onClick={remove} disabled={lastCard}>
        {lastCard ? "마지막 카드는 뺄 수 없습니다" : heading ? "구역 제목 빼기" : "이 카드 빼기"}
      </Button>
    </aside>
  );
}

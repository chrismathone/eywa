"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { EyIcon } from "@/components/icons/aywa-icons";
import type { MenuKey } from "@/lib/permissions";
import type { OverviewSnapshot } from "@/features/dashboard/overview/model";
import { CARD_GROUPS, CARDS, defaultPreset, type CardDef, type SizePreset } from "@/features/dashboard/layout/registry";
import { summaryOf } from "@/features/dashboard/layout/summary";
import type { Bundle, Item } from "@/features/dashboard/layout/types";
import { badgesFor, exposureOf, type Exposure } from "./badges";
import { WidgetFace } from "./widget-face";
import g from "./gallery.module.css";

/** 미리보기 실제 크기 — 캔버스 한 열 폭(넓은 화면 근사)과 칸 안쪽 폭. */
const PREVIEW_COL = 46;
const STAGE_W = 200;

function GalleryCard({
  def,
  placed,
  role,
  menus,
  snapshot,
  exposure,
  items,
  onAdd,
}: {
  def: CardDef;
  placed: boolean;
  role: Bundle;
  menus: ReadonlySet<MenuKey>;
  snapshot: OverviewSnapshot | null;
  exposure: Exposure;
  /** 지금 배치 — 아직 안 넣은 카드의 꼬리표는 '넣었을 때'로 판정한다(넣으면 옵션 기본 = 가림). */
  items: readonly Item[];
  onAdd: (id: string, z: SizePreset) => void;
}) {
  const [at, setAt] = useState(() => def.sizes.findIndex((z) => z.key === defaultPreset(def).key));
  const z = def.sizes[at] ?? def.sizes[0]!;
  const item: Item = { id: def.id, w: z.w, h: z.h, ...(z.mode ? { mode: z.mode } : {}) };
  const step = (d: number) => setAt((i) => (i + d + def.sizes.length) % def.sizes.length);
  return (
    <li className={g.card} data-placed={placed || undefined}>
      {/* 실제 모양 — 편집 캔버스와 같은 실제 크기(1열 46px · 1줄 104px)로 그린 뒤 칸에 맞게 줄인다(zoom). 값은 실데이터 미리보기 원본에서.
          🔴 이 창 안에선 끌지 않으니 zoom 조상이 있어도 된다(끄는 화면이면 좌표가 틀어진다 — [[#98]]). */}
      <div className={g.stage}>
        <div className={g.preview} style={{ width: z.w * PREVIEW_COL - 12, height: z.h * 116 - 12, zoom: Math.min(1, STAGE_W / (z.w * PREVIEW_COL - 12)) }}>
          <WidgetFace def={def} item={item} summary={snapshot ? summaryOf(def.id, snapshot) : null} badges={badgesFor(item, role, menus, placed ? exposure : exposureOf([...items, item], role, menus))} />
        </div>
      </div>
      <div className={g.sizeRow}>
        <button type="button" className={g.arrow} onClick={() => step(-1)} aria-label={`${def.label} 작은 크기 보기`} disabled={def.sizes.length < 2}>
          <EyIcon name="chevronLeft" size={16} aria-hidden />
        </button>
        <span>
          {z.label} · {z.hint}
        </span>
        <button type="button" className={g.arrow} onClick={() => step(1)} aria-label={`${def.label} 큰 크기 보기`} disabled={def.sizes.length < 2}>
          <EyIcon name="chevronRight" size={16} aria-hidden />
        </button>
      </div>
      <div className={g.foot}>
        <b>{def.label}</b>
        <Button size="sm" variant={placed ? "outline" : "default"} disabled={placed} onClick={() => onAdd(def.id, z)}>
          {placed ? "추가됨" : "+ 추가"}
        </Button>
      </div>
    </li>
  );
}

/**
 * 위젯 갤러리 — 묶음별로 모든 카드의 **실제 모양 미니 미리보기**(고른 크기 비율 · 실데이터 값)와 크기 좌우 보기, '+ 추가'.
 * 이미 넣은 카드는 '추가됨'. 넣으면 맨 뒤에 붙는다(끌어서 옮긴다). 닫지 않고 여러 장 넣을 수 있다.
 * 🔴 이 창(Dialog) 안에서는 끌지 않는다 — 가운데 정렬 transform 아래에선 끄는 카드 좌표가 틀어진다([[#98]]).
 */
export function WidgetGallery({
  open,
  onOpenChange,
  items,
  role,
  menus,
  snapshot,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: readonly Item[];
  role: Bundle;
  menus: ReadonlySet<MenuKey>;
  snapshot: OverviewSnapshot | null;
  onAdd: (id: string, z: SizePreset) => void;
}) {
  const placed = new Set(items.map((i) => i.id));
  const exposure = exposureOf(items, role, menus);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`${g.dialog} sm:max-w-5xl`}>
        <DialogTitle>위젯 추가</DialogTitle>
        <DialogDescription>크기를 좌우로 넘겨 보고 ‘+ 추가’를 누르세요. 넣은 카드는 맨 뒤에 붙고, 끌어서 옮길 수 있습니다.</DialogDescription>
        <div className={g.scroll}>
          {CARD_GROUPS.map((group) => (
            <section key={group} className={g.group} aria-label={group}>
              <h4>{group === "KPI" ? "숫자 칸(KPI)" : group}</h4>
              <ul className={g.list}>
                {CARDS.filter((c) => c.group === group).map((def) => (
                  <GalleryCard key={def.id} def={def} placed={placed.has(def.id)} role={role} menus={menus} snapshot={snapshot} exposure={exposure} items={items} onAdd={onAdd} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

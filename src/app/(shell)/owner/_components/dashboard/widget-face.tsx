import { memo } from "react";
import { presetOf, type CardDef } from "@/features/dashboard/layout/registry";
import type { Summary } from "@/features/dashboard/layout/summary";
import type { Item } from "@/features/dashboard/layout/types";
import { WidgetThumb } from "./widget-thumb";
import e from "./editor.module.css";

/** 얼굴의 짧은 꼬리표 — 자세한 이유는 선택하면 오른쪽 설정 칸이 글자로 적는다(폰에 hover가 없다). */
export type FaceBadge = { tone: "danger" | "warn" | "info"; text: string };

/**
 * 편집 중 카드의 **가벼운 얼굴** — 제목 · 지금 값(실데이터 미리보기 원본에서) · 그림 · 크기 · 꼬리표.
 * 🔑 끄는 동안 다시 그리지 않게 `memo` — 자리는 바깥 칸(transform)이 옮긴다(60fps).
 */
export const WidgetFace = memo(function WidgetFace({
  def,
  item,
  summary,
  badges,
}: {
  def: CardDef;
  item: Pick<Item, "w" | "h" | "mode" | "title">;
  summary: Summary | null | undefined;
  badges: readonly FaceBadge[];
}) {
  const small = item.w <= 3;
  const size = presetOf(def, item)?.label ?? `${item.w / 6}×${item.h}`;
  const valueFirst = def.kind === "kpi" || item.mode === "summary";
  return (
    <div className={e.face} data-small={small || undefined} data-dim={badges.some((b) => b.tone === "danger") || undefined}>
      <div className={e.faceHead}>
        <span className={e.faceTitle}>{item.title ?? def.label}</span>
        <span className={e.faceSize}>{size}</span>
      </div>
      <div className={e.faceBody}>
        {summary && (valueFirst || !small) ? (
          <span className={e.faceValue} data-danger={summary.danger || undefined}>
            {summary.value}
            {summary.unit ? <small>{summary.unit}</small> : null}
          </span>
        ) : null}
        {!valueFirst || !summary ? <WidgetThumb kind={def.thumb} className={e.faceThumb} /> : null}
      </div>
      {badges.length > 0 ? (
        <div className={e.faceBadges}>
          {badges.slice(0, small ? 1 : 3).map((b) => (
            <span key={b.text} className={e.badge} data-tone={b.tone}>
              {b.text}
            </span>
          ))}
        </div>
      ) : summary?.detail && !small ? (
        <p className={e.faceDetail}>{summary.detail}</p>
      ) : null}
    </div>
  );
});

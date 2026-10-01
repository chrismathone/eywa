"use client";

/**
 * 시안 머리 — 이 시안이 먼저 보여 주는 것과 **일부러 뺀 것**(묶음 한 줄은 서버 `bundle-summary.tsx`).
 * 노출 통제가 목적이라 뺀 항목을 시안마다 글자로 적는다(실제 화면엔 빠진 자리조차 없다 — "있었는지조차 모르게").
 */
import { EyIcon } from "@/components/icons/aywa-icons";
import type { DraftMeta } from "../_data/bundles";

export function DraftHead({ index, meta }: { index: number; meta: DraftMeta }) {
  return (
    <div className="flex flex-col gap-2 px-1">
      <h3 className="text-lg font-bold">
        시안 {index + 1} · {meta.title}
      </h3>
      <p className="text-sm">
        <span className="font-bold">먼저 보여 주는 것</span> — {meta.lead}
      </p>
      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        <span className="inline-flex items-center gap-1 font-bold">
          <EyIcon name="eyeOff" size={16} />
          일부러 뺀 것
        </span>
        {meta.hidden.map((h) => (
          <span key={h} className="bg-bg-soft rounded-pill px-2.5 py-0.5 text-xs font-medium">
            {h}
          </span>
        ))}
      </div>
      {meta.decide ? (
        <p className="bg-amber-soft text-amber inline-flex w-fit items-center gap-1.5 rounded-lg px-2.5 py-1 text-sm font-bold">
          <EyIcon name="alertCircle" size={16} />
          원장 결정 필요 — {meta.decide}
        </p>
      ) : null}
    </div>
  );
}

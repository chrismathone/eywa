import { Pill } from "@/components/atoms/pill";
import { TONE_ACCENT_BAR } from "@/lib/design/semantic-color";
import { assetCategoryLabel } from "@/features/inventory/category";
import { assetStatusLabel } from "@/features/inventory/status";
import type { InventoryAsset } from "@/features/inventory/types";
import { dashIfEmpty } from "@/features/inventory/unknown-value";

/**
 * "지금 조치가 필요한 자산 N건" — `needsAction`으로 거른 목록(page.tsx가 스탯과 **같은 함수**로 만든다).
 * 🔴 N = 이 배열의 길이(상한 없음 — [[#89]]). 카드 = `자산ID / 모델(없으면 분류) / 상태 · 현위치`(시안 그대로).
 */
export function ActionNeeded({ assets }: { assets: InventoryAsset[] }) {
  return (
    <section className={`bg-card shadow-card rounded-2xl border-l-[3px] p-4 ${TONE_ACCENT_BAR.critical}`}>
      <div className="flex items-baseline gap-2">
        <h3 className="text-foreground text-[13.5px] font-bold">지금 조치가 필요한 자산</h3>
        <Pill color="danger">{assets.length}건</Pill>
      </div>
      <ul className="mt-2 grid gap-x-4 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {assets.map((a) => (
          <li key={a.id} className="flex min-w-0 items-baseline gap-2 text-[12.5px]">
            <span className="border-line bg-bg-soft text-foreground shrink-0 rounded-md border px-1.5 py-0.5 font-mono text-[11px]">
              {a.assetCode}
            </span>
            <span className="text-foreground min-w-0 truncate font-medium">{a.model ?? assetCategoryLabel(a.category)}</span>
            <span className="text-text-dim ml-auto shrink-0 text-[11.5px] whitespace-nowrap">
              {assetStatusLabel(a.status)} · {dashIfEmpty(a.location)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

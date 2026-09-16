import { Pill } from "@/components/atoms/pill";
import { buildCategoryMaps, type InventoryCategory } from "@/features/inventory/category";
import { assetStatusLabel } from "@/features/inventory/status";
import type { InventoryAsset } from "@/features/inventory/types";
import { dashIfEmpty } from "@/features/inventory/unknown-value";
import { ACTION_NEEDED_ID } from "@/features/inventory/ui-ids";

/**
 * "지금 조치가 필요한 자산 N건" — `needsAction`으로 거른 목록(page.tsx가 스탯과 **같은 함수**로 만든다).
 * 🔴 N = 이 배열의 길이(상한 없음 — [[#89]]). 카드 = `자산ID / 모델(없으면 분류) / 상태 · 현위치`(시안 그대로).
 *
 * **평소엔 접혀 있고(`<details>`) 스탯의 조치필요 카드를 누르면 펼쳐진다**(원장 2026-09-04 *"조치 필요한 자산을 해당 카드 누르면
 * 나오도록"*). 머리 줄(요약)을 직접 눌러도 열린다. 접힌 줄에도 건수가 서서 목록이 있다는 사실은 숨지 않는다.
 * ⚠️ 서버 컴포넌트라 클라 훅(useCategoryMaps)을 못 쓴다 — 목록을 받아 여기서 맵을 만든다(작은 배열).
 */
export function ActionNeeded({ assets, categories }: { assets: InventoryAsset[]; categories: InventoryCategory[] }) {
  const cats = buildCategoryMaps(categories);
  return (
    <details
      id={ACTION_NEEDED_ID}
      className="bg-card shadow-card scroll-mt-3 rounded-2xl [&_summary::-webkit-details-marker]:hidden"
    >
      <summary className="flex cursor-pointer list-none items-baseline gap-2 px-4 py-3">
        <h3 className="text-foreground text-sm font-bold">지금 조치가 필요한 자산</h3>
        <Pill color="danger">{assets.length}건</Pill>
        <span className="text-text-faint ml-auto text-xs">눌러서 펼치기 · 접기</span>
      </summary>
      <ul className="grid gap-x-4 gap-y-1.5 px-4 pb-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {assets.map((a) => (
          <li key={a.id} className="flex min-w-0 items-baseline gap-2 text-xs">
            <span className="border-line bg-bg-soft text-foreground shrink-0 rounded-md border px-1.5 py-0.5 font-mono text-xs">
              {a.assetCode}
            </span>
            <span className="text-foreground min-w-0 truncate font-medium">{a.model ?? cats.labelOf(a.category)}</span>
            <span className="text-text-dim ml-auto shrink-0 text-xs whitespace-nowrap">
              {assetStatusLabel(a.status)} · {dashIfEmpty(a.location)}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

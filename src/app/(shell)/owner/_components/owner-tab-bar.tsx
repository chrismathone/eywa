import { FaceTabs } from "@/components/face-tabs";
import { ownerTabRows } from "@/features/owner/tab-rows";
import type { OwnerFaceDef, OwnerFaceKey } from "@/features/owner/tabs";

/**
 * 학원 설정 상단 탭 — 면이 많으면 **범주 줄 + 그 범주의 면 줄**, 적으면 종전처럼 한 줄(`ownerTabRows`).
 * 범주 줄의 칸은 목적지가 아니라 묶음이라, 그 묶음의 첫 면에 붙인 사용자 지정 이름을 따라가지 않는다(`customLabels={false}`).
 */
export function OwnerTabBar({ faces, active }: { faces: readonly OwnerFaceDef[]; active: OwnerFaceKey }) {
  const rows = ownerTabRows(faces, active);
  if (rows.mode === "flat") return <FaceTabs faces={rows.faces} active={active} ariaLabel="학원 설정·관리 면 전환" />;
  return (
    <div className="min-w-0 space-y-2">
      <FaceTabs faces={rows.categories} active={rows.activeCategory} ariaLabel="학원 설정 범주 전환" customLabels={false} />
      {rows.faces.length > 0 ? (
        <FaceTabs faces={rows.faces} active={active} level="secondary" ariaLabel="학원 설정·관리 면 전환" />
      ) : null}
    </div>
  );
}

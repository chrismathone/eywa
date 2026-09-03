import { BigStat } from "@/components/atoms/big-stat";
import { EyIcon } from "@/components/icons/eywa-icons";
import type { InventoryStats } from "@/features/inventory/stats";

/**
 * 상단 스탯 5장(Editorial 문법 ② — 로컬 Stat 신설 금지). 숫자는 자산 표에서 센 값이라 시안의
 * "현황판은 수식으로" 절이 필요 없다(수기 숫자가 애초에 없다). 색은 의미에만 — 조치필요만 위험색.
 */
export function StatsRow({ stats }: { stats: InventoryStats }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
      <BigStat label="전체 자산" value={stats.total} unit="대" sub="폐기 제외" icon={<EyIcon name="archive" size={16} />} />
      <BigStat label="사용중" value={stats.inUse} unit="대" tone="green" icon={<EyIcon name="check" size={16} />} />
      <BigStat label="대여중" value={stats.onLoan} unit="대" sub="대여이력 연동" tone="blue" icon={<EyIcon name="users" size={16} />} />
      <BigStat
        label="조치필요"
        value={stats.needsAction}
        unit="대"
        sub="분실 · 확인 · 미등록 · 수리"
        tone="danger"
        valueClass={stats.needsAction > 0 ? "text-danger" : undefined}
        icon={<EyIcon name="alert" size={16} />}
      />
      <BigStat label="폐기" value={stats.disposed} unit="대" sub="이력 보존" icon={<EyIcon name="trash" size={16} />} />
    </div>
  );
}

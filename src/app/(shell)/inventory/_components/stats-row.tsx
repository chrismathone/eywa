"use client";

import { BigStat } from "@/components/atoms/big-stat";
import { StatStrip } from "@/components/atoms/stat-strip";
import { MenuGlyph } from "@/components/icons/menu-glyph";
import type { InventoryStats } from "@/features/inventory/stats";
import { ACTION_NEEDED_ID } from "@/features/inventory/ui-ids";

/**
 * 상단 스탯 5장(Editorial 문법 ② — 로컬 Stat 신설 금지). 숫자는 자산 표에서 센 값이라 시안의
 * "현황판은 수식으로" 절이 필요 없다(수기 숫자가 애초에 없다). 색은 의미에만 — 조치필요만 위험색.
 *
 * **조치필요 카드는 누른다**(원장 2026-09-04: *"조치 필요한 자산을 해당 카드 누르면 나오도록 · 누를 수 있다는 이펙트를 주기 위해
 * 3d블럭처럼"*) — 아래 "지금 조치가 필요한 자산" 목록(`<details>`)을 펼치고 그 자리로 스크롤한다. 목록은 평소 접혀 있다.
 * 카드 하나가 버튼이라 이 파일만 클라 컴포넌트다(숫자는 서버가 센 값 그대로).
 */
export function StatsRow({ stats }: { stats: InventoryStats }) {
  const openActionList = () => {
    const el = document.getElementById(ACTION_NEEDED_ID);
    if (!(el instanceof HTMLDetailsElement)) return;
    el.open = true;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  return (
    <StatStrip label="資産現況">
      <BigStat label="전체 자산" value={stats.total} unit="대" sub="폐기 제외" icon={<MenuGlyph name="archive" size={22} />} />
      <BigStat label="사용중" value={stats.inUse} unit="대" tone="green" icon={<MenuGlyph name="check" size={22} />} />
      <BigStat label="대여중" value={stats.onLoan} unit="대" sub="대여이력 연동" tone="blue" icon={<MenuGlyph name="users" size={22} />} />
      <BigStat
        label="조치필요"
        value={stats.needsAction}
        unit="대"
        sub="분실 · 확인 · 미등록 · 수리"
        tone="danger"
        valueClass={stats.needsAction > 0 ? "text-danger" : undefined}
        icon={<MenuGlyph name="alert" size={22} />}
        onClick={stats.needsAction > 0 ? openActionList : undefined}
        ariaLabel={stats.needsAction > 0 ? `조치필요 ${stats.needsAction}대 — 목록 열기` : undefined}
      />
      <BigStat label="폐기" value={stats.disposed} unit="대" sub="이력 보존" icon={<MenuGlyph name="trash" size={22} />} />
    </StatStrip>
  );
}

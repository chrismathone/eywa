"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { planMonthLabel, type PlanMonthSummary } from "@/features/timetable-dev/types";

/**
 * 비교할 두 달 고르기 — URL(`?a=&b=`)이 진실이라 링크·새로고침·창 복원에 그대로 살아남는다.
 *
 * 네이티브 `<select>`는 신규 금지(디자인 스크롤바 미적용) 규약이라 `SearchableSelect`로 통일한다.
 * `FilterSelect`를 쓰지 않은 이유: 그쪽은 "전체"(빈 값) 옵션을 항상 앞에 끼우는데, 비교는 **두 달이
 * 반드시 있어야** 성립해서 빈 값이 뜻을 갖지 못한다(고르면 화면이 통째로 사라진다).
 *
 * ⚠️ 같은 달을 양쪽에 고르면 diff가 전부 '동일'이 된다 — 막지는 않되(일시적으로 스쳐 지나갈 수 있다)
 *    화면이 안내 문구를 띄운다.
 */
export function MonthPairPicker({
  months,
  a,
  b,
}: {
  months: PlanMonthSummary[];
  /** 기준 달(왼쪽). 여기에만 있는 칸 = 삭제. */
  a: string;
  /** 비교 달(오른쪽). 여기에만 있는 칸 = 추가. */
  b: string;
}) {
  const router = useRouter();
  const pathname = usePathname() ?? "/timetable-dev/compare";
  const params = useSearchParams();

  const options = months.map((m) => ({
    value: m.month,
    label: planMonthLabel(m.month),
    hint: `${m.slotCount}칸 · 반 ${m.classCount}개`,
  }));

  const go = (nextA: string, nextB: string) => {
    const next = new URLSearchParams(params?.toString() ?? "");
    next.set("a", nextA);
    next.set("b", nextB);
    router.push(`${pathname}?${next.toString()}`);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-text-dim shrink-0 text-[12px]">기준</span>
      <SearchableSelect
        className="w-40"
        value={a}
        onValueChange={(v) => go(v, b)}
        options={options}
        ariaLabel="기준 달"
        placeholder="기준 달"
        cap={120}
        highlightSelected
      />
      <Button
        variant="outline"
        size="sm"
        onClick={() => go(b, a)}
        title="기준 달과 비교 달을 맞바꾼다 — 추가와 삭제가 뒤집힌다"
      >
        맞바꾸기
      </Button>
      <span className="text-text-dim shrink-0 text-[12px]">비교</span>
      <SearchableSelect
        className="w-40"
        value={b}
        onValueChange={(v) => go(a, v)}
        options={options}
        ariaLabel="비교 달"
        placeholder="비교 달"
        cap={120}
        highlightSelected
      />
    </div>
  );
}

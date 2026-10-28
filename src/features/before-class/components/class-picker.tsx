"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { TOOLBAR_SELECT } from "@/components/toolbar-controls";
import { useEmbed, withEmbed } from "@/components/workspace/embed-context";
import type { ChecklistTarget } from "../types";

/**
 * 시험 반 고르기 — 반을 바꾸면 그 반의 달 자료를 새로 읽는다(주소 `?class=`). 창 안에서는 embed를 지킨다([[#133]]).
 * 드롭다운(원장 2026-10-28 *"반이 많아지면 보기 너무 불편 — 드롭다운으로"*): 옛 칩 줄은 반 수만큼 툴바가 길어졌다.
 * 검색되고 담임 이름이 옆 열에 선다. 이동은 이전 화면을 둔 채 받는다(PeriodNav와 같은 transition).
 */
export function ClassPicker({ targets, current, month }: { targets: ChecklistTarget[]; current: string; month: string }) {
  const embed = useEmbed();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const go = (id: string) => {
    if (!id || id === current) return;
    const raw = `/before-class?class=${id}&month=${month}`;
    startTransition(() => router.push(embed ? withEmbed(raw) : raw));
  };
  return (
    <div className={`flex items-center gap-1.5 ${pending ? "opacity-60" : ""}`} aria-busy={pending}>
      <span className="micro shrink-0">반</span>
      <SearchableSelect
        ariaLabel="반"
        options={targets.map((t) => ({ value: t.id, label: t.name, hint: t.teacherName || undefined }))}
        value={current}
        onValueChange={go}
        highlightSelected
        searchPlaceholder="반·담임 검색"
        className="w-64 max-w-full"
        triggerClassName={TOOLBAR_SELECT}
      />
    </div>
  );
}

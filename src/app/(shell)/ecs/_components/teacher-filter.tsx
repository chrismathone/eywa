"use client";

import { TOOLBAR_SELECT } from "@/components/toolbar-controls";

// 담임 보기 필터(전체 / 담임별 / 담임 미지정) — ECS 랜딩 헤더. 원장 2026-08-11 *"담임 필터링 가능하게."*
//
// ⚠️ **서버가 진실**이다(목록을 서버가 좁혀 내려준다) → 저장 후 `router.refresh()`. 프로그램 필터와 같은 규약
//    (클라에서만 감추면 주 이동·새로고침에 필터가 풀리고, 머리의 '반 N개 · 교시 작성 N/M'이 목록과 갈린다).
// ⚠️ 계정 귀속(`users.ui_prefs.ecs.teacher`) — 다른 PC에서도 같은 담임으로 열린다.
// ⚠️ 프로그램은 3칸 고정이라 알약 토글이지만 담임은 십수 명이라 **드롭다운**이다(칩으로 깔면 툴바가
//    두 줄이 되어, 정리하려던 화면이 도로 어수선해진다). 새 드롭다운 기본값 = SearchableSelect.
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { setMyEcsTeacher } from "@/features/class-sheets/server/actions";
import { ECS_TEACHER_ALL, type LandingTeacherOption } from "@/features/class-sheets/landing-teacher";

export function EcsTeacherFilter({
  value,
  options,
  totalCount,
}: {
  value: string;
  options: LandingTeacherOption[];
  /** '담임 전체'에 붙는 개수 = 지금 프로그램 필터에서 보이는 반 수. */
  totalCount: number;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const pick = useCallback(
    async (next: string) => {
      if (pending || next === value) return;
      setPending(true);
      try {
        const r = await setMyEcsTeacher(next);
        if (!r.ok) {
          toast.error(r.error ?? "보기 설정을 저장하지 못했습니다");
          return;
        }
        router.refresh();
      } finally {
        setPending(false);
      }
    },
    [pending, router, value],
  );

  // 담임이 한 명뿐이면 고를 것이 없다 — 눌러도 같은 목록인 컨트롤은 자리만 차지한다(강사 본인 화면).
  if (options.length < 2) return null;

  return (
    <span className="flex items-center gap-1.5" title="담임별로 반 목록을 좁혀 봅니다(내 계정에 저장 — 다른 PC에서도 같은 상태로 열립니다)">
      <span className="micro">담임</span>
      <SearchableSelect
        compact
        className="w-36"
        ariaLabel="담임으로 반 목록 좁히기"
        value={value}
        onValueChange={pick}
        searchPlaceholder="담임 검색..."
        options={[
          { value: ECS_TEACHER_ALL, label: "전체", hint: `${totalCount}` },
          ...options.map((o) => ({ value: o.value, label: o.label, hint: `${o.count}` })),
        ]}
        // 같은 툴바의 다른 컨트롤(보기·주·프로그램)과 같은 높이·라운드 — 여기만 알약이면 그 줄이
        // 통째로 어긋난다(원장 2026-09-01 툴바 통일). 고른 값 표시는 종전대로 테두리 강조.
        // 🔴 고른 값 표시는 `!`로 확정한다 — TOOLBAR_SELECT의 `border-border`와 같은 축이라
        //    그냥 덧붙이면 승자를 문자열 순서가 아니라 생성된 CSS 순서가 정한다([[#116]]).
        triggerClassName={`${TOOLBAR_SELECT} font-medium ${
          value === ECS_TEACHER_ALL ? "" : "border-foreground!"
        } ${pending ? "opacity-60" : ""}`}
      />
    </span>
  );
}

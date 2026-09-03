"use client";

import { TOOLBAR_SEG_BOX } from "@/components/toolbar-controls";

// 프로그램 보기 필터(전체 / EiE / 인재원 영어) — ECS 랜딩 헤더. 0176a `classes.english_track`.
//
// 원장 2026-08-04: *"상단 헤더에 (전체/EiE/인재원 영어) 토글버튼 만들고 on/off 할 수 있게."*
// + *"당연하지만 항상 모든 뷰 세팅은 '계정에 귀속'."* → localStorage가 아니라 `users.ui_prefs.ecs.englishTrack`.
//
// ⚠️ **서버가 진실**이다(목록을 서버가 좁혀 내려준다) → 저장 후 `router.refresh()`. 클라에서만 감추면
//    주 이동·새로고침에 필터가 풀려 "껐는데 다시 켜진다"가 된다.
// ⚠️ 개수는 **필터 전** 집합 기준이라 무엇을 고르든 숫자가 안 변한다(0인 칸도 눌러볼 수 있게 그대로 둔다 —
//    비활성으로 만들면 "왜 못 누르지"가 되고, 눌러서 빈 목록 + 안내를 보는 편이 정직하다).
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { setMyEcsEnglishTrack } from "@/features/class-sheets/server/actions";
import {
  ENGLISH_TRACK_FILTERS,
  ENGLISH_TRACK_FILTER_LABEL,
  type EnglishTrackFilter,
} from "@/features/classes/english-track";

export function EcsTrackFilter({
  value,
  counts,
}: {
  value: EnglishTrackFilter;
  counts: Record<EnglishTrackFilter, number>;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const pick = useCallback(
    async (next: EnglishTrackFilter) => {
      if (pending || next === value) return;
      setPending(true);
      try {
        const r = await setMyEcsEnglishTrack(next);
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

  return (
    <span
      className={TOOLBAR_SEG_BOX}
      title="영어 프로그램별로 반 목록을 좁혀 봅니다(내 계정에 저장 — 다른 PC에서도 같은 상태로 열립니다)"
    >
      <span className="text-text-dim px-1.5 text-xs font-bold">프로그램</span>
      {ENGLISH_TRACK_FILTERS.map((f) => (
        <button
          key={f}
          type="button"
          disabled={pending}
          onClick={() => pick(f)}
          aria-pressed={value === f}
          className={`cursor-pointer rounded-md px-2 py-1 text-xs font-bold transition disabled:cursor-wait disabled:opacity-60 ${
            value === f ? "bg-primary text-primary-foreground" : "text-text-dim hover:bg-bg-soft"
          }`}
        >
          {ENGLISH_TRACK_FILTER_LABEL[f]}
          <span className={`num ml-1 ${value === f ? "opacity-80" : "opacity-60"}`}>{counts[f]}</span>
        </button>
      ))}
    </span>
  );
}

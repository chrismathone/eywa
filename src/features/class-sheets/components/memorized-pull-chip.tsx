"use client";

/**
 * JJ 교시 카드의 **[SRS 단어수]** — 그 교시 명단의 '누적 암기 단어수'를 SRS 최신값으로 맞춘다
 * (원장 2026-09-28: *"최신버전으로 srs 업데이트 뭐 해서 가져와서 자동기입되게 하는 기능 추가"*).
 *
 * 🔑 자동(매일 04:20 KST 크론)·자리 출석부의 같은 이름 버튼과 **같은 서버 판단**을 탄다 — 셋이 다른 숫자를
 *    적으면 안 된다. 이 버튼은 결과만 옮긴다(무엇을 덮을지 여기서 정하지 않는다).
 * 🔴 **서버가 돌려준 값을 화면 state에 직접 머지한다** — 마크는 `useState`라 `router.refresh()`로는 안
 *    바뀐다(sheet-client `applyCarried`와 같은 이유: 안 옮기면 "눌렀는데 칸이 그대로"로 보인다).
 * 🔴 누른 사람에게 **무엇을 안 했는지**까지 말한다(메모가 든 칸·짝 없는 학생·이미 최신) — 판단은 전부
 *    서버가 하고 문장도 서버가 만든다.
 * ⚠️ 두 번 눌러 두 번 부르지 않게 잠근다(같은 칸을 두 번 쓰지는 않지만 SRS를 두 번 부른다).
 * ⚠️ 카드 **안쪽** 컨트롤이라 툴바 규약(h-8 칩) 대상이 아니다 — 머리 줄의 강사 알약과 같은 치수를 쓴다.
 */

import { useTransition } from "react";
import { toast } from "sonner";
import { useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";
import {
  pullEcsMemorizedWords,
  type EcsMemorizedWritten,
} from "../server/memorized-actions";

export function MemorizedPullChip({
  classId,
  date,
  slotStart,
  onWritten,
}: {
  classId: string;
  date: string;
  slotStart: string;
  /** 적힌 값을 화면 state로 옮기는 손 — `SheetHandlers.applyMemorizedWords`와 **같은 모양**이어야 한다. */
  onWritten: (date: string, slotStart: string, written: readonly EcsMemorizedWritten[]) => void;
}) {
  const t = useSheetT();
  const tf = useSheetTf();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      title={t("roster.srs.title")}
      // 머리 줄의 강사 알약과 같은 모양(테두리 알약) + 눌 수 있다는 표시.
      className="border-line-strong text-foreground hover:bg-bg-soft shrink-0 cursor-pointer rounded-full border px-2 py-0.5 text-xs font-bold whitespace-nowrap disabled:cursor-wait disabled:opacity-60"
      onClick={() =>
        start(async () => {
          const res = await pullEcsMemorizedWords({ classId, date, slotStart });
          if (!res.ok) {
            toast.error(res.error);
            return;
          }
          onWritten(date, slotStart, res.written);
          toast.success(tf("roster.srs.done", { notice: res.notice }));
        })
      }
    >
      {pending ? t("roster.srs.busy") : t("roster.srs")}
    </button>
  );
}

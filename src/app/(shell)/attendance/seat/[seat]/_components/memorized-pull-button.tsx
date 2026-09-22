"use client";

/**
 * JJ실 자리 출석부 — **'인재원 단어수 가져오기'**(원장 2026-09-21: *"수동으로 가져와서 입력되게도해줘"*).
 *
 * 🔑 자동(매일 04:20 KST 크론)과 **같은 서버 함수**를 부른다 — 두 길이 다른 숫자를 적으면 안 된다.
 * 🔴 누른 사람에게 **무엇을 안 했는지**까지 말한다(이미 적힌 칸·짝 없는 학생) — "눌렀는데 아무 일도 없다"로
 *    보이지 않게. 판단은 전부 서버가 하고 이 버튼은 결과만 옮긴다.
 * ⚠️ 두 번 눌러 두 번 부르지 않게 잠근다(같은 칸을 두 번 쓰지는 않지만 인재원을 두 번 부른다).
 */

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { TOOLBAR_CHIP, TOOLBAR_CHIP_OFF } from "@/components/toolbar-controls";
import { pullSeatMemorizedWords } from "@/features/attendance/seat/server/memorized-actions";
import type { SeatKey } from "@/features/attendance/seat/seat";

export function MemorizedPullButton({ seat, date }: { seat: SeatKey; date: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      title="그 날 명단의 '누적 암기 단어수' 빈 칸을 인재원 장기기억 단어수로 채웁니다 — 이미 적힌 칸은 그대로 둡니다"
      className={`${TOOLBAR_CHIP} ${TOOLBAR_CHIP_OFF} mr-1 disabled:opacity-50`}
      onClick={() =>
        start(async () => {
          const res = await pullSeatMemorizedWords({ seat, date });
          if ("error" in res) {
            toast.error(res.error);
            return;
          }
          toast.success(`누적 암기 단어수 — ${res.notice}`);
          router.refresh();
        })
      }
    >
      {pending ? "가져오는 중…" : "인재원 단어수"}
    </button>
  );
}

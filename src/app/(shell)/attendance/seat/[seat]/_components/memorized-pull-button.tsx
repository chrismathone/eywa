"use client";

/**
 * JJ실 자리 출석부 — **'SRS 단어수 가져오기'**(원장 2026-09-21: *"수동으로 가져와서 입력되게도해줘"*).
 *
 * 🔑 자동(매일 04:20 KST 크론)·영어 강사 시트의 같은 이름 버튼과 **같은 서버 함수**를 부른다 —
 *    세 길이 다른 숫자를 적으면 안 된다.
 * 🔑 이름은 앱 전역에서 **SRS**로 부른다(원장 2026-09-28에 학생 상세 탭도 'SRS'로 통일) — 한 기능이
 *    화면마다 '인재원'과 'SRS'로 갈려 불리면 같은 것인지 눌러 보기 전엔 모른다.
 * 🔴 누른 사람에게 **무엇을 안 했는지**까지 말한다(메모가 든 칸·이미 최신인 칸·짝 없는 학생) — "눌렀는데 아무 일도 없다"로
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
      title="그 날 명단의 '누적 암기 단어수'를 SRS의 '지금까지 학습한 단어 수'로 맞춥니다 — 빈 칸은 채우고 숫자는 최신값으로 갱신하며, 메모가 적힌 칸은 그대로 둡니다"
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
      {pending ? "가져오는 중…" : "SRS 단어수"}
    </button>
  );
}

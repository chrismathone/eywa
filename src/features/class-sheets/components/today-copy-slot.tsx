"use client";

/**
 * 오늘 보드의 **직전 교시 복사** — 빈 교시에서 "주간 시트로 가서 줄을 추가"하는 우회로를 한 클릭으로.
 * 저장은 주간 시트와 **같은 RPC**(`ecs_copy_slot`, 0183a — 대상에 의미 있는 행이 있으면 서버가 거부)라
 * 여기서 새 쓰기 경로를 만들지 않는다. 성공하면 `router.refresh()`로 서버 카드가 새 줄을 다시 내려준다
 * (오늘 보드 계획 줄은 서버 props가 진실 — 주간 시트처럼 클라 state를 갈아끼우는 대신 재조회가 단순하다).
 *
 * ⚠️ 시기는 **평시(regular) 고정** — 오늘 보드는 시기 구획이 없는 채우기 화면이라 여기서 내신을 고르게
 *    하면 컨트롤이 하나 더 붙는다. 내신 기간 복사는 시기 구획이 있는 주간 시트에서(카드의 링크가 그 길).
 * ⚠️ 복사는 대상 교시의 placeholder 행을 지우고 새로 넣으므로(0183a) **반영 전 flush** — 같은 반의 다른
 *    교시에 확정 안 된 입력(디바운스 800ms)이 남아 있으면 refresh가 그 글자를 앗아갈 수 있다(주간 시트
 *    `copySlot`과 같은 계약).
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { copySlotFromPrevious } from "../server/actions";
import type { SheetSaveStore } from "./use-sheet-saves";

export function TodayCopySlot({
  classId,
  date,
  slotStart,
  store,
}: {
  classId: string;
  date: string;
  slotStart: string;
  store: SheetSaveStore;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      title="같은 평시 계획 중 이 교시보다 앞선 가장 최근 교시에서 복사합니다(학생 기록은 복사하지 않습니다)"
      className="border-line-strong text-foreground hover:text-primary hover:border-primary cursor-pointer rounded-full border px-2 py-0.5 text-[12px] font-bold disabled:cursor-default disabled:opacity-60"
      onClick={() => {
        setBusy(true);
        void store
          .flush()
          .then((flushed) => {
            if (!flushed.ok) {
              const go = window.confirm(
                "아직 저장이 확정되지 않은 입력(또는 충돌)이 있습니다. 그래도 직전 교시를 복사할까요? (입력을 잃을 수 있습니다)",
              );
              if (!go) return;
            }
            return copySlotFromPrevious({ classId, planDate: date, slotStart, termMode: "regular" }).then((r) => {
              if (!r.ok) return void toast.error(r.error);
              if (r.copied === 0) {
                // 서버가 "조용히 성공한 척"을 안 하므로(0183a) 사유를 그대로 잇는다 — raw 코드는 한글로.
                return void toast.info(
                  r.reason === "target_not_empty"
                    ? "이미 계획이 있는 교시라 복사하지 않았습니다(덮어쓰기 없음)"
                    : "복사할 직전 교시가 없습니다(최근 8주 안에 작성된 평시 계획이 없습니다)",
                );
              }
              toast.success(`${r.sourceLabel ?? "직전 교시"}에서 ${r.copied}줄 복사했습니다`);
              router.refresh();
            });
          })
          // 서버 액션 reject(네트워크 단절 등)면 아무 피드백 없이 버튼만 풀린다 — 에러를 말한다(적대 리뷰).
          .catch(() => toast.error("직전 교시 복사에 실패했습니다 — 네트워크 연결을 확인해 주세요"))
          .finally(() => setBusy(false));
      }}
    >
      {/* '평시'를 라벨에 밝힌다 — 내신 기간에 이 버튼이 하는 일(평시 계획 복사)이 툴팁 없이도 보이게. */}
      {busy ? "복사 중…" : "평시 직전 교시 복사"}
    </button>
  );
}

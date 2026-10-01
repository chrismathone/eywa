"use client";

import { useState } from "react";
import { Send } from "@/components/icons/aywa-icon-compat";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { MakeeduPushCard } from "@/features/integrations/components/makeedu-push-card";
import { isPushInFlight } from "@/features/integrations/push-eligibility";
import type { UnpushedIntakeConsultation } from "@/features/integrations/server/makeedu-sync";

/**
 * 콜&상담 머리글의 'makeedu 보내기'(원장 2026-10-01 *"메이크에듀 역동기화 상단에 버튼 만들고 누르면 [카드] 나오고
 * 지정해서 보낼 수 있게"*). 누르면 연동 면과 **같은 카드**(`MakeeduPushCard`)를 다이얼로그로 연다 — 조회·전송 경로는
 * 그대로다(후보 = getUnpushedIntakeConsultations, 전송 = enqueueConsultationPush → makeedu_push_requests → 연동 PC).
 *
 * - `candidates === null` = 아직 조회 중(Suspense 대체 화면) — 같은 자리·같은 크기의 잠긴 버튼.
 * - 배지 = **지금 골라 보낼 수 있는 건수**(이미 큐에 있는 대기·제출 중은 뺀다 — 카드 체크박스와 같은 `isPushInFlight`).
 * - 보낸 뒤: 전송 액션의 `revalidatePath("/enrollment")`가 새 후보를 이 컴포넌트 prop으로 내려 준다(다이얼로그는 열린 채
 *   '전송 대기'로 바뀌고 배지가 줄어든다). 다이얼로그는 닫히면 언마운트돼 다시 열 때 선택·안내가 새로 시작된다(#67).
 * - 노출 게이트는 부모(page·섹션)가 `canPushToMakeedu`로 정한다 — 여기 오면 이미 통과한 사람이다.
 */
export function MakeeduPushButton({ candidates }: { candidates: UnpushedIntakeConsultation[] | null }) {
  const [open, setOpen] = useState(false);
  const ready = candidates ? candidates.filter((c) => !isPushInFlight(c.pushStatus)).length : 0;

  return (
    <>
      {/* 우상단 동작 = 공용 Button 기본 크기 · ghost(Primary는 '신규 등록' 하나 — 옆 'QR'·'계산기'와 같은 모양). */}
      <Button
        variant="ghost"
        disabled={candidates === null}
        onClick={() => setOpen(true)}
        aria-label={ready > 0 ? `makeedu 보내기 — 보낼 상담 ${ready}건` : "makeedu 보내기"}
      >
        <Send className="size-4" />
        makeedu 보내기
        {ready > 0 ? (
          <span className="bg-primary text-primary-foreground inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs font-medium tabular">
            {ready}
          </span>
        ) : null}
      </Button>
      {candidates ? (
        <Dialog open={open} onOpenChange={setOpen}>
          {/* 8열 표라 넓게 — 좁은 창에선 공용 Dialog가 화면 폭(−2rem)으로 줄고 표는 카드 안에서 가로 스크롤한다. */}
          <DialogContent aria-label="makeedu로 상담 보내기" className="p-6 sm:max-w-5xl">
            <MakeeduPushCard candidates={candidates} inDialog />
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
